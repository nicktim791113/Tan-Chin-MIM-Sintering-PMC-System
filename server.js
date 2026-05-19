const express = require("express");
const cors = require("cors");
const path = require("node:path");
const xlsx = require("xlsx");
const { DatabaseService } = require("./database");
const packageInfo = require("./package.json");

function normalizeError(error) {
  return {
    message: error?.message || "Unexpected server error."
  };
}

function buildPush(mainWindow) {
  return (channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload);
    }
  };
}

function buildSnapshot(db, filters = {}) {
  return {
    degreasing_batches: db.listDegreasingBatches(filters) || [],
    solvent_change_logs: db.listSolventChangeLogs(filters) || [],
    vacuum_batches: db.listVacuumBatches(filters) || [],
    sintering_batches: db.listSinteringBatches(filters) || []
  };
}

function mapRows(rows, columns) {
  return (rows || []).map((row) =>
    columns.reduce((record, column) => {
      const value = typeof column.value === "function" ? column.value(row) : row[column.value];
      record[column.label] = value ?? "";
      return record;
    }, {})
  );
}

function buildReportSheets(snapshot) {
  return [
    {
      name: "Degreasing",
      title: "Degreasing",
      rows: mapRows(snapshot.degreasing_batches, [
        { label: "Operated At", value: "operated_at" },
        { label: "Ended At", value: "ended_at" },
        { label: "Machine Code", value: "machine_code" },
        { label: "Machine Name", value: "machine_name" },
        { label: "Part No", value: "part_no" },
        { label: "Product Name", value: "product_name" },
        { label: "Quantity", value: "quantity_pcs" },
        { label: "Input Weight", value: "input_weight" },
        { label: "Operator", value: "operator_name" },
        { label: "Batch No", value: "batch_no" },
        { label: "Work Order", value: "work_order_no" },
        { label: "Notes", value: "notes" }
      ])
    },
    {
      name: "Solvent Changes",
      title: "Solvent Changes",
      rows: mapRows(snapshot.solvent_change_logs, [
        { label: "Changed At", value: "changed_at" },
        { label: "Machine Code", value: "machine_code" },
        { label: "Machine Name", value: "machine_name" },
        { label: "Previous Accum Weight", value: "previous_accum_weight" },
        { label: "Operator", value: "operator_name" },
        { label: "Notes", value: "notes" }
      ])
    },
    {
      name: "Vacuum Batches",
      title: "Vacuum Batches",
      rows: mapRows(snapshot.vacuum_batches, [
        { label: "Planned Date", value: "planned_date" },
        { label: "Machine Code", value: (row) => row.vacuum_machine_code || row.machine_code },
        { label: "Machine Name", value: (row) => row.vacuum_machine_name || row.machine_name },
        { label: "Batch No", value: "batch_no" },
        { label: "Status", value: "status" },
        { label: "Estimated Load Rate", value: "estimated_load_rate" },
        { label: "Operator", value: "operator_name" },
        { label: "Notes", value: "notes" }
      ])
    },
    {
      name: "Sintering Batches",
      title: "Sintering Batches",
      rows: mapRows(snapshot.sintering_batches, [
        { label: "Planned Date", value: "planned_date" },
        { label: "Machine Code", value: (row) => row.furnace_machine_code || row.machine_code },
        { label: "Machine Name", value: (row) => row.furnace_machine_name || row.machine_name },
        { label: "Batch No", value: "batch_no" },
        { label: "Status", value: "status" },
        { label: "Estimated Load Rate", value: "estimated_load_rate" },
        { label: "Operator", value: "operator_name" },
        { label: "Notes", value: "notes" }
      ])
    }
  ];
}

function buildWorkbook(snapshot) {
  const workbook = xlsx.utils.book_new();
  for (const sheet of buildReportSheets(snapshot)) {
    const worksheet = xlsx.utils.json_to_sheet(sheet.rows);
    xlsx.utils.book_append_sheet(workbook, worksheet, sheet.name);
  }
  return workbook;
}

function buildCsv(snapshot) {
  const blocks = buildReportSheets(snapshot).map((sheet) => {
    const worksheet = xlsx.utils.json_to_sheet(sheet.rows);
    return `==== ${sheet.title} ====\n${xlsx.utils.sheet_to_csv(worksheet)}`;
  });
  return `\uFEFF${blocks.join("\n")}`;
}

