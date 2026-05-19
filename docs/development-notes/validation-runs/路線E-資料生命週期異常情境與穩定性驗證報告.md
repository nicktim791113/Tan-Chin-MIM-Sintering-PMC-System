# 路線 E：資料生命週期、異常情境與穩定性驗證

執行日期：2026-05-14 16:32 Asia/Taipei  
驗證人員：Codex  
驗證藍圖：`docs/development-notes/五路線系統驗證藍圖.md`，路線 E：資料生命週期、異常情境與穩定性驗證

## 測試範圍

本次依路線 E 的 E-01 至 E-15 逐項驗證，重點涵蓋：

- 產品主檔 / 作業標準與治具的重複資料阻擋。
- 已被歷史資料引用的產品作業標準封存與恢復。
- 設備停用後對新作業與歷史查詢的影響。
- 作業標準高度、單盤容量與治具狀態變更後，推薦與歷史批次的一致性。
- 搜尋、未來日期報表、重開資料庫、異常數字輸入、大量資料與系統資訊 API。

未自動執行：

- E-10「快速切換多個頁籤 20 次」需要實際 renderer/browser 互動與 console 觀察；本次只用本機程式碼、暫存資料庫、API 與建置命令驗證，未啟動 Electron UI 自動化。

## 執行方式

1. 閱讀路線 E 內容：
   - `docs/development-notes/五路線系統驗證藍圖.md` 第 313-365 行。
2. 程式碼檢查：
   - `database.js`：唯一索引、封存/恢復、設備狀態、報表日期篩選、系統紀錄。
   - `server.js`：`/api/health`、`/api/settings`、`/api/reports/snapshot`。
   - `renderer-scripts/app.js`、`renderer-scripts/products.js`、`renderer-scripts/machines.js`：refresh、表單與事件綁定位置。
3. 建置檢查：
   - `npm run build:web`：通過。
   - `npm run build:css`：通過；出現 Browserslist/caniuse-lite outdated 提示，不影響此次建置結果。
4. 暫存 DB/API 自動驗證：
   - 一般 `node` 執行 `DatabaseService` 時，因本機 Node `NODE_MODULE_VERSION 127` 與 `better-sqlite3` native module `NODE_MODULE_VERSION 133` 不一致而失敗。
   - 改用專案內 Electron ABI 執行：

```powershell
$env:ELECTRON_RUN_AS_NODE='1'
# 將驗證腳本透過 stdin 送入 .\node_modules\.bin\electron.cmd -
```

驗證腳本建立暫存資料庫於 `%TEMP%\mim-route-e-2026-05-14T08-32-13-002Z\pmc.db`，測完後清除。未使用正式 userData DB。

## 通過項目

| 項目 | 結果 | 驗證摘要 |
| --- | --- | --- |
| E-01 | 通過 | 重複產品主檔 / 規格代碼被阻擋，錯誤訊息為「此產品主檔已經有相同的作業標準代碼（規格代碼不能重複）。」 |
| E-02 | 通過 | 重複治具編號被 SQLite unique constraint 阻擋：`UNIQUE constraint failed: support_blocks.block_code` |
| E-03 | 通過 | 已被燒結批次引用的產品作業標準執行 `disposeProduct` 後為 `archived`，歷史燒結批次仍可查詢 |
| E-04 | 通過 | 封存的產品作業標準可由 `restoreProduct` 恢復為 `active` |
| E-05 | 通過 | 已有批次的設備改為 `inactive` 後，新浸泡式脫脂批次被阻擋，既有歷史批次仍可查 |
| E-06 | 通過 | 編輯單盤容量後，新推薦 tray count 從 2 變 4，既有燒結批次 item 保留原 tray count 2 |
| E-07 | 通過 | 治具停用後不再出現在後續可選推薦清單，既有歷史批次仍保留該治具 id |
| E-08 | 通過 | 不存在關鍵字搜尋產品與治具皆回傳 0 筆，未丟出例外 |
| E-09 | 通過 | 未來日期 `2099-01-01` 至 `2099-12-31` 報表篩選回傳 0 筆 |
| E-11 | 通過 | 儲存產品後立即用列表查詢可取得同筆資料 |
| E-12 | 通過 | 關閉並重新開啟同一 SQLite DB 後，已儲存資料仍存在 |
| E-13 | 通過 | 脫脂投入重量輸入負數被阻擋：`Input weight must be greater than 0 for all items.` |
| E-14 | 通過 | 暫存 DB 建立 50 筆產品、50 筆治具、20 筆燒結批次後，列表查詢筆數正確 |
| E-15 | 通過 | `/api/health`、`/api/settings`、`/api/reports/snapshot` 回傳 JSON 正常，未出現字串 `undefined` |

