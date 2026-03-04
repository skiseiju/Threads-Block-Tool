import { CONFIG } from './config.js';
import { Utils } from './utils.js';
import { Storage } from './storage.js';

export const Worker = {
    stats: { success: 0, skipped: 0, failed: 0, startTime: 0 },
    initialTotal: 0,
    sessionQueue: [],          // 本次 session 完整名單快照
    verifyLevel: 0,            // 0=每5次, 1=每3次, 2=每次
    verifyCount: 0,            // 自上次驗證以來的計數
    consecutiveRateLimits: 0,
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
