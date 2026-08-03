# -*- coding: utf-8 -*-
"""Управление API-токеном Яндекс Музыки.

Токен хранится в системном хранилище ОС через `keyring`
(Windows Credential Manager / macOS Keychain / Secret Service).
Токен НИКОГДА не выводится в логи в открытом виде.
"""
import logging

import keyring
from keyring.errors import KeyringError

logger = logging.getLogger(__name__)

SERVICE_NAME = "ya-music-desktop"
TOKEN_USERNAME = "yandex_music_token"

# Ссылка с инструкцией по получению токена
TOKEN_HELP_URL = "https://yandex-music.readthedocs.io/en/main/token.html"


def get_token():
    """Возвращает сохранённый токен или None."""
    try:
        token = keyring.get_password(SERVICE_NAME, TOKEN_USERNAME)
        if token:
            token = token.strip() or None
        return token
    except KeyringError as exc:
        logger.error("Не удалось прочитать токен из keyring: %s", exc)
        return None


def save_token(token):
    """Сохраняет токен в системном хранилище.

    :raises ValueError: если токен пустой.
    :raises RuntimeError: при ошибке keyring.
    """
    if not token or not token.strip():
        raise ValueError("Токен не может быть пустым")
    token = token.strip()
    try:
        keyring.set_password(SERVICE_NAME, TOKEN_USERNAME, token)
    except KeyringError as exc:
        logger.error("Не удалось сохранить токен: %s", exc)
        raise RuntimeError("Ошибка системного хранилища ключей") from exc
    logger.info("Токен успешно сохранён (длина %d)", len(token))


def delete_token():
    """Удаляет токен из хранилища (если есть)."""
    try:
        keyring.delete_password(SERVICE_NAME, TOKEN_USERNAME)
    except KeyringError:
        pass


def is_authorized():
    """True, если токен сохранён."""
    return get_token() is not None


def validate_token(token):
    """Проверяет валидность токена через API (быстрый запрос account_status)."""
    if not token:
        return False
    try:
        from yandex_music import Client
        client = Client(token).init()
        status = client.account_status()
        return status is not None
    except Exception as exc:
        logger.warning("Проверка токена не пройдена: %s", exc)
        return False
