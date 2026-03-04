(function() {
    'use strict';
    console.log('[HegeBlock] Content Script Injected, Version: 2.2.0');
// --- config.js ---
const CONFIG = {
    VERSION: '2.2.0', // Official Release: Worker UI 2.0 & Cooldown Protection
    DEBUG_MODE: true,
    DB_KEY: 'hege_block_db_v1',
    KEYS: {
        PENDING: 'hege_pending_users',
        BG_STATUS: 'hege_bg_status',
        BG_QUEUE: 'hege_active_queue',
        BG_CMD: 'hege_bg_command',
        IOS_MODE: 'hege_ios_active',
        MAC_MODE: 'hege_mac_mode',
        COOLDOWN: 'hege_rate_limit_until',
        VERSION_CHECK: 'hege_version_check',
        POS: 'hege_panel_pos',
        STATE: 'hege_panel_state',
        DISCLAIMER_AGREED: 'hege_disclaimer_agreed_v2_1',
        FAILED_QUEUE: 'hege_failed_queue',
        COOLDOWN_QUEUE: 'hege_cooldown_queue',
        DB_TIMESTAMPS: 'hege_block_timestamps',
        VERIFY_PENDING: 'hege_verify_pending',
        DEBUG_LOG: 'hege_debug_log'
    },
    LIMITS: {
        OVERLAY_ZINDEX: 999999,
        CHECK_INTERVAL_MS: 500,
        MAX_QUEUE_SIZE: 50,
        MIN_BLOCK_DELAY: 3500,
        MAX_BLOCK_DELAY: 6000,
        CONCURRENT_WORKERS: 8,
        ERROR_COOLDOWN_MINUTES: 5,
        RATE_LIMIT_COOLDOWN_MINUTES: 30,
    },
    SELECTORS: {
        MORE_SVG: 'svg[aria-label="更多"], svg[aria-label="More"]',
        MENU_ITEM: 'div[role="menuitem"], div[role="button"]',
        DIALOG: 'div[role="dialog"]',
        DIALOG_HEADER: 'div[role="dialog"] h1',
        DIALOG_USER_LINK: 'div[role="dialog"] div.html-div a[href^="/@"]',
    }
};

// --- utils.js ---


const Utils = {
    _myUsername: null,
    getMyUsername: () => {
        if (Utils._myUsername) return Utils._myUsername;

        // Approach: Find the profile link in the navigation bar
        const allLinks = document.querySelectorAll('a[href^="/@"]');
        for (let a of allLinks) {
            // Usually the navigation bar links are outside the main feed role
            if (!a.closest('main') && !a.closest('div[role="main"]') && !a.closest('div[data-pressable-container="true"]')) {
                // Profile nav link usually has an SVG or no text
                if (a.textContent.trim() === '' || a.querySelector('svg')) {
                    const href = a.getAttribute('href');
                    if (href) {
                        const u = href.split('/@')[1].split('/')[0];
                        if (u) {
                            Utils._myUsername = u;
                            return u;
                        }
                    }
                }
            }
        }
        return null;
    },
    sleep: (ms) => new Promise(r => setTimeout(r, ms)),

    log: (msg) => {
        if (!CONFIG.DEBUG_MODE) return;
        console.log(`[RightBlock] ${msg}`);
        // Dispatch to UI console if available
        if (window.hegeLogUI) window.hegeLogUI(msg);
    },

    simClick: (element) => {
        if (!element) return;
        const opts = { bubbles: true, cancelable: true, view: window };

        // Touch events for iOS/Mobile/React
        if (typeof TouchEvent !== 'undefined') {
            element.dispatchEvent(new TouchEvent('touchstart', opts));
            element.dispatchEvent(new TouchEvent('touchend', opts));
        }

        element.dispatchEvent(new MouseEvent('mousedown', opts));
        element.dispatchEvent(new MouseEvent('mouseup', opts));
        element.click();
    },

    isMobile: () => {
        const isIPad = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || isIPad;
        return isIOS || /Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    },

    // Trusted Types Policy for Meta sites
    htmlPolicy: null,
    getPolicy: () => {
        if (Utils.htmlPolicy) return Utils.htmlPolicy;
        if (window.trustedTypes && window.trustedTypes.createPolicy) {
            try {
                Utils.htmlPolicy = window.trustedTypes.createPolicy('hege_policy', {
                    createHTML: (string) => string
                });
            } catch (e) {
                console.warn('[RightBlock] Policy creation failed', e);
                // Fallback: simple object to pass-through if policy exists but creation failed (e.g. duplicate name)
                // Try to find existing? Hard. Just return mock if fail.
                Utils.htmlPolicy = { createHTML: s => s };
            }
        } else {
            Utils.htmlPolicy = { createHTML: s => s };
        }
        return Utils.htmlPolicy;
    },

    setHTML: (element, html) => {
        // Method 1: Trusted Types Policy
        if (window.trustedTypes && window.trustedTypes.createPolicy) {
            try {
                const policy = Utils.getPolicy();
                element.innerHTML = policy.createHTML(html);
                return;
            } catch (e) {
                // Policy failed, fall through to parser
            }
        }

        // Method 2: DOMParser (Bypasses innerHTML sink)
        // Note: Scripts won't execute, which is what we want for UI.
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            element.innerHTML = '';
            // Move children
            while (doc.body.firstChild) {
                element.appendChild(doc.body.firstChild);
            }
        } catch (e) {
            console.error('[RightBlock] setHTML failed', e);
            // Last resort
            element.innerHTML = html;
        }
    }
};

// --- storage.js ---
// Simple Adapter for LocalStorage / SessionStorage with Memory Cache
const Storage = {
    cache: {},
    sessionCache: {},

    get: (key, defaultVal = null) => {
        if (Storage.cache[key] !== undefined) return Storage.cache[key];
        const val = localStorage.getItem(key);
        Storage.cache[key] = val !== null ? val : defaultVal;
        return Storage.cache[key];
    },
    set: (key, value) => {
        Storage.cache[key] = value;
        localStorage.setItem(key, value);
    },
    remove: (key) => {
        delete Storage.cache[key];
        localStorage.removeItem(key);
    },
    invalidate: (key) => {
        delete Storage.cache[key];
    },
    getJSON: (key, defaultVal = []) => {
        let parsed;
        if (Storage.cache[key] !== undefined && typeof Storage.cache[key] !== 'string') {
            parsed = Storage.cache[key];
        } else {
            const val = localStorage.getItem(key);
            try {
                parsed = val ? JSON.parse(val) : defaultVal;
                Storage.cache[key] = parsed;
            } catch (e) {
                parsed = defaultVal;
            }
        }
        // Return a clone to prevent accidental reference mutation bugs across contexts
        return Array.isArray(parsed) ? [...parsed] : (typeof parsed === 'object' && parsed !== null ? { ...parsed } : parsed);
    },
    setJSON: (key, value) => {
        Storage.cache[key] = value;
        localStorage.setItem(key, JSON.stringify(value));
    },

    // Session Storage
    getSessionJSON: (key, defaultVal = []) => {
        let parsed;
        if (Storage.sessionCache[key] !== undefined) {
            parsed = Storage.sessionCache[key];
        } else {
            const val = sessionStorage.getItem(key);
            try {
                parsed = val ? JSON.parse(val) : defaultVal;
                Storage.sessionCache[key] = parsed;
            } catch (e) {
                parsed = defaultVal;
            }
        }
        // Return a clone
        return Array.isArray(parsed) ? [...parsed] : (typeof parsed === 'object' && parsed !== null ? { ...parsed } : parsed);
    },
    setSessionJSON: (key, value) => {
        Storage.sessionCache[key] = value;
        sessionStorage.setItem(key, JSON.stringify(value));
    }
};

// --- ui.js ---




const UI = {
    injectStyles: () => {
        const style = document.createElement('style');
        style.textContent = `
            .hege-checkbox-container {
                position: absolute; right: -8px; top: 50%; transform: translateY(-50%);
                width: 36px; height: 36px; z-index: 1000;
                display: flex; align-items: center; justify-content: center;
                border-radius: 50%; cursor: pointer; transition: background-color 0.2s;
            }
            .hege-checkbox-container:hover { background-color: rgba(255, 255, 255, 0.1); }
            .hege-svg-icon { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2; color: rgb(119, 119, 119); transition: all 0.2s; }
            @media (prefers-color-scheme: dark) { .hege-svg-icon { color: rgb(119, 119, 119); } }
            @media (prefers-color-scheme: light) { .hege-svg-icon { color: rgb(153, 153, 153); } .hege-checkbox-container:hover { background-color: rgba(0, 0, 0, 0.05); } }
            
            .hege-checkbox-container.checked .hege-svg-icon { color: #ff3b30; fill: #ff3b30; stroke: none; transform: scale(1.1); }
            .hege-checkmark { display: none; stroke: white; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
            .hege-checkbox-container.checked .hege-checkmark { display: block; }

            .hege-checkbox-container.finished { opacity: 0.6; }
            .hege-checkbox-container.finished .hege-svg-icon { color: #555; }
            .hege-checkbox-container:active { transform: translateY(-50%) scale(0.9); }
            
            .hege-block-all-btn {
                display: flex; align-items: center; justify-content: center;
                gap: 6px; padding: 6px 12px; margin-left: 12px;
                background-color: rgba(255, 59, 48, 0.1); color: #ff3b30;
                border: 1px solid rgba(255, 59, 48, 0.3); border-radius: 16px;
                font-size: 14px; font-weight: bold; cursor: pointer;
                transition: all 0.2s;
            }
            .hege-block-all-btn:hover { background-color: rgba(255, 59, 48, 0.2); }
            .hege-block-all-btn:active { transform: scale(0.95); }
            .hege-block-all-btn svg { width: 16px; height: 16px; }

            #hege-panel {
                position: fixed; z-index: 2147483647;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                user-select: none;
            }

            #hege-header {
                background: #101010; color: #fff;
                padding: 8px 12px;
                border-radius: 18px;
                border: 1px solid #333;
                font-weight: bold; font-size: 14px;
                cursor: pointer;
                display: flex; align-items: center; justify-content: space-between;
                box-shadow: 0 2px 5px rgba(0,0,0,0.3);
            }
            #hege-toggle { font-size: 10px; opacity: 0.7; margin-left: 6px; }

            #hege-panel.minimized .hege-content { display: none; }
            
            #hege-panel:not(.minimized) .hege-content {
                 position: absolute; 
                 top: 100%; right: 0;
                 margin-top: 8px; /* Gap */
                 background: #181818; 
                 border: 1px solid #333;
                 border-radius: 16px;
                 width: 240px;
                 box-shadow: 0 4px 20px rgba(0,0,0,0.6);
                 overflow: hidden;
                 display: flex; flex-direction: column;
            }

            .hege-menu-item {
                padding: 14px 16px;
                color: #f5f5f5;
                font-size: 15px;
                font-weight: 500;
                cursor: pointer;
                border-bottom: 1px solid #2a2a2a;
                display: flex; justify-content: space-between; align-items: center;
                transition: background 0.1s;
            }
            .hege-menu-item:hover { background: #222; }
            .hege-menu-item:last-child { border-bottom: none; }
            
            .hege-menu-item.danger { color: #ff3b30; }
            .hege-menu-item .status { font-size: 12px; color: #888; }
            
            #hege-bg-status { padding: 4px 16px; font-size: 11px; color: #4cd964; background: #1a1a1a; display: none; }
            body.hege-ghost-mode div[role="menu"], body.hege-ghost-mode div[role="dialog"] { opacity: 0 !important; pointer-events: auto !important; }
            
            #hege-disclaimer-overlay {
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0,0,0,0.85); z-index: 2147483647;
                display: flex; align-items: center; justify-content: center;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            }
            #hege-disclaimer-box {
                background: #181818; border: 1px solid #333; border-radius: 16px;
                padding: 24px; max-width: 85%; width: 400px;
                color: #f5f5f5; text-align: center;
                box-shadow: 0 10px 40px rgba(0,0,0,0.8);
            }
            #hege-disclaimer-title { font-size: 18px; font-weight: bold; margin-bottom: 16px; color: #fff; }
            #hege-disclaimer-text { font-size: 14px; line-height: 1.5; color: #ccc; margin-bottom: 24px; text-align: left; background: #222; padding: 12px; border-radius: 8px; }
            #hege-disclaimer-btn {
                background: #fff; color: #000; border: none; padding: 10px 32px;
                border-radius: 30px; font-size: 15px; font-weight: 600; cursor: pointer;
                transition: transform 0.1s;
            }
            #hege-disclaimer-btn:active { transform: scale(0.95); }
        `;
        (document.head || document.documentElement).appendChild(style);
    },

    createPanel: (callbacks) => {
        const isMinimized = Storage.get(CONFIG.KEYS.STATE, 'true') === 'true';
        const isMobile = Utils.isMobile();

        const panel = document.createElement('div');
        panel.id = 'hege-panel';
        panel.className = isMinimized ? 'minimized' : '';

        const htmlContent = `
            <div id="hege-header">
                <div>留友封 <span id="hege-queue-badge" style="font-size:12px; color:#4cd964; margin-left:4px;"></span></div>
                <span id="hege-toggle">${isMinimized ? '▼' : '▲'}</span>
            </div>
            <div class="hege-content">
                <div id="hege-bg-status">執行狀態...</div>
                
                <div class="hege-menu-item" id="hege-main-btn-item">
                    <span>開始封鎖</span>
                    <span class="status" id="hege-sel-count">0 選取</span>
                </div>

                <div class="hege-menu-item" id="hege-clear-sel-item">
                    <span>清除選取</span>
                </div>
                
                <div class="hege-menu-item" id="hege-import-item">
                    <span>匯入名單</span>
                </div>
                
                <div class="hege-menu-item" id="hege-export-item">
                    <span>匯出紀錄</span>
                </div>
                
                <div class="hege-menu-item danger" id="hege-retry-failed-item" style="display:none;">
                    <span>重試失敗清單</span>
                    <span class="status" id="hege-failed-count">0</span>
                </div>
                
                <div class="hege-menu-item" id="hege-report-item" style="display:none;">
                    <span>🐛 回報問題</span>
                </div>

                <div class="hege-menu-item danger" id="hege-clear-db-item">
                    <span>清除所有歷史</span>
                </div>
                
                <div class="hege-menu-item danger" id="hege-stop-btn-item" style="border-top:1px solid #333; display:none;">
                    <span>停止執行</span>
                </div>
            </div>
        `;
        Utils.setHTML(panel, htmlContent);
        document.body.appendChild(panel);

        // Bind Events
        const bindClick = (id, handler) => {
            if (!handler) return;
            const el = document.getElementById(id);
            if (!el) return;
            // The UI panel uses standard click events securely because it floats at the body level
            // away from any <a> tags. Using touchend + preventDefault here breaks iOS window.open permissions.
            el.addEventListener('click', handler);
        };

        document.getElementById('hege-toggle').onclick = () => {
            const min = !panel.classList.contains('minimized');
            panel.classList.toggle('minimized', min);
            Storage.set(CONFIG.KEYS.STATE, min);
            document.getElementById('hege-toggle').textContent = min ? '▼' : '▲';
        };

        bindClick('hege-main-btn-item', callbacks.onMainClick);
        bindClick('hege-clear-sel-item', callbacks.onClearSel);
        bindClick('hege-clear-db-item', callbacks.onClearDB);
        bindClick('hege-import-item', callbacks.onImport);
        bindClick('hege-export-item', callbacks.onExport);
        bindClick('hege-retry-failed-item', callbacks.onRetryFailed);
        bindClick('hege-report-item', callbacks.onReport);
        bindClick('hege-stop-btn-item', callbacks.onStop);


        // Header click toggles too
        document.getElementById('hege-header').onclick = (e) => {
            if (e.target.id !== 'hege-toggle') document.getElementById('hege-toggle').click();
        };

        // Auto-collapse on outside click
        document.addEventListener('click', (e) => {
            const p = document.getElementById('hege-panel');
            if (p && !p.classList.contains('minimized') && !p.contains(e.target) && !e.target.closest('#hege-panel')) {
                p.classList.add('minimized');
                Storage.set(CONFIG.KEYS.STATE, 'true');
                const t = document.getElementById('hege-toggle');
                if (t) t.textContent = '▼';
            }
        });

        return panel;
    },

    showToast: (msg, duration = 2500) => {
        const exist = document.getElementById('hege-toast');
        if (exist) exist.remove();
        const toast = document.createElement('div');
        toast.id = 'hege-toast'; toast.textContent = msg;
        toast.style.cssText = `
            position: fixed; top: 10%; left: 50%; transform: translateX(-50%);
            background: rgba(0, 180, 0, 0.95); color: white; padding: 12px 24px;
            border-radius: 50px; font-size: 16px; font-weight: bold; z-index: 2147483647;
            box-shadow: 0 5px 20px rgba(0,0,0,0.5); pointer-events: none;
            transition: opacity 0.5s; font-family: system-ui; text-align: center;
        `;
        (document.body || document.documentElement).appendChild(toast);
        setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 500); }, duration);
    },

    updateDebugLog: (msg) => {
        // Console only requested
        console.log(`[HegeUI] ${msg}`);
    },

    anchorPanel: () => {
        const panel = document.getElementById('hege-panel');
        if (!panel) return;

        // Optimization: Try to find anchor in a more restricted scope first
        let anchor = null;
        const navSelectors = ['div[role="navigation"]', 'header', 'nav', 'div[style*="position: fixed"]'];

        for (const selector of navSelectors) {
            const container = document.querySelector(selector);
            if (!container) continue;

            const svgs = container.querySelectorAll('svg');
            for (let svg of svgs) {
                const label = (svg.getAttribute('aria-label') || '').trim();
                if (label === '功能表' || label === 'Menu' || label === 'Settings' || label === '設定' || label === '更多選項') {
                    anchor = svg.closest('div[role="button"]') || svg;
                    break;
                }
                const rects = svg.querySelectorAll('rect, line');
                if (rects.length === 2 && svg.getBoundingClientRect().top < 100) {
                    anchor = svg.closest('div[role="button"]') || svg;
                    break;
                }
            }
            if (anchor) break;
        }

        // Fallback to broader search only if needed and not recently checked
        if (!anchor) {
            const svgs = document.querySelectorAll('svg');
            for (let svg of svgs) {
                const label = (svg.getAttribute('aria-label') || '').trim();
                if (label === '功能表' || label === 'Menu' || label === 'Settings' || label === '設定' || label === '更多選項') {
                    anchor = svg.closest('div[role="button"]') || svg;
                    break;
                }
            }
        }

        if (anchor) {
            const rect = anchor.getBoundingClientRect();
            // Visibility Check: Ensure the anchor is actually visible
            if (rect.width > 0 && rect.height > 0 && rect.top >= 0) {
                panel.style.top = (rect.top) + 'px';
                let rightVal = window.innerWidth - rect.left + 5;
                rightVal = rightVal - 3;
                if (window.innerWidth < 450) {
                    if (rightVal < 0) rightVal = 0;
                    if (rightVal > window.innerWidth - 100) rightVal = 10;
                }
                panel.style.right = rightVal + 'px';
                panel.style.left = 'auto';
                if (CONFIG.DEBUG_MODE) console.log(`[留友封] Menu Anchored at ${rect.top}px`);
            }
        } else {
            // console.log('[留友封] No Anchor Found - Using Fallback Position');
            // Force visible on top
            if (!panel.style.top || parseInt(panel.style.top) > 200 || parseInt(panel.style.top) < 50) {
                panel.style.top = '85px';
                panel.style.right = '16px';
                panel.style.left = 'auto';
                panel.style.zIndex = '1000000';
                panel.style.display = 'block';

                // Visual Debugging: Force dimensions and color
                panel.style.minWidth = '50px';
                panel.style.minHeight = '20px';
                // panel.style.border = '2px solid red'; // Uncomment if needed, but 'Test' text below is better

                // Content Check
                if (panel.innerHTML.trim().length === 0) {
                    console.error('[留友封] Panel is empty! Re-injecting...');
                    panel.textContent = 'Err: Empty Panel';
                    panel.style.background = 'red';
                    panel.style.color = 'white';
                    panel.style.padding = '10px';
                }
            }
        }
    },

    showDisclaimer: (onConfirm) => {
        if (document.getElementById('hege-disclaimer-overlay')) return;

        const overlay = document.createElement('div');
        overlay.id = 'hege-disclaimer-overlay';
        overlay.innerHTML = `
            <div id="hege-disclaimer-box">
                <div id="hege-disclaimer-title">使用前說明</div>
                <div id="hege-disclaimer-text">
                    本擴充功能「留友封」僅供輔助過濾資訊，請依個人使用習慣斟酌，若因社群平台政策更動導致失效或異常，開發者不負相關責任。
                </div>
                <button id="hege-disclaimer-btn">我同意並繼續</button>
            </div>
        `;
        (document.body || document.documentElement).appendChild(overlay);

        document.getElementById('hege-disclaimer-btn').onclick = () => {
            overlay.remove();
            if (onConfirm) onConfirm();
        };
    }
};

