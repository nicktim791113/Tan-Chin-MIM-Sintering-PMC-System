const { contextBridge, ipcRenderer } = require("electron");

function invoke(channel, payload) {
  return ipcRenderer.invoke(channel, payload);
}

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

contextBridge.exposeInMainWorld("appApi", {
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
  },
  dashboard: {
    getSummary: () => invoke("dashboard:getSummary")
  },
  machines: {
    list: (filters) => invoke("machines:list", filters),
    create: (payload) => invoke("machines:create", payload),
    update: (payload) => invoke("machines:update", payload)
  },
  furnaces: {
    listProfiles: (filters) => invoke("furnaces:listProfiles", filters),
    saveProfile: (payload) => invoke("furnaces:saveProfile", payload)
  },
  degreasing: {
    createBatch: (payload) => invoke("degreasing:createBatch", payload),
    createBatchBulk: (payload) => invoke("degreasing:createBatchBulk", payload),
    listBatches: (filters) => invoke("degreasing:listBatches", filters),
    changeSolvent: (payload) => invoke("degreasing:changeSolvent", payload),
    changeSolventBulk: (payload) => invoke("degreasing:changeSolventBulk", payload),
    listSolventChanges: (filters) => invoke("degreasing:listSolventChanges", filters)
  },
  products: {
    list: (filters) => invoke("products:list", filters),
    create: (payload) => invoke("products:create", payload),
    update: (payload) => invoke("products:update", payload),
    dispose: (payload) => invoke("products:dispose", payload),
    restore: (payload) => invoke("products:restore", payload)
  },
  productMasters: {
    list: (filters) => invoke("productMasters:list", filters),
    create: (payload) => invoke("productMasters:create", payload),
    update: (payload) => invoke("productMasters:update", payload),
    dispose: (payload) => invoke("productMasters:dispose", payload),
    restore: (payload) => invoke("productMasters:restore", payload)
  },
  supportBlocks: {
    list: (filters) => invoke("supportBlocks:list", filters),
    create: (payload) => invoke("supportBlocks:create", payload),
    update: (payload) => invoke("supportBlocks:update", payload),
    listRelations: (filters) => invoke("supportBlocks:listRelations", filters),
    replaceRulesForProduct: (payload) => invoke("supportBlocks:replaceRulesForProduct", payload),
    getOptionsForProduct: (payload) => invoke("supportBlocks:getOptionsForProduct", payload)
  },
  sintering: {
    calculateLayout: (payload) => invoke("sintering:calculateLayout", payload),
    createBatch: (payload) => invoke("sintering:createBatch", payload),
    listBatches: (filters) => invoke("sintering:listBatches", filters),
    listLayoutPlans: (batchId) => invoke("sintering:listLayoutPlans", { batchId })
  },
  vacuum: {
    calculateLayout: (payload) => invoke("vacuum:calculateLayout", payload),
    createBatch: (payload) => invoke("vacuum:createBatch", payload),
    listBatches: (filters) => invoke("vacuum:listBatches", filters),
    listLayoutPlans: (batchId) => invoke("vacuum:listLayoutPlans", { batchId })
  },
  reports: {
    getSnapshot: (filters) => invoke("reports:getSnapshot", filters),
    export: (filters, format) => invoke("reports:export", { filters, format })
  },
  system: {
    listLogs: (filters) => invoke("system:listLogs", filters),
    getServerMeta: () => invoke("server:getMeta")
  },
  settings: {
    getSettings: () => invoke("settings:getSettings"),
    saveSettings: (payload) => invoke("settings:saveSettings", payload)
  },
  events: {
    onDataChanged: (callback) => subscribe("app:data-changed", callback),
    onServerEvent: (callback) => subscribe("server:event", callback),
    onUpdateStatus: (callback) => subscribe("app:update-status", callback)
  }
});
