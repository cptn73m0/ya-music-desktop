# -*- coding: utf-8 -*-
"""Скачивание треков, альбомов и плейлистов Яндекс Музыки.

Использует библиотеку `yandex-music` и сохраняемый API-токен.
Файлы складываются в папку:
    <профиль пользователя>/Music/YaMusic Desktop/
с ID3-тегами (название, исполнитель, альбом, номер трека, год) и обложкой,
встроенной в файл через `mutagen`.
"""
import logging
import re
import threading
from pathlib import Path

import requests
from mutagen.id3 import APIC, TALB, TIT2, TPE1, TRCK, TDRC, error as ID3Error
from mutagen.mp3 import MP3

logger = logging.getLogger(__name__)

DEFAULT_DOWNLOAD_DIR = Path.home() / "Music" / "YaMusic Desktop"
MAX_PART_LEN = 64

# Встроенный прогресс-бар скачивания библиотеки mutes stdout — отключаем
_TEMPLATE_FILENAME = "{number} - {title}"


class _MutesDummy:
    """Заглушка вместо прогресс-бара tqdm из yandex-music."""

    def __call__(self, iterable=None, **kwargs):
        return iterable if iterable is not None else []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def _sanitize(text: str) -> str:
    """Убирает запрещённые для имён файлов символы и обрезает длину."""
    text = re.sub(r'[\\/:*?"<>|]', " ", text)
    text = re.sub(r"\s+", " ", text).strip(" .")
    return text[:MAX_PART_LEN] or "unknown"


def _format_artists(artists) -> str:
    names = []
    for artist in artists or []:
        name = getattr(artist, "name", None)
        if name:
            names.append(name)
    return ", ".join(names) if names else "Unknown Artist"


def _write_tags(file_path: Path, track, album=None) -> None:
    """Проставляет ID3-теги и встраивает обложку в mp3-файл."""
    try:
        audio = MP3(str(file_path))
        if audio.tags is None:
            audio.add_tags()
        tags = audio.tags

        tags.delall("TIT2")
        tags.delall("TPE1")
        tags.delall("TALB")
        tags.delall("TRCK")
        tags.delall("TDRC")
        tags.delall("APIC")

        title = getattr(track, "title", None) or "Unknown"
        tags.add(TIT2(encoding=3, text=title))
        tags.add(TPE1(encoding=3, text=_format_artists(track.artists)))

        albums = track.albums or ([album] if album else [])
        if albums:
            first = albums[0]
            album_title = getattr(first, "title", None)
            if album_title:
                tags.add(TALB(encoding=3, text=album_title))
            year = getattr(first, "year", None)
            if year:
                tags.add(TDRC(encoding=3, text=str(year)))

        track_position = getattr(track, "track_position", None)
        index = getattr(track_position, "index", None) if track_position else None
        if index:
            tags.add(TRCK(encoding=3, text=str(index)))

        cover_bytes = _fetch_cover_bytes(track)
        if cover_bytes:
            tags.add(APIC(encoding=3, mime="image/jpeg", type=3,
                          desc="Cover", data=cover_bytes))

        audio.save(v2_version=3)
    except (ID3Error, Exception) as exc:  # теги не должны ломать скачивание
        logger.warning("Не удалось проставить теги для %s: %s", file_path, exc)


def _fetch_cover_bytes(track) -> bytes | None:
    cover_uri = getattr(track, "cover_uri", None)
    if not cover_uri:
        albums = track.albums or []
        if albums:
            cover_uri = getattr(albums[0], "cover_uri", None)
    if not cover_uri:
        return None
    url = f"https://{cover_uri.replace('%%', '400x400')}"
    try:
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        return resp.content
    except requests.RequestException as exc:
        logger.warning("Не удалось скачать обложку: %s", exc)
        return None


