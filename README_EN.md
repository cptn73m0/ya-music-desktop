# YaMusic Desktop Client

A desktop wrapper for the Yandex Music web version with built-in downloads of tracks, albums and playlists right from the interface.

[Русская версия: README.md](README.md)

## Features

- Renders music.yandex.ru in a native window (pywebview + Edge WebView2).
- Adds download buttons next to tracks, albums and on playlist pages.
- Downloads music via the `yandex-music` library as MP3 (320/192/128 kbps with fallback).
- Writes ID3 tags and embeds cover art (mutagen).
- Blocks ad requests and banners, auto-accepts cookie banners.
- Configurable folder layout: single folder, by artist, by album, artist/album.
- Persists the Yandex session between launches — no need to log in again.
- Shows playlist download progress in a persistent toast.

## Running from source

Requires Python 3.9+ on Windows 10/11.

```
git clone https://github.com/cptn73m0/ya-music-desktop.git
cd ya-music-desktop
python -m venv venv
venv\Scripts\pip install -r requirements.txt
venv\Scripts\python main.py
```

## Prebuilt binary

`dist\YaMusicDesktop.exe` is a portable single-file build — no installation needed. Requires Edge WebView2 Runtime (preinstalled on most Windows 10/11 systems).

To rebuild:

```
tools\build.ps1
```

The script installs PyInstaller, generates the app icon (`tools\make_icon.py`) and produces one exe in `dist\`.

## Access token

On first download the app asks for a Yandex Music OAuth token:

1. Open the link from the dialog (or `ym.marshal.dev`).
2. After the redirect, copy the `access_token` value from the address bar.
3. Paste it into the field and save.

The token is stored in the OS secret store (Windows Credential Manager) via `keyring`. It is never written to logs or console.

## Project layout

- `main.py` — entry point, window creation, JS-Python bridge.
- `core/auth.py` — token storage and validation.
- `core/downloader.py` — track/album/playlist downloads, tags, covers.
- `core/settings.py` — download path and folder layout (`~/.ya-music-desktop/settings.json`).
- `assets/inject.js` — download buttons injected into Yandex Music DOM, ad blocker, toasts, modals.
- `tools/` — icon generation and exe build.

## Known limitations

- Yandex Music markup changes from time to time; buttons may break after a layout update — please open an issue if they disappear.
- Editorial playlists with UUID links are resolved via `GET /playlist/<uuid>`.
- Tracks unavailable in your region are skipped and reported in the error list.

## Credits

- [Llistochek](https://github.com/llistochek) — author of [yandex-music-downloader](https://github.com/llistochek/yandex-music-downloader), which this project is based on / inspired by.
- [MarshalX](https://github.com/MarshalX) — author of the [yandex-music](https://github.com/MarshalX/yandex-music) library and the token helper [ym.marshal.dev](https://ym.marshal.dev).

## Disclaimer

The app is intended for personal use and downloading content you have legal access to. The author is not responsible for violating Yandex Music terms of service or copyright law.
