# 路線 D：真空式燒結排程與承載限制驗證

執行日期：2026-05-14  
執行者：Codex  
驗證目標：依據 `docs/development-notes/system-validation-blueprint.md` 的「路線 D：真空式燒結排程與承載限制驗證」，檢查真空式燒結爐、燒結推薦、混裝限制、堆疊/高度限制、批次儲存、儀表板與報表追蹤。

## 測試範圍

本次驗證涵蓋藍圖 D-01 到 D-10：

| 步驟 | 驗證項目 | 本次狀態 |
| --- | --- | --- |
| D-01 | 新增真空式燒結爐並可選取 | 通過 |
| D-02 | 未選爐直接送出應阻擋 | 失敗 |
| D-03 | 單一作業標準可產生推薦，並顯示高度與容量依據 | 通過 |
| D-04 | 儲存燒結批次 `QA-BATCH-SIN-A001` | 通過 |
| D-05 | 不允許混裝品項不可直接合併 | 通過 |
| D-06 | 墊塊堆疊數超過最大值應阻擋或標示不可行 | 通過，但 UI 堆疊操作未自動執行 |
| D-07 | 產品高度超過爐層高度應不可行 | 通過 |
| D-08 | 治具限制規則應影響推薦 | 通過 |
| D-09 | 儀表板可追蹤近期燒結排程 | 通過 |
| D-10 | 報表可用批號與日期查到燒結批次 | 通過 |

未納入自動 UI 操作：Electron 桌面 UI 的實際點擊、表單輸入、畫面 toast/提示文字驗證。本次以本機 Electron runtime、臨時 SQLite DB、資料層方法與本機 HTTP API 驗證。原因是此 repo 目前沒有可重用的 UI E2E 測試 harness；直接啟動桌面 UI 自動操作會需要額外瀏覽器/視窗自動化設定，且本任務要求不要改正式功能程式碼。

## 執行方式

1. 讀取藍圖 Route D 內容：
   - `docs/development-notes/system-validation-blueprint.md`
2. 靜態檢查主要程式檔語法：
   - `node --check database.js`
   - `node --check server.js`
   - `node --check main.js`
   - `node --check preload.js`
3. 使用專案內 Electron runtime 執行臨時驗證腳本：
   - 原因：`better-sqlite3` native module 是以 Electron ABI 編譯，直接用系統 Node 會因 `NODE_MODULE_VERSION` 不符而無法載入。
   - 臨時 DB：`C:\Users\nickt\AppData\Local\Temp\route-d-sintering-S9rFr6\pmc-validation.db`
   - 測試資料與正式 DB 隔離，未寫入 repo 內資料庫。
4. 驗證時啟動本機 API server，使用隨機 port 呼叫：
   - `GET /api/health`
   - `GET /api/reports/snapshot?batch_no=QA-BATCH-SIN-A001&date_from=2026-05-14&date_to=2026-05-14`

本次未執行 `npm run build`，避免改寫 `dist` 或其他建置產物。

## 測試資料

| 類型 | 欄位 | 值 |
| --- | --- | --- |
| 燒結爐 | 設備代碼 | `QA-MCH-SIN-A001` |
| 燒結爐 | 設備名稱 | `驗證真空燒結爐 A` |
| 燒結爐 profile | 總層數 | `8` |
| 燒結爐 profile | 每層位置數 | `2` |
| 燒結爐 profile | 每層高度 | `80` |
| 批次 | 批號 | `QA-BATCH-SIN-A001` |
| 批次 | 作業人員 | `QA Tester` |
| 品項 1 | 作業標準 | `QA-SPEC-A001` |
| 品項 1 | 數量 | `360` |
| 品項 1 | 允許混裝 | `true` |
| 品項 2 | 作業標準 | `QA-SPEC-B001` |
| 品項 2 | 數量 | `80` |
| 品項 2 | 允許混裝 | `false` |
| 治具 | 承載盤 | `QA-JIG-TRAY-A001` |
| 治具 | 陶瓷盤 | `QA-JIG-CER-A001` |
| 治具 | 墊腳 | `QA-JIG-FOOT-A001` |
| 治具 | 墊高治具 | `QA-JIG-SUP-A001` |
| 治具 | 限制用墊高治具 | `QA-JIG-SUP-R001` |

## 通過項目

- D-01：`QA-MCH-SIN-A001` 可建立為 `sintering_furnace`，並可在爐體 profile 清單中查到，profile 顯示 `total_layers = 8`、`positions_per_layer = 2`。
- D-03：單一品項 `QA-SPEC-A001`、數量 `360` 可產生可行推薦；計算結果包含 `required_height = 25`、`total_required_positions = 6`、`estimated_load_rate = 37.5`，且 `conflicts = []`。
- D-04：`QA-BATCH-SIN-A001` 可儲存，`listSinteringBatches` 可查到 1 筆，`listLayoutPlans` 可查到 1 筆，儲存負載率為 `37.5`。
- D-05：加入 `QA-SPEC-B001` 且該品項不允許混裝時，推薦結果為不可行，衝突訊息包含 `Selected products are not all marked as mix-load compatible.`。
- D-06：建立製程規格時，若 `support_stack_quantity = 4` 超過治具 `max_stack_count = 3`，資料層會阻擋，錯誤為 `Support block stack quantity exceeds configured max stack count.`。
- D-07：將品項高度調整到超過爐層限制時，推薦結果為不可行，衝突訊息包含 `requires 100.0 mm, exceeding the layer limit 80.0 mm.`。
- D-08：將 `QA-JIG-SUP-R001` 對 `QA-SPEC-A001` 設為 `restricted` 後，重新推薦會不可行，衝突訊息包含 `restricted from using support block QA-JIG-SUP-R001.`。
- D-09：`getDashboardSummary()` 的 `upcoming_sintering` 可找到 `QA-BATCH-SIN-A001`。
- D-10：`/api/reports/snapshot` 使用批號與日期查詢時，HTTP 200 且 `sintering_batches` 可找到 `QA-BATCH-SIN-A001`。
- 本機 API health 檢查通過，`GET /api/health` 回傳 HTTP 200。
- `database.js`、`server.js`、`main.js`、`preload.js` 均通過 `node --check` 語法檢查。

