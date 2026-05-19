# 路線 B：設備、浸泡式脫脂與溶劑更換驗證

執行日期：2026-05-14  
執行者：Codex  
驗證範圍：`docs/development-notes/五路線系統驗證藍圖.md` 的「路線 B：設備、浸泡式脫脂與溶劑更換驗證」

## 測試範圍

- 設備設定：新增、編輯狀態、依 `machine_type=degreasing_immersion` 分表查詢與排序。
- 浸泡式脫脂投入：未選設備阻擋、單台投入、多台設備 bulk 投入、停用設備阻擋。
- 溶劑更換：未選設備阻擋、建立更換紀錄、關聯設備、重設累積重量與警示狀態。
- 儀表板資料源：浸泡式設備狀態、最近浸泡投入、最近溶劑更換。
- 查詢報表資料源：日期、批號與設備篩選可查到投入與更換紀錄。
- API 路由：`/api/machines`、`/api/dashboard`、`/api/reports/snapshot` 以同一暫存 DB 回傳路線 B 資料。

## 執行方式

本次沒有修改正式功能程式碼，也沒有寫入正式 DB。驗證使用 `%TEMP%` 內的臨時 SQLite 檔，結束後刪除。

執行過的主要檢查：

```powershell
$env:ELECTRON_RUN_AS_NODE='1'
.\node_modules\.bin\electron.cmd - <inline route-b validation script>
```

驗證腳本使用：

- `DatabaseService({ dbPath: <TEMP>/route-b-validation.db })`
- `db.createMachine()`
- `db.updateMachine()`
- `db.createDegreasingBatch()`
- `db.createDegreasingBatchBulk()`
- `db.changeSolvent()`
- `db.changeSolventBulk()`
- `db.getDashboardSummary()`
- `db.listDegreasingBatches()`
- `db.listSolventChangeLogs()`
- `startServer()` 啟動臨時 Express API，使用隨機本機 port。

補充檢查：

```powershell
$env:ELECTRON_RUN_AS_NODE='1'
.\node_modules\.bin\electron.cmd --check database.js
.\node_modules\.bin\electron.cmd --check server.js
.\node_modules\.bin\electron.cmd --check main.js
.\node_modules\.bin\electron.cmd --check preload.js
```

結果：以上 CommonJS 入口與後端檔案語法檢查通過，`require('./database')` 與 `require('./server')` 也可正常載入。

未採用一般 `node` 執行的原因：`better-sqlite3` 目前是 Electron ABI `NODE_MODULE_VERSION 133`，系統 Node.js 需要 `NODE_MODULE_VERSION 127`，直接用 `node` 會出現 ABI 不相容錯誤。因此改用 `ELECTRON_RUN_AS_NODE=1` 的 Electron runtime。

`renderer-scripts/degreasing.js`、`renderer-scripts/solvent.js`、`renderer-scripts/reports.js`、`renderer-scripts/machines.js` 未用 `electron --check` 判定，因為 root `package.json` 是 `commonjs`，這些檔案是瀏覽器端 ES module，直接用 CommonJS 語法檢查會因 `import` 報錯，不能代表實際瀏覽器載入失敗。

## 通過項目

| 藍圖步驟 | 自動驗證結果 | 佐證 |
| --- | --- | --- |
| B-01 新增浸泡式脫脂設備 | 通過 | 建立 `QA-MCH-DEG-A001`，`listMachines({ machine_type: "degreasing_immersion" })` 可查到設備名稱 `驗證浸泡脫脂槽 A`。 |
| B-02 新增第二台浸泡式脫脂設備 | 通過 | 建立 `QA-MCH-DEG-A002`，同類型查詢得到 2 台 QA 設備，排序為 `QA-MCH-DEG-A001,QA-MCH-DEG-A002`。 |
| B-03 將其中一台改為停用 | 通過 | `updateMachine()` 將 `QA-MCH-DEG-A002` 改為 `inactive`，重新讀取狀態正確。 |
| B-04 浸泡式脫脂未選設備送出 | 通過 | `createDegreasingBatchBulk({ machine_ids: [] })` 拋出 `At least one machine must be selected.`，未建立紀錄。 |
| B-05 選擇啟用設備建立投入 | 通過 | `QA-DEG-BATCH-A001` 建立成功，報表查詢可查到 `QA-SPEC-A001`，設備累積重量更新為 35 kg。 |
| B-06 多選兩台啟用設備送出 | 通過 | `createDegreasingBatchBulk()` 回傳 `machine_count=2`，查詢 `QA-DEG-BATCH-A002` 得到 2 筆、分屬 2 台設備，未漏寫或重複寫入同設備。 |
| B-07 嘗試用停用設備投入 | 通過 | `QA-MCH-DEG-A002` 停用後，`createDegreasingBatch()` 拋出 `Selected machine is not active.`。 |
| B-08 溶劑更換未選設備送出 | 通過 | `changeSolventBulk({ machine_ids: [] })` 拋出 `At least one machine must be selected.`，未建立紀錄。 |
| B-09 選擇設備新增溶劑更換 | 通過 | `changeSolvent()` 建立 `change_log_id=1`，更換前累積重量為 47 kg；更換後設備累積重量歸零、`alert_state=normal`。 |
| B-10 儀表板查看最新狀態 | 通過 | `getDashboardSummary()` 回傳浸泡式設備 12 台、最近投入 3 筆、最近溶劑更換 1 筆，包含本輪 QA 資料。 |
| B-11 查詢報表日期與設備篩選 | 通過 | `listDegreasingBatches()` 以 2026-05-14、設備與批號篩選查到 `QA-DEG-BATCH-A001/A002`；`listSolventChangeLogs()` 查到 `穩定性驗證`。 |
| API 資料源 | 通過 | 臨時 API `GET /api/machines`、`GET /api/dashboard`、`GET /api/reports/snapshot` 均回 200，且包含 route B QA 資料。 |

