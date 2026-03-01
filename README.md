# 留友封 (Threads Block Tool)

**留友封** 是一個專為 Threads 設計的批量封鎖工具，旨在解決官方介面缺乏批量管理功能的痛點。本專案支援 **Userscript (Tampermonkey/Stay)** 與 **Chrome 擴充功能** 雙模式。

## ✨ 主要功能 (Features)

*   **三模式運作**：
    *   **Mobile 同分頁模式 (iOS/iPadOS)**：透過 `history.replaceState` + `reload` 在當前分頁執行背景任務，規避 Safari 的 Universal Links 限制。完成後自動返回原頁面。
    *   **前景模式 (Desktop)**：模擬真人操作，直接在當前頁面點擊封鎖。
    *   **背景模式 (Desktop 預設)**：將名單發送至獨立背景視窗執行，不干擾主頁導覽。
*   **全新背景視覺面板 (Worker UI 2.0)**：
    *   提供清晰的進度條、動態 ETA 預估時間，以及即時的三維度狀態統計（成功/失敗/跳過）。
*   **12 小時冷卻防護與智慧回滾**：
    *   偵測 Threads 官方流量限制時自動啟動 12 小時鎖定防護。
    *   **智慧回滾 (Auto-Rollback)**：觸發冷卻時，自動將本次與近期 50 筆疑似失效名單安全轉移至「冷卻等待區」，確保封鎖零遺漏。
*   **自適應驗證系統 (Adaptive Verification)**：
    *   動態調整驗證頻率對抗假性成功，根據封鎖失敗率在每 5 次/3 次/每次之間切換抽樣檢查。
*   **批量選取與管理**：
    *   一鍵同列全封：支援將互動名單（按讚/轉發對話框）一鍵全選。
    *   Shift-Click 連鎖選取：按住 `Shift` 鍵並點擊，一鍵選取/取消選取區間內的所有用戶。
    *   智慧排除自我帳號，防止誤鎖。
*   **跨平台支援**：
    *   Chrome / Edge / Brave (擴充功能 或 Tampermonkey)
    *   Safari (macOS / iOS Stay) 支援相測試中

## 🛠 安裝與使用 (Installation)

### 1. Chrome 擴充功能 (開發者模式)
1. 下載專案並執行 `./build.sh`。
2. 開啟 Chrome -> 管理擴充功能 -> 開啟「開發人員模式」。
3. 點擊「載入未封裝項目」，選擇 `ThreadsBlocker_Project/dist/extension` 資料夾。

### 2. Userscript (Tampermonkey / Stay)
1. 執行 `./build.sh`。
2. 產生的檔案位於 `ThreadsBlocker_Project/dist/threads_block_tool.user.js`。
3. 將檔案拖入瀏覽器或在 Tampermonkey 中建立新腳本並貼上內容。
4. **iOS Safari**: 腳本會自動部署至 iCloud Userscripts 資料夾 (若有設定)。

## 📝 版本紀錄 (Changelog)

詳細版本紀錄請參閱 **[CHANGELOG.md](./CHANGELOG.md)**。

## 📂 專案結構 (Structure)

```
ThreadsBlocker_Project/
├── build.sh            # 自動建置腳本
├── src/                # 原始碼
│   ├── main.js         # 入口點
│   ├── core.js         # 封鎖邏輯
│   ├── ui.js           # 介面組件
│   ├── ...
│   └── manifest.json   # Chrome 擴充設定
└── dist/               # 建置輸出 (自動生成)
    ├── threads_block_tool.user.js
    └── extension/
```
