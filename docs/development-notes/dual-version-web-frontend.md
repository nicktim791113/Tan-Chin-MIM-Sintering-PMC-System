# Tan-Chin-MIM-Sintering-PMC-System 雙版本網頁前端紀錄

建立日期：2026-05-19
版本起點：1.1.0

## 目標

本次調整不是淘汰 Electron 桌面版，而是讓桌面版與內網瀏覽器版同步開發：

- 桌面版保留原本 Electron 操作方式。
- 網頁版提供內網端瀏覽器入口。
- 兩邊優先共用同一份 `index.html`、`assets/`、`renderer-scripts/`。
- 後續版面、欄位、流程、文案修改，原則上先改共用 renderer，避免兩套 UI 分岔。
- 內網多人操作、帳號權限、報表匯出、ERP 串接、資料保留與備份會分階段補齊。

## 本次已落地的架構

桌面版仍由 `main.js` 建立 Electron 視窗並載入：

```text
file://.../index.html
```

網頁版改由 `server.js` 提供同一份畫面：

```text
http://主機IP:3186/web/
```

相關靜態資源由同一套來源提供：

```text
/web/assets/*
/web/renderer-scripts/*
```

瀏覽器沒有 Electron preload，所以 `renderer-scripts/api.js` 現在會自動判斷：

- 在桌面版：使用 `window.appApi` 走 IPC。
- 在網頁版：使用 `/api/*` 走 HTTP API。

## 新增或調整的後端入口

- `GET /web/`：載入與桌面版相同的 `index.html`。
- `GET /api/bootstrap`：回傳系統名稱、版本、API 路徑、web 入口等啟動資訊。
- `GET /api/system/meta`：提供目前 server host、port、版本。
- `GET /api/system/logs`：提供系統紀錄查詢。
- `POST /api/reports/export`：提供瀏覽器版 CSV / Excel 下載，對應桌面版原本的報表匯出按鈕。

## 啟動方式

桌面版：

```powershell
npm start
```

只啟動 server，不開 Electron 視窗：

```powershell
npm run server
```

此專案的 `better-sqlite3` native module 會跟 Electron ABI 綁定，所以 `npm run server` 會透過 Electron 的 Node runtime 執行，不建議直接用 `node server.js` 啟動。

若要指定內網綁定或 port：

```powershell
$env:PMC_SERVER_HOST="0.0.0.0"
$env:PMC_SERVER_PORT="3186"
npm run server
```

若要指定資料庫位置：

```powershell
$env:PMC_DB_PATH="C:\path\to\pmc-system.db"
npm run server
```

## 後續分階段工作

第一階段已先完成「同畫面網頁入口」。接下來建議依序補：

1. 帳號登入與角色權限：生產人員、高階主管、開發人員。
2. 操作紀錄與審核軌跡：多人操作前必須補足。
3. ERP 串接規格：先定義匯入工單、品號、製程資料與同步狀態。
4. 正式備份策略：資料庫、設定、報表、還原說明要一起保存。
5. LAN 上線檢查：固定主機 IP、防火牆、API Key 或登入機制。

## GitHub 注意事項

本機資料夾目前尚未是 Git repo。若要同步到：

```text
https://github.com/nicktim791113/Tan-Chin-MIM-Sintering-PMC-System
```

建議先確認遠端 repository 已建立，再初始化本機 Git、設定 `.gitignore`，並避免提交 `node_modules/`、`dist/`、資料庫與本機環境檔。