## 失敗/風險項目

| 項目 | 結論 | 風險 |
| --- | --- | --- |
| UI 實際點擊流程 | 未自動執行 | 本次未啟動 Electron 視窗逐步點擊，因此未驗證畫面卡片、列表分頁、toast 文案、按鈕狀態與實際刷新動畫。 |
| 停用設備在作業卡片的視覺狀態 | 風險 | 後端會阻擋停用設備投入，但 `renderer-scripts/degreasing.js` 與 `renderer-scripts/solvent.js` 的 `getMachines()` 只依 `machine_type` 過濾，未排除 `status !== "active"`；停用設備可能仍可被選取，送出後才由後端擋下。 |
| 溶劑更換停用設備限制 | 待釐清 | `changeSolvent()` 只驗證設備存在且類型為浸泡式脫脂，未檢查 `status === "active"`。藍圖 B-07 明確要求投入停用設備應阻擋，但對溶劑更換停用設備沒有明確規則；若現場不應操作停用設備，需補規則。 |
| 前端 ES module 語法檢查 | 未以 `electron --check` 自動判定 | root `package.json` 為 `commonjs`，直接檢查瀏覽器端 `import` 檔會誤報；需透過 Vite/browser 或 Electron UI 載入驗證。 |
| 建置檢查 | 未執行 | 為避免覆蓋 `assets/css/tailwind.css`、`web-client/dist` 或其他 Agent 產物，本輪未跑會寫入專案輸出檔的 build。 |

## 可重現步驟

以下步驟使用暫存資料庫，不會碰正式資料庫。

1. 使用 Electron Node runtime，避免 `better-sqlite3` ABI 不相容：

   ```powershell
   $env:ELECTRON_RUN_AS_NODE='1'
   ```

2. 建立臨時 DB 並初始化：

   ```javascript
   const { DatabaseService } = require('./database.js');
   const db = new DatabaseService({ dbPath: '<temp>/route-b-validation.db', logger });
   db.init();
   ```

3. 建立兩台浸泡式脫脂設備：

   ```javascript
   const machineA = db.createMachine({
     machine_code: 'QA-MCH-DEG-A001',
     machine_name: '驗證浸泡脫脂槽 A',
     machine_type: 'degreasing_immersion',
     status: 'active',
     solvent_weight_limit: 100
   });

   const machineB = db.createMachine({
     machine_code: 'QA-MCH-DEG-A002',
     machine_name: '驗證浸泡脫脂槽 B',
     machine_type: 'degreasing_immersion',
     status: 'active',
     solvent_weight_limit: 120
   });
   ```

4. 驗證設備分表、排序與停用：

   ```javascript
   db.listMachines({ machine_type: 'degreasing_immersion' });
   db.updateMachine(machineB.id, { status: 'inactive' });
   ```

5. 驗證未選設備不可建立浸泡投入：

   ```javascript
   db.createDegreasingBatchBulk({
     machine_ids: [],
     operator_name: 'QA Tester',
     items: [{ part_no: 'QA-SPEC-A001', input_weight: 10 }]
   });
   ```

6. 建立單台投入：

   ```javascript
   db.createDegreasingBatch({
     machine_id: machineA.id,
     batch_no: 'QA-DEG-BATCH-A001',
     operator_name: 'QA Tester',
     operated_at: '2026-05-14T09:30:00.000',
     items: [
       {
         part_no: 'QA-SPEC-A001',
         product_name: 'Route B test product',
         work_order_no: 'QA-WO-DEG-A001',
         input_weight: 35,
         quantity_pcs: 100
       }
     ]
   });
   ```

