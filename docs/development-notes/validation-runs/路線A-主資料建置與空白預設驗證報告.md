# 路線 A：主資料建置與空白預設驗證

測試日期：2026-05-14  
測試人員：Codex  
驗證範圍：`docs/development-notes/五路線系統驗證藍圖.md` 的「路線 A：主資料建置與空白預設驗證」。

## 測試範圍

- 產品主檔：新增、必填阻擋、搜尋、編輯。
- 作業標準：產品主檔必選、建檔、搜尋、編輯、數字欄位後端防呆。
- 治具主檔：建檔、搜尋、編輯、材質與用途後端防呆。
- 製程治具對應規則：指定作業標準、推薦治具、優先序、重新讀取後仍存在。
- 前端靜態檢查：新增模式清空邏輯、下拉預設提示、編輯帶入邏輯。
- 建置檢查：web client 與 Tailwind CSS 皆輸出到暫存目錄，未覆蓋專案內建置產物。

## 執行方式

1. 讀取藍圖路線 A：`docs/development-notes/五路線系統驗證藍圖.md`。
2. 檢查路線 A 相關程式碼：
   - `index.html`
   - `renderer-scripts/products.js`
   - `renderer-scripts/support-blocks.js`
   - `server.js`
   - `database.js`
3. 使用 Electron runtime 執行一次性驗證腳本，因 `better-sqlite3` 是 Electron ABI 版本，系統 Node 22 不能直接載入。
4. 驗證腳本建立隔離暫存資料庫，不使用正式資料庫：
   - `C:\Users\nickt\AppData\Local\Temp\mim-pmc-route-a-jN2clN\route-a-validation.db`
5. 啟動 Express API 到本機測試埠 `127.0.0.1:3197`，透過 API 建立與查詢 QA 資料。
6. 建置檢查：
   - `npx vite build --outDir <TEMP> --emptyOutDir`
   - `npx tailwindcss -i ./assets/css/input.css -o <TEMP>.css --minify`

## 通過項目

| 步驟 | 結果 | 證據 |
| --- | --- | --- |
| PRE-API | 通過 | API server 以暫存 DB 啟動，`GET /api/health` 回傳 200。 |
| A-01 | 部分通過 | 暫存 DB 初始查詢 `QA-PM-A001` 為 0 筆；實際 Electron UI 未自動開啟。 |
| A-02 | 通過 | `POST /api/product-masters` 缺產品代碼時回 400，訊息 `Product code and product name are required.`，且未寫入資料。 |
| A-03 | 通過 | 建立 `QA-PM-A001` 成功，搜尋可找到 1 筆。 |
| A-04 | 靜態通過 | `syncMasterOptions()` 設定 `請選擇產品主檔`，`resetSpecForm()` 將產品、高度、容量等欄位重設為空白。 |
| A-05 | 通過 | 未選產品主檔建立作業標準時回 400，訊息 `Product master selection is required.`。 |
| A-06 | 通過 | 建立 `QA-SPEC-A001` 成功，搜尋可找到 1 筆。 |
| A-07 | 靜態通過 | 治具材質、用途、狀態、作業標準下拉皆有空白預設提示；`resetFixtureForm()` 清空數字欄位。 |
| A-09 | 通過 | 建立 `QA-JIG-TRAY-A001` 成功，搜尋可找到 1 筆。 |
| A-10/A-11 | 通過 | 將 `QA-JIG-TRAY-A001` 設為 `recommended`、優先序 `1`，重新讀取規則仍存在。 |
| A-12 | 通過 | 產品主檔、作業標準、治具編輯 API 成功；作業標準高度 `18.5`、容量 `120` 與治具高度 `12` 未被清空。 |
| 建置 | 通過 | Vite production build 成功；Tailwind minify 成功，僅有 Browserslist caniuse-lite 過期提示。 |

## 失敗/風險項目

| 編號 | 嚴重程度 | 結論 | 實際結果 |
| --- | --- | --- | --- |
| A-RISK-001 | 中 | 作業標準數字欄位後端防呆不足。 | `POST /api/products` 只給 `product_master_id/spec_code/spec_name` 仍回 201，後端自動存入 `product_height=0`、`tray_capacity=1`。若 UI 被繞過或未來 API 串接，可能產生不完整規格。 |
| A-RISK-002 | 中 | 治具材質/用途後端防呆不足。 | `POST /api/support-blocks` 只給 `block_code/block_name` 仍回 201，後端自動存入 `fixture_quick_type=other`、`fixture_type=support_block`。這與路線 A-08「不能建立用途不明治具」不一致。 |
| A-RISK-003 | 低 | UI 未在本輪自動操作。 | 本輪以本機程式碼、暫存 DB、API 與建置驗證為主；未自動啟動 Electron 視窗逐步點擊，因此白屏、toast 文案、滑鼠操作流程與截圖證據仍需人工或 browser automation 補驗。 |
| A-RISK-004 | 低 | API 錯誤訊息有英文。 | 產品主檔與作業標準後端阻擋有效，但訊息為英文；若這些訊息會直接出現在桌面 UI，現場使用者可讀性較弱。 |

