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
http://主機IP:3186/web/
```

## 版本規則

- 版面調整或文案名稱修改：調整 patch，例如 `1.1.1`。
- 單一運作邏輯修改：調整 minor，並歸零 patch，例如 `1.2.0`。
- 多重運作邏輯或大範圍修改：調整 major，並歸零後段，例如 `2.0.0`。
