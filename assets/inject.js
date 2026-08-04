/* YaMusic Desktop Client — внедрение в интерфейс Яндекс Музыки.

Функции:
  - кнопки «Скачать» рядом с треками/альбомами/плейлистами;
  - модальное окно ввода API-токена;
  - встроенный блокировщик рекламы (fetch / XHR / window.open + CSS);
  - автопринятие cookie / GDPR-баннеров;
  - кнопка «Настройки загрузок» в левом сайдбаре + модалка с параметрами.
Устойчив к SPA-навигации через MutationObserver. UI не блокируется.
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

    // --- ссылка с инструкцией по токену ---
    var TOKEN_URL = 'https://oauth.yandex.ru/authorize?response_type=token&client_id=23cabbbdc6cd418abb4b39c32c41195d';

    // --- рекламные домены/паттерны (для fetch/XHR/window.open) ---
    var AD_URL_PATTERNS = [
        'yabs.yandex', 'an.yandex', 'adsdk.yandex', 'awaps.yandex',
        'adfox', 'ads.yandex', 'advertising.yandex', 'direct.yandex',
        'partner2.yandex', '.doubleclick.', 'adservice.', 'googlesyndication',
        '/get-killbill/', '/r/click-ad/', '/ad_', 'adlik', 'adpush'
    ];

    /* ---------- стили ---------- */

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = [
            /* кнопка скачивания рядом с треком */
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
            /* большая кнопка на странице плейлиста/альбома */
            '.' + BTN_CLASS + '.ym-dl-page-btn {',
            '  margin-left: 12px; padding: 8px 18px; font-size: 14px; border-radius: 10px;',
            '}',

            /* скрытие рекламы */
            '.ym-dl-ad-hidden { display: none !important; visibility: hidden !important; }',

            /* модальное окно токена и настроек общие стили */
            '#ym-token-overlay, #ym-settings-overlay, .ym-overlay-base {',
            '  position: fixed !important; inset: 0 !important; z-index: 99999 !important;',
            '  background: rgba(0,0,0,.55) !important;',
            '  display: flex !important; align-items: center !important; justify-content: center !important;',
            '}',
            '#ym-download-modal {',
            '  width: 440px; max-width: 90vw; padding: 24px; background: #fff; color: #000;',
            '  border-radius: 12px; font-family: "Yandex Sans Text", Arial, sans-serif; font-size: 14px;',
            '  box-shadow: 0 12px 40px rgba(0,0,0,.35);',
            '}',
            '#ym-download-modal h2 { margin: 0 0 12px; font-size: 18px; }',
            '#ym-download-modal p { margin: 8px 0; line-height: 1.45; }',
            '#ym-download-modal a { color: #8a5cf6; word-break: break-all; }',
            '#ym-download-modal input[type=text], #ym-download-modal input[type=password] {',
            '  width: 100%; box-sizing: border-box; margin: 12px 0; padding: 10px; border: 1px solid #ccc; border-radius: 8px; font-size: 14px;',
            '}',
            '#ym-download-modal .row { display: flex; gap: 8px; justify-content: flex-end; }',
            '#ym-download-modal button { padding: 8px 16px; border: none; border-radius: 8px;',
            '  background: #FFDB4D; font-weight: 600; cursor: pointer;',
            '}',
            '#ym-download-modal button.secondary { background: #eee; }',
            '#ym-download-modal .ym-error { color: #d33; font-size: 12px; margin: 4px 0 0; }',
            '#ym-download-modal .ym-note { color: #666; font-size: 12px; margin: 4px 0 0; }',
            '#ym-token-cancel { margin-right: auto; }',

            /* путь загрузки */
            '.ym-dir-row { display: flex; gap: 6px; align-items: center; }',
            '.ym-dir-row input { flex: 1; }',
            '.ym-dir-row button { min-width: 110px; }',

            /* опции раскладки */
            '.ym-layout-option { display: flex; align-items: center; gap: 8px; margin: 6px 0; }',

            /* тосты */
            '#ym-dl-toasts { position: fixed; right: 16px; bottom: 16px; z-index: 99998; display: flex; flex-direction: column; gap: 8px; }',
            '.ym-dl-toast { padding: 10px 14px; border-radius: 10px; background: #222; color: #fff;',
            '  font-family: "Yandex Sans Text", Arial, sans-serif; font-size: 13px; max-width: 320px;',
            '  box-shadow: 0 6px 20px rgba(0,0,0,.3); opacity: 0; transform: translateY(8px); transition: all .25s ease;',
            '}',
            '.ym-dl-toast.show { opacity: 1; transform: none; }',
            '.ym-dl-toast.error { background: #b3261e; }',

            /* пункт сайдбара — наследует тему ЯМ, добавляем только курсор */
            '#ym-settings-nav-item, #ym-settings-nav-item * { cursor: pointer !important; }',
            'a.ym-settings-float {',
            '  position: fixed; left: 12px; bottom: 130px; z-index: 99997;',
            '  display: inline-block; padding: 10px 16px; border-radius: 24px;',
            '  background: #FFDB4D; color: #000; font-family: "Yandex Sans Text", Arial, sans-serif;',
            '  font-size: 13px; font-weight: 600; text-decoration: none; cursor: pointer;',
            '  box-shadow: 0 6px 20px rgba(0,0,0,.35);',
            '}',
            'a.ym-settings-float:hover { transform: scale(1.05); }'
        ].join('\n');
        document.head.appendChild(style);
    }

    /* ---------- уведомления / тосты ---------- */

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
        var bridge = api();
        if (bridge) return Promise.resolve(bridge);
        if (attempt > 60) return Promise.reject(new Error('pywebview недоступен'));
        return new Promise(function (resolve, reject) {
            setTimeout(function () {
                waitForApi(attempt + 1).then(resolve, reject);
            }, 200);
        });
    }

    /* ---------- блокировщик рекламы ---------- */

    function isAdUrl(url) {
        if (!url || typeof url !== 'string') return false;
        url = url.toLowerCase();
        return AD_URL_PATTERNS.some(function (p) { return url.indexOf(p) !== -1; });
    }

    function installAdblock() {
        // fetch
        var origFetch = window.fetch;
        try {
            window.fetch = function (input, init) {
                var url = (typeof input === 'string') ? input
                    : (input && input.url) ? input.url
                    : '';
                if (isAdUrl(url)) {
                    return Promise.resolve(new Response('', { status: 204 }));
                }
                return origFetch.apply(this, arguments);
            };
        } catch (e) { /* readonly — игнорируем */ }

        // XMLHttpRequest
        var origOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (method, url) {
            if (isAdUrl(url)) {
                this.__ymBlocked = true;
                // вызовем onerror, чтобы сайт корректно обработал «провал»
                var self = this;
                setTimeout(function () {
                    try {
                        if (typeof self.onerror === 'function')
                            self.onerror(new ProgressEvent('error'));
                        if (typeof self.onloadend === 'function')
                            self.onloadend();
                    } catch (err) { /* noop */ }
                }, 0);
                return;
            }
            return origOpen.apply(this, arguments);
        };

        // window.open
        var origOpenWin = window.open;
        try {
            window.open = function (url) {
                if (isAdUrl(url)) return null;
                return origOpenWin.apply(this, arguments);
            };
        } catch (e) { /* noop */ }
    }

    function hideAdElements() {
        if (!document.body) return;
        var candidates = document.querySelectorAll([
            '[class*="advertisement"]', '[class*="banner"]',
            '[class*="yandex-ad"]', '[class*="adv-block"]',
            'iframe[src*="adfox"]', 'iframe[src*="yabs"]',
            'iframe[src*="doubleclick"]', 'iframe[title*="rekl"]'
        ].join(','));
        candidates.forEach(function (el) {
            el.classList.add('ym-dl-ad-hidden');
        });
    }

    /* ---------- автопринятие cookie / GDPR ---------- */

    var _consentTried = 0;

    function acceptConsent() {
    var _consentTried = 0;
        var popups = document.querySelectorAll([
            '[class*="gdpr"]', '[class*="cookie"]', '[id*="cookie"]',
            '[class*="consent"]', '[id*="gdpr"]'
        ].join(','));
        popups.forEach(function (popup) {
            var buttons = popup.querySelectorAll('button, a');
            buttons.forEach(function (btn) {
                var txt = (btn.textContent || '').trim().toLowerCase();
                if (/^(принять|принимаю|согласен|ясно|понятно|ок|отлично|accept|agree|ok|done)/.test(txt)) {
                    try { btn.click(); } catch (e) { /* noop */ }
                }
            });
            // иногда кнопка — сам элемент поп-апа
            var selfTxt = (popup.textContent || '').trim().toLowerCase();
            if (/^(принять|согласен|accept|agree)/.test(selfTxt) && popup.click) {
                try { popup.click(); } catch (e) { /* noop */ }
            }
        });

        // 2) баннер внизу (cookie-gdpr)
        var foot = document.querySelector('[class*="cookie-banner"], [class*="gdpr-footer"]');
        if (foot) {
            var btns = foot.querySelectorAll('button, a');
            btns.forEach(function (b) {
                var t = (b.textContent || '').toLowerCase();
                if (t.indexOf('прин') !== -1 || t.indexOf('accept') !== -1 || t.indexOf('agree') !== -1 || t.indexOf('ок') === 0) {
                    try { b.click(); } catch (e) { /* noop */ }
                }
            });
        }
    }

    /* ---------- извлечение ID ---------- */

    function extractFromUrl(url) {
        if (!url) return null;
        var m;
        // Плейлист: /users/:owner/playlists/:kind
        // kind может быть не только числом — редакционные плейлисты имеют строковый слаг
        m = url.match(/\/users\/([^/?#]+)\/playlists\/([^/?#]+)/);
        if (m) return { type: 'playlist', id: decodeURIComponent(m[1]) + ':' + decodeURIComponent(m[2]) };
        m = url.match(/\/track\/(\d+)/);
        if (m) return { type: 'track', id: m[1] };
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
        var holder = el.closest('[data-track-id], [data-trackid], [data-album-id]');
        if (holder) {
            var trackId = holder.getAttribute('data-track-id') || holder.getAttribute('data-trackid');
            if (trackId) return { type: 'track', id: trackId };
            var albumId = holder.getAttribute('data-album-id');
            if (albumId) return { type: 'album', id: albumId };
        }
        return null;
    }

    /* ---------- внедрение кнопок скачивания ---------- */

    function findCards(root) {
        var cards = [];
        root.querySelectorAll('a[href*="/track/"]').forEach(function (a) {
            cards.push({ anchor: a, container: a.closest('[class*="d-track"], [class*="track"], li, tr') || a });
        });
        root.querySelectorAll('a[href*="/album/"]:not([href*="/track/"])').forEach(function (a) {
            cards.push({ anchor: a, container: a.closest('[class*="album"], [class*="entity"], li, div') || a });
        });
        // Плейлисты — только карточки в основном контенте, НЕ в сайдбаре
        root.querySelectorAll('a[href*="/playlists/"]').forEach(function (a) {
            if (a.closest('nav, [class*="sidebar"], [class*="NavigationSidebar"]')) return;
            cards.push({
                anchor: a,
                // ищем внешний контейнер-карточку, иначе — сразу parentElement ссылки
                container: a.closest('[class*="playlist"], [class*="entity-card"], [class*="entity-view"], [class*="cover"]') || a.parentElement
            });
        });
        return cards;
    }

    function addButton(card) {
        var container = card.container;
        if (!container || container.getAttribute(PROCESSED_ATTR)) return;
        var meta = extractFromUrl(card.anchor.getAttribute('href') || '') || extractFromElement(card.anchor);
        if (!meta) return;

        container.setAttribute(PROCESSED_ATTR, '1');
        var btn = document.createElement('button');
        btn.className = BTN_CLASS;
        btn.type = 'button';
        btn.title = 'Скачать ' + (meta.type === 'track' ? 'трек'
            : meta.type === 'album' ? 'альбом' : 'плейлист');
        btn.textContent = '⬇';
        btn.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation();
            handleDownload(btn, meta);
        });
        (card.anchor.parentElement || container).appendChild(btn);
    }

    function scan() {
        if (!document.body) return;
        injectStyles();
        hideAdElements();
        findCards(document).forEach(addButton);
        injectPageDownloadButton();
        injectSidebarButton();
        scheduleConsent();
    }

    /* ---------- большая кнопка плейлиста ---------- *
     * Надёжная: вставляется рядом с кнопкой Play.
     * MutationObserver вызывает на каждый рендер страницы.
     */

    function injectPageDownloadButton() {
        if (document.getElementById('ym-page-dl-btn')) return;

        var meta = extractFromUrl(location.pathname);
        if (!meta || meta.type !== 'playlist') return;

        // Слушаем любую кнопку «Слушать»/«Играть»
        var playIcon = document.querySelector(
            'button[aria-label*="Слушать"], button[title*="Слушать"], button[aria-label*="Играть"]');
        if (!playIcon) return;

        var btn = document.createElement('button');
        btn.id = 'ym-page-dl-btn';
        btn.className = BTN_CLASS + ' ym-dl-page-btn';
        btn.type = 'button';
        btn.textContent = '⬇ Скачать плейлист';
        btn.title = 'Скачать весь плейлист (' + meta.id + ')';
        btn.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation();
            handleDownload(btn, meta);
        });
        try {
            playIcon.parentElement.insertBefore(btn, playIcon.nextSibling);
        } catch (err) {
            playIcon.parentElement.appendChild(btn);
        }
    }

    function injectPageDownloadButton() {
        if (document.getElementById('ym-page-dl-btn')) return;

        var meta = extractFromUrl(location.pathname);
        if (!meta || meta.type === 'track') return; // у трека нет страницы-карточки вида /track/N

        // Порядок надёжности: кнопка «Слушать/Играть» -> заголовок h1 -> page-*__title -> page-*__head
        var host = null;
        var playBtn = document.querySelector(
            'button[aria-label*="Слушать"], button[aria-label*="Играть"], button[aria-label*="Play"], ' +
            'button[title*="Слушать"], button[title*="Играть"]');
        if (playBtn) host = playBtn.parentElement;
        if (!host) {
            var h1 = document.querySelector('h1');
            if (h1) host = h1.parentElement;
        }
        if (!host) {
            var title = document.querySelector('[class*="page-playlist__title"], [class*="page-album__title"]');
            if (title) host = title.parentElement;
        }
        if (!host) {
            var hdr = document.querySelector('[class*="page-playlist__head"], [class*="page-album__head"]');
            if (hdr) host = hdr;
        }
        if (!host) return;

        var btn = document.createElement('button');
        btn.id = 'ym-page-dl-btn';
        btn.className = BTN_CLASS + ' ym-dl-page-btn';
        btn.type = 'button';
        btn.textContent = '⬇ Скачать целиком';
        btn.title = 'Скачать ' + (meta.type === 'album' ? 'альбом' : 'плейлист') + ' целиком';
        btn.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation();
            handleDownload(btn, meta);
        });
        host.appendChild(btn);
    }

    /* ---------- модальное окно токена ---------- */

    function showTokenModal(onSaved) {
        if (document.getElementById('ym-token-overlay')) return;

        var overlay = document.createElement('div');
        overlay.id = 'ym-token-overlay';
        overlay.className = 'ym-overlay-base';
        overlay.innerHTML =
            '<div id="ym-download-modal">' +
            '  <h2>API-токен Яндекс Музыки</h2>' +
            '  <p>Токен хранится локально в защищённом хранилище и никуда не отправляется.</p>' +
            '  <p>1. Откройте ссылку (уже авторизованы в Яндексе — просто подтвердите доступ):</p>' +
            '  <p><a href="' + TOKEN_URL + '" target="_blank" rel="noopener">' + TOKEN_URL + '</a></p>' +
            '  <p>2. После редиректа скопируйте <b>access_token</b> из адресной строки.</p>' +
            '  <input type="password" id="ym-token-input" placeholder="Вставьте токен" autocomplete="off" />' +
            '  <div class="ym-error" id="ym-token-error" style="display:none"></div>' +
            '  <div class="row">' +
            '    <button class="secondary" id="ym-token-cancel">Отмена</button>' +
            '    <button id="ym-token-save">Сохранить</button>' +
            '  </div>' +
            '</div>';
        document.body.appendChild(overlay);

        var input = overlay.querySelector('#ym-token-input');
        var errorEl = overlay.querySelector('#ym-token-error');
        overlay.querySelector('#ym-token-cancel').addEventListener('click', function () { overlay.remove(); });
        overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
        overlay.addEventListener('keydown', function (e) { if (e.key === 'Escape') overlay.remove(); });
        input.focus();

        overlay.querySelector('#ym-token-save').addEventListener('click', function () {
            var token = input.value.trim();
            if (!token) { errorEl.textContent = 'Поле токена пустое'; errorEl.style.display = 'block'; return; }
            errorEl.style.display = 'none';
            waitForApi().then(function (bridge) { return bridge.save_token(token); }).then(function (result) {
                if (result && (result.ok || result.warning)) {
                    overlay.remove();
                    toast(result.warning || 'Токен сохранён');
                    if (typeof onSaved === 'function') onSaved();
                } else {
                    errorEl.textContent = (result && result.error) || 'Не удалось сохранить токен';
                    errorEl.style.display = 'block';
                }
            }).catch(function (err) { errorEl.textContent = String(err); errorEl.style.display = 'block'; });
        });
    }

    /* ---------- модальное окно настроек загрузок ---------- */

    function showSettingsModal() {
        hideConsentBanner();
        if (document.getElementById('ym-settings-overlay')) return;

        var overlay = document.createElement('div');
        overlay.id = 'ym-settings-overlay';
        overlay.className = 'ym-overlay-base';

        overlay.innerHTML =
            '<div id="ym-download-modal">' +
            '  <h2>Настройки загрузок</h2>' +
            '  <p>Папка, куда сохранять скачанные треки:</p>' +
            '  <div class="ym-dir-row">' +
            '    <input type="text" id="ym-dir-input" readonly />' +
            '    <button id="ym-dir-browse">Выбрать…</button>' +
            '  </div>' +
            '  <p style="margin-top:14px">Структура каталогов:</p>' +
            '  <label class="ym-layout-option"><input type="radio" name="ym-layout" value="flat"> Всё в один каталог</label>' +
            '  <label class="ym-layout-option"><input type="radio" name="ym-layout" value="artist"> По папкам исполнителей</label>' +
            '  <label class="ym-layout-option"><input type="radio" name="ym-layout" value="album"> По альбомам (объединять треки одного альбома в одну папку)</label>' +
            '  <label class="ym-layout-option"><input type="radio" name="ym-layout" value="artist_album"> Исполнитель → Альбом</label>' +
            '  <div class="ym-note" id="ym-settings-note" style="display:none"></div>' +
            '  <div class="row" style="margin-top:14px">' +
            '    <button class="secondary" id="ym-settings-cancel">Отмена</button>' +
            '    <button id="ym-settings-save">Сохранить</button>' +
            '  </div>' +
            '</div>';
        document.body.appendChild(overlay);

        var dirInput = overlay.querySelector('#ym-dir-input');
        var note = overlay.querySelector('#ym-settings-note');

        waitForApi().then(function (bridge) { return bridge.get_settings(); }).then(function (cfg) {
            dirInput.value = cfg.download_path || '';
            var radio = overlay.querySelector('input[name="ym-layout"][value="' + (cfg.download_layout || 'artist') + '"]');
            if (radio) radio.checked = true;
        }).catch(function (err) { note.textContent = 'Не удалось загрузить настройки: ' + err; note.style.display = 'block'; });

        overlay.querySelector('#ym-dir-browse').addEventListener('click', function () {
            waitForApi().then(function (bridge) { return bridge.browse_download_path(); }).then(function (res) {
                if (res && res.path) { dirInput.value = res.path; }
            });
        });

        overlay.querySelector('#ym-settings-cancel').addEventListener('click', function () { overlay.remove(); });
        overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
        overlay.addEventListener('keydown', function (e) { if (e.key === 'Escape') overlay.remove(); });

        overlay.querySelector('#ym-settings-save').addEventListener('click', function () {
            var layoutRadio = overlay.querySelector('input[name="ym-layout"]:checked');
            var layout = layoutRadio ? layoutRadio.value : null;
            note.style.display = 'none';
            waitForApi().then(function (bridge) {
                return bridge.save_settings({ download_path: dirInput.value, download_layout: layout });
            }).then(function (res) {
                if (res && res.ok) {
                    overlay.remove();
                    toast('Настройки сохранены');
                } else {
                    note.textContent = (res && res.error) || 'Ошибка сохранения';
                    note.style.display = 'block';
                }
            }).catch(function (err) { note.textContent = String(err); note.style.display = 'block'; });
        });
    }

    /* ---------- кнопка в сайдбаре ---------- */

    function injectSidebarButton() {
        if (document.getElementById('ym-settings-nav-item') ||
            document.getElementById('ym-settings-float')) return;

        var links = document.querySelectorAll(
            'a[href*="/collection"], a[href*="/home"], a[href*="/my-wave"], ' +
            'a[href*="/radio"], a[href*="/podcasts"], a[href*="/books"]');
        if (links.length) {
            var ref = links[0];
            var refHost = ref.closest('li') || ref;
            var li = document.createElement('li');
            li.className = refHost.className;
            var clone = ref.cloneNode(true);
            clone.id = 'ym-settings-nav-item';
            clone.removeAttribute('href');
            clone.setAttribute('role', 'button');
            clone.setAttribute('title', 'Настройки загрузок');
            var textNode = null;
            (function walk(n) {
                n.childNodes.forEach(function (c) {
                    if (!textNode && c.nodeType === 3 && c.textContent.trim()) textNode = c;
                    if (c.nodeType === 1 && ['svg', 'i'].indexOf(c.tagName.toLowerCase()) === -1) walk(c);
                });
            })(clone);
            if (textNode) textNode.textContent = 'Настройки загрузок';
            else clone.textContent = 'Настройки загрузок';
            clone.addEventListener('click', function (e) {
                e.preventDefault(); e.stopPropagation();
                showSettingsModal();
            });
            li.appendChild(clone);
            var parentEls = refHost.parentElement;
            if (parentEls && parentEls.appendChild) parentEls.appendChild(li);
            return;
        }
        // сайдбар ещё не отрендерился — плавающая кнопка
        addFloatingButton();
    }

    // плавающая жёлтая кнопка-фолбэк, если сайдбар не найден
    function addFloatingButton() {
        if (document.getElementById('ym-settings-float')) return;
        var a = document.createElement('a');
        a.id = 'ym-settings-float';
        a.className = 'ym-settings-float';
        a.href = '#';
        a.textContent = '⚙ Настройки загрузок';
        a.title = 'Настройки загрузок';
        a.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation();
            showSettingsModal();
        });
        document.body.appendChild(a);
    }

    function hideConsentBanner() {
        var b;
        while ((b = document.querySelector('[class*="cookie-banner"], [class*="gdpr-footer"]'))) {
            b.classList.add('ym-dl-ad-hidden');
        }
    }

    /* ---------- согласие/консент ---------- */

    var _consentTimer = null;
    function scheduleConsent() {
        if (_consentTimer) return; // уже планируем
        var count = 0;
        _consentTimer = setInterval(function () {
            _consentTried++;
            acceptConsent();
            if (_consentTried >= 30 || document.querySelector('[class*="gdpr"], [class*="cookie"]') === null) {
                clearInterval(_consentTimer);
                _consentTimer = null;
            }
        }, 1000);
    }

    /* ---------- скачивание ---------- */

    function handleDownload(btn, meta) {
        waitForApi().then(function (bridge) {
            return bridge.is_authorized();
        }).then(function (authorized) {
            if (!authorized) {
                showTokenModal(function () {});
                return;
            }
            startDownload(btn, meta);
        }).catch(function (err) { toast('Ошибка: ' + err, true); });
    }

    function startDownload(btn, meta) {
        btn.classList.add('ym-dl-loading');
        btn.textContent = '…';
        toast('Скачивание ' + (meta.type === 'track' ? 'трека'
            : meta.type === 'album' ? 'альбома' : 'плейлиста') + ' #' + meta.id);
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
        }, 600);
    });

    function boot() {
        injectStyles();
        installAdblock();
        scan();
        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