## 失敗/風險項目

### D-02 失敗：資料層未選燒結爐仍可建立批次

藍圖預期：到「真空式燒結作業」，未選爐直接送出時，系統應阻擋並提示需選擇真空式燒結爐。

實測結果：直接呼叫 `createSinteringBatch` 且不傳 `furnace_machine_id` 時，批次仍會建立成功。

證據：

```json
{
  "step": "D-02",
  "status": "FAIL",
  "batch_id": 1,
  "furnace_machine_id": null
}
```

風險：

- 後端/API 可產生沒有 `furnace_machine_id` 的燒結批次。
- 同一筆批次仍可能保存自動 layout plan，造成「批次主檔沒有選爐，但 layout plan 有推薦爐」的資料不一致。
- 即使桌面 UI 目前可能預設選取第一台爐，API、Web client 或未來匯入流程仍可繞過此要求。

### UI 未自動執行

以下項目已由資料層/API 驗證，但尚未透過實際 Electron UI 自動點擊確認：

- D-02 的畫面提示文字是否存在。
- D-06 在批次頁面內「調整堆疊數」的互動流程。現有批次表單看起來主要輸入 `support_block_height`，而堆疊上限主要在製程規格建立時阻擋。
- D-09 儀表板畫面是否真的渲染出該筆批次。本次驗證的是儀表板資料來源 `getDashboardSummary()`。
- D-10 報表畫面查詢流程。本次驗證的是 `/api/reports/snapshot`。

## 可重現步驟

1. 使用 Electron runtime 建立臨時 DB，初始化 `DatabaseService({ dbPath })`。
2. 建立 Route D 測試治具：
   - `QA-JIG-TRAY-A001`
   - `QA-JIG-CER-A001`
   - `QA-JIG-FOOT-A001`
   - `QA-JIG-SUP-A001`
   - `QA-JIG-SUP-R001`
3. 建立真空式燒結爐：
   - `machine_code = QA-MCH-SIN-A001`
   - `machine_type = sintering_furnace`
   - `profile.total_layers = 8`
   - `profile.base_layer_gap = 80`
   - `profile.positions_per_layer = 2`
4. 建立兩個作業標準：
   - `QA-SPEC-A001`：允許混裝、單盤容量 `60`、產品高度 `25`
   - `QA-SPEC-B001`：不允許混裝、單盤容量 `40`、產品高度 `30`
5. 呼叫 `calculateSinteringLayout({ items: [{ product_id: QA-SPEC-A001, quantity: 360 }] })`，確認推薦可行。
6. 呼叫 `createSinteringBatch` 建立 `QA-BATCH-SIN-A001`，帶入 `furnace_machine_id = QA-MCH-SIN-A001`，確認批次與 layout plan 可查。
7. 呼叫 `calculateSinteringLayout`，同時帶入 `QA-SPEC-A001` 與 `QA-SPEC-B001`，確認混裝衝突。
8. 建立超過 `max_stack_count` 的製程規格，確認被阻擋。
9. 呼叫 `calculateSinteringLayout` 並覆寫 `unit_height = 100`，確認高度衝突。
10. 將 `QA-JIG-SUP-R001` 對 `QA-SPEC-A001` 設為 `restricted`，重新推薦確認治具限制衝突。
11. 呼叫 `getDashboardSummary()`，確認 `upcoming_sintering` 查得到 `QA-BATCH-SIN-A001`。
12. 啟動本機 API server，呼叫 `/api/reports/snapshot`，用批號與日期查詢 `QA-BATCH-SIN-A001`。

## 建議後續

1. 修正 D-02：在 `createSinteringBatch` 或 API 層要求 `furnace_machine_id` 必填，避免後端/API 建立無爐號批次。
2. 若仍希望允許「先推薦再選爐」，建議拆成兩個明確狀態：推薦草稿不得寫入正式批次；正式儲存批次必須有爐號。
3. 補一個自動化測試入口，至少覆蓋 `calculateSinteringLayout`、`createSinteringBatch`、報表 snapshot 與 D-02 必填爐號行為。
4. 補 UI E2E 或最小 Playwright/Electron 測試，確認未選爐提示、儀表板渲染、報表查詢畫面、批次頁治具/高度提示文字。
5. 釐清批次頁 D-06 的「墊塊堆疊數」是否應作為可編輯欄位；目前資料層主要在製程規格建立時檢查堆疊上限，批次項目可覆寫的是 `support_block_height`。