class Downloader:
    """Потокобезопасный менеджер скачиваний для моста JS <-> Python."""

    def __init__(self, token_getter, download_dir: Path = DEFAULT_DOWNLOAD_DIR):
        self._token_getter = token_getter
        self._download_dir = Path(download_dir)
        self._download_dir.mkdir(parents=True, exist_ok=True)
        self._client = None
        self._client_lock = threading.Lock()

    # ---------- внутренние ----------

    def _get_client(self):
        """Ленивая инициализация клиента yandex-music по текущему токену."""
        with self._client_lock:
            if self._client is not None:
                return self._client
            token = self._token_getter()
            if not token:
                raise RuntimeError("Токен не найден. Введите его в настройках.")
            try:
                import yandex_music.client as ym_client_mod
                # Отключаем шумный прогресс-бар в stdout
                ym_client_mod.tqdm = _MutesDummy()
            except Exception:
                pass
            from yandex_music import Client
            self._client = Client(token).init()
            logger.info("Клиент yandex-music инициализирован")
            return self._client

    def reset_client(self):
        """Сбрасывает кэш клиента (например, после смены токена)."""
        with self._client_lock:
            self._client = None

    def _save_track(self, track, directory: Path, number: int | None = None,
                    album_for_tags=None) -> Path:
        title = _sanitize(getattr(track, "title", "track"))
        artist = _sanitize(_format_artists(track.artists))
        folder = directory / artist
        folder.mkdir(parents=True, exist_ok=True)

        prefix = f"{number:02d} - " if number is not None else ""
        file_path = folder / f"{prefix}{artist} - {title}.mp3"

        track.download(str(file_path), bitrate_in_kbps=320)
        _write_tags(file_path, track, album=album_for_tags)
        logger.info("Скачан трек: %s", file_path.name)
        return file_path

    # ---------- публичный API ----------

    def download_track(self, track_id: str):
        client = self._get_client()
        tracks = client.tracks([track_id])
        if not tracks:
            raise RuntimeError(f"Трек {track_id} не найден")
        path = self._save_track(tracks[0], self._download_dir)
        return {"ok": True, "saved": 1, "path": str(path)}

    def download_album(self, album_id: str):
        client = self._get_client()
        album = client.albums_with_tracks(album_id)
        if not album:
            raise RuntimeError(f"Альбом {album_id} не найден")

        album_title = _sanitize(getattr(album, "title", "album"))
        directory = self._download_dir / album_title
        directory.mkdir(parents=True, exist_ok=True)

        saved, errors = 0, []
        number = 1
        for volume in album.volumes or []:
            for track in volume:
                try:
                    self._save_track(track, directory, number=number,
                                     album_for_tags=album)
                    saved += 1
                except Exception as exc:
                    logger.error("Ошибка скачивания трека из альбома: %s", exc)
                    errors.append(str(exc))
                number += 1

        return {"ok": saved > 0, "saved": saved, "errors": errors,
                "path": str(directory)}

    def download_playlist(self, playlist_id: str):
        """playlist_id приходит формата "<owner_uid>:<kind>"."""
        client = self._get_client()
        try:
            owner, kind = playlist_id.split(":", 1)
        except ValueError as exc:
            raise RuntimeError(
                "Неверный идентификатор плейлиста") from exc

        playlist = client.users_playlists(int(kind), int(owner))
        if not playlist:
            raise RuntimeError(f"Плейлист {playlist_id} не найден")

        title = _sanitize(getattr(playlist, "title", "playlist"))
        directory = self._download_dir / title
        directory.mkdir(parents=True, exist_ok=True)

        saved, errors = 0, []
        for number, short in enumerate(playlist.tracks or [], start=1):
            try:
                track = short.track if hasattr(short, "track") else short.fetch_track()
                if track is None:
                    continue
                self._save_track(track, directory, number=number)
                saved += 1
            except Exception as exc:
                logger.error("Ошибка скачивания трека из плейлиста: %s", exc)
                errors.append(str(exc))

        return {"ok": saved > 0, "saved": saved, "errors": errors,
                "path": str(directory)}

    def download_item(self, item_id: str, item_type: str):
        """Точка входа от JS: скачать track / album / playlist."""
        item_type = (item_type or "").lower()
        if item_type == "track":
            return self.download_track(str(item_id))
        if item_type == "album":
            return self.download_album(str(item_id))
        if item_type == "playlist":
            return self.download_playlist(str(item_id))
        raise RuntimeError(f"Неизвестный тип объекта: {item_type}")