7. 將第二台改回啟用後，建立兩台 bulk 投入：

   ```javascript
   db.updateMachine(machineB.id, { status: 'active' });
   db.createDegreasingBatchBulk({
     machine_ids: [machineA.id, machineB.id],
     batch_no: 'QA-DEG-BATCH-A002',
     operator_name: 'QA Tester',
     operated_at: '2026-05-14T10:00:00.000',
     items: [{ part_no: 'QA-SPEC-A001', input_weight: 12 }]
   });
   ```

8. 將第二台停用並驗證不能投入：

   ```javascript
   db.updateMachine(machineB.id, { status: 'inactive' });
   db.createDegreasingBatch({
     machine_id: machineB.id,
     batch_no: 'QA-DEG-BATCH-INACTIVE',
     operator_name: 'QA Tester',
     operated_at: '2026-05-14T09:30:00.000',
     items: [{ part_no: 'QA-SPEC-A001', input_weight: 5 }]
   });
   ```

9. 驗證未選設備不可建立溶劑更換：

   ```javascript
   db.changeSolventBulk({
     machine_ids: [],
     operator_name: 'QA Tester',
     changed_at: '2026-05-14T09:30:00.000',
     notes: '穩定性驗證'
   });
   ```

10. 建立溶劑更換並確認設備重設：

    ```javascript
    db.changeSolvent({
      machine_id: machineA.id,
      operator_name: 'QA Tester',
      changed_at: '2026-05-14T11:00:00.000',
      notes: '穩定性驗證'
    });
    db.getMachineById(machineA.id);
    db.listSolventChangeLogs({
      machine_id: machineA.id,
      date_from: '2026-05-14',
      date_to: '2026-05-14'
    });
    ```

11. 驗證儀表板與報表資料源：

    ```javascript
    db.getDashboardSummary();
    db.listDegreasingBatches({
      machine_id: machineA.id,
      date_from: '2026-05-14',
      date_to: '2026-05-14',
      batch_no: 'QA-DEG-BATCH'
    });
    db.listSolventChangeLogs({
      machine_id: machineA.id,
      date_from: '2026-05-14',
      date_to: '2026-05-14'
    });
    ```

12. 啟動臨時 API 並驗證：

    ```javascript
    const { startServer } = require('./server.js');
    const api = await startServer({ db, mainWindow: null, logger, port: 0, host: '127.0.0.1' });
    const base = `http://127.0.0.1:${api.server.address().port}/api`;
    await fetch(`${base}/machines?machine_type=degreasing_immersion`);
    await fetch(`${base}/dashboard`);
    await fetch(`${base}/reports/snapshot?date_from=2026-05-14&date_to=2026-05-14&machine_id=${machineA.id}`);
    ```

## 未自動執行項目

- 未自動點擊 Electron 桌面 UI 的 B-01 到 B-11 完整操作。
- 未留 UI 截圖。
- 未驗證 toast 文案是否與後端錯誤訊息完全一致。
- 未驗證停用設備卡片在 UI 上是否清楚標示、禁止點擊或只是在送出時被後端阻擋。
- 未驗證溶劑更換後 UI 是否即時刷新，不需切頁或重開。

原因：本輪以不修改正式功能、不碰正式資料庫、避免覆蓋建置產物為前提，穩定可自動化的範圍是本機資料層、暫存 SQLite 與臨時 Express API；Electron 視窗互動需另開 UI automation 才能取得可靠點擊、toast 與截圖證據。

## 建議後續

1. 釐清停用設備規則：若停用設備不應出現在浸泡投入/溶劑更換卡片，建議前端 `getMachines()` 過濾 `status === "active"`，或在卡片上禁用並明確標示原因。
2. 若停用設備也不應允許溶劑更換，建議在 `changeSolvent()` 與 `changeSolventBulk()` 加上 `status === "active"` 檢查，讓溶劑更換與投入規則一致。
3. 補一輪 Electron UI 自動化或人工驗證：逐步操作 B-01 到 B-11，補齊卡片狀態、toast、即時刷新、報表畫面與儀表板畫面截圖。
4. 若要補 build 驗證，建議使用暫存輸出目錄，例如 Vite `--outDir <TEMP>` 與 Tailwind `-o <TEMP>.css`，避免覆蓋其他 Agent 的 build 產物。
5. 將會直接顯示給現場使用者的後端錯誤訊息改為中文，至少涵蓋「未選設備」與「停用設備不可投入」兩類。