## 失敗 / 風險項目

| 項目 | 狀態 | 說明 |
| --- | --- | --- |
| E-10 | 未自動執行 | 快速切換頁籤 20 次需要 UI 自動化或人工操作觀察白屏、卡死、console error 與重複送出。本次 DB/API 驗證不能代表 renderer 事件監聽完全無重複綁定。 |
| 使用一般 `node` 跑資料層 | 風險 | 本機 Node 與 `better-sqlite3` native module ABI 不一致。實務驗證需使用 Electron ABI，或重建 native module 後再用 Node CLI。 |
| E-02 錯誤提示 | 低風險 | 後端目前直接暴露 SQLite unique constraint 文字，功能上會阻擋重複，但 UI 友善度可能不足。 |
| E-14 效能 | 低風險 | 已確認指定筆數可建立與查詢；本次未量測秒數、記憶體與 UI 捲動/頁籤切換體感。 |

## 可重現步驟

1. 在專案根目錄執行建置檢查：

```powershell
npm run build:web
npm run build:css
```

2. 使用 Electron ABI 執行暫存 DB 驗證：

```powershell
$env:ELECTRON_RUN_AS_NODE='1'
# 透過 stdin 將驗證腳本送入：
.\node_modules\.bin\electron.cmd -
```

3. 驗證腳本需建立：
   - 產品：`E-PROD-001`、`E-PROD-REFRESH`、`E-BULK-P-00` 至 `E-BULK-P-49`
   - 治具：`E-TRAY-001`、`E-SUP-001`、`E-CER-001`、`E-FOOT-001`、`E-BULK-F-00` 至 `E-BULK-F-49`
   - 批次：`E-SIN-001`、`E-DEG-001`、`E-BULK-SIN-00` 至 `E-BULK-SIN-19`
4. 驗證重點：
   - 重複建立 `E-PROD-001` / `A` 應失敗。
   - 重複建立 `E-SUP-001` 應失敗。
   - 已被批次引用的產品作業標準應封存，不應硬刪造成歷史批次消失。
   - 設備停用後新批次應被阻擋，歷史批次仍可查。
   - 修改產品單盤容量後，新推薦使用新值，歷史批次保留舊值。
   - 治具停用後不再列為後續可選，歷史批次仍保留治具資訊。
   - 未來日期報表與不存在關鍵字搜尋應回傳 0 筆而非錯誤。
   - 重開同一 DB 後資料仍可查。

## 建議後續

1. 補一條 UI 自動化或人工驗證紀錄給 E-10：快速切換主頁籤 20 次，觀察 console、白屏、卡頓與按一次儲存是否產生單筆資料。
2. 將重複治具編號的錯誤訊息轉成可讀中文，例如「治具編號不可重複」，避免直接顯示 SQLite constraint。
3. 若未來要把路線 E 變成常態 smoke test，建議新增專用驗證腳本並固定透過 Electron ABI 執行，或在安裝流程中確保 `better-sqlite3` 可被一般 Node CLI 載入。
4. 大量資料測試可延伸加入耗時量測與 UI 捲動/搜尋體感，補足目前 DB/API 層驗證無法代表的前端穩定性。