// --- core.js ---





const Core = {
    blockQueue: new Set(),
    pendingUsers: new Set(),
    lastClickedBtn: null, // Track for shift-click
    lastClickedUsername: null, // Fallback if DOM node is lost
    lastClickedState: null, // null, 'checked', or 'unchecked'

    init: () => {
        Core.pendingUsers = new Set(Storage.getSessionJSON(CONFIG.KEYS.PENDING));

        const hasAgreed = Storage.get(CONFIG.KEYS.DISCLAIMER_AGREED);

        if (!hasAgreed) {
            UI.showDisclaimer(() => {
                Storage.set(CONFIG.KEYS.DISCLAIMER_AGREED, 'true');
                Core.startScanner();
            });
        } else {
            Core.startScanner();
        }
    },

    observer: null,
    startScanner: () => {
        // Optimization: Use MutationObserver instead of fixed interval for most cases
        if (Core.observer) Core.observer.disconnect();

        Core.observer = new MutationObserver((mutations) => {
            let shouldScan = false;
            let dialogChanged = false;
            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0) {
                    shouldScan = true;
                    dialogChanged = true;
                    break;
                }
            }
            if (shouldScan) Core.scanAndInject();
            if (dialogChanged) Core.injectDialogBlockAll();
        });

        Core.observer.observe(document.body, { childList: true, subtree: true });

        // Backup polling (much slower) just in case
        setInterval(Core.scanAndInject, 5000);
        Core.scanAndInject();

        // React often swallows events or stops propagation.
        // We now bind `addEventListener('click', Core.handleGlobalClick, true)` 
        // directly to the initialized containers instead of window to prevent click-through.
    },

    saveToDB: (username) => {
        if (!username) return;
        username = username.replace('@', '').trim();
        let dbArray = Storage.getJSON(CONFIG.KEYS.DB_KEY, []);
        let db = new Set(dbArray);
        if (!db.has(username)) {
            db.add(username);
            Storage.setJSON(CONFIG.KEYS.DB_KEY, [...db]);
        }
    },

    injectDialogBlockAll: () => {
        const headers = document.querySelectorAll('h1, h2');
        let header = null;
        let titleText = '';

        for (let h of headers) {
            const text = h.innerText.trim();

            // We want to lock onto these specific dialog keywords:
            // "貼文動態" (Post Activity), "讚" (Likes), "Likes"
            if (text.includes('貼文動態') || text.includes('讚') || text.includes('Likes')) {
                // Ignore the main page "Threads" header if somehow it matched
                if (text === 'Threads') continue;

                // Extra safety: make sure it's inside a dialog or at least not the main nav
                let isDialog = false;
                let p = h.parentElement;
                for (let i = 0; i < 6; i++) {
                    if (p && p.getAttribute('role') === 'dialog') { isDialog = true; break; }
                    if (p) p = p.parentElement;
                }

                // With specific keywords, we can be more confident, but let's enforce dialog
                // or just allow it if the text is exactly '貼文動態' since it's highly specific.
                if (isDialog || text === '貼文動態') {
                    header = h;
                    titleText = text;
                    break;
                }
            }
        }

        if (!header) return;

        const headerContainer = header.parentElement;
        if (!headerContainer) return;

        // Ensure we haven't already injected the button
        if (headerContainer.dataset.hegeDialogInjected) return;

        // Prevent multiple injections
        headerContainer.dataset.hegeDialogInjected = 'true';

        // Create the Block All Button
        const blockAllBtn = document.createElement('div');
        blockAllBtn.className = 'hege-block-all-btn';
        blockAllBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"></path></svg>
            <span>同列全封</span>
        `;

        const handleBlockAll = (e) => {
            e.stopPropagation();
            e.preventDefault();

            // Scope the search to the modal context (go up 8 levels)
            let ctx = header;
            for (let i = 0; i < 8; i++) {
                if (ctx.parentElement && ctx.parentElement.tagName !== 'BODY') {
                    ctx = ctx.parentElement;
                }
            }

            // Find all user links in the dialog context
            const links = ctx.querySelectorAll('a[href^="/@"]');
            let rawUsers = Array.from(links).map(a => {
                const href = a.getAttribute('href');
                return href.split('/@')[1].split('/')[0];
            });

            // Deduplicate internally
            rawUsers = [...new Set(rawUsers)];

            // Filter out existing DB, Queue, and Pending users
            const db = new Set(Storage.getJSON(CONFIG.KEYS.DB_KEY, []));
            let activeQueue = Storage.getJSON(CONFIG.KEYS.BG_QUEUE, []);
            const activeSet = new Set(activeQueue);

            const newUsers = rawUsers.filter(u => !db.has(u) && !activeSet.has(u) && !Core.pendingUsers.has(u));

            if (newUsers.length === 0) {
                UI.showToast('沒有新帳號可加入 (皆已在歷史或排除中)');
                return;
            }

            const status = Storage.getJSON(CONFIG.KEYS.BG_STATUS, {});
            const isRunning = (Date.now() - (status.lastUpdate || 0) < 10000 && status.state === 'running');

            // Directly add to pending without confirm dialog
            newUsers.forEach(u => Core.pendingUsers.add(u));
            Storage.setSessionJSON(CONFIG.KEYS.PENDING, [...Core.pendingUsers]);

            if (isRunning) {
                const combinedQueue = [...activeQueue, ...Core.pendingUsers];
                Storage.setJSON(CONFIG.KEYS.BG_QUEUE, [...new Set(combinedQueue)]);
                UI.showToast(`已將畫面上 ${newUsers.length} 筆帳號加入背景排隊`);
            } else {
                UI.showToast(`已加入「${Core.pendingUsers.size} 選取」，請至清單「開始封鎖」`);
            }

            // Sync checkbox visually on current page
            document.querySelectorAll('.hege-checkbox-container').forEach(box => {
                if (box.dataset.username && Core.pendingUsers.has(box.dataset.username)) {
                    box.classList.add('checked');
                }
            });

            // CRITICAL: Update floating panel count!
            Core.updateControllerUI();
        };

        if (Utils.isMobile()) {
            blockAllBtn.addEventListener('touchstart', (e) => {
                e.stopPropagation();
            }, { passive: false });

            blockAllBtn.addEventListener('touchend', (e) => {
                // preventDefault stops iOS Safari from firing the synthetic click which triggers Universal Links
                e.stopPropagation();
                e.preventDefault();
                handleBlockAll(e);
            }, { passive: false });
        } else {
            blockAllBtn.addEventListener('click', handleBlockAll);
        }

        headerContainer.style.display = 'flex';
        headerContainer.style.alignItems = 'center';

        // Insert after the h1 so it is placed nicely
        if (header.nextSibling) {
            headerContainer.insertBefore(blockAllBtn, header.nextSibling);
        } else {
            headerContainer.appendChild(blockAllBtn);
        }
    },


    scanAndInject: () => {
        // Performance: Only run if window is active/visible to save CPU
        if (document.hidden) return;

        const moreSvgs = document.querySelectorAll(CONFIG.SELECTORS.MORE_SVG);
        if (moreSvgs.length === 0) return;

        // Optimization: Cache DB lookup
        const db = new Set(Storage.getJSON(CONFIG.KEYS.DB_KEY));

        moreSvgs.forEach(svg => {
            const btn = svg.closest('div[role="button"]');
            if (!btn || !btn.parentElement) return;

            // Check if already processed
            if (btn.getAttribute('data-hege-checked') === 'true') return;
            if (btn.parentElement.querySelector('.hege-checkbox-container')) {
                btn.setAttribute('data-hege-checked', 'true');
                return;
            }

            // SVG filtering
            if (!svg.querySelector('circle') && !svg.querySelector('path')) return;
            const viewBox = svg.getAttribute('viewBox');
            if (viewBox === '0 0 12 12' || viewBox === '0 0 13 12') return;
            const width = svg.style.width ? parseInt(svg.style.width) : 24;
            if (width < 16 && svg.clientWidth < 16) return;

            let username = null;
            try {
                let p = btn.parentElement; let foundLink = null;
                for (let i = 0; i < 5; i++) {
                    if (!p) break;
                    foundLink = p.querySelector('a[href^="/@"]');
                    if (foundLink) break;
                    p = p.parentElement;
                }
                if (foundLink) {
                    username = foundLink.getAttribute('href').split('/@')[1].split('/')[0];
                }
            } catch (e) { }

            if (username && username === Utils.getMyUsername()) {
                // Checkbox should not appear for the user's own account
                btn.setAttribute('data-hege-checked', 'true');
                return;
            }

            btn.setAttribute('data-hege-checked', 'true');
            btn.style.transition = 'transform 0.2s';
            btn.style.transform = 'translateX(-45px)';

            const container = document.createElement('div');
            container.className = 'hege-checkbox-container';

            const svgIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            svgIcon.setAttribute("viewBox", "0 0 24 24");
            svgIcon.classList.add("hege-svg-icon");

            const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            rect.setAttribute("x", "2"); rect.setAttribute("y", "2");
            rect.setAttribute("width", "20"); rect.setAttribute("height", "20");
            rect.setAttribute("rx", "6"); rect.setAttribute("ry", "6");
            rect.setAttribute("stroke", "currentColor"); rect.setAttribute("stroke-width", "2.5");
            rect.setAttribute("fill", "none");

            const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
            path.classList.add("hege-checkmark");
            path.setAttribute("d", "M6 12 l4 4 l8 -8");
            path.setAttribute("fill", "none");

            svgIcon.appendChild(rect); svgIcon.appendChild(path);
            container.appendChild(svgIcon);

            if (username) {
                btn.dataset.username = username;
                container.dataset.username = username;

                const db = new Set(Storage.getJSON(CONFIG.KEYS.DB_KEY));
                const cdq = new Set(Storage.getJSON(CONFIG.KEYS.COOLDOWN_QUEUE, []));
                const bgq = new Set(Storage.getJSON(CONFIG.KEYS.BG_QUEUE, []));

                if (db.has(username)) {
                    container.classList.add('finished');
                } else if (Core.pendingUsers.has(username) || cdq.has(username) || bgq.has(username)) {
                    container.classList.add('checked');
                    Core.blockQueue.add(btn);
                }
            }

            if (Utils.isMobile()) {
                container.addEventListener('touchstart', (e) => {
                    if (e.target.closest('.hege-checkbox-container')) {
                        e.stopPropagation();
                    }
                }, { passive: false });

                container.addEventListener('touchend', (e) => {
                    if (e.target.closest('.hege-checkbox-container')) {
                        e.stopPropagation();
                        e.preventDefault(); // CRITICAL: Stop iOS from firing synthetic click that triggers Universal Link

                        // Manually trigger handleGlobalClick since we prevented the default synthetic click
                        Core.handleGlobalClick(e);
                    }
                }, { passive: false });
            } else {
                // Desktop (Chrome + Safari): intercept pointer/mouse events before React steals them
                container.addEventListener('pointerdown', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                }, true);
                container.addEventListener('pointerup', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                }, true);
                container.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                    if (e.shiftKey) e.preventDefault();
                }, true);
                container.addEventListener('mouseup', (e) => {
                    e.stopPropagation();
                }, true);
            }

            // Bind directly to the element using a capture phase listener.
            // This is the most bulletproof way to intercept clicks before React or <a> tags steal them.
            container.addEventListener('click', Core.handleGlobalClick, true);

            try {
                const ps = window.getComputedStyle(btn.parentElement).position;
                if (ps === 'static') btn.parentElement.style.position = 'relative';
                btn.parentElement.insertBefore(container, btn);
            } catch (e) { }
        });
    },

    handleGlobalClick: (e) => {
        const container = e.target.closest('.hege-checkbox-container');
        if (!container) return;

        // Stop propagation IMMEDIATELY to prevent opening user profile or React intercepting
        e.stopPropagation();
        e.preventDefault();

        if (CONFIG.DEBUG_MODE) {
            console.log(`[Shift - Click] Container Matched! ShiftKey: ${e.shiftKey}, anchorUsername: ${Core.lastClickedUsername}`);
        }

        // --- Shift-Click Multi-Select Logic ---
        let targetBoxes = [container];
        if (e.shiftKey && (Core.lastClickedBtn || Core.lastClickedUsername)) {
            const allBoxes = Array.from(document.querySelectorAll('.hege-checkbox-container'));
            let lastIdx = allBoxes.indexOf(Core.lastClickedBtn);

            // Fallback: If DOM node was recreated by React, find by username
            if (lastIdx === -1 && Core.lastClickedUsername) {
                lastIdx = allBoxes.findIndex(box => box.dataset.username === Core.lastClickedUsername);
            }

            const currIdx = allBoxes.indexOf(container);

            if (lastIdx !== -1 && currIdx !== -1) {
                const min = Math.min(lastIdx, currIdx);
                const max = Math.max(lastIdx, currIdx);
                targetBoxes = allBoxes.slice(min, max + 1);
                if (CONFIG.DEBUG_MODE) console.log(`[Shift - Click] Processing ${targetBoxes.length} items from index ${min} to ${max}`);
            } else {
                if (CONFIG.DEBUG_MODE) console.log(`[Shift - Click] Failed to establish range.lastIdx: ${lastIdx}, currIdx: ${currIdx}`);
            }
        }

        // Determine intended state based on current container
        const isCurrentlyChecked = container.classList.contains('checked');
        const isCurrentlyFinished = container.classList.contains('finished');

        let targetAction = 'check'; // Check by default
        if (isCurrentlyFinished) {
            targetAction = 'reset';
        } else if (isCurrentlyChecked) {
            targetAction = 'uncheck';
        }

        const currentDB = new Set(Storage.getJSON(CONFIG.KEYS.DB_KEY));

        targetBoxes.forEach(box => {
            const u = box.dataset.username;
            const btnElement = box.parentElement; // Used for blockQueue

            if (targetAction === 'reset' && box.classList.contains('finished')) {
                if (u) {
                    currentDB.delete(u);
                    box.classList.remove('finished');
                    box.classList.add('checked');
                    if (btnElement) btnElement.dataset.username = u; // Ensure dataset exists safely
                    if (btnElement) Core.blockQueue.add(btnElement);
                    Core.pendingUsers.add(u);
                }
            } else if (targetAction === 'uncheck' && box.classList.contains('checked')) {
                box.classList.remove('checked');
                // Remove from queue where username matches
                Array.from(Core.blockQueue).forEach(b => {
                    if (b.dataset && b.dataset.username === u) Core.blockQueue.delete(b);
                });
                if (u) {
                    Core.pendingUsers.delete(u);
                    let bg = Storage.getJSON(CONFIG.KEYS.BG_QUEUE, []);
                    if (bg.includes(u)) Storage.setJSON(CONFIG.KEYS.BG_QUEUE, bg.filter(x => x !== u));
                    let cdq = Storage.getJSON(CONFIG.KEYS.COOLDOWN_QUEUE, []);
                    if (cdq.includes(u)) Storage.setJSON(CONFIG.KEYS.COOLDOWN_QUEUE, cdq.filter(x => x !== u));
                }
            } else if (targetAction === 'check' && !box.classList.contains('checked') && !box.classList.contains('finished')) {
                box.classList.add('checked');
                if (btnElement) btnElement.dataset.username = u;
                if (btnElement) Core.blockQueue.add(btnElement);
                if (u) Core.pendingUsers.add(u);
            }
        });

        if (targetAction === 'reset') {
            Storage.setJSON(CONFIG.KEYS.DB_KEY, [...currentDB]);
            UI.showToast('已重置並重新加入排程');
        }

        Storage.setSessionJSON(CONFIG.KEYS.PENDING, [...Core.pendingUsers]);

        Core.lastClickedBtn = container;
        Core.lastClickedUsername = container.dataset.username;
        Core.lastClickedState = targetAction;

        if (CONFIG.DEBUG_MODE) {
            console.log(`[Shift - Click] State saved.next anchorUsername: ${Core.lastClickedUsername}`);
        }

        Core.updateControllerUI();
    },

    updateControllerUI: () => {
        // Throttled UI update logic (proper deferral to prevent missed updates)
        if (Core._uiUpdatePending) return;

        const now = Date.now();
        const timeSinceLast = now - (Core._lastUIUpdate || 0);

        if (timeSinceLast < 500) {
            Core._uiUpdatePending = setTimeout(() => {
                Core._uiUpdatePending = null;
                Core.updateControllerUI();
            }, 500 - timeSinceLast);
            return;
        }

        Core._lastUIUpdate = now;
        Core._uiUpdatePending = null;

        const db = new Set(Storage.getJSON(CONFIG.KEYS.DB_KEY));
        const cdq = new Set(Storage.getJSON(CONFIG.KEYS.COOLDOWN_QUEUE, []));
        const bgq = new Set(Storage.getJSON(CONFIG.KEYS.BG_QUEUE, []));

        // Global cleanup
        let pendingChanged = false;
        for (const u of Core.pendingUsers) {
            if (db.has(u) || cdq.has(u) || bgq.has(u)) {
                Core.pendingUsers.delete(u);
                pendingChanged = true;
            }
        }
        if (pendingChanged) Storage.setSessionJSON(CONFIG.KEYS.PENDING, [...Core.pendingUsers]);

        // Only update visible elements or those that need state change
        document.querySelectorAll('.hege-checkbox-container').forEach(el => {
            const u = el.dataset.username;
            if (!u) return;

            if (db.has(u)) {
                if (!el.classList.contains('finished')) {
                    el.classList.add('finished');
                    el.classList.remove('checked');
                }
            } else if (Core.pendingUsers.has(u) || cdq.has(u) || bgq.has(u)) {
                if (!el.classList.contains('checked') && !el.classList.contains('finished')) {
                    el.classList.add('checked');
                } else if (el.classList.contains('finished')) {
                    el.classList.remove('finished');
                    el.classList.add('checked');
                }
            } else {
                el.classList.remove('finished');
                el.classList.remove('checked');
            }
        });

        const selCount = document.getElementById('hege-sel-count');
        if (selCount) selCount.textContent = `${Core.pendingUsers.size} 選取`;

        const panel = document.getElementById('hege-panel');
        if (!panel) return;

        const failedQueue = Storage.getJSON(CONFIG.KEYS.FAILED_QUEUE, []);
        const retryItem = document.getElementById('hege-retry-failed-item');
        const reportItem = document.getElementById('hege-report-item');
        if (retryItem) {
            if (failedQueue.length > 0) {
                retryItem.style.display = 'flex';
                const countBadge = document.getElementById('hege-failed-count');
                if (countBadge) countBadge.textContent = `${failedQueue.length} 筆`;
            } else {
                retryItem.style.display = 'none';
            }
        }
        if (reportItem) {
            reportItem.style.display = failedQueue.length > 0 ? 'flex' : 'none';
        }

        let badgeText = Core.pendingUsers.size > 0 ? `(${Core.pendingUsers.size})` : '';

        let shouldShowStop = false;
        let mainText = '開始封鎖';
        let headerColor = 'transparent'; // Use transparent or theme color

        const cooldownUntil = parseInt(Storage.get(CONFIG.KEYS.COOLDOWN) || '0');
        if (cooldownUntil > Date.now()) {
            const remainHrs = Math.ceil((cooldownUntil - Date.now()) / (1000 * 60 * 60));
            const cdQueueSize = Storage.getJSON(CONFIG.KEYS.COOLDOWN_QUEUE, []).length;
            mainText = `⛔ 限制保護中 (${remainHrs}小時候恢復)`;
            headerColor = '#ff453a';
            badgeText = `(${cdQueueSize}冷卻中)`;
        } else {
            const bgStatus = Storage.getJSON(CONFIG.KEYS.BG_STATUS, {});
            if (bgStatus.state === 'running' && (Date.now() - (bgStatus.lastUpdate || 0) < 10000)) {
                shouldShowStop = true;
                mainText = `背景執行中 剩餘 ${bgStatus.total}`;
                headerColor = '#4cd964';
                badgeText = `(${bgStatus.total}剩餘)`; // Show progress in header badge explicitly
            } else if (bgq.size > 0) {
                // Worker stopped/idle but queue has remaining items from a previous run
                mainText = `繼續封鎖 (${bgq.size} 筆待處理)`;
                headerColor = '#ff9500';
                badgeText = `(${bgq.size}待處理)`;
            }
        }

        const badge = document.getElementById('hege-queue-badge');
        if (badge) badge.textContent = badgeText;

        const stopBtn = document.getElementById('hege-stop-btn-item'); if (stopBtn) stopBtn.style.display = shouldShowStop ? 'flex' : 'none';
        const mainItem = document.getElementById('hege-main-btn-item');
        if (mainItem) { mainItem.querySelector('span').textContent = mainText; mainItem.style.color = shouldShowStop ? headerColor : '#f5f5f5'; }
        const header = document.getElementById('hege-header'); if (header) header.style.borderColor = headerColor;
    },

    runSameTabWorker: () => {
        const toAdd = Array.from(Core.pendingUsers);

        const q = Storage.getJSON(CONFIG.KEYS.BG_QUEUE, []);
        const newQ = [...new Set([...q, ...toAdd])];

        if (newQ.length === 0) {
            UI.showToast('沒有待處理的帳號');
            return;
        }

        Storage.setJSON(CONFIG.KEYS.BG_QUEUE, newQ);
        Storage.remove(CONFIG.KEYS.BG_CMD);
        Storage.remove('hege_worker_stats'); // Fresh stats for new session

        if (toAdd.length > 0) {
            Core.pendingUsers.clear();
            Storage.setSessionJSON(CONFIG.KEYS.PENDING, []);
        }

        // Save current page URL (without hege_bg param) so the worker can navigate back when done
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete('hege_bg');
        Storage.set('hege_return_url', cleanUrl.toString());

        // CRITICAL: Use history.replaceState + reload to avoid Universal Links entirely.
        // Since we're already on threads.net, we modify the URL in-place (no navigation event)
        // and reload. Safari sees this as a page refresh, NOT a navigation to a new URL,
        // so Universal Links cannot intercept it.
        const workerUrl = new URL(window.location.origin);
        workerUrl.searchParams.set('hege_bg', 'true');
        history.replaceState(null, '', workerUrl.toString());
        location.reload();
    },



    exportHistory: () => {
        const db = Storage.getJSON(CONFIG.KEYS.DB_KEY, []);
        if (db.length === 0) { UI.showToast('歷史資料庫是空的'); return; }
        const list = db.join('\n');
        navigator.clipboard.writeText(list).then(() => { UI.showToast(`已複製 ${db.length} 人名單`); }).catch(() => { prompt("請手動複製總名單：", list); });
    },

    retryFailedQueue: () => {
        const failedUsers = Storage.getJSON(CONFIG.KEYS.FAILED_QUEUE, []);
        if (failedUsers.length === 0) {
            UI.showToast('沒有失敗紀錄可重試');
            return;
        }

        if (confirm(`發現 ${failedUsers.length} 筆過去封鎖失敗或找不到人的帳號。\n確定要重新將他們加入排隊列重試嗎？`)) {
            let activeQueue = Storage.getJSON(CONFIG.KEYS.BG_QUEUE, []);
            const combinedQueue = [...new Set([...activeQueue, ...failedUsers])];
            Storage.setJSON(CONFIG.KEYS.BG_QUEUE, combinedQueue);
            Storage.setJSON(CONFIG.KEYS.FAILED_QUEUE, []); // Clear it out
            UI.showToast(`已將 ${failedUsers.length} 筆名單重送至背景排隊`);

            Core.updateControllerUI();

            const status = Storage.getJSON(CONFIG.KEYS.BG_STATUS, {});
            const isRunning = (Date.now() - (status.lastUpdate || 0) < 10000 && status.state === 'running');
            if (!isRunning) {
                if (Utils.isMobile()) {
                    Core.runSameTabWorker();
                } else {
                    window.open('https://www.threads.net/?hege_bg=true', 'HegeBlockWorker', 'width=800,height=600');
                }
            }
        }
    },

    importList: () => {
        const input = prompt("請貼上 ID 名單："); if (!input) return;
        let rawUsers = input.split(/[\s,，\n]+/).map(u => u.trim()).filter(u => u.length > 0).map(u => {
            u = u.split('?')[0]; // 去除網址帶有的 tracking parameters
            if (u.includes('/@')) return u.split('/@')[1].split('/')[0];
            if (u.startsWith('@')) return u.substring(1);
            return u.split('/')[0];
        });

        // 名單內部自身去重
        rawUsers = [...new Set(rawUsers)];

        const db = new Set(Storage.getJSON(CONFIG.KEYS.DB_KEY, []));
        let activeQueue = Storage.getJSON(CONFIG.KEYS.BG_QUEUE, []);
        const activeSet = new Set(activeQueue);

        // 雙重過濾：不在歷史紀錄中，且不在當前的排隊佇列中
        const newUsers = rawUsers.filter(u => !db.has(u) && !activeSet.has(u));

        if (newUsers.length === 0) { UI.showToast('沒有新名單可匯入 (皆已在歷史庫或等待佇列中)'); return; }

        const combinedQueue = [...activeQueue, ...newUsers];
        Storage.setJSON(CONFIG.KEYS.BG_QUEUE, combinedQueue);

        UI.showToast(`已匯入 ${newUsers.length} 筆至背景佇列`);

        const status = Storage.getJSON(CONFIG.KEYS.BG_STATUS, {});
        const isRunning = (Date.now() - (status.lastUpdate || 0) < 10000 && status.state === 'running');

        if (!isRunning && confirm(`已匯入 ${newUsers.length} 筆名單。\n是否立即開始背景執行？`)) {
            if (Utils.isMobile()) {
                Core.runSameTabWorker();
            } else {
                window.open('https://www.threads.net/?hege_bg=true', 'HegeBlockWorker', 'width=800,height=600');
            }
        } else if (isRunning) {
            UI.showToast('已合併至正在運行的背景任務');
        }
    },

    collectDiagnostics: () => {
        const isIPad = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || isIPad;
        const platform = isIOS ? 'iOS/iPad' : 'Desktop';

        // Detect Threads UI language from aria labels
        const svgs = document.querySelectorAll('svg[aria-label]');
        const ariaLabels = Array.from(svgs).map(s => s.getAttribute('aria-label'));
        const hasZh = ariaLabels.some(l => /[\u4e00-\u9fff]/.test(l));
        const hasEn = ariaLabels.some(l => /^[A-Za-z ]+$/.test(l));
        const langDetected = hasZh ? 'zh' : (hasEn ? 'en' : 'unknown');

        // SVG structure of "More" buttons
        const moreSvgs = document.querySelectorAll('svg[aria-label="更多"], svg[aria-label="More"]');
        const svgDetails = Array.from(moreSvgs).map(s => {
            const hasCircle = !!s.querySelector('circle');
            const pathCount = s.querySelectorAll('path').length;
            const vb = s.getAttribute('viewBox');
            return `circle=${hasCircle},paths=${pathCount},vb=${vb}`;
        });

        // Menu items if any are open
        const menuItems = document.querySelectorAll('div[role="menuitem"]');
        const menuTexts = Array.from(menuItems).map(el => (el.innerText || '').trim().substring(0, 30));

        // Dialog info
        const dialogs = document.querySelectorAll('div[role="dialog"]');
        const dialogTexts = Array.from(dialogs).map(d => (d.innerText || '').trim().substring(0, 80));

        // Queue states
        const bgQueue = Storage.getJSON(CONFIG.KEYS.BG_QUEUE, []);
        const failedQueue = Storage.getJSON(CONFIG.KEYS.FAILED_QUEUE, []);
        const cooldownQueue = Storage.getJSON(CONFIG.KEYS.COOLDOWN_QUEUE, []);
        const cooldownUntil = parseInt(Storage.get(CONFIG.KEYS.COOLDOWN) || '0');
        const cooldownActive = cooldownUntil > Date.now();
        const cooldownRemain = cooldownActive ? Math.ceil((cooldownUntil - Date.now()) / (1000 * 60 * 60)) + 'h' : 'N/A';

        // Worker stats
        const workerStats = Storage.getJSON('hege_worker_stats', {});
        const bgStatus = Storage.getJSON(CONFIG.KEYS.BG_STATUS, {});

        // Debug logs
        let debugLogs = [];
        try {
            debugLogs = JSON.parse(localStorage.getItem(CONFIG.KEYS.DEBUG_LOG) || '[]');
        } catch (e) { }

        // Checkbox states
        const checkboxes = document.querySelectorAll('.hege-checkbox-container');
        const cbChecked = Array.from(checkboxes).filter(el => el.classList.contains('checked')).length;
        const cbFinished = Array.from(checkboxes).filter(el => el.classList.contains('finished')).length;

        // UserScript manager detection
        let injectionMethod = 'unknown';
        if (typeof GM_info !== 'undefined') injectionMethod = 'Tampermonkey/Userscripts';
        else if (document.querySelector('script[src*="content.js"]')) injectionMethod = 'Chrome Extension';
        else if (chrome && chrome.runtime) injectionMethod = 'Chrome Extension';

        // Build report
        const lines = [
            `🛡️ 留友封 診斷報告`,
            `版本: ${CONFIG.VERSION}`,
            `平台: ${platform} | ${navigator.platform} | TP:${navigator.maxTouchPoints}`,
            `UA: ${navigator.userAgent}`,
            `注入: ${injectionMethod}`,
            `語言: ${langDetected} (偵測自 aria-labels)`,
            `URL: ${location.pathname}${location.search}`,
            ``,
            `── 佇列狀態 ──`,
            `待處理: ${bgQueue.length} | 失敗: ${failedQueue.length} | 冷卻備份: ${cooldownQueue.length}`,
            `冷卻中: ${cooldownActive ? '⚠️ 是 (剩餘 ' + cooldownRemain + ')' : '❌ 否'}`,
            `Worker: ${bgStatus.state || 'idle'} | 最後更新: ${bgStatus.lastUpdate ? new Date(bgStatus.lastUpdate).toLocaleTimeString() : 'N/A'}`,
            ``,
            `── Worker 統計 ──`,
            `成功: ${workerStats.stats?.success ?? 'N/A'} | 跳過: ${workerStats.stats?.skipped ?? 'N/A'} | 失敗: ${workerStats.stats?.failed ?? 'N/A'}`,
            `驗證等級: ${workerStats.verifyLevel ?? 'N/A'} | 連續失敗: ${workerStats.consecutiveFails ?? 'N/A'}`,
            `Session 名單: ${workerStats.sessionQueue?.length ?? 'N/A'} | 初始 Total: ${workerStats.initialTotal ?? 'N/A'}`,
            ``,
            `── DOM 快照 ──`,
            `更多按鈕 SVG(${moreSvgs.length}): ${svgDetails.length > 0 ? svgDetails.join(' | ') : '未找到'}`,
            `頁面 aria-labels(${ariaLabels.length}): ${JSON.stringify([...new Set(ariaLabels)])}`,
            `menuitem(${menuTexts.length}): ${menuTexts.length > 0 ? JSON.stringify(menuTexts) : '無'}`,
            `dialogs(${dialogs.length}): ${dialogTexts.length > 0 ? JSON.stringify(dialogTexts) : '無'}`,
            `checkbox: ${checkboxes.length}個 (✅${cbFinished} ☑️${cbChecked})`,
            ``,
            `── 失敗清單 ──`,
            failedQueue.length > 0 ? failedQueue.join(', ') : '(空)',
            ``,
            `── 執行紀錄 (最近${debugLogs.length}筆) ──`,
            ...debugLogs
        ];

        return lines.join('\n');
    },

    showReportDialog: () => {
        // Remove existing dialog if any
        const existing = document.getElementById('hege-report-dialog');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'hege-report-dialog';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:999999;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,sans-serif;';

        const dialog = document.createElement('div');
        dialog.style.cssText = 'background:#1a1a2e;color:#e0e0e0;border-radius:16px;padding:28px 24px;max-width:400px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.5);text-align:center;';

        Utils.setHTML(dialog, `
            <div style="font-size:20px;font-weight:700;margin-bottom:16px;">🐛 回報問題</div>
            <div style="font-size:14px;line-height:1.6;color:#aaa;margin-bottom:20px;text-align:left;">
                如果你有大量的失敗，並確認不是被 Meta 限制了，按下「複製 Debug 訊息」回報給開發者，協助我把這個程式修正的更好！感謝 🙏
            </div>
            <div id="hege-report-copy-btn" style="background:linear-gradient(135deg,#4cd964,#30d158);color:#fff;font-size:16px;font-weight:700;padding:14px;border-radius:12px;cursor:pointer;user-select:none;margin-bottom:12px;transition:transform 0.15s;">
                📋 複製 Debug 訊息
            </div>
            <div id="hege-report-copy-status" style="font-size:13px;color:#4cd964;margin-bottom:16px;display:none;">✅ 已複製到剪貼簿！請貼給開發者</div>
            <a href="https://www.threads.net/@skiseiju" target="_blank" style="display:inline-block;background:#333;color:#fff;font-size:14px;padding:10px 20px;border-radius:10px;text-decoration:none;margin-bottom:8px;transition:background 0.2s;">
                💬 前往開發者 Threads (@skiseiju)
            </a>
            <div id="hege-report-close" style="font-size:13px;color:#666;cursor:pointer;margin-top:12px;padding:8px;">關閉</div>
        `);

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        // Copy button handler
        const copyBtn = document.getElementById('hege-report-copy-btn');
        const copyStatus = document.getElementById('hege-report-copy-status');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                const report = Core.collectDiagnostics();
                navigator.clipboard.writeText(report).then(() => {
                    if (copyStatus) copyStatus.style.display = 'block';
                    copyBtn.textContent = '✅ 已複製！';
                    copyBtn.style.background = '#333';
                }).catch(() => {
                    // Fallback: prompt
                    prompt('請手動複製以下訊息：', report);
                });
            });
        }

        // Close handlers
        const closeBtn = document.getElementById('hege-report-close');
        if (closeBtn) closeBtn.addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    }
};

// --- worker.js ---




const Worker = {
    stats: { success: 0, skipped: 0, failed: 0, startTime: 0 },
    initialTotal: 0,
    sessionQueue: [],          // 本次 session 完整名單快照
    verifyLevel: 0,            // 0=每5次, 1=每3次, 2=每次
    verifyCount: 0,            // 自上次驗證以來的計數
    consecutiveRateLimits: Worker.stats.consecutiveRateLimits || 0,
    consecutiveFails: 0,       // Level 2 連續失敗計數

    saveStats: () => {
        Storage.setJSON('hege_worker_stats', {
            stats: Worker.stats,
            initialTotal: Worker.initialTotal,
            sessionQueue: Worker.sessionQueue,
            verifyLevel: Worker.verifyLevel,
            verifyCount: Worker.verifyCount,
            consecutiveFails: Worker.consecutiveFails
        });
    },

    loadStats: () => {
        const saved = Storage.getJSON('hege_worker_stats', null);
        if (saved && saved.stats) {
            Worker.stats = saved.stats;
            Worker.initialTotal = saved.initialTotal || 0;
            Worker.sessionQueue = saved.sessionQueue || [];
            Worker.verifyLevel = saved.verifyLevel || 0;
            Worker.verifyCount = saved.verifyCount || 0;
            Worker.consecutiveFails = saved.consecutiveFails || 0;
        } else {
            Worker.stats = { success: 0, skipped: 0, failed: 0, startTime: Date.now() };
            Worker.initialTotal = 0;
            Worker.sessionQueue = [];
            Worker.verifyLevel = 0;
            Worker.verifyCount = 0;
            Worker.consecutiveFails = 0;
        }
    },

    clearStats: () => {
        Storage.remove('hege_worker_stats');
    },

    init: () => {
        Worker.loadStats();
        document.title = "🛡️ 留友封-背景執行中";
        // Enforce maximum safe desktop window size if the browser opens it too large
        try {
            if (window.outerWidth > 800 || window.outerHeight > 600) {
                window.resizeTo(800, 600);
            }
        } catch (e) { }

        const cover = document.createElement('div');
        const channel = new BroadcastChannel('hege_debug_channel');
        window.hegeLog = (msg) => {
            if (CONFIG.DEBUG_MODE) {
                console.log(`[BG-LOG] ${msg}`);
                channel.postMessage({ type: 'log', msg: `[BG] ${msg}` });

                // Append to UI Log
                const logEl = document.getElementById('hege-worker-log');
                if (logEl) {
                    const line = document.createElement('div');
                    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
                    line.style.borderBottom = '1px solid #333';
                    logEl.prepend(line); // Newest on top
                }
            }
            // Persist to localStorage buffer (always, regardless of DEBUG_MODE)
            try {
                const logs = JSON.parse(localStorage.getItem(CONFIG.KEYS.DEBUG_LOG) || '[]');
                logs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
                // Keep last 100 entries
                if (logs.length > 100) logs.splice(0, logs.length - 100);
                localStorage.setItem(CONFIG.KEYS.DEBUG_LOG, JSON.stringify(logs));
            } catch (e) { }
        };
        window.hegeLog('[BG-INIT] Worker Started');

        // Cooldown check: if rate-limited, show message and don't start
        const cooldownUntil = parseInt(Storage.get(CONFIG.KEYS.COOLDOWN) || '0');
        if (cooldownUntil > Date.now()) {
            const remainMs = cooldownUntil - Date.now();
            const remainHrs = Math.ceil(remainMs / (1000 * 60 * 60));
            Worker.createStatusUI();
            Worker.updateStatus('error', `⛔ 封鎖功能被限制，約 ${remainHrs} 小時後自動恢復`);
            const stopBtn = document.getElementById('hege-worker-stop');
            if (stopBtn) stopBtn.style.display = 'none';
            return;
        }

        // Cooldown expired + queue waiting: restore from backup
        const cooldownQueue = Storage.getJSON(CONFIG.KEYS.COOLDOWN_QUEUE, []);
        if (cooldownQueue.length > 0) {
            const currentQueue = Storage.getJSON(CONFIG.KEYS.BG_QUEUE, []);
            const merged = [...new Set([...currentQueue, ...cooldownQueue])];
            Storage.setJSON(CONFIG.KEYS.BG_QUEUE, merged);
            Storage.remove(CONFIG.KEYS.COOLDOWN_QUEUE);
            Storage.remove(CONFIG.KEYS.COOLDOWN);
            // Reset stats for fresh session
            Worker.stats = { success: 0, skipped: 0, failed: 0, startTime: Date.now() };
            Worker.initialTotal = 0;
            Worker.sessionQueue = [];
            Worker.verifyLevel = 0;
            Worker.verifyCount = 0;
            Worker.consecutiveFails = 0;
            Worker.saveStats();
            window.hegeLog(`[BG-INIT] Cooldown expired, restored ${cooldownQueue.length} users from backup`);
        }

        Worker.createStatusUI();
        setTimeout(Worker.runStep, 1000);
    },

    createStatusUI: () => {
        const cover = document.createElement('div');
        cover.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:linear-gradient(135deg,#0a0a0a 0%,#1a1a2e 100%);color:#e0e0e0;z-index:999999;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;font-family:system-ui,-apple-system,sans-serif;font-size:14px;padding:24px 20px;box-sizing:border-box;overflow:hidden;';

        Utils.setHTML(cover, `
            <div style="width:100%;max-width:420px;display:flex;flex-direction:column;align-items:center;flex:1;overflow:hidden;">
                <div style="font-size:22px;font-weight:700;margin-bottom:4px;letter-spacing:0.5px;">🛡️ 封鎖進行中</div>
                <div style="font-size:12px;color:#666;margin-bottom:24px;">請勿離開此頁面，完成後會自動返回</div>

                <!-- Progress Bar -->
                <div style="width:100%;background:#222;border-radius:12px;height:28px;overflow:hidden;margin-bottom:8px;position:relative;box-shadow:inset 0 2px 4px rgba(0,0,0,0.5);">
                    <div id="hege-progress-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#4cd964,#30d158);border-radius:12px;transition:width 0.5s ease;position:relative;">
                        <div style="position:absolute;right:8px;top:50%;transform:translateY(-50%);font-size:12px;font-weight:700;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.5);" id="hege-progress-pct">0%</div>
                    </div>
                </div>
                <div id="hege-progress-text" style="font-size:13px;color:#888;margin-bottom:20px;">準備中...</div>

                <!-- Stats Row -->
                <div style="display:flex;gap:16px;margin-bottom:16px;width:100%;justify-content:center;">
                    <div style="text-align:center;flex:1;background:#1a2e1a;border-radius:10px;padding:10px 0;">
                        <div id="hege-stat-success" style="font-size:24px;font-weight:700;color:#4cd964;">0</div>
                        <div style="font-size:11px;color:#6a6a6a;margin-top:2px;">✅ 成功</div>
                    </div>
                    <div style="text-align:center;flex:1;background:#2e2e1a;border-radius:10px;padding:10px 0;">
                        <div id="hege-stat-skipped" style="font-size:24px;font-weight:700;color:#ff9f0a;">0</div>
                        <div style="font-size:11px;color:#6a6a6a;margin-top:2px;">⏭️ 跳過</div>
                    </div>
                    <div style="text-align:center;flex:1;background:#2e1a1a;border-radius:10px;padding:10px 0;">
                        <div id="hege-stat-failed" style="font-size:24px;font-weight:700;color:#ff453a;">0</div>
                        <div style="font-size:11px;color:#6a6a6a;margin-top:2px;">❌ 失敗</div>
                    </div>
                </div>

                <!-- ETA -->
                <div id="hege-eta" style="font-size:13px;color:#888;margin-bottom:6px;">⏱️ 計算中...</div>

                <!-- Current Target -->
                <div id="bg-status" style="font-size:15px;font-weight:600;color:#4cd964;margin-bottom:20px;">等待指令...</div>

                <!-- Stop Button -->
                <div id="hege-worker-stop" style="background:#ff453a;color:#fff;font-size:16px;font-weight:700;padding:14px 48px;border-radius:14px;cursor:pointer;user-select:none;-webkit-tap-highlight-color:transparent;box-shadow:0 4px 12px rgba(255,69,58,0.3);transition:transform 0.15s,opacity 0.15s;margin-bottom:20px;">🛑 停止封鎖</div>

                <!-- Debug Log -->
                <div id="hege-worker-log" style="width:100%;flex:1;overflow-y:auto;border:1px solid #222;border-radius:8px;padding:10px;text-align:left;font-family:monospace;font-size:11px;color:#555;background:#0a0a0a;"></div>
            </div>
        `);
        document.body.appendChild(cover);

        // Bind stop button
        const stopBtn = document.getElementById('hege-worker-stop');
        if (stopBtn) {
            const handleStop = () => {
                Storage.set(CONFIG.KEYS.BG_CMD, 'stop');
                stopBtn.textContent = '⏳ 正在停止...';
                stopBtn.style.background = '#666';
                stopBtn.style.pointerEvents = 'none';
            };
            stopBtn.addEventListener('click', handleStop);
            if (Utils.isMobile()) {
                stopBtn.addEventListener('touchend', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleStop();
                }, { passive: false });
            }
        }
    },

    updateStatus: (state, current = '', progress = 0, total = 0) => {
        const s = { state, current, progress, total, lastUpdate: Date.now() };
        Storage.setJSON(CONFIG.KEYS.BG_STATUS, s);

        // Status text
        const el = document.getElementById('bg-status');
        if (el) el.textContent = state === 'running' ? `目前：@${current.replace(/^(前往|封鎖中|略過)[：:] ?/, '')}` : current;

        // Title
        const processed = Worker.stats.success + Worker.stats.skipped + Worker.stats.failed;
        const initTotal = Worker.initialTotal || total;
        document.title = state === 'running' ? `🛡️ ${processed}/${initTotal}` : '🛡️ 留友封';

        // Progress bar
        const pct = initTotal > 0 ? Math.round((processed / initTotal) * 100) : 0;
        const bar = document.getElementById('hege-progress-bar');
        const pctEl = document.getElementById('hege-progress-pct');
        const progressText = document.getElementById('hege-progress-text');
        if (bar) bar.style.width = `${pct}%`;
        if (pctEl) pctEl.textContent = `${pct}%`;
        if (progressText) progressText.textContent = `${processed} / ${initTotal} 已處理`;

        // Stats counters
        const sEl = document.getElementById('hege-stat-success');
        const skEl = document.getElementById('hege-stat-skipped');
        const fEl = document.getElementById('hege-stat-failed');
        if (sEl) sEl.textContent = Worker.stats.success;
        if (skEl) skEl.textContent = Worker.stats.skipped;
        if (fEl) fEl.textContent = Worker.stats.failed;

        // ETA calculation
        const etaEl = document.getElementById('hege-eta');
        if (etaEl && processed > 0 && state === 'running') {
            const elapsed = (Date.now() - Worker.stats.startTime) / 1000;
            const avgPerUser = elapsed / processed;
            const remaining = initTotal - processed;
            const etaSec = Math.round(avgPerUser * remaining);
            if (etaSec > 60) {
                const mins = Math.floor(etaSec / 60);
                const secs = etaSec % 60;
                etaEl.textContent = `⏱️ 預估剩餘：~${mins} 分 ${secs} 秒`;
            } else {
                etaEl.textContent = `⏱️ 預估剩餘：~${etaSec} 秒`;
            }
        } else if (etaEl && state !== 'running') {
            etaEl.textContent = state === 'idle' ? '⏱️ 已完成' : `⏱️ ${state}`;
        }
    },

    navigateBack: () => {
        setTimeout(() => {
            const returnUrl = Storage.get('hege_return_url');
            if (returnUrl) {
                Storage.remove('hege_return_url');
                // Use history.replaceState + reload to avoid Universal Links on iOS
                const url = new URL(returnUrl);
                history.replaceState(null, '', url.pathname + url.search);
                location.reload();
            } else {
                // Desktop popup fallback
                window.close();
            }
        }, 2000);
    },

    runStep: async () => {
        if (Storage.get(CONFIG.KEYS.BG_CMD) === 'stop') {
            Storage.remove(CONFIG.KEYS.BG_CMD);
            Storage.remove(CONFIG.KEYS.VERIFY_PENDING);
            Worker.updateStatus('stopped', '已停止');
            Worker.clearStats();
            Worker.navigateBack();
            return;
        }

        // Handle pending verification (after page reload)
        const verifyPending = Storage.get(CONFIG.KEYS.VERIFY_PENDING);
        if (verifyPending) {
            Storage.remove(CONFIG.KEYS.VERIFY_PENDING);
            const onVerifyPage = location.pathname.includes(`/@${verifyPending}`);
            if (onVerifyPage) {
                window.hegeLog(`[驗證] 頁面已刷新，驗證 @${verifyPending}`);
                const verified = await Worker.verifyBlock(verifyPending);
                let queue = Storage.getJSON(CONFIG.KEYS.BG_QUEUE, []);
                const currentTotal = queue.length;

                if (!verified) {
                    window.hegeLog(`[驗證] @${verifyPending} 驗證失敗 (靜默失敗)`);
                    if (Worker.verifyLevel < 2) {
                        Worker.verifyLevel++;
                        Worker.consecutiveFails = 0;
                        window.hegeLog(`[驗證] 升級至 Level ${Worker.verifyLevel}`);
                    } else {
                        Worker.consecutiveFails++;
                        window.hegeLog(`[驗證] Level 2 連續失敗 ${Worker.consecutiveFails}/5`);
                        if (Worker.consecutiveFails >= 5) {
                            await Worker.triggerCooldown();
                            return;
                        }
                    }
                    Worker.stats.failed++;
                    Worker.saveStats();
                    if (queue.length > 0 && queue[0] === verifyPending) {
                        queue.shift();
                        Storage.setJSON(CONFIG.KEYS.BG_QUEUE, queue);
                    }
                    let fq = new Set(Storage.getJSON(CONFIG.KEYS.FAILED_QUEUE, []));
                    fq.add(verifyPending);
                    Storage.setJSON(CONFIG.KEYS.FAILED_QUEUE, [...fq]);
                    Worker.updateStatus('running', verifyPending, 0, currentTotal);
                    Worker.runStep();
                    return;
                }

                // Verification passed
                Worker.consecutiveFails = 0;
                Worker.stats.success++;
                Worker.saveStats();
                if (queue.length > 0 && queue[0] === verifyPending) {
                    queue.shift();
                    Storage.setJSON(CONFIG.KEYS.BG_QUEUE, queue);
                }
                let db = new Set(Storage.getJSON(CONFIG.KEYS.DB_KEY, []));
                db.add(verifyPending);
                Storage.setJSON(CONFIG.KEYS.DB_KEY, [...db]);
                let ts = Storage.getJSON(CONFIG.KEYS.DB_TIMESTAMPS, {});
                ts[verifyPending] = Date.now();
                Storage.setJSON(CONFIG.KEYS.DB_TIMESTAMPS, ts);
                Worker.updateStatus('running', verifyPending, 0, currentTotal);
                Worker.runStep();
                return;
            } else {
                // Not on the right page, skip verification and treat as success
                window.hegeLog(`[驗證] 頁面不符，跳過驗證 @${verifyPending}`);
                let queue = Storage.getJSON(CONFIG.KEYS.BG_QUEUE, []);
                Worker.stats.success++;
                Worker.saveStats();
                if (queue.length > 0 && queue[0] === verifyPending) {
                    queue.shift();
                    Storage.setJSON(CONFIG.KEYS.BG_QUEUE, queue);
                }
                let db = new Set(Storage.getJSON(CONFIG.KEYS.DB_KEY, []));
                db.add(verifyPending);
                Storage.setJSON(CONFIG.KEYS.DB_KEY, [...db]);
                let ts = Storage.getJSON(CONFIG.KEYS.DB_TIMESTAMPS, {});
                ts[verifyPending] = Date.now();
                Storage.setJSON(CONFIG.KEYS.DB_TIMESTAMPS, ts);
            }
        }

        let queue = Storage.getJSON(CONFIG.KEYS.BG_QUEUE, []);
        if (queue.length === 0) {
            Worker.updateStatus('idle', '✅ 全部完成！', 0, 0);
            Worker.clearStats();
            // Hide stop button on completion
            const stopBtn = document.getElementById('hege-worker-stop');
            if (stopBtn) stopBtn.style.display = 'none';
            Worker.navigateBack();
            return;
        }

        // Record initial total on first run, and dynamically sync if queue grows
        if (Worker.initialTotal === 0) {
            Worker.initialTotal = queue.length;
            Worker.sessionQueue = [...queue]; // 快照本次 session 名單
            Worker.saveStats();
        } else {
            // 動態同步：若佇列在執行期間被外部追加，更新 total + sessionQueue
            const processed = Worker.stats.success + Worker.stats.skipped + Worker.stats.failed;
            const currentTotal = processed + queue.length;
            if (currentTotal > Worker.initialTotal) {
                // Append new users to sessionQueue
                const sessionSet = new Set(Worker.sessionQueue);
                queue.forEach(u => { if (!sessionSet.has(u)) Worker.sessionQueue.push(u); });
                Worker.initialTotal = currentTotal;
                Worker.saveStats();
            }
        }

        const targetUser = queue[0];
        const currentTotal = queue.length;

        let db = new Set(Storage.getJSON(CONFIG.KEYS.DB_KEY, []));
        if (db.has(targetUser)) {
            Worker.stats.skipped++;
            Worker.saveStats();
            Worker.updateStatus('running', `略過: ${targetUser}`, 0, currentTotal);
            queue.shift();
            Storage.setJSON(CONFIG.KEYS.BG_QUEUE, queue);
            setTimeout(Worker.runStep, 100);
            return;
        }

        const onTargetPage = location.pathname.includes(`/@${targetUser}`);
        if (!onTargetPage) {
            Worker.updateStatus('running', `前往: ${targetUser}`, 0, currentTotal);
            await Utils.sleep(500 + Math.random() * 500);
            // Use history.replaceState + reload to avoid Universal Links on iOS
            history.replaceState(null, '', `/@${targetUser}?hege_bg=true`);
            location.reload();
        } else {
            Worker.updateStatus('running', `封鎖中: ${targetUser}`, 0, currentTotal);
            const result = await Worker.autoBlock(targetUser);

            if (result === 'success' || result === 'already_blocked') {
                // Post-block verification via adaptive sampling
                Worker.verifyCount++;
                if (result === 'success' && Worker.shouldVerify()) {
                    // Save pending verification and reload page for fresh React state
                    window.hegeLog(`[驗證] Level ${Worker.verifyLevel} 排定驗證 @${targetUser}，重新載入頁面...`);
                    Storage.set(CONFIG.KEYS.VERIFY_PENDING, targetUser);
                    Worker.saveStats();
                    await Utils.sleep(1000);
                    location.reload();
                    return;
                }

                // No verification needed — count as success directly
                Worker.stats.success++;
                Worker.consecutiveRateLimits = 0; // Reset rate-limit counter on success
                Worker.saveStats();
                let q = Storage.getJSON(CONFIG.KEYS.BG_QUEUE, []);
                if (q.length > 0 && q[0] === targetUser) {
                    q.shift();
                    Storage.setJSON(CONFIG.KEYS.BG_QUEUE, q);
                }

                db = new Set(Storage.getJSON(CONFIG.KEYS.DB_KEY, []));
                db.add(targetUser);
                Storage.setJSON(CONFIG.KEYS.DB_KEY, [...db]); // Fix Sync

                // Record timestamp for rollback support
                let ts = Storage.getJSON(CONFIG.KEYS.DB_TIMESTAMPS, {});
                ts[targetUser] = Date.now();
                Storage.setJSON(CONFIG.KEYS.DB_TIMESTAMPS, ts);

                Worker.updateStatus('running', targetUser, 0, currentTotal);
                Worker.runStep();
            } else if (result === 'failed') {
                Worker.stats.failed++;
                Worker.saveStats();
                // Remove from active queue
                let q = Storage.getJSON(CONFIG.KEYS.BG_QUEUE, []);
                if (q.length > 0 && q[0] === targetUser) {
                    q.shift();
                    Storage.setJSON(CONFIG.KEYS.BG_QUEUE, q);
                }

                // Add to failed queue (DO NOT add to history DB)
                let fq = new Set(Storage.getJSON(CONFIG.KEYS.FAILED_QUEUE, []));
                fq.add(targetUser);
                Storage.setJSON(CONFIG.KEYS.FAILED_QUEUE, [...fq]);

                Worker.updateStatus('running', targetUser, 0, currentTotal);
                Worker.runStep();
            } else if (result === 'rate_limited') {
                Worker.consecutiveRateLimits++;
                Worker.saveStats();

                if (Worker.consecutiveRateLimits >= 3) {
                    if (window.hegeLog) window.hegeLog(`[⚠️警告] 選單異常達 ${Worker.consecutiveRateLimits} 次，偵測到 Meta 限制操作，強制冷卻`);
                    await Worker.triggerCooldown();
                    Worker.clearStats();
                    return;
                } else {
                    if (window.hegeLog) window.hegeLog(`[⚠️警告] 選單異常 (第 ${Worker.consecutiveRateLimits}/3 次)，可能為網路延遲或初級限制，跳過並靜置...`);
                    // treat as normal failure but give it a larger timeout to breathe
                    Worker.stats.failed++;
                    Worker.saveStats();

                    let q = Storage.getJSON(CONFIG.KEYS.BG_QUEUE, []);
                    if (q.length > 0 && q[0] === targetUser) {
                        q.shift();
                        Storage.setJSON(CONFIG.KEYS.BG_QUEUE, q);
                    }
                    let fq = new Set(Storage.getJSON(CONFIG.KEYS.FAILED_QUEUE, []));
                    fq.add(targetUser);
                    Storage.setJSON(CONFIG.KEYS.FAILED_QUEUE, [...fq]);

                    Worker.updateStatus('running', targetUser, 0, currentTotal);
                    await Utils.sleep(3000); // extra breather
                    Worker.runStep();
                }
                return;
            } else if (result === 'cooldown') {
                Worker.updateStatus('error', '⚠️ 頻率限制觸發，請稍後再試');
                const stopBtn = document.getElementById('hege-worker-stop');
                if (stopBtn) stopBtn.style.display = 'none';
            }
        }
    },

    shouldVerify: () => {
        if (Worker.verifyLevel === 0) return Worker.verifyCount % 5 === 0;
        if (Worker.verifyLevel === 1) return Worker.verifyCount % 3 === 0;
        return true; // Level 2: always verify
    },

    verifyBlock: async (user) => {
        // Page has been reloaded — check if "Unblock" appears in menu (= block succeeded)
        try {
            // Wait for page to fully render after reload
            await Utils.sleep(2500);

            // Find "More" button again
            let profileBtn = null;
            for (let i = 0; i < 10; i++) {
                const moreSvgs = document.querySelectorAll('svg[aria-label="更多"], svg[aria-label="More"]');
                for (let svg of moreSvgs) {
                    if (svg.querySelector('circle') && svg.querySelectorAll('path').length >= 3) {
                        profileBtn = svg.closest('div[role="button"]');
                        if (profileBtn) break;
                    }
                }
                if (!profileBtn && moreSvgs.length > 0) {
                    profileBtn = moreSvgs[0].closest('div[role="button"]');
                }
                if (profileBtn) break;
                await Utils.sleep(500);
            }

            if (!profileBtn) {
                window.hegeLog('[驗證] 找不到更多按鈕，跳過驗證');
                return true; // Can't verify, assume success
            }

            await Utils.sleep(500);
            Utils.simClick(profileBtn);

            // Wait for menu to appear
            let foundUnblock = false;
            let foundBlock = false;
            for (let i = 0; i < 10; i++) {
                await Utils.sleep(500);
                const menuItems = document.querySelectorAll('div[role="menuitem"], div[role="button"]');
                for (let item of menuItems) {
                    const t = item.innerText || item.textContent;
                    if (!t) continue;
                    if (t.includes('解除封鎖') || t.includes('Unblock')) {
                        foundUnblock = true;
                        break;
                    }
                    if ((t.includes('封鎖') && !t.includes('解除')) || (t.includes('Block') && !t.includes('Un'))) {
                        foundBlock = true;
                    }
                }
                if (foundUnblock || foundBlock) break;
            }

            // Close the menu by pressing ESC
            try {
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                await Utils.sleep(300);
                const backdrop = document.querySelector('div[data-overlay-container="true"]');
                if (backdrop) Utils.simClick(backdrop);
                await Utils.sleep(500);
            } catch (e) { }

            if (foundUnblock) {
                window.hegeLog(`[驗證] @${user} 確認已封鎖 ✅`);
                return true;
            } else if (foundBlock) {
                window.hegeLog(`[驗證] @${user} 未封鎖（靜默失敗）❌`);
                return false;
            }

            // Could not determine — assume success
            window.hegeLog('[驗證] 無法判定，視為成功');
            return true;
        } catch (e) {
            console.error('[驗證] Error:', e);
            return true; // Error during verify, don't punish
        }
    },

    triggerCooldown: async () => {
        window.hegeLog('[冷卻] 觸發 12 小時冷卻保護！正在回滾 session...');

        // 1. Remove all session users from DB
        let db = new Set(Storage.getJSON(CONFIG.KEYS.DB_KEY, []));
        const sessionSet = new Set(Worker.sessionQueue);
        for (const u of sessionSet) {
            db.delete(u);
        }

        // 2. Check if user wants to also rollback recent 50 blocks (before this session)
        let rollbackUsers = [];
        const timestamps = Storage.getJSON(CONFIG.KEYS.DB_TIMESTAMPS, {});
        const sortedRecent = Object.entries(timestamps)
            .filter(([username]) => !sessionSet.has(username) && db.has(username))
            .sort((a, b) => b[1] - a[1])
            .slice(0, 50);

        if (sortedRecent.length > 0) {
            rollbackUsers = sortedRecent.map(([username]) => username);
            for (const u of rollbackUsers) {
                db.delete(u);
                delete timestamps[u];
            }
            window.hegeLog(`[冷卻] 已自動回滾 ${rollbackUsers.length} 筆發生在本次之前的疑似失敗封鎖紀錄`);
        }

        // Remove session users' timestamps too
        for (const u of sessionSet) {
            delete timestamps[u];
        }
        Storage.setJSON(CONFIG.KEYS.DB_TIMESTAMPS, timestamps);
        Storage.setJSON(CONFIG.KEYS.DB_KEY, [...db]);

        // 3. Backup rollback list + remaining unprocessed BG_QUEUE + FAILED_QUEUE to COOLDOWN_QUEUE
        const remainingQueue = Storage.getJSON(CONFIG.KEYS.BG_QUEUE, []);
        const failedQueue = Storage.getJSON(CONFIG.KEYS.FAILED_QUEUE, []);
        const fullRollbackList = [...Worker.sessionQueue, ...rollbackUsers];
        const fullCooldownQueue = [...new Set([...fullRollbackList, ...remainingQueue, ...failedQueue])];
        Storage.setJSON(CONFIG.KEYS.COOLDOWN_QUEUE, fullCooldownQueue);

        // 4. Set cooldown timestamp (12 hours)
        const cooldownUntil = Date.now() + (12 * 60 * 60 * 1000);
        Storage.set(CONFIG.KEYS.COOLDOWN, cooldownUntil.toString());

        // 5. Clear operational queues (all data now safely in COOLDOWN_QUEUE)
        Storage.setJSON(CONFIG.KEYS.BG_QUEUE, []);
        Storage.setJSON(CONFIG.KEYS.FAILED_QUEUE, []);
        Worker.clearStats();

        // 6. Update UI and navigate back
        const totalRolled = fullRollbackList.length;
        Worker.updateStatus('error', `⛔ 偵測到系統限制，已啟動 12 小時冷卻保護\n共 ${totalRolled} 筆名單已保存，冷卻結束後自動恢復`);
        const stopBtn = document.getElementById('hege-worker-stop');
        if (stopBtn) stopBtn.style.display = 'none';
        Worker.navigateBack();
    },

    autoBlock: async (user) => {
        // Updated with Robust Polling and STRICT SVG Check
        function setStep(msg) {
            const s = Storage.getJSON(CONFIG.KEYS.BG_STATUS, {});
            s.current = `${user}: ${msg}`;
            s.lastUpdate = Date.now();
            Storage.setJSON(CONFIG.KEYS.BG_STATUS, s);
            if (window.hegeLog) window.hegeLog(msg);
        }

        function checkForError() {
            const errorPhrases = ['稍後再試', 'Try again later', '為了保護', 'protect our community', '受到限制', 'restrict certain activity'];
            const dialogs = document.querySelectorAll('div[role="dialog"]');
            for (let dialog of dialogs) {
                const t = dialog.innerText || dialog.textContent;
                if (!t) continue;
                if (errorPhrases.some(p => t.includes(p))) {
                    console.log(`[留友封] 偵測到限制訊息`);
                    return true;
                }
            }
            return false;
        }

        try {
            setStep('載入中...');
            await Utils.sleep(2500);

            // 1. Wait for "More" button (Polling up to 12s)
            let profileBtn = null;

            for (let i = 0; i < 25; i++) {
                const moreSvgs = document.querySelectorAll('svg[aria-label="更多"], svg[aria-label="More"]');
                for (let svg of moreSvgs) {
                    if (svg.querySelector('circle') && svg.querySelectorAll('path').length >= 3) {
                        profileBtn = svg.closest('div[role="button"]');
                        if (profileBtn) break;
                    }
                }

                // Fallback
                if (!profileBtn && moreSvgs.length > 0) {
                    profileBtn = moreSvgs[0].closest('div[role="button"]');
                }

                if (profileBtn) break;
                await Utils.sleep(500);
            }

            if (!profileBtn) {
                // Diagnostic dump: collect all SVG info on page
                const allSvgs = document.querySelectorAll('svg[aria-label]');
                const svgLabels = Array.from(allSvgs).map(s => s.getAttribute('aria-label'));
                const moreSvgs = document.querySelectorAll('svg[aria-label="更多"], svg[aria-label="More"]');
                const svgDetails = Array.from(moreSvgs).map(s => {
                    const hasCircle = !!s.querySelector('circle');
                    const pathCount = s.querySelectorAll('path').length;
                    const vb = s.getAttribute('viewBox');
                    return `circle=${hasCircle},paths=${pathCount},viewBox=${vb}`;
                });
                const dialogCount = document.querySelectorAll('div[role="dialog"]').length;
                if (window.hegeLog) {
                    window.hegeLog(`[DIAG] @${user} 找不到更多按鈕`);
                    window.hegeLog(`[DIAG] URL: ${location.pathname}`);
                    window.hegeLog(`[DIAG] 頁面 SVG aria-labels(${svgLabels.length}): ${JSON.stringify(svgLabels)}`);
                    window.hegeLog(`[DIAG] 更多按鈕 SVG(${moreSvgs.length}): ${JSON.stringify(svgDetails)}`);
                    window.hegeLog(`[DIAG] Dialogs: ${dialogCount}`);
                }
                return 'failed';
            }

            setStep('開啟選單...');
            if (window.hegeLog && profileBtn) {
                const rect = profileBtn.getBoundingClientRect();
                let parentText = '';
                try {
                    let parent = profileBtn.parentElement;
                    for (let p = 0; p < 3 && parent; p++) {
                        parentText += (parent.textContent || '').substring(0, 10).replace(/\n/g, '') + '|';
                        parent = parent.parentElement;
                    }
                } catch (e) { }
                window.hegeLog(`[DIAG] 準備點擊按鈕 x=${Math.round(rect.x)}, y=${Math.round(rect.y)}, 父層文案=${parentText}`);
            }
            await Utils.sleep(500);
            profileBtn.scrollIntoView({ block: 'center', inline: 'center' });
            await Utils.sleep(500);
            Utils.simClick(profileBtn);


            // 2. Wait for Menu (Polling up to 8s, retry click if menu doesn't open)
            let blockBtn = null;
            let clickRetried = false;
            for (let i = 0; i < 16; i++) {
                await Utils.sleep(500);

                // After 3s (6 iterations) with no menuitem, retry the click
                if (i === 6 && !clickRetried) {
                    const testMenu = document.querySelectorAll('div[role="menuitem"]');
                    if (testMenu.length === 0) {
                        clickRetried = true;
                        if (window.hegeLog) window.hegeLog(`[DIAG] 選單未開啟，重試 simClick...`);
                        Utils.simClick(profileBtn);
                        await Utils.sleep(500);
                    }
                }

                const menuItems = document.querySelectorAll('div[role="menuitem"], div[role="button"]');
                for (let item of menuItems) {
                    const t = item.innerText || item.textContent;
                    if (!t) continue;

                    if (t.includes('解除封鎖') || t.includes('Unblock')) {
                        setStep('已封鎖 (略過)');
                        return 'already_blocked';
                    }

                    if ((t.includes('封鎖') && !t.includes('解除')) || (t.includes('Block') && !t.includes('Un'))) {
                        blockBtn = item;
                        break;
                    }
                }
                if (blockBtn) break;
            }

            if (!blockBtn) {
                const menuItems = document.querySelectorAll('div[role="menuitem"], div[role="button"]');
                for (let item of menuItems) {
                    const t = item.innerText || item.textContent;
                    if (t && (t.includes('解除封鎖') || t.includes('Unblock'))) {
                        setStep('已封鎖 (略過)');
                        return 'already_blocked';
                    }
                }
                // Diagnostic dump: collect all menu item text
                const allMenuItems = document.querySelectorAll('div[role="menuitem"]');
                const menuTexts = Array.from(allMenuItems).map(el => (el.innerText || el.textContent || '').trim().substring(0, 30));
                const allBtns = document.querySelectorAll('div[role="button"]');
                const btnTexts = Array.from(allBtns).map(el => (el.innerText || el.textContent || '').trim().substring(0, 30)).filter(t => t.length > 0);
                const dialogCount = document.querySelectorAll('div[role="dialog"]').length;
                if (window.hegeLog) {
                    window.hegeLog(`[DIAG] @${user} 找不到封鎖鈕`);
                    window.hegeLog(`[DIAG] menuitem(${menuTexts.length}): ${JSON.stringify(menuTexts)}`);
                    window.hegeLog(`[DIAG] buttons(${btnTexts.length}): ${JSON.stringify(btnTexts.slice(0, 15))}`);
                    window.hegeLog(`[DIAG] Dialogs: ${dialogCount}`);
                }
                setStep('錯誤: 找不到封鎖鈕 (可能遭限制)');
                return 'rate_limited';
            }

            setStep('點擊封鎖...');
            await Utils.sleep(800);
            Utils.simClick(blockBtn);

            // 3. Wait for Confirmation Dialog (Polling up to 5s)
            let confirmBtn = null;
            for (let i = 0; i < 10; i++) {
                await Utils.sleep(500);
                const dialogs = document.querySelectorAll('div[role="dialog"]');
                for (let dialog of dialogs) {
                    const btns = dialog.querySelectorAll('div[role="button"], button');
                    for (let btn of btns) {
                        const t = btn.innerText || btn.textContent;
                        if (!t) continue;

                        if (t.includes('封鎖') && !t.includes('解除') && !t.includes('取消')) {
                            confirmBtn = btn;
                        }
                        if (t.includes('Block') && !t.includes('Un') && !t.includes('Cancel')) {
                            confirmBtn = btn;
                        }
                    }
                }
                if (confirmBtn) break;
            }

            if (!confirmBtn) {
                // Diagnostic dump: what's in the dialogs (or lack thereof)
                const dialogs = document.querySelectorAll('div[role="dialog"]');
                if (window.hegeLog) {
                    window.hegeLog(`[DIAG] @${user} 找不到確認對話框`);
                    window.hegeLog(`[DIAG] Dialogs 數量: ${dialogs.length}`);
                    for (let i = 0; i < dialogs.length; i++) {
                        const d = dialogs[i];
                        const btns = d.querySelectorAll('div[role="button"], button');
                        const btnTexts = Array.from(btns).map(b => (b.innerText || b.textContent || '').trim().substring(0, 40)).filter(t => t.length > 0);
                        const dialogText = (d.innerText || '').trim().substring(0, 150);
                        window.hegeLog(`[DIAG] Dialog[${i}] 按鈕(${btnTexts.length}): ${JSON.stringify(btnTexts)}`);
                        window.hegeLog(`[DIAG] Dialog[${i}] 內容: ${dialogText}`);
                    }
                    if (dialogs.length === 0) {
                        // Check if maybe the block succeeded without confirmation
                        const menuItems = document.querySelectorAll('div[role="menuitem"]');
                        const menuTexts = Array.from(menuItems).map(el => (el.innerText || '').trim().substring(0, 30));
                        window.hegeLog(`[DIAG] 無 dialog，可能已直接封鎖？ menuitem: ${JSON.stringify(menuTexts)}`);
                        // Check page for any "Unblock" indication
                        const pageText = document.body.innerText || '';
                        const hasUnblock = pageText.includes('解除封鎖') || pageText.includes('Unblock');
                        window.hegeLog(`[DIAG] 頁面含「解除封鎖」: ${hasUnblock}`);
                    }
                }
                setStep('找不到確認');
                return 'failed';
            }

            setStep('確認封鎖...');
            await Utils.sleep(300);
            Utils.simClick(confirmBtn);

            // 4. Wait for confirmation dialog to close
            for (let i = 0; i < 10; i++) {
                await Utils.sleep(500);
                const dialogs = document.querySelectorAll('div[role="dialog"]');
                if (dialogs.length === 0) {
                    setStep('✅ 已封鎖');
                    return 'success';
                }
                if (checkForError()) {
                    return 'cooldown';
                }
            }

            // Diagnostic dump: dialog didn't close
            if (window.hegeLog) {
                const dialogs = document.querySelectorAll('div[role="dialog"]');
                window.hegeLog(`[DIAG] @${user} 確認後 dialog 未關閉`);
                window.hegeLog(`[DIAG] 殘留 Dialogs: ${dialogs.length}`);
                for (let i = 0; i < dialogs.length; i++) {
                    const text = (dialogs[i].innerText || '').trim().substring(0, 200);
                    window.hegeLog(`[DIAG] Dialog[${i}]: ${text}`);
                }
            }

            setStep('✅ 已封鎖 (超時)');
            return 'success';
        } catch (e) {
            console.error('autoBlock error:', e);
            return 'failed';
        }
    }
};

// --- main.js ---







(function () {
    'use strict';
    console.log('[留友封] Extension Script Initializing...');

    if (Storage.get(CONFIG.KEYS.VERSION_CHECK) !== CONFIG.VERSION) {
        // Cleanup old keys if needed
        Storage.remove(CONFIG.KEYS.IOS_MODE);

        // Aggressively clear all temporary selection and operational queues to prevent ghost data
        Storage.setSessionJSON(CONFIG.KEYS.PENDING, []);
        Storage.setJSON(CONFIG.KEYS.BG_QUEUE, []);
        Storage.setJSON(CONFIG.KEYS.FAILED_QUEUE, []);
        Storage.setJSON(CONFIG.KEYS.BG_STATUS, {});

        // Beta 10/16 Cleanup: Remove all potententially stale verification or cooldown data
        // Explicitly use localStorage.removeItem to ensure iOS UIWebViews don't ignore it
        localStorage.removeItem('hege_cooldown_queue');
        localStorage.removeItem('hege_rate_limit_until');
        localStorage.removeItem('hege_block_timestamps');
        localStorage.removeItem('hege_worker_stats');

        Storage.remove(CONFIG.KEYS.COOLDOWN_QUEUE);
        Storage.remove(CONFIG.KEYS.COOLDOWN);
        Storage.remove('hege_worker_stats');
        Storage.setJSON(CONFIG.KEYS.DB_TIMESTAMPS, {});

        Storage.set(CONFIG.KEYS.VERSION_CHECK, CONFIG.VERSION);
        console.log(`[留友封] Updated to v${CONFIG.VERSION}. Cleared all temporary queues.`);
    }

    // Unconditional safety clear: if the user manually fired an event but they are stuck, force them away
    const forceClear = new URLSearchParams(window.location.search).get('hege_clear');
    if (forceClear === 'true') {
        localStorage.removeItem('hege_cooldown_queue');
        localStorage.removeItem('hege_rate_limit_until');
        localStorage.removeItem('hege_block_timestamps');
        localStorage.removeItem('hege_worker_stats');
        alert('緊急清除完成，請重新整理頁面。');
    }

    const isBgPage = new URLSearchParams(window.location.search).get('hege_bg') === 'true';

    // Initialize
    function main() {
        if (isBgPage) {
            Worker.init();
        } else {
            // Prevent running in iframes for Controller (Beta46 logic)
            if (window.top !== window.self) return;

            UI.injectStyles();

            const handleMainButton = () => {
                const pending = Core.pendingUsers;
                const cooldownUntil = parseInt(Storage.get(CONFIG.KEYS.COOLDOWN) || '0');
                if (cooldownUntil > Date.now()) {
                    const remainHrs = Math.ceil((cooldownUntil - Date.now()) / (1000 * 60 * 60));
                    if (confirm(`⚠️ 目前處於冷卻保護中（約 ${remainHrs} 小時後自動解除）\n\n強制取消冷卻並繼續封鎖？\n\n若您確認今日封鎖未超過 100 位，這可能是系統誤判，可放心繼續執行。\n\n若已大量封鎖，後續操作可能失敗，Meta 也可能對您的帳號施加額外限制。`)) {
                        // Force cancel cooldown and resume
                        const cooldownQueue = Storage.getJSON(CONFIG.KEYS.COOLDOWN_QUEUE, []);
                        const currentQueue = Storage.getJSON(CONFIG.KEYS.BG_QUEUE, []);
                        const pendingArr = Array.from(pending);
                        const merged = [...new Set([...currentQueue, ...cooldownQueue, ...pendingArr])];
                        Storage.setJSON(CONFIG.KEYS.BG_QUEUE, merged);
                        Storage.remove(CONFIG.KEYS.COOLDOWN_QUEUE);
                        Storage.remove(CONFIG.KEYS.COOLDOWN);
                        Storage.invalidate(CONFIG.KEYS.COOLDOWN);
                        Storage.invalidate(CONFIG.KEYS.COOLDOWN_QUEUE);

                        if (pendingArr.length > 0) {
                            Core.pendingUsers.clear();
                            Storage.setSessionJSON(CONFIG.KEYS.PENDING, []);
                        }

                        Core.updateControllerUI();
                        UI.showToast(`已恢復佇列，共 ${merged.length} 筆，開始執行`);

                        // Directly start worker with restored queue
                        Storage.remove(CONFIG.KEYS.BG_CMD);
                        if (Utils.isMobile()) {
                            Core.runSameTabWorker();
                        } else {
                            window.open('https://www.threads.net/?hege_bg=true', 'HegeBlockWorker', 'width=800,height=600');
                        }
                        return;
                    } else {
                        return;
                    }
                }

                if (pending.size === 0) { UI.showToast('請先勾選用戶！'); return; }

                const isMobile = Utils.isMobile();
                const deskMode = Storage.get(CONFIG.KEYS.MAC_MODE) || 'background';

                if (isMobile) {
                    Core.runSameTabWorker();
                } else if (deskMode === 'foreground') {
                    Core.runForegroundBlock();
                } else {
                    // Add to queue
                    const q = Storage.getJSON(CONFIG.KEYS.BG_QUEUE, []);
                    const toAdd = Array.from(pending);
                    const newQ = [...new Set([...q, ...toAdd])];
                    Storage.setJSON(CONFIG.KEYS.BG_QUEUE, newQ);
                    UI.showToast(`已提交 ${toAdd.length} 筆至背景佇列`);

                    // Check if running
                    const status = Storage.getJSON(CONFIG.KEYS.BG_STATUS, {});
                    const running = (Date.now() - (status.lastUpdate || 0) < 10000 && status.state === 'running');
                    if (!running) {
                        Storage.remove(CONFIG.KEYS.BG_CMD);
                        window.open('https://www.threads.net/?hege_bg=true', 'HegeBlockWorker', 'width=800,height=600');
                    }
                }
            };

            const updateModeUI = () => {
                const currentMode = Storage.get(CONFIG.KEYS.MAC_MODE) || 'background';
                const modeText = document.getElementById('hege-mode-text');
                const modeDesc = document.getElementById('hege-mode-desc');
                if (!modeText || !modeDesc) return;

                if (currentMode === 'foreground') {
                    modeText.textContent = '前景模式 (iOS模擬)';
                    modeText.style.color = '#ff9f0a';
                    modeDesc.textContent = '當前分頁執行';
                } else {
                    modeText.textContent = '背景模式 (預設)';
                    modeText.style.color = '#4cd964';
                    modeDesc.textContent = '新分頁執行';
                }
            };

            const callbacks = {
                onMainClick: handleMainButton,
                onClearSel: () => {
                    if (confirm('確定要清除目前的「選取清單」與所有「背景排隊」的帳號嗎？\n(這不會影響已完成的封鎖歷史紀錄)')) {
                        Core.pendingUsers.clear();
                        Storage.setSessionJSON(CONFIG.KEYS.PENDING, []);
                        Storage.setJSON(CONFIG.KEYS.BG_QUEUE, []);
                        Storage.setJSON(CONFIG.KEYS.FAILED_QUEUE, []);
                        Storage.setJSON(CONFIG.KEYS.BG_STATUS, {});
                        Core.blockQueue.forEach(b => {
                            b.style.transform = 'none';
                            b.parentElement.querySelector('.hege-checkbox-container')?.classList.remove('checked');
                        });
                        Core.blockQueue.clear();
                        Core.updateControllerUI();
                        UI.showToast('待封鎖清單與背景佇列已全數清除');
                    }
                },
                onClearDB: () => { if (confirm('清空歷史?')) { Storage.setJSON(CONFIG.KEYS.DB_KEY, []); Core.updateControllerUI(); } },
                onImport: () => Core.importList(),
                onExport: () => Core.exportHistory(),
                onRetryFailed: () => Core.retryFailedQueue(),
                onReport: () => Core.showReportDialog(),
                onStop: () => { if (confirm('停止?')) Storage.set(CONFIG.KEYS.BG_CMD, 'stop'); },
                onModeToggle: () => {
                    const cur = Storage.get(CONFIG.KEYS.MAC_MODE) || 'background';
                    const next = cur === 'background' ? 'foreground' : 'background';
                    Storage.set(CONFIG.KEYS.MAC_MODE, next);
                    updateModeUI();
                    UI.showToast(`已切換模式`);
                }
            };

            const panel = UI.createPanel(callbacks);
            updateModeUI();

            // Sync Logic (Restored from beta46)
            window.addEventListener('storage', (e) => {
                if (e.key === CONFIG.KEYS.BG_STATUS || e.key === CONFIG.KEYS.DB_KEY || e.key === CONFIG.KEYS.BG_QUEUE || e.key === CONFIG.KEYS.COOLDOWN || e.key === CONFIG.KEYS.COOLDOWN_QUEUE || e.key === CONFIG.KEYS.FAILED_QUEUE) {
                    Storage.invalidate(e.key); // Force cache clear so getJSON fetches fresh data
                    Core.updateControllerUI();
                }
            });
            setInterval(() => {
                Storage.invalidate(CONFIG.KEYS.DB_KEY);
                Storage.invalidate(CONFIG.KEYS.BG_STATUS);
                Storage.invalidate(CONFIG.KEYS.BG_QUEUE);
                Storage.invalidate(CONFIG.KEYS.COOLDOWN);
                Storage.invalidate(CONFIG.KEYS.COOLDOWN_QUEUE);
                Storage.invalidate(CONFIG.KEYS.FAILED_QUEUE);
                Core.updateControllerUI();
            }, 2000); // Polling backup

            // Env Log
            const isIPad = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || isIPad;
            Utils.log(`Env: ${navigator.platform}, TP:${navigator.maxTouchPoints}\nDevice: ${isIOS ? 'iOS/iPad' : 'Desktop'}\nUA: ${navigator.userAgent.substring(0, 50)}...`);

            // Anchor Loop
            UI.anchorPanel();
            setInterval(() => {
                if (!document.getElementById('hege-panel')) {
                    console.warn('[留友封] Panel missing from DOM! Attempting re-inject?');
                }
                UI.anchorPanel();
            }, 1500);

            Core.init();

            // Log Sync
            if (CONFIG.DEBUG_MODE) {
                // Console only
            }
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', main);
    } else {
        main();
    }
})();

})();
