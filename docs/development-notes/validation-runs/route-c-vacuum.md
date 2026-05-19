# 路線 C：真空式脫脂排程與推薦驗證

執行日期：2026-05-14  
執行者：Codex  
驗證範圍：`docs/development-notes/system-validation-blueprint.md` 的「路線 C：真空式脫脂排程與推薦驗證」

## 測試範圍

- 驗證真空式脫脂設備與爐體 profile 可建立並被 `listFurnaceProfiles()` 查到。
- 驗證真空式脫脂推薦邏輯會讀取產品高度、治具、單盤容量、數量與墊塊規則。
- 驗證正常批量可產生可行推薦、層位建議與推薦細節。
- 驗證超出容量、超出高度、未設定治具規則等例外資料不會讓計算崩潰，且會回傳限制原因或 fallback 結果。
- 驗證真空式脫脂批次可儲存、列表可查詢、重新開啟同一 SQLite DB 後資料仍存在。
- 未自動執行 Electron UI 點擊流程；本次以本機程式碼與暫存 SQLite DB 直接驗證 `database.js` 的資料與推薦邏輯。

## 執行方式

本次沒有修改正式功能程式碼，也沒有寫入正式 DB。驗證使用 `%TEMP%` 內的臨時 SQLite 檔，結束後刪除。

執行過的檢查：

```powershell
$env:ELECTRON_RUN_AS_NODE='1'
.\node_modules\.bin\electron.cmd - <inline route-c validation script>
```

補充靜態檢查：

```powershell
$env:ELECTRON_RUN_AS_NODE='1'; .\node_modules\.bin\electron.cmd --check database.js
```

結果：`database.js` 語法檢查通過。

未採用一般 `node` 執行的原因：`better-sqlite3` 目前是 Electron ABI `NODE_MODULE_VERSION 133`，系統 Node.js v22.17.0 需要 `NODE_MODULE_VERSION 127`，直接用 `node` 會出現 ABI 不相容錯誤。因此改用 `ELECTRON_RUN_AS_NODE=1` 的 Electron runtime。

`renderer-scripts/structured-batch.js` 與 `renderer-scripts/vacuum.js` 未用 `electron --check` 判定，因為 root `package.json` 是 `commonjs`，這兩個檔案是瀏覽器端 ES module，直接用 CommonJS 語法檢查會因 `import` 報錯，不能代表實際瀏覽器載入失敗。

## 通過項目

| 藍圖步驟 | 自動驗證結果 | 佐證 |
| --- | --- | --- |
| C-01 新增真空式脫脂設備 | 通過 | 建立 `QA-MCH-VAC-A001`，`listMachines()` 與 `listFurnaceProfiles()` 可查到真空設備與 5 層、每層 2 位置 profile。 |
| C-03 新增正常品項 | 通過 | `calculateVacuumLayout()` 讀到 `QA-SPEC-A001`，數量 240 轉為 4 tray positions，需求高度 44 mm，墊塊規則為 `recommended`。 |
| C-04 建立推薦 | 通過 | 240 + 60 兩筆品項產生可行推薦，裝載率 50%，推薦分數 78，層位建議 5 筆，沒有 conflicts。 |
| C-05 儲存批次 | 通過 | 儲存 `QA-BATCH-VAC-A001`，列表可查到 1 筆，批次含 2 品項，並自動建立 1 筆 selected layout plan。 |
| C-06 超出容量 | 通過 | 數量 1200 產生 20 positions，設備容量 10 positions，推薦回傳不可行並說明容量不足。 |
| C-07 未設定治具規則 | 通過 | 無規則產品可取得 fallback support options，推薦計算未崩潰，結果可行且無 conflicts。 |
| C-08 高度超限 | 通過 | 高度 120 mm 對上層高限制 80 mm，推薦回傳不可行，item analysis 標示 `height_fits=false`。 |
| C-09 報表查詢資料源 | 通過 | `listVacuumBatches()` 以批號與日期區間查到 `QA-BATCH-VAC-A001`、爐號 `QA-MCH-VAC-A001`、品項數 2。 |
| C-10 重新開啟持久性 | 通過 | 關閉 DB 後用同一 SQLite 檔重新 `init()`，仍可查到 `QA-BATCH-VAC-A001`。 |

