const electronApi = window.appApi;
const API_BASE = "/api";
const TOKEN_STORAGE_KEY = "pmc_api_token";

function buildQuery(filters = {}) {
  const params = new URLSearchParams();

  Object.entries(filters || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }

    params.set(key, Array.isArray(value) ? value.join(",") : String(value));
  });

  const query = params.toString();
  return query ? `?${query}` : "";
}

function readApiToken() {
  return window.localStorage?.getItem(TOKEN_STORAGE_KEY) || "";
}

function saveApiToken(token) {
  if (token) {
    window.localStorage?.setItem(TOKEN_STORAGE_KEY, token);
  }
}

async function request(path, options = {}) {
  const headers = {
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {})
  };
  const token = readApiToken();

  if (token) {
    headers["x-api-key"] = token;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (response.status === 401 && options.retry !== false) {
    const nextToken = window.prompt("請輸入這台 PMC Server 的 API Key");
    if (nextToken !== null) {
      saveApiToken(nextToken.trim());
      return request(path, { ...options, retry: false });
    }
  }

  if (!response.ok) {
    let message = `Server error: ${response.status}`;
    try {
      const payload = await response.json();
      message = payload.message || message;
    } catch {
      const text = await response.text().catch(() => "");
      message = text || message;
    }
    throw new Error(message);
  }

  return response;
}

async function getJson(path, filters) {
  const response = await request(`${path}${buildQuery(filters)}`);
  return response.json();
}

async function sendJson(method, path, body) {
  const response = await request(path, { method, body });
  return response.json();
}

function getFilename(response, fallback) {
  const disposition = response.headers.get("Content-Disposition") || "";
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) {
    return decodeURIComponent(utf8Match[1]);
  }

  const asciiMatch = disposition.match(/filename="?([^";]+)"?/i);
  return asciiMatch?.[1] || fallback;
}

async function downloadReport(filters, format) {
  const response = await request("/reports/export", {
    method: "POST",
    body: { filters, format }
  });
  const blob = await response.blob();
  const fallback = format === "csv" ? "PMC_Report.csv" : "PMC_Report.xlsx";
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = getFilename(response, fallback);
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  URL.revokeObjectURL(link.href);
  link.remove();
  return true;
}

function createBrowserApi() {
  return {
    dashboard: {
      getSummary: () => getJson("/dashboard")
    },
    machines: {
      list: (filters) => getJson("/machines", filters),
      create: (payload) => sendJson("POST", "/machines", payload),
      update: (payload) => sendJson("PUT", `/machines/${payload.id}`, payload)
    },
    furnaces: {
      listProfiles: (filters) => getJson("/furnaces", filters),
      saveProfile: (payload) =>
        sendJson("POST", `/furnaces/${payload.machineId || payload.machine_id}/profile`, payload)
    },
    degreasing: {
      createBatch: (payload) => sendJson("POST", "/degreasing/batches", payload),
      createBatchBulk: (payload) => sendJson("POST", "/degreasing/batches/bulk", payload),
      listBatches: (filters) => getJson("/degreasing/batches", filters),
      changeSolvent: (payload) => sendJson("POST", "/degreasing/solvent-change", payload),
      changeSolventBulk: (payload) => sendJson("POST", "/degreasing/solvent-change/bulk", payload),
      listSolventChanges: (filters) => getJson("/degreasing/solvent-change", filters)
    },
    products: {
      list: (filters) => getJson("/products", filters),
      create: (payload) => sendJson("POST", "/products", payload),
      update: (payload) => sendJson("PUT", `/products/${payload.id}`, payload),
      dispose: (payload) => sendJson("POST", `/products/${payload.id}/dispose`, payload),
      restore: (payload) => sendJson("POST", `/products/${payload.id}/restore`, payload)
    },
    productMasters: {
      list: (filters) => getJson("/product-masters", filters),
      create: (payload) => sendJson("POST", "/product-masters", payload),
      update: (payload) => sendJson("PUT", `/product-masters/${payload.id}`, payload),
      dispose: (payload) => sendJson("POST", `/product-masters/${payload.id}/dispose`, payload),
      restore: (payload) => sendJson("POST", `/product-masters/${payload.id}/restore`, payload)
    },
    supportBlocks: {
      list: (filters) => getJson("/support-blocks", filters),
      create: (payload) => sendJson("POST", "/support-blocks", payload),
      update: (payload) => sendJson("PUT", `/support-blocks/${payload.id}`, payload),
      listRelations: (payload) =>
        getJson(`/support-block-rules/${payload.product_id || payload.productId}`),
      replaceRulesForProduct: (payload) =>
        sendJson("PUT", `/support-block-rules/${payload.product_id || payload.productId}`, {
          rules: payload.rules || []
        }),
      getOptionsForProduct: (payload) =>
        getJson(`/support-block-options/${payload.product_id || payload.productId}`)
    },
    sintering: {
      calculateLayout: (payload) => sendJson("POST", "/sintering/calculate-layout", payload),
      createBatch: (payload) => sendJson("POST", "/sintering/batches", payload),
      listBatches: (filters) => getJson("/sintering/batches", filters),
      listLayoutPlans: (batchId) => getJson(`/sintering/layout-plans/${batchId}`)
    },
    vacuum: {
      calculateLayout: (payload) => sendJson("POST", "/vacuum/calculate-layout", payload),
      createBatch: (payload) => sendJson("POST", "/vacuum/batches", payload),
      listBatches: (filters) => getJson("/vacuum/batches", filters),
      listLayoutPlans: (batchId) => getJson(`/vacuum/layout-plans/${batchId}`)
    },
    reports: {
      getSnapshot: (filters) => getJson("/reports/snapshot", filters),
      export: (filters, format) => downloadReport(filters, format)
    },
    system: {
      listLogs: (filters) => getJson("/system/logs", filters),
      getServerMeta: () => getJson("/system/meta")
    },
    settings: {
      getSettings: () => getJson("/settings"),
      saveSettings: (payload) => sendJson("PUT", "/settings", payload)
    },
    events: {
      onDataChanged: () => () => {},
      onServerEvent: () => () => {},
      onUpdateStatus: () => () => {}
    }
  };
}

export const api = electronApi
  ? {
      dashboard: electronApi.dashboard,
      machines: electronApi.machines,
      furnaces: electronApi.furnaces,
      degreasing: electronApi.degreasing,
      products: electronApi.products,
      productMasters: electronApi.productMasters,
      supportBlocks: electronApi.supportBlocks,
      sintering: electronApi.sintering,
      vacuum: electronApi.vacuum,
      reports: electronApi.reports,
      system: electronApi.system,
      settings: electronApi.settings,
      events: electronApi.events
    }
  : createBrowserApi();
