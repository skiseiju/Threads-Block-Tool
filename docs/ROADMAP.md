# 🗺️ Roadmap

## 未來評估項目

### 🔲 架構重構：DOM Adapter 抽象化 (Cross-Platform Strategy)

**目的**：為徹底解決 iOS/iPadOS 與 Desktop/Chrome 之間對 React 事件處理（如 `click` vs `TouchEvent`）與 DOM 渲染層級（如 `innerText` 取值）的差異，建立統一的 Adapter 防腐層。

**價值**：主流程 `worker.js` 將不再混雜平台特例，降低維護成本。當 Threads 改版時只需修改對應的 Adapter，實現關注點分離 (Separation of Concerns)。

**實作要點**：
- 建立 `dom-adapters.js` 模組。
- 抽離 `Worker.autoBlock` 內部尋找「更多」、「封鎖」與「確認」按鈕的長迴圈邏輯。
- 將 `Utils.simClick` 這類平台判定統一封裝在 Adapter 的 `clickElement(el)` 介面中。

---

## 💡 待討論 (To Be Discussed / Next Phase Blueprint)

### 🔲 核心基礎：Storage 儲存引擎升級 (IndexedDB)
**目的**：解決目前 `localStorage` 5MB 的死佔用上限，當歷史封鎖資料庫 (`hege_block_db_v1`) 超過數千筆時，避免寫入效能下降或儲存失敗 (QuotaExceededError)。
**實作方向**：打造非同步的 `StorageAdapter` 切換至 IndexedDB 儲存。
**擴充功能影響**：**完全不影響申請，不需要額外權限！** IndexedDB 屬於現代瀏覽器標準 Web Storage API 之一，跟 `localStorage` 一樣在 Content Script 或網頁環境預設開放，甚至比需要宣告 `storage` 權限的 Chrome API (`chrome.storage.local`) 更乾淨、不依賴擴充環境。

### 🔲 產品擴張：智慧關鍵字過濾標記 (Keyword Auto-Flagging)
**目的**：使用者輸入「討厭的關鍵字」後，腳本自動在 Threads 畫面上將包含該詞彙的作者名稱與勾選框 Highlight 成顯眼顏色，甚至支援「自動預先勾選」。
**價值**：從「輔助手動點擊」轉化為「強大的內容防禦盾」。

### 🔲 產品擴張：視覺化歷史戰情室 (Dashboard / History Viewer)
**目的**：建立一個獨立的全螢幕 Dashboard，讓用戶可以檢視自己「總共封鎖了多少人」、「封鎖時間分佈」，並可以關鍵字搜尋名單，提供一鍵「解除封鎖」的批次功能。

### 🔲 產品擴張：鏈式關聯封鎖 (Block Chains / Network Actions)
**目的**：讓使用者點擊某個目標對象的「粉絲名單」後，提供「一鍵將這清單內所有人加入封鎖佇列」的毀滅性防護功能。

---