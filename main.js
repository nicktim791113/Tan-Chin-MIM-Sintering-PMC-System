const path = require("node:path");
const fs = require("node:fs");
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const xlsx = require("xlsx");
const log = require("electron-log/main");
const { autoUpdater } = require("electron-updater");
const { DatabaseService } = require("./database");
const { startServer } = require("./server");

let mainWindow = null;
let database = null;
let serverHandle = null;

function pushToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function configureLogging() {
  log.initialize();
  log.transports.file.level = "info";
  log.transports.console.level = "info";
}

function configureAutoUpdater() {
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;

  autoUpdater.on("checking-for-update", () => {
    pushToRenderer("app:update-status", {
      state: "checking",
      message: "Checking for updates."
    });
  });

  autoUpdater.on("update-available", (info) => {
    pushToRenderer("app:update-status", {
      state: "available",
      version: info.version,
      message: "Update is available."
    });
  });

  autoUpdater.on("update-not-available", () => {
    pushToRenderer("app:update-status", {
      state: "idle",
      message: "System is up to date."
    });
  });

  autoUpdater.on("update-downloaded", async (info) => {
    pushToRenderer("app:update-status", {
      state: "downloaded",
      version: info.version,
      message: "Update downloaded. Ready to install."
    });

    if (mainWindow) {
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: "info",
        buttons: ["立即重啟並安裝 (Restart Now)", "稍後安裝 (Later)"],
        title: "軟體更新下載完成",
        message: "最新的系統版本已經下載完畢，強烈建議您立即重啟以套用更新。\n是否要立即重新啟動應用程式？",
        cancelId: 1
      });
      if (response === 0) {
        setImmediate(() => autoUpdater.quitAndInstall());
      }
    }
  });

  autoUpdater.on("error", (error) => {
    const message = String(error?.message || error || "");
    const isOfflineError =
      message.includes("ERR_INTERNET_DISCONNECTED") ||
      message.includes("ERR_NETWORK_IO_SUSPENDED") ||
      message.includes("ERR_NAME_NOT_RESOLVED") ||
      message.includes("net::ERR_INTERNET_DISCONNECTED");

    if (isOfflineError) {
      log.info("[updater] internet disconnected, skipping update check.");
      pushToRenderer("app:update-status", {
        state: "offline",
        message: "Update check skipped because the device is offline."
      });
      return;
    }

    log.error("[updater] update error", error);
    pushToRenderer("app:update-status", {
      state: "error",
      message: "Update service encountered an error."
    });
  });
}

function registerHandler(channel, callback) {
  ipcMain.handle(channel, async (_event, payload) => {
    try {
      return await callback(payload);
    } catch (error) {
      log.error(`[ipc] ${channel} failed`, error);
      if (database) {
        database.logSystemEvent("error", "ipc", channel, error.message || "IPC request failed.", {
          payload
        });
      }
      throw new Error(error.message || "Request failed.");
    }
  });
}

