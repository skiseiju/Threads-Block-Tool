import { CONFIG } from './config.js';
import { Storage } from './storage.js';
import { Utils } from './utils.js';
import { UI } from './ui.js';
import { Core } from './core.js';
import { Worker } from './worker.js';

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
