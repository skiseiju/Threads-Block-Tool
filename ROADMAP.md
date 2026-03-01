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

### 🔲 方案 A：批次分段 + 暫停/恢復

**目的**：將大佇列拆成小批次（如每 10-15 人），每批完成後自動返回主頁，使用者可以瀏覽、操作，再手動繼續下一批。

**價值**：使用者每 1-2 分鐘就有一次操作窗口，不會被長時間鎖定。

**實作要點**：
- `worker.js` 加入 `BATCH_SIZE` 判斷，達到上限時自動 `navigateBack`
- 主頁面需偵測「佇列未清空 + Worker 已返回」狀態，顯示「繼續封鎖 (剩餘 N 人)」按鈕
- `config.js` 新增 `BATCH_SIZE` 設定（可調）

**風險**：低（不違反任何 iOS 安全限制）

---

### 🔲 方案 C：A + B 組合（最佳體驗）

**前置條件**：方案 B 已實作 ✅

**目的**：結合批次分段與進度視覺化，在每批執行中顯示進度 UI，批次結束後返回主頁以浮動面板顯示整體進度。

**價值**：iOS/iPad 上的終極體驗方案。

---

## 已完成

### ✅ 方案 B：進度條 + 預估時間 + 中止改善

- 進度條視覺化
- 預估剩餘時間（ETA）
- 成功/跳過/失敗 即時統計
- 停止按鈕