function registerIpcHandlers() {
  registerHandler("dashboard:getSummary", () => database.getDashboardSummary());

  registerHandler("machines:list", (payload = {}) => database.listMachines(payload));
  registerHandler("machines:create", (payload = {}) => {
    const machine = database.createMachine(payload);
    pushToRenderer("app:data-changed", { scope: "machines", action: "create", machine });
    return machine;
  });
  registerHandler("machines:update", (payload = {}) => {
    const machine = database.updateMachine(Number(payload.id), payload);
    pushToRenderer("app:data-changed", { scope: "machines", action: "update", machine });
    return machine;
  });

  registerHandler("furnaces:listProfiles", (payload = {}) => database.listFurnaceProfiles(payload));
  registerHandler("furnaces:saveProfile", (payload = {}) => {
    const profile = database.upsertFurnaceProfile(Number(payload.machineId || payload.machine_id), payload);
    pushToRenderer("app:data-changed", { scope: "furnaces", action: "profile-upsert", profile });
    return profile;
  });

  registerHandler("degreasing:createBatch", (payload = {}) => {
    const result = database.createDegreasingBatch(payload);
    pushToRenderer("app:data-changed", { scope: "degreasing", action: "batch-create", result });
    return result;
  });
  registerHandler("degreasing:createBatchBulk", (payload = {}) => {
    const result = database.createDegreasingBatchBulk(payload);
    pushToRenderer("app:data-changed", { scope: "degreasing", action: "batch-bulk-create", result });
    return result;
  });
  registerHandler("degreasing:listBatches", (payload = {}) => database.listDegreasingBatches(payload));
  registerHandler("degreasing:changeSolvent", (payload = {}) => {
    const result = database.changeSolvent(payload);
    pushToRenderer("app:data-changed", { scope: "degreasing", action: "solvent-change", result });
    return result;
  });
  registerHandler("degreasing:changeSolventBulk", (payload = {}) => {
    const result = database.changeSolventBulk(payload);
    pushToRenderer("app:data-changed", { scope: "degreasing", action: "solvent-change-bulk", result });
    return result;
  });
  registerHandler("degreasing:listSolventChanges", (payload = {}) =>
    database.listSolventChangeLogs(payload)
  );

  registerHandler("products:list", (payload = {}) => database.listProducts(payload));
  registerHandler("products:create", (payload = {}) => {
    const product = database.createProduct(payload);
    pushToRenderer("app:data-changed", { scope: "products", action: "create", product });
    return product;
  });
  registerHandler("products:update", (payload = {}) => {
    const product = database.updateProduct(Number(payload.id), payload);
    pushToRenderer("app:data-changed", { scope: "products", action: "update", product });
    return product;
  });
  registerHandler("products:dispose", (payload = {}) => {
    const result = database.disposeProduct(Number(payload.id));
    pushToRenderer("app:data-changed", { scope: "products", action: result.action, result });
    return result;
  });
  registerHandler("products:restore", (payload = {}) => {
    const result = database.restoreProduct(Number(payload.id));
    pushToRenderer("app:data-changed", { scope: "products", action: result.action, result });
    return result;
  });
  registerHandler("productMasters:list", (payload = {}) => database.listProductMasters(payload));
  registerHandler("productMasters:create", (payload = {}) => {
    const productMaster = database.createProductMaster(payload);
    pushToRenderer("app:data-changed", { scope: "product-masters", action: "create", productMaster });
    return productMaster;
  });
  registerHandler("productMasters:update", (payload = {}) => {
    const productMaster = database.updateProductMaster(Number(payload.id), payload);
    pushToRenderer("app:data-changed", { scope: "product-masters", action: "update", productMaster });
    return productMaster;
  });
  registerHandler("productMasters:dispose", (payload = {}) => {
    const result = database.disposeProductMaster(Number(payload.id));
    pushToRenderer("app:data-changed", { scope: "product-masters", action: result.action, result });
    return result;
  });
  registerHandler("productMasters:restore", (payload = {}) => {
    const result = database.restoreProductMaster(Number(payload.id));
    pushToRenderer("app:data-changed", { scope: "product-masters", action: result.action, result });
    return result;
  });

  registerHandler("supportBlocks:list", (payload = {}) => database.listSupportBlocks(payload));
  registerHandler("supportBlocks:create", (payload = {}) => {
    const supportBlock = database.createSupportBlock(payload);
    pushToRenderer("app:data-changed", { scope: "support-blocks", action: "create", supportBlock });
    return supportBlock;
  });
  registerHandler("supportBlocks:update", (payload = {}) => {
    const supportBlock = database.updateSupportBlock(Number(payload.id), payload);
    pushToRenderer("app:data-changed", { scope: "support-blocks", action: "update", supportBlock });
    return supportBlock;
  });
  registerHandler("supportBlocks:listRelations", (payload = {}) =>
    database.listSupportBlockRelations(payload)
  );
  registerHandler("supportBlocks:replaceRulesForProduct", (payload = {}) => {
    const rules = database.replaceSupportBlockRulesForProduct(
      Number(payload.product_id || payload.productId),
      payload.rules || []
    );
    pushToRenderer("app:data-changed", {
      scope: "support-block-rules",
      action: "replace",
      productId: Number(payload.product_id || payload.productId)
    });
    return rules;
  });
  registerHandler("supportBlocks:getOptionsForProduct", (payload = {}) =>
    database.getSupportBlockOptionsForProduct(Number(payload.product_id || payload.productId), payload)
  );

  registerHandler("sintering:calculateLayout", (payload = {}) => database.calculateSinteringLayout(payload));
  registerHandler("sintering:createBatch", (payload = {}) => {
    const batch = database.createSinteringBatch(payload);
    pushToRenderer("app:data-changed", { scope: "sintering", action: "batch-create", batch });
    return batch;
  });
  registerHandler("sintering:listBatches", (payload = {}) => database.listSinteringBatches(payload));
  registerHandler("sintering:listLayoutPlans", (payload = {}) =>
    database.listLayoutPlans(Number(payload.batchId))
  );
  registerHandler("vacuum:calculateLayout", (payload = {}) => database.calculateVacuumLayout(payload));
  registerHandler("vacuum:createBatch", (payload = {}) => {
    const batch = database.createVacuumBatch(payload);
    pushToRenderer("app:data-changed", { scope: "vacuum", action: "batch-create", batch });
    return batch;
  });
  registerHandler("vacuum:listBatches", (payload = {}) => database.listVacuumBatches(payload));
  registerHandler("vacuum:listLayoutPlans", (payload = {}) =>
    database.listVacuumLayoutPlans(Number(payload.batchId))
  );

  registerHandler("reports:getSnapshot", (payload = {}) => ({
    degreasing_batches: database.listDegreasingBatches(payload),
    solvent_change_logs: database.listSolventChangeLogs(payload),
    vacuum_batches: database.listVacuumBatches(payload),
    sintering_batches: database.listSinteringBatches(payload)
  }));

  registerHandler("reports:export", async (payload = {}) => {
    const filters = payload.filters || {};
    const format = payload.format === "csv" ? "csv" : "excel";

    const snapshot = {
      degreasing: database.listDegreasingBatches(filters) || [],
      solvent: database.listSolventChangeLogs(filters) || [],
      vacuum: database.listVacuumBatches(filters) || [],
      sintering: database.listSinteringBatches(filters) || []
    };

    const mapDegreasing = snapshot.degreasing.map(r => ({
      "作業時間 (Operated At)": r.operated_at || "",
      "預計結束時間 (Ended At)": r.ended_at || "",
      "設備代碼 (Machine Code)": r.machine_code || "",
      "設備名稱 (Machine Name)": r.machine_name || "",
      "產品編號 (Part No)": r.part_no || "",
      "產品名稱 (Product Name)": r.product_name || "",
      "數量 (Quantity)": r.quantity_pcs !== null ? r.quantity_pcs : "",
      "投入重量 (Input Weight)": r.input_weight || 0,
      "作業人員 (Operator)": r.operator_name || "",
      "批次號 (Batch No)": r.batch_no || "",
      "製令編號 (Work Order)": r.work_order_no || "",
      "品項備註 (Item Notes)": r.item_notes || "",
      "作業備註 (Batch Notes)": r.notes || ""
    }));

    const mapSolvent = snapshot.solvent.map(r => ({
      "更換時間 (Changed At)": r.changed_at || "",
      "設備代碼 (Machine Code)": r.machine_code || "",
      "設備名稱 (Machine Name)": r.machine_name || "",
      "更換前累積重量 (Prev Accum Weight)": r.previous_accum_weight || 0,
      "作業人員 (Operator)": r.operator_name || "",
      "備註 (Notes)": r.notes || ""
    }));

    const mapVacuum = snapshot.vacuum.map(r => ({
      "計畫日期 (Planned Date)": r.planned_date || "",
      "爐號 (Machine Code)": r.vacuum_machine_code || r.machine_code || "",
      "爐號名稱 (Machine Name)": r.vacuum_machine_name || r.machine_name || "",
      "批次號 (Batch No)": r.batch_no || "",
      "狀態 (Status)": r.status || "",
      "預估裝載率 (Estimated Load)": r.estimated_load_rate !== null ? `${r.estimated_load_rate}%` : "-",
      "作業人員 (Operator)": r.operator_name || "",
      "備註 (Notes)": r.notes || ""
    }));

    const mapSintering = snapshot.sintering.map(r => ({
      "計畫日期 (Planned Date)": r.planned_date || "",
      "爐號 (Machine Code)": r.furnace_machine_code || r.machine_code || "",
      "爐號名稱 (Machine Name)": r.furnace_machine_name || r.machine_name || "",
      "批次號 (Batch No)": r.batch_no || "",
      "狀態 (Status)": r.status || "",
      "預估裝載率 (Estimated Load)": r.estimated_load_rate !== null ? `${r.estimated_load_rate}%` : "-",
      "作業人員 (Operator)": r.operator_name || "",
      "備註 (Notes)": r.notes || ""
    }));

    const wb = xlsx.utils.book_new();

    const wsDegreasing = xlsx.utils.json_to_sheet(mapDegreasing);
    const wsSolvent = xlsx.utils.json_to_sheet(mapSolvent);
    const wsVacuum = xlsx.utils.json_to_sheet(mapVacuum);
    const wsSintering = xlsx.utils.json_to_sheet(mapSintering);

    xlsx.utils.book_append_sheet(wb, wsDegreasing, "浸泡式脫脂");
    xlsx.utils.book_append_sheet(wb, wsSolvent, "溶劑更換");
    xlsx.utils.book_append_sheet(wb, wsVacuum, "真空式脫脂");
    xlsx.utils.book_append_sheet(wb, wsSintering, "真空式燒結");

    const defaultExt = format === "csv" ? "csv" : "xlsx";
    const defaultName = `報表匯出_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.${defaultExt}`;

    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: `匯出 ${format.toUpperCase()} 報表`,
      defaultPath: path.join(app.getPath("documents"), defaultName),
      filters: format === "csv" 
        ? [{ name: "CSV Files", extensions: ["csv"] }]
        : [{ name: "Excel Workbooks", extensions: ["xlsx"] }]
    });

    if (canceled || !filePath) {
      throw new Error("canceled");
    }

    if (format === "csv") {
      const csvStr1 = "==== 浸泡式脫脂 (Degreasing) ====\n" + xlsx.utils.sheet_to_csv(wsDegreasing);
      const csvStr2 = "\n==== 溶劑更換 (Solvent Changes) ====\n" + xlsx.utils.sheet_to_csv(wsSolvent);
      const csvStr3 = "\n==== 真空式脫脂 (Vacuum Batches) ====\n" + xlsx.utils.sheet_to_csv(wsVacuum);
      const csvStr4 = "\n==== 真空式燒結 (Sintering Batches) ====\n" + xlsx.utils.sheet_to_csv(wsSintering);
      const outputStr = "\uFEFF" + csvStr1 + csvStr2 + csvStr3 + csvStr4; // UTF-8 BOM
      fs.writeFileSync(filePath, outputStr, "utf8");
    } else {
      xlsx.writeFile(wb, filePath);
    }

    return true;
  });

  registerHandler("system:listLogs", (payload = {}) => database.listSystemLogs(payload));
  registerHandler("server:getMeta", () => ({
    host: serverHandle?.host || "0.0.0.0",
    port: serverHandle?.port || 3186
  }));

  registerHandler("settings:getSettings", () => ({
    api_key_enabled: database.getMeta("api_key_enabled") === "1",
    api_key_token: database.getMeta("api_key_token") || "",
    degreasing_time_offset: Number(database.getMeta("degreasing_time_offset") || 8)
  }));

  registerHandler("settings:saveSettings", (payload = {}) => {
    if (typeof payload.api_key_enabled !== "undefined") {
      database.setMeta("api_key_enabled", payload.api_key_enabled ? "1" : "0");
    }
    if (typeof payload.api_key_token !== "undefined") {
      database.setMeta("api_key_token", payload.api_key_token);
    }
    if (typeof payload.degreasing_time_offset !== "undefined") {
      database.setMeta("degreasing_time_offset", String(payload.degreasing_time_offset));
    }
    return true;
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1260,
    minHeight: 840,
    backgroundColor: "#f4f6f2",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function bootstrap() {
  configureLogging();
  configureAutoUpdater();

  process.on("uncaughtException", (error) => {
    log.error("[process] uncaughtException", error);
  });

  process.on("unhandledRejection", (reason) => {
    log.error("[process] unhandledRejection", reason);
  });

  const dbPath = path.join(app.getPath("userData"), "pmc-system.db");
  database = new DatabaseService({ dbPath, logger: log }).init();
  registerIpcHandlers();
  createWindow();
  serverHandle = await startServer({
    db: database,
    mainWindow,
    logger: log,
    port: 3186
  });

  pushToRenderer("app:update-status", {
    state: "ready",
    message: "Desktop system initialized."
  });

  if (app.isPackaged && process.env.PMC_ENABLE_AUTO_UPDATE === "1") {
    try {
      await autoUpdater.checkForUpdatesAndNotify();
    } catch (error) {
      log.error("[updater] initial check failed", error);
    }
  }
}

async function shutdown() {
  if (serverHandle?.server) {
    await new Promise((resolve) => serverHandle.server.close(resolve));
    serverHandle = null;
  }

  if (database) {
    database.close();
    database = null;
  }
}

app.whenReady().then(bootstrap).catch((error) => {
  log.error("[app] bootstrap failed", error);
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  ipcMain.removeHandler("dashboard:getSummary");
});

app.on("will-quit", () => {
  shutdown().catch((error) => {
    log.error("[app] shutdown failed", error);
  });
});
