# -*- coding: utf-8 -*-
"""YaMusic Desktop Client — точка входа.

Создаёт окно pywebview со страницей music.yandex.ru, внедряет
assets/inject.js (кнопки «Скачать», окно токена) и регистрирует
мост JS <-> Python (авторизация и скачивание).
"""
import logging
import sys
import threading
import time
from pathlib import Path

import webview

from core import auth
from core.downloader import Downloader

BASE_DIR = Path(__file__).resolve().parent
INJECT_JS = BASE_DIR / "assets" / "inject.js"
APP_URL = "https://music.yandex.ru"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("ya-music-desktop")

# Скрываем чувствительные логи библиотек (токены в заголовках и т.п.)
for noisy in ("urllib3", "yandex_music", "keyring"):
    logging.getLogger(noisy).setLevel(logging.WARNING)


class JsApi:
    """Мост между внедрённым JS и Python.

    Скачивание выполняется в отдельном потоке, чтобы не блокировать UI.
    Возвращаем JS простые dict-структуры — pywebview сериализует их в JSON.
    """

    def __init__(self):
        self._downloader = Downloader(token_getter=auth.get_token)

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

        # Валидацию делаем мягко: плохой токен не блокируем,
        # но предупреждаем пользователя.
        valid = auth.validate_token(token)
        # Сбрасываем кэш клиента, чтобы при следующем скачивании
        # использовался уже новый токен.
        self._downloader.reset_client()
        if not valid:
            return {"ok": True, "warning": "Токен сохранён, но проверка не пройдена. Возможно, он неверен."}
        return {"ok": True}

    def get_token_help_url(self):
        return auth.TOKEN_HELP_URL

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
        # Ждём завершения pywebview-вызова, чтобы вернуть результат в JS.
        finished.wait()
        return result


def _inject(window):
    """Внедряет JS после загрузки страницы (и при каждом переходе SPA)."""
    try:
        code = INJECT_JS.read_text(encoding="utf-8")
    except OSError as exc:
        logger.error("Не удалось прочитать %s: %s", INJECT_JS, exc)
        return
    window.evaluate_js(code)
    logger.info("Скрипт внедрён")


def _wait_and_inject(window):
    # Даём webview отрисоваться и подгружаем наш скрипт
    time.sleep(1.5)
    _inject(window)


def main():
    api = JsApi()
    window = webview.create_window(
        "YaMusic Desktop Client",
        APP_URL,
        js_api=api,
        width=1280,
        height=800,
        min_size=(900, 600),
    )

    # Инъекция при загрузке и при навигации внутри SPA
    window.events.loaded += lambda: _inject(window)

    webview.start(debug=False)


if __name__ == "__main__":
    main()
