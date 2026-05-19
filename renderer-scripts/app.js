import { api } from "./api.js";
import { createModal } from "./components/modal.js";
import { initToast, showToast } from "./components/toast.js";
import { createDashboardModule } from "./dashboard.js";
import { createDegreasingModule } from "./degreasing.js";
import { createMachinesModule } from "./machines.js";
import { createProductsModule } from "./products.js";
import { createReportsModule } from "./reports.js";
import { createSinteringModule } from "./sintering.js";
import { getState, mergeState } from "./state.js";
import { createSolventModule } from "./solvent.js";
import { createSupportBlocksModule } from "./support-blocks.js";
import { createVacuumModule } from "./vacuum.js";
import { createSettingsModule } from "./settings.js";

const modules = [];

function switchView(view) {
  document.querySelectorAll("[data-view-panel]").forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.viewPanel !== view);
  });

  document.querySelectorAll("[data-view-target]").forEach((button) => {
    const active = button.dataset.viewTarget === view;
    button.classList.toggle("nav-tab-active", active);
  });

  mergeState({ currentView: view });
}

async function loadReferenceData() {
  const [machines, productMasters, products, furnaces, vacuumProfiles, supportBlocks, serverMeta] = await Promise.all([
    api.machines.list(),
    api.productMasters.list(),
    api.products.list(),
    api.furnaces.listProfiles({ machineTypes: ["sintering_furnace"] }),
    api.furnaces.listProfiles({ machineTypes: ["degreasing_reserved"] }),
    api.supportBlocks.list(),
    api.system.getServerMeta()
  ]);

  mergeState({ machines, productMasters, products, furnaces, vacuumProfiles, supportBlocks, serverMeta });
}

async function refreshAll() {
  await loadReferenceData();
  await Promise.all(modules.map((module) => module.refresh?.()));
  const serverMeta = getState().serverMeta;
  document.getElementById("server-meta").textContent = `${serverMeta.host}:${serverMeta.port}`;
}

async function init() {
  initToast(document.getElementById("toast-root"));
  const modal = createModal(document.getElementById("modal-root"));

  const context = {
    api,
    getState,
    mergeState,
    showToast,
    modal,
    refreshAll
  };

  modules.push(
    createDashboardModule(context),
    createMachinesModule(context),
    createDegreasingModule(context),
    createSolventModule(context),
    createVacuumModule(context),
    createProductsModule(context),
    createSupportBlocksModule(context),
    createSinteringModule(context),
    createReportsModule(context),
    createSettingsModule(context)
  );

  await Promise.all(modules.map((module) => module.init?.()));

  document.querySelectorAll("[data-view-target]").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.viewTarget));
  });

  document.getElementById("modal-root").addEventListener("click", (event) => {
    if (event.target.closest("[data-modal-close]")) {
      modal.close();
    }
  });

  api.events.onDataChanged(() => {
    refreshAll().catch((error) => {
      showToast(error.message || "重新整理資料時發生錯誤。", "error");
    });
  });

  api.events.onServerEvent((payload) => {
    showToast(`收到外部資料事件：${payload.type}`, "info");
  });

  api.events.onUpdateStatus((payload) => {
    document.getElementById("update-status").textContent = payload.message;
  });

  await refreshAll();
  switchView(getState().currentView);
}

init().catch((error) => {
  console.error(error);
  showToast(error.message || "系統初始化失敗。", "error");
});
