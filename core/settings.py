# -*- coding: utf-8 -*-
"""Настройки приложения (путь загрузок, структура каталогов).

Хранятся в JSON в профиле пользователя: ~/.ya-music-desktop/settings.json
(на Windows обычно C:\\Users\\<user>\\.ya-music-desktop\\settings.json).
"""
import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

DEFAULT_DOWNLOAD_DIR = Path.home() / "Music" / "YaMusic Desktop"

# Структуры каталогов:
#   flat          — все треки в одном каталоге;
#   artist        — разделение по папкам исполнителей;
#   album         — треки одного альбома в отдельный одноимённый каталог;
#   artist_album  — Исполнитель / Альбом / Трек.
LAYOUTS = ("flat", "artist", "album", "artist_album")

_DEFAULTS = {
    "download_path": str(DEFAULT_DOWNLOAD_DIR),
    "download_layout": "artist",
}


class Settings:
    def __init__(self, path: Path | None = None):
        self._path = Path(path) if path else Path.home() / ".ya-music-desktop" / "settings.json"
        self._data = dict(_DEFAULTS)
        self._load()

    def _load(self):
        try:
            if self._path.exists():
                loaded = json.loads(self._path.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    self._data.update({k: v for k, v in loaded.items() if k in _DEFAULTS})
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("Не удалось прочитать настройки: %s", exc)

        # Дефолт отсутствующего дома — не молчим
        if self._data.get("download_layout") not in LAYOUTS:
            self._data["download_layout"] = _DEFAULTS["download_layout"]

    def save(self):
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            self._path.write_text(
                json.dumps(self._data, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except OSError as exc:
            logger.error("Не удалось сохранить настройки: %s", exc)
            raise RuntimeError("Не удалось сохранить настройки") from exc

    # ---- свойства ----

    @property
    def download_path(self) -> Path:
        return Path(self._data.get("download_path") or _DEFAULTS["download_path"])

    @download_path.setter
    def download_path(self, value):
        value = str(value).strip()
        if not value:
            raise ValueError("Путь не может быть пустым")
        self._data["download_path"] = value

    @property
    def download_layout(self) -> str:
        return self._data["download_layout"]

    @download_layout.setter
    def download_layout(self, value):
        if value not in LAYOUTS:
            raise ValueError(f"Недопустимая структура: {value}")
        self._data["download_layout"] = value

    def as_dict(self):
        return {
            "download_path": self._data["download_path"],
            "download_layout": self._data["download_layout"],
            "layouts": list(LAYOUTS),
        }


_SETTINGS = None


def get_settings() -> Settings:
    global _SETTINGS
    if _SETTINGS is None:
        _SETTINGS = Settings()
    return _SETTINGS
