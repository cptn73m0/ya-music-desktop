# -*- coding: utf-8 -*-
"""YaMusic Desktop Client — точка входа.

Создаёт окно pywebview со страницей music.yandex.ru, внедряет
assets/inject.js (кнопки «Скачать», окно токена, блокировщик рекламы,
автопринятие cookies, настройки загрузок) и регистрирует мост
JS <-> Python (авторизация, настройки, скачивание).
"""
import logging
import sys
import threading
from pathlib import Path

import webview

from core import auth
from core.downloader import Downloader
from core.settings import get_settings

BASE_DIR = Path(__file__).resolve().parent
INJECT_JS = BASE_DIR / "assets" / "inject.js"
APP_URL = "https://music.yandex.ru"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("ya-music-desktop")

# Скрываем чувствительные/шумные логи библиотек (токены в заголовках и т.п.)
for noisy in ("urllib3", "yandex_music", "keyring"):
    logging.getLogger(noisy).setLevel(logging.WARNING)

# Ссылки на окно нужны диалогу выбора папки.
_WINDOW = None


class JsApi:
    """Мост между внедрённым JS и Python.

    Длительные операции выполняются в отдельном потоке, чтобы UI не зависал.
    Возвращаем JS простые dict-структуры — pywebview сериализует их в JSON.
    """

    def __init__(self):
        self._settings = get_settings()
        self._downloader = Downloader(token_getter=auth.get_token,
                                      settings=self._settings)

    # ---- авторизация ----

    def is_authorized(self):
        return bool(auth.is_authorized())

    def save_token(self, token):
        try:
            auth.save_token(token)
        except ValueError as exc:
            return {"ok": False, "error": str(exc)}
        except RuntimeError as exc:
            return {"ok": False, "error": str(exc)}

        valid = auth.validate_token(token)
        self._downloader.reset_client()
        if not valid:
            return {"ok": True,
                    "warning": "Токен сохранён, но проверка не пройдена. Возможно, он неверен."}
        return {"ok": True}

    # ---- настройки загрузок ----

    def get_settings(self):
        return self._settings.as_dict()

    def save_settings(self, settings):
        settings = settings or {}
        try:
            path = settings.get("download_path")
            if path:
                self._settings.download_path = path
            layout = settings.get("download_layout")
            if layout:
                self._settings.download_layout = layout
            self._settings.save()
            logger.info("Настройки сохранены: путь=%s, раскладка=%s",
                        self._settings.download_path,
                        self._settings.download_layout)
            return {"ok": True, "settings": self._settings.as_dict()}
        except (ValueError, RuntimeError) as exc:
            return {"ok": False, "error": str(exc)}

    def browse_download_path(self):
        """Открывает нативный диалог выбора папки."""
        start_dir = str(self._settings.download_path)
        try:
            picked = _WINDOW.create_file_dialog(
                webview.FileDialog.FOLDER, directory=start_dir)
            if picked:
                return {"path": picked[0]}
        except Exception as exc:
            logger.error("Диалог выбора папки упал: %s", exc)
            return {"error": str(exc)}
        return {"cancelled": True}

    # ---- скачивание ----

    def download(self, item_id, item_type):
        finished = threading.Event()
        result = {}

        def _worker():
            try:
                result.update(self._downloader.download_item(item_id, item_type))
            except Exception as exc:
                logger.error("Скачивание %s:%s упало: %s", item_type, item_id, exc)
                result.update({"ok": False, "error": str(exc)})
            finally:
                finished.set()

        threading.Thread(target=_worker, daemon=True).start()
        finished.wait()
        return result


def _inject(window):
    try:
        code = INJECT_JS.read_text(encoding="utf-8")
    except OSError as exc:
        logger.error("Не удалось прочитать %s: %s", INJECT_JS, exc)
        return
    window.evaluate_js(code)
    logger.info("Скрипт внедрён")


def main():
    global _WINDOW
    api = JsApi()
    window = webview.create_window(
        "YaMusic Desktop Client",
        APP_URL,
        js_api=api,
        width=1280,
        height=800,
        min_size=(900, 600),
    )
    _WINDOW = window

    # Инъекция при загрузке и при навигации внутри SPA
    window.events.loaded += lambda: _inject(window)

    webview.start(debug=False)


if __name__ == "__main__":
    main()
