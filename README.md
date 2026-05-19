# Tan-Chin-MIM-Sintering-PMC-System

Tan Chin MIM 脫脂 / 燒結整合監控系統。

本專案保留 Electron 桌面版，並開始加入內網瀏覽器版入口。桌面版與網頁版會優先共用同一份前端 renderer，讓後續版面、欄位、流程與文案能同步維護。

## 啟動

桌面版：

```powershell
npm start
```

只啟動內網 server：

```powershell
npm run server
```

網頁入口：

```text
http://目前電腦IP:3106/web/
```

`3106` 是網頁版 server-only 預設 port，`3105` 是桌面版內建 server 預設 port。若要改網頁版 port：

```powershell
$env:PMC_WEB_PORT="3000"
npm run server
```

若要改桌面版內建 server port：

```powershell
$env:PMC_DESKTOP_SERVER_PORT="3001"
npm start
```

## 文件

- [文件索引](docs/文件索引.md)
- [開始工作前工作守則](docs/development-notes/開始工作前工作守則-雙版本架構與網頁前端同步開發.md)
- [更新紀錄](docs/更新紀錄.md)
- [備份與還原指令](docs/備份與還原指令.md)

## 備份

```powershell
npm run backup
```

## 版本規則

- 版面調整或文案名稱修改：調整 patch，例如 `1.1.1`。
- 單一運作邏輯修改：調整 minor，並歸零 patch，例如 `1.2.0`。
- 多重運作邏輯或大範圍修改：調整 major，並歸零後段，例如 `2.0.0`。
