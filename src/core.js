import { CONFIG } from './config.js';
import { Utils } from './utils.js';
import { Storage } from './storage.js';
import { UI } from './ui.js';

export const Core = {
    blockQueue: new Set(),
    pendingUsers: new Set(),
    lastClickedBtn: null, // Track for shift-click
    lastClickedUsername: null, // Fallback if DOM node is lost
    lastClickedState: null, // null, 'checked', or 'unchecked'

    init: () => {
        Core.pendingUsers = new Set(Storage.getSessionJSON(CONFIG.KEYS.PENDING));

        const hasAgreed = Storage.get(CONFIG.KEYS.DISCLAIMER_AGREED);

        if (CONFIG.DEBUG_MODE) console.log(`[留友封] 初始化完成, 版本: ${CONFIG.VERSION}, Mobile: ${Utils.isMobile()}`);
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
            if (dialogChanged) {
                Core.injectDialogBlockAll();
                Core.injectDialogCheckboxes();
            }
        });

        Core.observer.observe(document.body, { childList: true, subtree: true });

        // Backup interval in case mutation observer misses React's synthetic updates
        // Increased frequency from 1500 to 500ms to catch post-Loading states faster
        setInterval(() => {
            Core.scanAndInject();
            Core.injectDialogBlockAll();
            Core.injectDialogCheckboxes();
        }, 500);

        Core.scanAndInject();

        // [Debug] Global Click Tracker (User requested to keep this around for debugging)
        if (CONFIG.DEBUG_MODE) {
            document.body.addEventListener('click', (e) => {
                let target = e.target;
                let text = target.innerText || target.textContent || '';

                // Try to find text from parent if the click was on an SVG or inner span
                if (!text.trim() && target.parentElement) {
                    text = target.parentElement.innerText || target.parentElement.textContent || '';
                }

                // Only log if we clicked something that looks like an action (has text or is an SVG)
                const isSvg = target.closest('svg');
                let logMsg = text.trim().substring(0, 30);
                if (!logMsg && isSvg) logMsg = '[SVG Icon]';

                if (logMsg) {
                    console.log(`[留友封 Debug] Clicked: "${logMsg.replace(/\n/g, ' ')}"`);

                    // Inspect DOM 1 second after click to see what React did to the headers
                    setTimeout(() => {
                        const headers = document.querySelectorAll('h1, h2');
                        console.log(`[留友封 Debug] --- DOM State 1s after click ---`);
                        console.log(`Found ${headers.length} headers total.`);
                        headers.forEach((h, idx) => {
                            const hText = (h.innerText || h.textContent || '').trim();
                            if (hText) {
                                const p = h.parentElement;
                                const injected = p ? p.dataset.hegeDialogInjected : 'N/A';
                                const hasBtn = p ? !!p.querySelector('.hege-block-all-btn') : false;

                                // Check if inside dialog
                                let isDialog = false;
                                let curr = p;
                                for (let i = 0; i < 8; i++) {
                                    if (curr && curr.getAttribute('role') === 'dialog') { isDialog = true; break; }
                                    if (curr) curr = curr.parentElement;
                                }

                                console.log(`Header [${idx}]: "${hText}" | inDialog: ${isDialog} | ParentInjectedFlag: ${injected} | BtnExists: ${hasBtn}`);

                                // Log the entire parent structure HTML (stripped of too much detail)
                                // if it's a dialog header we care about
                                if (isDialog && ['讚', '引用', '轉發', '貼文動態', '活動', 'Likes'].some(t => hText.includes(t))) {
                                    console.log(`[!] Target Header Parent HTML snippet:`, p ? p.outerHTML.substring(0, 300) + '...' : 'null');
                                }
                            }
                        });
                        console.log(`-------------------------------------------`);
                    }, 1000);
                }
            }, true); // Capture phase to guarantee we catch it even if React calls stopPropagation()
        }

        // React often swallows events or stops propagation.
        // We now bind `addEventListener('click', Core.handleGlobalClick, true)`
        // directly to the initialized containers instead of window to prevent click-through.
    },

    getTopContext: () => {
        const dialogs = document.querySelectorAll('[role="dialog"]');
        if (dialogs.length > 0) {
            // Pick the last one which is usually the topmost in DOM
            return dialogs[dialogs.length - 1];
        }
        return document.body;
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
        const ctx = Core.getTopContext();
        const isDialog = ctx !== document.body;

        const headers = ctx.querySelectorAll('h1, h2, div[role="heading"] span');
        let header = null;
        let titleText = '';

        for (let h of headers) {
            const tempText = (h.innerText || h.textContent || '');
            const text = tempText.trim();
            if (text && text !== 'Threads') {
                if (isDialog || ['貼文動態', '讚', 'Likes', '引用', '轉發', '活動'].some(t => text.includes(t))) {
                    header = h;
                    titleText = text;
                }
            }
        }

        if (!header) return;

        const headerContainer = header.parentElement;
        if (!headerContainer) return;

        let localCtx = headerContainer;
        for (let i = 0; i < 2; i++) {
            if (localCtx.parentElement && localCtx.parentElement.tagName !== 'BODY') {
                localCtx = localCtx.parentElement;
            }
        }

        const existingBtn = localCtx.querySelector('.hege-block-all-btn');
        if (existingBtn && document.body.contains(existingBtn)) return;

        const blockAllBtn = document.createElement('div');
        blockAllBtn.className = 'hege-block-all-btn';
        blockAllBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"></path></svg>
            <span>同列全封</span>
        `;

        const handleBlockAll = (e) => {
            e.stopPropagation();
            e.preventDefault();

            const links = ctx.querySelectorAll('a[href^="/@"]');
            let rawUsers = Array.from(links).map(a => {
                const href = a.getAttribute('href');
                return href.split('/@')[1].split('/')[0];
            });

            rawUsers = [...new Set(rawUsers)];

            const db = new Set(Storage.getJSON(CONFIG.KEYS.DB_KEY, []));
            const activeQueue = Storage.getJSON(CONFIG.KEYS.BG_QUEUE, []);
            const activeSet = new Set(activeQueue);

            const newUsers = rawUsers.filter(u => !db.has(u) && !activeSet.has(u) && !Core.pendingUsers.has(u));

            if (newUsers.length === 0) {
                UI.showToast('沒有新帳號可加入');
                return;
            }

            newUsers.forEach(u => Core.pendingUsers.add(u));
            Storage.setSessionJSON(CONFIG.KEYS.PENDING, [...Core.pendingUsers]);

            const status = Storage.getJSON(CONFIG.KEYS.BG_STATUS, {});
            const isRunning = (Date.now() - (status.lastUpdate || 0) < 10000 && status.state === 'running');

            if (isRunning) {
                const combinedQueue = [...activeQueue, ...Core.pendingUsers];
                Storage.setJSON(CONFIG.KEYS.BG_QUEUE, [...new Set(combinedQueue)]);
                UI.showToast(`已將畫面上 ${newUsers.length} 筆帳號加入背景排隊`);
            } else {
                UI.showToast(`已加入「${Core.pendingUsers.size} 選取」，請至清單「開始封鎖」`);
            }

            document.querySelectorAll('.hege-checkbox-container').forEach(box => {
                if (box.dataset.username && Core.pendingUsers.has(box.dataset.username)) {
                    box.classList.add('checked');
                }
            });

            Core.updateControllerUI();
        };

        const allSpans = localCtx.querySelectorAll('span[dir="auto"]');
        let sortSpan = null;
        for (let span of allSpans) {
            const spanText = (span.innerText || span.textContent || '').trim();
            if (spanText === '排序' || spanText.includes('排序')) {
                sortSpan = span;
                break;
            }
        }

        if (sortSpan && sortSpan.closest('[role="button"]')) {
            const sortBtn = sortSpan.closest('[role="button"]');
            blockAllBtn.style.marginRight = '8px';

            if (!blockAllBtn.dataset.hegeEventBound) {
                if (Utils.isMobile()) {
                    blockAllBtn.addEventListener('touchend', (e) => {
                        e.stopPropagation(); e.preventDefault();
                        handleBlockAll(e);
                    }, { passive: false, capture: true });
                } else {
                    blockAllBtn.addEventListener('click', handleBlockAll, true);
                }
                blockAllBtn.dataset.hegeEventBound = 'true';
            }

            try {
                sortBtn.parentElement.style.display = 'flex';
                sortBtn.parentElement.style.alignItems = 'center';
                sortBtn.parentElement.insertBefore(blockAllBtn, sortBtn);
            } catch (e) {
                headerContainer.appendChild(blockAllBtn);
            }
        } else {
            if (!blockAllBtn.dataset.hegeEventBound) {
                if (Utils.isMobile()) {
                    blockAllBtn.addEventListener('touchend', (e) => {
                        e.stopPropagation(); e.preventDefault();
                        handleBlockAll(e);
                    }, { passive: false, capture: true });
                } else {
                    blockAllBtn.addEventListener('click', handleBlockAll, true);
                }
                blockAllBtn.dataset.hegeEventBound = 'true';
            }

            blockAllBtn.style.marginLeft = 'auto';
            blockAllBtn.style.marginRight = '8px';

            if (header.nextSibling) {
                headerContainer.insertBefore(blockAllBtn, header.nextSibling);
            } else {
                headerContainer.appendChild(blockAllBtn);
            }
        }
    },

    injectDialogCheckboxes: () => {
        const ctx = Core.getTopContext();
        const isDialog = ctx !== document.body;

        const dialogHeaders = ctx.querySelectorAll('h1, h2, div[role="heading"] span');
        let header = null;
        for (let h of dialogHeaders) {
            const tempText = (h.innerText || h.textContent || '').trim();
            if (tempText && tempText !== 'Threads') {
                if (isDialog || ['讚', '引用', '轉發', '貼文動態', '活動', 'Likes'].some(t => tempText.includes(t))) {
                    header = h;
                }
            }
        }
        if (!header) return;

        const links = ctx.querySelectorAll('a[href^="/@"]');
        const dbRef = new Set(Storage.getJSON(CONFIG.KEYS.DB_KEY, []));
        const activeQueue = Storage.getJSON(CONFIG.KEYS.BG_QUEUE, []);
        const activeSet = new Set(activeQueue);

        if (CONFIG.DEBUG_MODE && links.length > 0) {
        }

        links.forEach((a, idx) => {
            const isAvatar = a.querySelector('img') || a.querySelector('svg') || a.innerText.trim() === '';
            const username = a.getAttribute('href').split('/@')[1].split('/')[0];

            if (!isAvatar) {
                // If it's not an avatar link, we only skip it if it's the 2nd link of the same user (name link)
                // However, in some views the name link IS the only link with a good flexRow. 
                // So let's try to process both, but avoid double injection via flexRow check.
            }

            if (username === Utils.getMyUsername()) return;

            let topContainer = a;
            let followBtn = null;
            for (let i = 0; i < 15; i++) {
                if (!topContainer.parentElement) break;
                topContainer = topContainer.parentElement;
                const btns = Array.from(topContainer.querySelectorAll('div[role="button"]'));
                followBtn = btns.find(b => b.innerText && ['追蹤', '正在追蹤', 'Follow', 'Following'].some(t => b.innerText.includes(t)));
                if (followBtn) break;
            }

            let flexRow = null;
            let followBtnContainer = null;

            if (followBtn) {
                let child = followBtn;
                while (child && child !== topContainer) {
                    let parent = child.parentElement;
                    let safeUsername = username.replace(/"/g, '');
                    // Threads lists usually have a clear row container that holds both user info and the follow button.
                    if (parent && parent.children.length >= 2 && parent.querySelector(`a[href*="/@${safeUsername}"]`)) {
                        flexRow = parent;
                        followBtnContainer = child;
                        break;
                    }
                    child = parent;
                }
            }

            // Fallback: If no follow button (e.g. current user or specific list type), find a container that looks like a list item.
            // Beta 53/54 optimization: Finding a stable Row Container.
            // Priority: role="listitem" -> data-pressable-container -> Common Flex Row classes
            if (!flexRow) {
                flexRow = a.closest('div[role="listitem"]') ||
                    a.closest('div[data-pressable-container="true"]') ||
                    a.closest('.x1n2onr6.x1f9n5g') || // Common reply row class
                    followBtn.parentElement.closest('.x78zum5.xdt5ytf') ||
                    followBtn.parentElement;
            }

            if (!flexRow) return;

            // Beta 54: Absolute deduplication. Check the whole row for THIS user's box.
            const existingBox = flexRow.querySelector(`.hege-checkbox-container[data-username="${CSS.escape(username)}"]`);
            if (existingBox) {
                const isChecked = Core.pendingUsers.has(username);
                if (isChecked !== existingBox.classList.contains('checked')) {
                    existingBox.classList.toggle('checked', isChecked);
                }
                return;
            }

            // Beta 54: Special case - if a box already exists in this row but for a different username, 
            // it means we've hit a shared parent. For safety, let's look for a better spot or skip.
            if (flexRow.querySelector('.hege-checkbox-container')) {
                // If the user's box isn't here, maybe it's in a different sub-flex.
                // But generally, one box per role="listitem" is the goal.
                return;
            }

            // Beta 40/42/54: Spacing adjustment on the Follow button side
            if (followBtnContainer) {
                followBtnContainer.style.setProperty("margin-right", "24px", "important");
            }

            // Ensure our chosen flexRow is the relative origin
            if (flexRow.style.position === "" || window.getComputedStyle(flexRow).position === "static") {
                flexRow.style.position = "relative";
            }
            flexRow.style.setProperty("overflow", "visible", "important");

            const container = document.createElement("div");
            container.className = "hege-checkbox-container";
            container.dataset.username = username; // Ensure we identify who this box belongs to
            container.style.position = "absolute";
            // Coordinate for flexRow anchor
            container.style.right = "-15px";
            container.style.top = "50%";
            container.style.transform = "translateY(-50%)";
            container.style.cursor = 'pointer';
            container.style.zIndex = '100';
            container.style.backgroundColor = 'var(--bg-color, rgba(255,255,255,0.1))';
            container.style.borderRadius = '4px';
            container.style.padding = '2px';

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

            container.dataset.username = username;

            if (dbRef.has(username)) {
                container.classList.add('finished');
            } else if (activeSet.has(username)) {
                container.classList.add('pending');
            } else if (Core.pendingUsers.has(username)) {
                container.classList.add('checked');
            }

            // Beta 45: Only use handleGlobalClick to avoid double-toggle issues.
            // Still keep the prevention listeners to block Threads' native behavior on these specific elements if needed.
            if (!Utils.isMobile()) {
                container.addEventListener('pointerdown', (e) => { e.stopPropagation(); }, true);
                container.addEventListener('pointerup', (e) => { e.stopPropagation(); }, true);
                container.addEventListener('mousedown', (e) => { e.stopPropagation(); if (e.shiftKey) e.preventDefault(); }, true);
                container.addEventListener('mouseup', (e) => { e.stopPropagation(); }, true);
            }
            container.addEventListener('click', Core.handleGlobalClick, true);

            flexRow.appendChild(container); // Just append, 'order: 999' will put it on the right
        });
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
                        if (CONFIG.DEBUG_MODE) console.log('[留友封] Checkbox Touchend detected');
                        e.stopPropagation();
                        // CRITICAL: Stop iOS from firing synthetic click that triggers Universal Link
                        if (e.cancelable) e.preventDefault();

                        // Manually trigger handleGlobalClick since we prevented the default synthetic click
                        Core.handleGlobalClick(e);
                    }
                }, { passive: false, capture: true });
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
            `成功: ${(workerStats.stats && workerStats.stats.success) || 'N/A'} | 跳過: ${(workerStats.stats && workerStats.stats.skipped) || 'N/A'} | 失敗: ${(workerStats.stats && workerStats.stats.failed) || 'N/A'}`,
            `驗證等級: ${workerStats.verifyLevel || 'N/A'} | 連續失敗: ${workerStats.consecutiveFails || 'N/A'}`,
            `Session 名單: ${(workerStats.sessionQueue && workerStats.sessionQueue.length) || 'N/A'} | 初始 Total: ${workerStats.initialTotal || 'N/A'}`,
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