function buildStandaloneDbPath() {
  if (process.env.PMC_DB_PATH) {
    return process.env.PMC_DB_PATH;
  }

  const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || process.cwd(), "AppData", "Roaming");
  return path.join(appData, "Electron", "pmc-system.db");
}

function normalizeProfileFilters(query = {}) {
  if (Array.isArray(query.machineTypes)) {
    return query;
  }

  if (typeof query.machineTypes === "string" && query.machineTypes.trim()) {
    return {
      ...query,
      machineTypes: query.machineTypes.split(",").map((item) => item.trim()).filter(Boolean)
    };
  }

  return query;
}

function createApp({ db, mainWindow, logger, serverConfig = {} }) {
  const app = express();
  const pushToRenderer = buildPush(mainWindow);

  app.use(express.json({ limit: "2mb" }));
  app.use(cors());

  const rendererIndexPath = path.join(__dirname, "index.html");
  app.get(/^\/web$/, (_request, response) => response.redirect(302, "/web/"));
  app.use("/web/assets", express.static(path.join(__dirname, "assets")));
  app.use("/web/renderer-scripts", express.static(path.join(__dirname, "renderer-scripts")));
  app.get("/web/", (_request, response) => {
    response.sendFile(rendererIndexPath);
  });
  app.get("/web/*", (_request, response) => {
    response.sendFile(rendererIndexPath);
  });

  app.get("/", (req, res) => res.redirect("/web"));

  app.get("/api/bootstrap", (request, response) => {
    response.json({
      ok: true,
      name: packageInfo.name,
      productName: packageInfo.build?.productName || packageInfo.name,
      version: packageInfo.version,
      apiBasePath: "/api",
      webEntryPath: "/web/",
      host: serverConfig.host || request.hostname,
      port: serverConfig.port || request.socket.localPort,
      mode: mainWindow ? "desktop-server" : "server"
    });
  });

  app.get("/api/health", (_request, response) => {
    response.json({
      ok: true,
      timestamp: new Date().toISOString()
    });
  });

  app.use("/api", (request, response, next) => {
    const isEnabled = db.getMeta("api_key_enabled") === "1";
    if (isEnabled) {
      const expectedApiKey = db.getMeta("api_key_token") || "";
      const headerToken = request.headers["x-api-key"] || request.headers.authorization?.replace(/^Bearer\s+/i, "");
      
      if (!expectedApiKey || headerToken !== expectedApiKey) {
        logger.warn("[server] Unauthorized API attempt.", {
          path: request.path,
          ip: request.ip
        });
        return response.status(401).json({ message: "Unauthorized: Invalid or missing API Key." });
      }
    }
    next();
  });

  app.get("/api/dashboard", (_request, response) => {
    response.json(db.getDashboardSummary());
  });

  app.get("/api/machines", (request, response, next) => {
    try {
      response.json(db.listMachines(request.query));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/machines", (request, response, next) => {
    try {
      const machine = db.createMachine(request.body);
      pushToRenderer("app:data-changed", { scope: "machines", action: "create", machine });
      response.status(201).json(machine);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/machines/:id", (request, response, next) => {
    try {
      const machine = db.updateMachine(Number(request.params.id), request.body);
      pushToRenderer("app:data-changed", { scope: "machines", action: "update", machine });
      response.json(machine);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/furnaces", (request, response, next) => {
    try {
      response.json(db.listFurnaceProfiles(normalizeProfileFilters(request.query)));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/furnaces/:machineId/profile", (request, response, next) => {
    try {
      const profile = db.upsertFurnaceProfile(Number(request.params.machineId), request.body);
      pushToRenderer("app:data-changed", { scope: "furnaces", action: "profile-upsert", profile });
      response.json(profile);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/degreasing/batches", (request, response, next) => {
    try {
      response.json(db.listDegreasingBatches(request.query));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/degreasing/batches", (request, response, next) => {
    try {
      const result = db.createDegreasingBatch(request.body);
      pushToRenderer("app:data-changed", { scope: "degreasing", action: "batch-create", result });
      response.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/degreasing/batches/bulk", (request, response, next) => {
    try {
      const result = db.createDegreasingBatchBulk(request.body);
      pushToRenderer("app:data-changed", { scope: "degreasing", action: "batch-bulk-create", result });
      response.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/degreasing/solvent-change", (request, response, next) => {
    try {
      response.json(db.listSolventChangeLogs(request.query));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/degreasing/solvent-change", (request, response, next) => {
    try {
      const result = db.changeSolvent(request.body);
      pushToRenderer("app:data-changed", { scope: "degreasing", action: "solvent-change", result });
      response.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/degreasing/solvent-change/bulk", (request, response, next) => {
    try {
      const result = db.changeSolventBulk(request.body);
      pushToRenderer("app:data-changed", { scope: "degreasing", action: "solvent-bulk-change", result });
      response.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/products", (request, response, next) => {
    try {
      response.json(db.listProducts(request.query));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/products", (request, response, next) => {
    try {
      const product = db.createProduct(request.body);
      pushToRenderer("app:data-changed", { scope: "products", action: "create", product });
      response.status(201).json(product);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/products/:id", (request, response, next) => {
    try {
      const product = db.updateProduct(Number(request.params.id), request.body);
      pushToRenderer("app:data-changed", { scope: "products", action: "update", product });
      response.json(product);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/products/:id/dispose", (request, response, next) => {
    try {
      const result = db.disposeProduct(Number(request.params.id));
      pushToRenderer("app:data-changed", { scope: "products", action: result.action, result });
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/products/:id/restore", (request, response, next) => {
    try {
      const result = db.restoreProduct(Number(request.params.id));
      pushToRenderer("app:data-changed", { scope: "products", action: result.action, result });
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/product-masters", (request, response, next) => {
    try {
      response.json(db.listProductMasters(request.query));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/product-masters", (request, response, next) => {
    try {
      const productMaster = db.createProductMaster(request.body);
      pushToRenderer("app:data-changed", { scope: "product-masters", action: "create", productMaster });
      response.status(201).json(productMaster);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/product-masters/:id", (request, response, next) => {
    try {
      const productMaster = db.updateProductMaster(Number(request.params.id), request.body);
      pushToRenderer("app:data-changed", { scope: "product-masters", action: "update", productMaster });
      response.json(productMaster);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/product-masters/:id/dispose", (request, response, next) => {
    try {
      const result = db.disposeProductMaster(Number(request.params.id));
      pushToRenderer("app:data-changed", { scope: "product-masters", action: result.action, result });
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/product-masters/:id/restore", (request, response, next) => {
    try {
      const result = db.restoreProductMaster(Number(request.params.id));
      pushToRenderer("app:data-changed", { scope: "product-masters", action: result.action, result });
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/support-blocks", (request, response, next) => {
    try {
      response.json(db.listSupportBlocks(request.query));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/support-blocks", (request, response, next) => {
    try {
      const supportBlock = db.createSupportBlock(request.body);
      pushToRenderer("app:data-changed", { scope: "support-blocks", action: "create", supportBlock });
      response.status(201).json(supportBlock);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/support-blocks/:id", (request, response, next) => {
    try {
      const supportBlock = db.updateSupportBlock(Number(request.params.id), request.body);
      pushToRenderer("app:data-changed", { scope: "support-blocks", action: "update", supportBlock });
      response.json(supportBlock);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/support-block-rules/:productId", (request, response, next) => {
    try {
      response.json(db.listSupportBlockRelations({ product_id: Number(request.params.productId) }));
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/support-block-rules/:productId", (request, response, next) => {
    try {
      const rules = db.replaceSupportBlockRulesForProduct(Number(request.params.productId), request.body?.rules || []);
      pushToRenderer("app:data-changed", { scope: "support-block-rules", action: "replace", productId: Number(request.params.productId) });
      response.json(rules);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/support-block-options/:productId", (request, response, next) => {
    try {
      response.json(db.getSupportBlockOptionsForProduct(Number(request.params.productId)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/sintering/batches", (request, response, next) => {
    try {
      response.json(db.listSinteringBatches(request.query));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/sintering/batches", (request, response, next) => {
    try {
      const batch = db.createSinteringBatch(request.body);
      pushToRenderer("app:data-changed", { scope: "sintering", action: "batch-create", batch });
      response.status(201).json(batch);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/sintering/calculate-layout", (request, response, next) => {
    try {
      response.json(db.calculateSinteringLayout(request.body));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/sintering/layout-plans/:batchId", (request, response, next) => {
    try {
      response.json(db.listLayoutPlans(Number(request.params.batchId)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/vacuum/batches", (request, response, next) => {
    try {
      response.json(db.listVacuumBatches(request.query));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/vacuum/batches", (request, response, next) => {
    try {
      const batch = db.createVacuumBatch(request.body);
      pushToRenderer("app:data-changed", { scope: "vacuum", action: "batch-create", batch });
      response.status(201).json(batch);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/vacuum/calculate-layout", (request, response, next) => {
    try {
      response.json(db.calculateVacuumLayout(request.body));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/vacuum/layout-plans/:batchId", (request, response, next) => {
    try {
      response.json(db.listVacuumLayoutPlans(Number(request.params.batchId)));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/external/ingest", (request, response) => {
    const payload = {
      source: request.body?.source || "external",
      type: request.body?.type || "unknown",
      value: request.body?.value ?? null,
      timestamp: request.body?.timestamp || new Date().toISOString(),
      raw: request.body || {}
    };
    pushToRenderer("server:event", payload);
    logger.info("[server] external-ingest", payload);
    response.status(202).json({ accepted: true });
  });

  app.get("/api/reports/snapshot", (request, response, next) => {
    try {
      response.json(buildSnapshot(db, request.query));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/reports/export", (request, response, next) => {
    try {
      const filters = request.body?.filters || {};
      const format = request.body?.format === "csv" ? "csv" : "excel";
      const snapshot = buildSnapshot(db, filters);
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");

      if (format === "csv") {
        response.setHeader("Content-Type", "text/csv; charset=utf-8");
        response.setHeader("Content-Disposition", `attachment; filename="PMC_Report_${stamp}.csv"`);
        response.send(buildCsv(snapshot));
        return;
      }

      const buffer = xlsx.write(buildWorkbook(snapshot), { bookType: "xlsx", type: "buffer" });
      response.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      response.setHeader("Content-Disposition", `attachment; filename="PMC_Report_${stamp}.xlsx"`);
      response.send(buffer);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/system/meta", (request, response) => {
    response.json({
      host: serverConfig.host || request.hostname,
      port: serverConfig.port || request.socket.localPort,
      version: packageInfo.version
    });
  });

  app.get("/api/system/logs", (request, response, next) => {
    try {
      response.json(db.listSystemLogs(request.query));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/settings", (_request, response) => {
    response.json({
      api_key_enabled: db.getMeta("api_key_enabled") === "1",
      api_key_token: db.getMeta("api_key_token") || "",
      degreasing_time_offset: Number(db.getMeta("degreasing_time_offset") || 8)
    });
  });

  app.put("/api/settings", (request, response, next) => {
    try {
      const payload = request.body;
      if (typeof payload.api_key_enabled !== "undefined") {
        db.setMeta("api_key_enabled", payload.api_key_enabled ? "1" : "0");
      }
      if (typeof payload.api_key_token !== "undefined") {
        db.setMeta("api_key_token", payload.api_key_token);
      }
      if (typeof payload.degreasing_time_offset !== "undefined") {
        db.setMeta("degreasing_time_offset", String(payload.degreasing_time_offset));
      }
      response.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  app.use((error, _request, response, _next) => {
    logger.error("[server] request failure", error);
    response.status(400).json(normalizeError(error));
  });

  return app;
}

function startServer({ db, mainWindow, logger, port = 3186, host = process.env.PMC_SERVER_HOST || "0.0.0.0" }) {
  return new Promise((resolve, reject) => {
    const app = createApp({ db, mainWindow, logger, serverConfig: { host, port } });
    const server = app
      .listen(port, host, () => {
        logger.info(`[server] listening on http://${host}:${port}`);
        resolve({
          app,
          server,
          port,
          host
        });
      })
      .on("error", (error) => {
        logger.error("[server] failed to start", error);
        reject(error);
      });
  });
}

module.exports = {
  startServer
};

if (require.main === module) {
  const logger = console;
  const db = new DatabaseService({ dbPath: buildStandaloneDbPath(), logger }).init();
  const port = Number(process.env.PMC_SERVER_PORT || 3186);
  const host = process.env.PMC_SERVER_HOST || "0.0.0.0";

  startServer({ db, logger, port, host }).then((handle) => {
    logger.info(`[server] web entry: http://${host}:${port}/web/`);

    const shutdown = () => {
      handle.server.close(() => {
        db.close();
        process.exit(0);
      });
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }).catch((error) => {
    logger.error("[server] standalone startup failed", error);
    db.close();
    process.exit(1);
  });
}
