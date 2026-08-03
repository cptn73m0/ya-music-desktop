/* YaMusic Desktop Client — внедрение кнопок «Скачать» в интерфейс Яндекс Музыки.
 * Устойчив к SPA-навигации: работает через MutationObserver.
 * Все вызовы в pywebview выполняются асинхронно, UI не блокируется.
 */
(function () {
    'use strict';

    if (window.__ymDesktopInjected) {
        return;
    }
    window.__ymDesktopInjected = true;

    var BTN_CLASS = 'ym-dl-btn';
    var PROCESSED_ATTR = 'data-ym-dl-processed';
    var STYLE_ID = 'ym-dl-styles';
    var TOKEN_URL = 'https://oauth.yandex.ru/authorize?response_type=token&client_id=23cabbbdc6cd418abb4b39c32c41195d';

    /* ---------- стили ---------- */

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = [
            '.' + BTN_CLASS + ' {',
            '  display: inline-flex; align-items: center; justify-content: center;',
            '  margin-left: 8px; padding: 4px 8px;',
            '  border: 1px solid rgba(0,0,0,0.2); border-radius: 6px;',
            '  background: #FFDB4D; color: #000; font-size: 12px; font-weight: 600;',
            '  cursor: pointer; line-height: 1; white-space: nowrap;',
            '  transition: transform .15s ease, opacity .15s ease;',
            '}',
            '.' + BTN_CLASS + ':hover { transform: scale(1.08); }',
            '.' + BTN_CLASS + ':disabled { opacity: .5; cursor: default; transform: none; }',
            '.' + BTN_CLASS + '.ym-dl-loading { opacity: .7; pointer-events: none; }',
            /* --- модальное окно токена --- */
            '#ym-token-overlay {',
            '  position: fixed; inset: 0; z-index: 99999;',
            '  background: rgba(0,0,0,.55);',
            '  display: flex; align-items: center; justify-content: center;',
            '}',
            '#ym-token-modal {',
            '  width: 420px; max-width: 90vw; padding: 20px;',
            '  background: #fff; color: #000; border-radius: 12px;',
            '  font-family: Yandex Sans Text, Arial, sans-serif; font-size: 14px;',
            '  box-shadow: 0 12px 40px rgba(0,0,0,.35);',
            '}',
            '#ym-token-modal h2 { margin: 0 0 12px; font-size: 18px; }',
            '#ym-token-modal p { margin: 8px 0; line-height: 1.45; }',
            '#ym-token-modal a { color: #8a5cf6; word-break: break-all; }',
            '#ym-token-modal input {',
            '  width: 100%; box-sizing: border-box; margin: 12px 0;',
            '  padding: 10px; border: 1px solid #ccc; border-radius: 8px; font-size: 14px;',
            '}',
            '#ym-token-modal .row { display: flex; gap: 8px; justify-content: flex-end; }',
            '#ym-token-modal button {',
            '  padding: 8px 16px; border: none; border-radius: 8px;',
            '  background: #FFDB4D; font-weight: 600; cursor: pointer;',
            '}',
            '#ym-token-modal button.secondary { background: #eee; }',
            '#ym-token-modal .ym-token-error { color: #d33; font-size: 12px; margin: 4px 0 0; }',
            /* --- тосты --- */
            '#ym-dl-toasts {',
            '  position: fixed; right: 16px; bottom: 16px; z-index: 99998;',
            '  display: flex; flex-direction: column; gap: 8px;',
            '}',
            '.ym-dl-toast {',
            '  padding: 10px 14px; border-radius: 10px; background: #222; color: #fff;',
            '  font-family: Yandex Sans Text, Arial, sans-serif; font-size: 13px;',
            '  max-width: 320px; box-shadow: 0 6px 20px rgba(0,0,0,.3);',
            '  opacity: 0; transform: translateY(8px); transition: all .25s ease;',
            '}',
            '.ym-dl-toast.show { opacity: 1; transform: none; }',
            '.ym-dl-toast.error { background: #b3261e; }'
        ].join('\n');
        document.head.appendChild(style);
    }

    /* ---------- уведомления ---------- */

    function toast(message, isError) {
        var container = document.getElementById('ym-dl-toasts');
        if (!container) {
            container = document.createElement('div');
            container.id = 'ym-dl-toasts';
            document.body.appendChild(container);
        }
        var el = document.createElement('div');
        el.className = 'ym-dl-toast' + (isError ? ' error' : '');
        el.textContent = message;
        container.appendChild(el);
        requestAnimationFrame(function () { el.classList.add('show'); });
        setTimeout(function () {
            el.classList.remove('show');
            setTimeout(function () { el.remove(); }, 300);
        }, 5000);
    }

    /* ---------- мост pywebview ---------- */

    function api() {
        if (window.pywebview && window.pywebview.api) {
            return window.pywebview.api;
        }
        return null;
    }

    function waitForApi(attempt) {
        attempt = attempt || 0;
        if (api()) return Promise.resolve(api());
        if (attempt > 50) return Promise.reject(new Error('pywebview недоступен'));
        return new Promise(function (resolve, reject) {
            setTimeout(function () {
                waitForApi(attempt + 1).then(resolve, reject);
            }, 200);
        });
    }

    /* ---------- модальное окно токена ---------- */

    function showTokenModal(onSaved) {
        if (document.getElementById('ym-token-overlay')) return;

        var overlay = document.createElement('div');
        overlay.id = 'ym-token-overlay';
        overlay.innerHTML =
            '<div id="ym-token-modal">' +
            '  <h2>Токен Яндекс Музыки</h2>' +
            '  <p>Для скачивания нужен API-токен вашего аккаунта. Он хранится локально и никуда не отправляется.</p>' +
            '  <p>1. Откройте ссылку (уже авторизованы в Яндексе? — просто подтвердите доступ):<br>' +
            '     <a href="' + TOKEN_URL + '" target="_blank" rel="noopener">' + TOKEN_URL + '</a></p>' +
            '  <p>2. После редиректа скопируйте значение <b>access_token</b> из адресной строки (между <b>access_token=</b> и <b>&</b>).</p>' +
            '  <input type="password" id="ym-token-input" placeholder="Вставьте токен сюда" autocomplete="off" />' +
            '  <div class="ym-token-error" id="ym-token-error" style="display:none"></div>' +
            '  <div class="row">' +
            '    <button class="secondary" id="ym-token-cancel">Отмена</button>' +
            '    <button id="ym-token-save">Сохранить</button>' +
            '  </div>' +
            '</div>';
        document.body.appendChild(overlay);

        var input = overlay.querySelector('#ym-token-input');
        var errorEl = overlay.querySelector('#ym-token-error');

        overlay.querySelector('#ym-token-cancel').addEventListener('click', function () {
            overlay.remove();
        });
        overlay.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') overlay.remove();
        });
        input.focus();

        overlay.querySelector('#ym-token-save').addEventListener('click', function () {
            var token = input.value.trim();
            if (!token) {
                errorEl.textContent = 'Поле токена пустое';
                errorEl.style.display = 'block';
                return;
            }
            errorEl.style.display = 'none';
            waitForApi().then(function (bridge) {
                return bridge.save_token(token);
            }).then(function (result) {
                if (result && result.ok) {
                    overlay.remove();
                    toast('Токен сохранён');
                    if (typeof onSaved === 'function') onSaved();
                } else {
                    errorEl.textContent = (result && result.error) || 'Не удалось сохранить токен';
                    errorEl.style.display = 'block';
                }
            }).catch(function (err) {
                errorEl.textContent = String(err);
                errorEl.style.display = 'block';
            });
        });
    }

    /* ---------- извлечение ID ---------- */

    function extractFromUrl(url) {
        if (!url) return null;
        var m;
        // Плейлист: /users/:owner/playlists/:kind
        m = url.match(/\/users\/(\d+)\/playlists\/(\d+)/);
        if (m) return { type: 'playlist', id: m[1] + ':' + m[2] };
        // Трек: /album/:albumId/track/:trackId  ИЛИ  /track/:trackId
        m = url.match(/\/track\/(\d+)/);
        if (m) return { type: 'track', id: m[1] };
        // Альбом: /album/:albumId (без /track/ дальше)
        m = url.match(/\/album\/(\d+)(?!\/track\b)/);
        if (m) return { type: 'album', id: m[1] };
        return null;
    }

    function extractFromElement(el) {
        var node = el.closest && el.closest('a[href]');
        if (node) {
            var fromUrl = extractFromUrl(node.getAttribute('href') || '');
            if (fromUrl) return fromUrl;
        }
        // data-атрибуты — fallback (Яндекс периодически их переименовывает)
        var holder = el.closest('[data-track-id], [data-trackid], [data-album-id], [data-albumid]');
        if (holder) {
            var trackId = holder.getAttribute('data-track-id') || holder.getAttribute('data-trackid');
            if (trackId) return { type: 'track', id: trackId };
            var albumId = holder.getAttribute('data-album-id') || holder.getAttribute('data-albumid');
            if (albumId) return { type: 'album', id: albumId };
        }
        return null;
    }

    /* ---------- внедрение кнопок ---------- */

    // Якорные точки в DOM ЯМ — подбираем максимально устойчивые селекторы.
    var CONTAINER_SELECTORS = [
        // строка трека в плейлисте/альбоме
        '[class*="d-track__name"], [class*="track__name"]',
        // обложка альбома на странице альбома / карточка
        '[class*="entity-cover__caption"], [class*="album__caption"]',
        // заголовок на странице альбома/плейлиста
        '[class*="page-album__title"], [class*="page-playlist__title"]'
    ];

    function findCards(root) {
        var cards = [];
        // Строки треков
        root.querySelectorAll('a[href*="/track/"]').forEach(function (a) {
            var row = a.closest('[class*="d-track"], [class*="track"], li, tr') || a;
            cards.push({ anchor: a, container: row });
        });
        // Ссылки на альбомы (не треки)
        root.querySelectorAll('a[href*="/album/"]:not([href*="/track/"])').forEach(function (a) {
            var row = a.closest('[class*="album"], [class*="entity"], li, div') || a;
            cards.push({ anchor: a, container: row });
        });
        // Ссылки на плейлисты
        root.querySelectorAll('a[href*="/playlists/"]').forEach(function (a) {
            var row = a.closest('[class*="playlist"], [class*="entity"], li, div') || a;
            cards.push({ anchor: a, container: row });
        });
        return cards;
    }

    function addButton(card) {
        var container = card.container;
        if (!container || container.getAttribute(PROCESSED_ATTR)) return;
        var meta = extractFromUrl(card.anchor.getAttribute('href') || '') ||
                   extractFromElement(card.anchor);
        if (!meta) return;

        container.setAttribute(PROCESSED_ATTR, '1');
        var btn = document.createElement('button');
        btn.className = BTN_CLASS;
        btn.type = 'button';
        btn.title = 'Скачать (' + meta.type + ')';
        btn.textContent = '⬇';
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            handleDownload(btn, meta);
        });

        // Вставляем рядом с якорем, аккуратно — внутрь родителя ссылки, чтобы не ломать верстку
        var parent = card.anchor.parentElement || container;
        parent.appendChild(btn);
    }

    function scan() {
        if (!document.body) return;
        injectStyles();
        findCards(document).forEach(addButton);
    }

    /* ---------- скачивание ---------- */

    function handleDownload(btn, meta) {
        waitForApi().then(function (bridge) {
            return bridge.is_authorized();
        }).then(function (authorized) {
            if (!authorized) {
                showTokenModal(function () { startDownload(btn, meta); });
                return;
            }
            startDownload(btn, meta);
        }).catch(function (err) {
            toast('Ошибка: ' + err, true);
        });
    }

    function startDownload(btn, meta) {
        btn.classList.add('ym-dl-loading');
        btn.textContent = '…';
        toast('Скачивание ' + meta.type + ' #' + meta.id + '…');
        waitForApi().then(function (bridge) {
            return bridge.download(meta.id, meta.type);
        }).then(function (result) {
            if (result && result.ok) {
                toast('Готово: скачано ' + (result.saved || 1) + ' трек(ов)');
            } else {
                toast('Ошибка скачивания: ' + ((result && result.error) || 'неизвестно'), true);
            }
        }).catch(function (err) {
            toast('Ошибка: ' + err, true);
        }).finally(function () {
            btn.classList.remove('ym-dl-loading');
            btn.textContent = '⬇';
        });
    }

    /* ---------- наблюдатель за SPA-навигацией ---------- */

    var scheduled = false;
    var observer = new MutationObserver(function () {
        if (scheduled) return;
        scheduled = true;
        setTimeout(function () {
            scheduled = false;
            scan();
        }, 600); // даём React дорисовать новый экран
    });

    function boot() {
        injectStyles();
        scan();
        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
