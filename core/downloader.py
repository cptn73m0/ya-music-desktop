# -*- coding: utf-8 -*-
"""Скачивание треков, альбомов и плейлистов Яндекс Музыки.

Использует библиотеку `yandex-music` и сохраняемый API-токен.
Папка загрузок и структура каталогов берутся из core.settings:

    flat          — все треки в одном каталоге;
    artist        — <base>/<Исполнитель>/<Трек>.mp3;
    album         — <base>/<Альбом>/<Трек>.mp3;
    artist_album  — <base>/<Исполнитель>/<Альбом>/<Трек>.mp3.

ID3-теги (название, исполнитель, альбом, номер трека, год) и обложка
встраиваются в файл через `mutagen`.
"""
import logging
import re
import threading
from pathlib import Path

import requests
from mutagen.id3 import APIC, TALB, TIT2, TPE1, TRCK, TDRC, error as ID3Error
from mutagen.mp3 import MP3

from core.settings import get_settings

logger = logging.getLogger(__name__)

MAX_PART_LEN = 64


class _MutesDummy:
    """Заглушка вместо прогресс-бара tqdm из yandex-music (не мусорим в stdout)."""

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


def _track_album(track):
    albums = getattr(track, "albums", None) or []
    return albums[0] if albums else None


def _fetch_cover_bytes(track) -> bytes | None:
    cover_uri = getattr(track, "cover_uri", None)
    if not cover_uri:
        album = _track_album(track)
        if album is not None:
            cover_uri = getattr(album, "cover_uri", None)
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


def _write_tags(file_path: Path, track, album=None) -> None:
    """Проставляет ID3-теги и встраивает обложку в mp3-файл."""
    try:
        audio = MP3(str(file_path))
        if audio.tags is None:
            audio.add_tags()
        tags = audio.tags

        for frame in ("TIT2", "TPE1", "TALB", "TRCK", "TDRC", "APIC"):
            tags.delall(frame)

        title = getattr(track, "title", None) or "Unknown"
        tags.add(TIT2(encoding=3, text=title))
        tags.add(TPE1(encoding=3, text=_format_artists(track.artists)))

        album = album or _track_album(track)
        if album is not None:
            album_title = getattr(album, "title", None)
            if album_title:
                tags.add(TALB(encoding=3, text=album_title))
            year = getattr(album, "year", None)
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
    except Exception as exc:  # теги не должны ломать скачивание
        logger.warning("Не удалось проставить теги для %s: %s", file_path, exc)


class Downloader:
    """Потокобезопасный менеджер скачиваний для моста JS <-> Python."""

    def __init__(self, token_getter, settings=None):
        self._token_getter = token_getter
        self._settings = settings or get_settings()
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

    def _track_dir(self, base: Path, track, album=None) -> Path:
        """Целевая папка трека согласно настройке download_layout."""
        layout = self._settings.download_layout
        artist = _sanitize(_format_artists(track.artists))
        album = album or _track_album(track)
        album_title = _sanitize(getattr(album, "title", None) or "Без альбома")

        if layout == "flat":
            return base
        if layout == "artist":
            return base / artist
        if layout == "album":
            return base / album_title
        if layout == "artist_album":
            return base / artist / album_title
        return base

    def _save_track(self, track, base_dir: Path, number: int | None = None,
                    album=None) -> Path:
        directory = self._track_dir(base_dir, track, album=album)
        directory.mkdir(parents=True, exist_ok=True)

        title = _sanitize(getattr(track, "title", "track"))
        artist = _sanitize(_format_artists(track.artists))
        prefix = f"{number:02d} - " if number is not None else ""
        file_path = directory / f"{prefix}{artist} - {title}.mp3"

        track.download(str(file_path), bitrate_in_kbps=320)
        _write_tags(file_path, track, album=album)
        logger.info("Скачан трек: %s", file_path.name)
        return file_path

    # ---------- публичный API ----------

    def download_track(self, track_id: str):
        client = self._get_client()
        tracks = client.tracks([track_id])
        if not tracks:
            raise RuntimeError(f"Трек {track_id} не найден")
        base = self._settings.download_path
        base.mkdir(parents=True, exist_ok=True)
        path = self._save_track(tracks[0], base)
        return {"ok": True, "saved": 1, "path": str(path)}

    def download_album(self, album_id: str):
        client = self._get_client()
        album = client.albums_with_tracks(album_id)
        if not album:
            raise RuntimeError(f"Альбом {album_id} не найден")

        base = self._settings.download_path
        album_title = _sanitize(getattr(album, "title", "album"))
        logger.info("Скачивание альбома «%s» (layout=%s, база=%s)",
                    album_title, self._settings.download_layout, base)

        saved, errors = 0, []
        number = 1
        for volume in album.volumes or []:
            for track in volume:
                try:
                    self._save_track(track, base, number=number, album=album)
                    saved += 1
                except Exception as exc:
                    logger.error("Ошибка скачивания трека из альбома: %s", exc)
                    errors.append(str(exc))
                number += 1

        return {"ok": saved > 0, "saved": saved, "errors": errors,
                "path": str(base)}

    def download_playlist(self, playlist_id: str):
        """playlist_id приходит формата "<owner_uid>:<kind>" или uuid (для /playlists/<uuid>)."""
        client = self._get_client()

        if ":" in playlist_id:
            owner, kind = playlist_id.split(":", 1)
            playlist = client.users_playlists(kind, owner)
        else:
            # uuid (/playlists/<uuid>) — пробуем с текущим uid как owner (нормально для коллекции)
            my_uid = client.account_status().account.uid
            playlist = client.users_playlists(playlist_id, my_uid)

        if not playlist:
            raise RuntimeError(f"Плейлист {playlist_id} не найден")

        base = self._settings.download_path
        title = _sanitize(getattr(playlist, "title", "playlist"))
        # У плейлиста нет «своего» альбома: для flat/artist/album
        # используем базовую логику, но плейлист складываем в подпапку,
        # если выбрана раскладка flat — иначе треки свалятся в общую кучу.
        if self._settings.download_layout == "flat":
            base = base / title
        base.mkdir(parents=True, exist_ok=True)

        saved, errors = 0, []
        for number, short in enumerate(playlist.tracks or [], start=1):
            try:
                track = short.track if getattr(short, "track", None) else short.fetch_track()
                if track is None:
                    continue
                self._save_track(track, base, number=number)
                saved += 1
            except Exception as exc:
                logger.error("Ошибка скачивания трека из плейлиста: %s", exc)
                errors.append(str(exc))

        return {"ok": saved > 0, "saved": saved, "errors": errors,
                "path": str(base)}

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