## 可重現步驟

以下步驟會使用暫存資料庫，不會碰正式資料庫。

1. 用 Electron runtime 執行一次性驗證腳本。
2. 建立 `DatabaseService({ dbPath: <TEMP>/route-a-validation.db })` 並呼叫 `init()`。
3. 用 `startServer({ db, host: "127.0.0.1", port: 3197 })` 啟動 API。
4. 呼叫 `GET /api/health` 確認 API 正常。
5. 呼叫 `POST /api/product-masters`，payload 只給 `{ "product_name": "缺少代碼" }`，預期 400。
6. 呼叫 `POST /api/product-masters` 建立：
   ```json
   {
     "product_code": "QA-PM-A001",
     "product_name": "驗證用齒輪胚件 A",
     "revision": "R01"
   }
   ```
7. 呼叫 `POST /api/products` 不帶 `product_master_id`，預期 400。
8. 呼叫 `POST /api/products` 建立完整作業標準：
   ```json
   {
     "product_master_id": 1,
     "spec_code": "QA-SPEC-A001",
     "spec_name": "標準排程驗證 A",
     "process_revision": "A1",
     "product_height": 18.5,
     "tray_capacity": 120
   }
   ```
9. 呼叫 `POST /api/products` 只帶 `product_master_id/spec_code/spec_name`，可重現 A-RISK-001。
10. 呼叫 `POST /api/support-blocks` 只帶 `block_code/block_name`，可重現 A-RISK-002。
11. 呼叫 `POST /api/support-blocks` 建立完整治具：
    ```json
    {
      "block_code": "QA-JIG-TRAY-A001",
      "block_name": "驗證石墨托盤 A",
      "fixture_quick_type": "graphite_tray",
      "fixture_type": "tray",
      "shape_type": "托盤",
      "height": 12,
      "max_stack_count": 3,
      "status": "active"
    }
    ```
12. 呼叫 `PUT /api/support-block-rules/<specId>`：
    ```json
    {
      "rules": [
        {
          "support_block_id": 2,
          "compatibility_status": "recommended",
          "priority": 1
        }
      ]
    }
    ```
13. 呼叫 `GET /api/support-block-rules/<specId>`，確認推薦規則仍存在。
14. 呼叫 `PUT /api/product-masters/<id>`、`PUT /api/products/<id>`、`PUT /api/support-blocks/<id>`，確認編輯不會清空原欄位。

## 未自動執行項目

- 未自動點擊 Electron 桌面 UI 的 A-01 到 A-12 完整操作。
- 未留 UI 截圖。
- 未驗證 toast 是否與 API 錯誤訊息完全一致。
- 未驗證重開 Electron 視窗後的畫面狀態，只以 API 重新查詢驗證資料持久化。

原因：本輪以不修改正式功能、不碰正式資料庫為前提，且目前可穩定自動化的是本機 API、暫存 SQLite 與建置流程；Electron 視窗互動需另開 UI automation 才能取得可靠點擊與截圖證據。

## 建議後續

1. 補強 `createProduct()` / `updateProduct()` 的後端驗證：新增作業標準時，`product_height` 與 `tray_capacity` 應要求明確輸入且符合範圍，不要用空白自動補 `0/1`。
2. 補強 `createSupportBlock()` / `updateSupportBlock()` 的後端驗證：材質、用途、狀態應要求明確輸入；若要允許 `other`，也應要求手動文字或明確分類。
3. 將會直接顯示給使用者的 API validation message 改為中文，至少涵蓋產品主檔、作業標準與治具主檔。
4. 下一輪用 Electron UI automation 或人工逐步操作 A-01 到 A-12，補齊畫面截圖、toast 文案與「清空並進入新增模式」的實際視覺證據。
5. 若 A-RISK-001/A-RISK-002 修正後，重跑本報告的可重現步驟，確認 API 與 UI 防呆一致。