## 失敗/風險項目

| 項目 | 結論 | 風險 |
| --- | --- | --- |
| C-02 未選設備直接建立排程 | 風險/不符合藍圖預期 | `createVacuumBatch()` 在沒有 `vacuum_machine_id` 時仍會建立批次，且回傳批次的 `vacuum_machine_id` 為 `null`。藍圖預期應阻擋並提示需選擇真空式脫脂爐。 |
| UI 實際點擊流程 | 未自動執行 | 本次未啟動 Electron 視窗逐步點擊，因此未驗證 toast 文字、實際畫面列表刷新、重開桌面 App 後畫面是否同步顯示。 |
| 切換設備後舊推薦清除/重新計算 | 未完整自動驗證 | 程式碼閱讀可見切換設備會更新選取與 detail，但本次沒有透過 UI 自動點擊確認畫面狀態與舊推薦視覺清除。 |

## 可重現步驟

1. 使用 Electron Node runtime，避免 `better-sqlite3` ABI 不相容：

   ```powershell
   $env:ELECTRON_RUN_AS_NODE='1'
   ```

2. 建立臨時 DB 並初始化 `DatabaseService`：

   ```javascript
   const { DatabaseService, MACHINE_TYPES } = require('./database.js');
   const db = new DatabaseService({ dbPath: '<temp>/route-c-vacuum.db', logger }).init();
   ```

3. 建立測試資料：

   - 真空設備：`QA-MCH-VAC-A001`
   - 爐體 profile：5 層、每層 2 位置、base layer gap 80 mm
   - 治具：托盤、陶瓷盤、腳座、墊塊
   - 正常作業標準：`QA-SPEC-A001`
   - 無治具規則作業標準：`QA-SPEC-NORULE`
   - 高度超限作業標準：`QA-SPEC-HIGH`

4. 執行推薦與儲存檢查：

   ```javascript
   db.calculateVacuumLayout({ items: [{ product_id: product.id, quantity: 240 }] });
   db.createVacuumBatch({
     batch_no: 'QA-BATCH-VAC-A001',
     vacuum_machine_id: machine.id,
     planned_date: '2026-05-14',
     operator_name: 'QA Tester',
     items: [
       { product_id: product.id, quantity: 240 },
       { product_id: product.id, quantity: 60 }
     ]
   });
   db.listVacuumBatches({ batch_no: 'QA-BATCH-VAC-A001' });
   db.listVacuumLayoutPlans(batch.id);
   ```

5. 執行例外檢查：

   ```javascript
   db.calculateVacuumLayout({ items: [{ product_id: product.id, quantity: 1200 }] });
   db.calculateVacuumLayout({ items: [{ product_id: highProduct.id, quantity: 60 }] });
   db.getSupportBlockOptionsForProduct(noRuleProduct.id, { fixture_type: 'support_block' });
   db.createVacuumBatch({
     batch_no: 'QA-BATCH-VAC-NOMACHINE',
     planned_date: '2026-05-14',
     operator_name: 'QA Tester',
     items: [{ product_id: product.id, quantity: 60 }]
   });
   ```

## 建議後續

1. 釐清 C-02 的產品規則：如果藍圖要求「一定要選真空式脫脂爐」，建議在 `createVacuumBatch()` 加上 `vacuum_machine_id` 必填檢查，或至少在 UI 層避免送出空值並顯示中文提示。
2. 補一條 UI 自動化或人工驗證：啟動 Electron 後逐步確認設備卡、品項 hint、推薦細節、toast、批次列表、報表頁顯示。
3. 對容量與高度不可行情境，建議確認 UI 是否把 `conflicts` 顯示成現場人員看得懂的中文；目前資料庫層回傳的是英文限制原因。
4. 若 Route D 共用 structured batch 行為，建議共用同一套「必選設備」、「不可行仍可否儲存」的規則決策，避免真空脫脂與燒結行為分歧。
