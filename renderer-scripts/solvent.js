import { renderTable } from "./components/table.js";
import {
  currentDateTimeLocalValue,
  createStatusPill,
  formatDateTime,
  formatNumber,
  resetForm,
  serializeForm
} from "./utils.js";

export function createSolventModule(context) {
  const cardsRoot = document.getElementById("solvent-machine-cards");
  const infoRoot = document.getElementById("solvent-machine-status");
  const form = document.getElementById("solvent-form");
  const tableRoot = document.getElementById("solvent-changes-table");
  const selectionSummary = document.getElementById("solvent-selection-summary");
  const selectedMachineIds = new Set();

  function getMachines() {
    return context
      .getState()
      .machines.filter((machine) => machine.machine_type === "degreasing_immersion" && machine.status === "active");
  }

  function getSelectedMachines() {
    return getMachines().filter((machine) => selectedMachineIds.has(machine.id));
  }

  function syncSelection() {
    const validIds = new Set(getMachines().map((machine) => machine.id));
    Array.from(selectedMachineIds).forEach((machineId) => {
      if (!validIds.has(machineId)) {
        selectedMachineIds.delete(machineId);
      }
    });
  }

  function getUsagePercent(machine) {
    return machine.solvent_weight_limit > 0
      ? Math.min((machine.current_solvent_accum_weight / machine.solvent_weight_limit) * 100, 100)
      : 0;
  }

  function renderCards() {
    const machines = getMachines();
    if (!machines.length) {
      cardsRoot.innerHTML =
        '<div class="panel p-6 text-sm text-slate">目前沒有可操作的浸泡式脫脂設備。</div>';
      return;
    }

    cardsRoot.innerHTML = machines
      .map((machine) => {
        const active = selectedMachineIds.has(machine.id);
        const usagePercent = getUsagePercent(machine);
        return `
          <button
            type="button"
            class="device-card ${active ? "device-card-active" : ""}"
            data-machine-pick="${machine.id}"
          >
            <div class="mb-2 flex items-start justify-between gap-3">
              <div class="min-w-0 flex-1 text-left">
                <p class="text-[10px] uppercase tracking-wide truncate ${active ? "text-white/70" : "text-slate"}">${machine.machine_code}</p>
                <h3 class="mt-0.5 text-base font-bold leading-tight truncate ${active ? "text-white" : "text-ink"}">${machine.machine_name}</h3>
              </div>
              <div class="flex flex-col items-end gap-2">
                ${createStatusPill(machine.alert_state, machine.alert_state)}
                <span class="chip ${active ? "!bg-white/20 !text-white" : ""}">${active ? "已選取" : "選取"}</span>
              </div>
            </div>
            <div class="mb-2 h-1.5 overflow-hidden rounded-full ${active ? "bg-white/20" : "bg-slate-100"}">
              <div class="h-full rounded-full ${active ? "bg-white" : "bg-ink"}" style="width: ${usagePercent}%"></div>
            </div>
            <div class="grid gap-1.5 text-[11px] ${active ? "text-white/80" : "text-slate"}">
              <div class="flex items-center justify-between">
                <span>更換前累積重量</span>
                <strong class="${active ? "text-white" : "text-ink"}">${formatNumber(machine.current_solvent_accum_weight)} kg</strong>
              </div>
              <div class="flex items-center justify-between">
                <span>本輪啟用時間</span>
                <strong class="${active ? "text-white" : "text-ink"}">${formatDateTime(machine.current_cycle_started_at)}</strong>
              </div>
            </div>
          </button>
        `;
      })
      .join("");
  }

  function renderSelectionSummary() {
    const selectedMachines = getSelectedMachines();
    if (!selectedMachines.length) {
      selectionSummary.innerHTML = '<span class="chip">尚未選取設備</span>';
      return;
    }

    const totalAccumWeight = selectedMachines.reduce(
      (sum, machine) => sum + Number(machine.current_solvent_accum_weight || 0),
      0
    );
    const needsChangeCount = selectedMachines.filter(
      (machine) => machine.alert_state === "needs_change"
    ).length;

    selectionSummary.innerHTML = `
      <span class="chip">已選取 ${selectedMachines.length} 台</span>
      <span class="chip">更換前累積總重 ${formatNumber(totalAccumWeight)} kg</span>
      <span class="chip">待更換設備 ${needsChangeCount} 台</span>
    `;
  }

  function renderInfo() {
    const selectedMachines = getSelectedMachines();
    if (!selectedMachines.length) {
      infoRoot.innerHTML =
        '<p class="text-sm text-slate">先在下方設備卡片多選設備，再一次完成同批溶劑更換作業。</p>';
      return;
    }

    const selectedCodes = selectedMachines
      .map((machine) => `<span class="chip">${machine.machine_code} / ${machine.machine_name}</span>`)
      .join("");
    const totalAccumWeight = selectedMachines.reduce(
      (sum, machine) => sum + Number(machine.current_solvent_accum_weight || 0),
      0
    );
    const earliestCycleStart = selectedMachines
      .map((machine) => machine.current_cycle_started_at)
      .filter(Boolean)
      .sort()[0];

    infoRoot.innerHTML = `
      <div class="space-y-5">
        <div>
          <p class="text-sm text-slate">已選取設備</p>
          <h3 class="mt-1 text-2xl font-black text-ink">${selectedMachines.length} 台浸泡式脫脂設備</h3>
        </div>
        <div class="metric-strip">
          <div class="info-tile">
            <p class="text-xs uppercase tracking-wide text-slate">設備數量</p>
            <p class="mt-2 text-2xl font-bold text-ink">${selectedMachines.length} 台</p>
          </div>
          <div class="info-tile">
            <p class="text-xs uppercase tracking-wide text-slate">更換前累積總重</p>
            <p class="mt-2 text-2xl font-bold text-ink">${formatNumber(totalAccumWeight)} kg</p>
          </div>
          <div class="info-tile">
            <p class="text-xs uppercase tracking-wide text-slate">最早啟用時間</p>
            <p class="mt-2 text-sm font-semibold text-ink">${formatDateTime(earliestCycleStart)}</p>
          </div>
        </div>
        <div class="subtle-card">
          <p class="text-sm font-semibold text-ink">本次會套用到以下設備</p>
          <div class="mt-3 flex flex-wrap gap-2">${selectedCodes}</div>
          <p class="mt-4 text-sm text-slate">
            送出後，系統會對每一台選取設備各建立一筆溶劑更換紀錄，並將累積重量歸零。
          </p>
        </div>
      </div>
    `;
  }

  async function renderSelectedLogs() {
    const machineIds = Array.from(selectedMachineIds);
    if (!machineIds.length) {
      renderTable(tableRoot, [{ key: "placeholder", label: "說明" }], [], {
        emptyMessage: "選取設備後會顯示最近的溶劑更換紀錄。"
      });
      return;
    }

    const rows = await context.api.degreasing.listSolventChanges({
      machine_ids: machineIds,
      limit: 20
    });

    renderTable(
      tableRoot,
      [
        { key: "machine_code", label: "設備編號" },
        {
          key: "previous_accum_weight",
          label: "更換前累積重量",
          render: (row) => `${formatNumber(row.previous_accum_weight)} kg`
        },
        { key: "operator_name", label: "更換人員" },
        {
          key: "changed_at",
          label: "更換時間",
          render: (row) => formatDateTime(row.changed_at)
        },
        { key: "notes", label: "備註", render: (row) => row.notes || "-" }
      ],
      rows,
      { emptyMessage: "目前沒有符合條件的溶劑更換紀錄。" }
    );
  }

  function resetChangeForm() {
    resetForm(form, {
      changed_at: currentDateTimeLocalValue()
    });
  }

  function updateView() {
    renderCards();
    renderSelectionSummary();
    renderInfo();
    renderSelectedLogs().catch((error) => context.showToast(error.message, "error"));
  }

  function selectAllMachines() {
    getMachines().forEach((machine) => selectedMachineIds.add(machine.id));
    updateView();
  }

  function clearSelection() {
    selectedMachineIds.clear();
    updateView();
  }

  function selectNeedsChangeMachines() {
    selectedMachineIds.clear();
    getMachines()
      .filter((machine) => machine.alert_state === "needs_change" || machine.alert_state === "warning")
      .forEach((machine) => selectedMachineIds.add(machine.id));
    updateView();
  }

  function bind() {
    cardsRoot.addEventListener("click", (event) => {
      const button = event.target.closest("[data-machine-pick]");
      if (!button) {
        return;
      }

      const machineId = Number(button.dataset.machinePick);
      if (selectedMachineIds.has(machineId)) {
        selectedMachineIds.delete(machineId);
      } else {
        selectedMachineIds.add(machineId);
      }

      syncSelection();
      updateView();
    });

    document.getElementById("solvent-select-all").addEventListener("click", selectAllMachines);
    document.getElementById("solvent-clear-selection").addEventListener("click", clearSelection);
    document.getElementById("solvent-select-alerts").addEventListener("click", selectNeedsChangeMachines);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const machineIds = Array.from(selectedMachineIds);
        if (!machineIds.length) {
          throw new Error("請至少選取一台浸泡式脫脂設備。");
        }

        const payload = serializeForm(form);
        const result = await context.api.degreasing.changeSolventBulk({
          machine_ids: machineIds,
          changed_at: payload.changed_at,
          operator_name: payload.operator_name,
          notes: payload.notes
        });
        context.showToast(`已為 ${result.machine_count} 台設備完成溶劑更換。`, "success");
        resetChangeForm();
        await context.refreshAll();
      } catch (error) {
        context.showToast(error.message || "執行溶劑更換失敗。", "error");
      }
    });
  }

  return {
    init() {
      bind();
      resetChangeForm();
    },
    async refresh() {
      syncSelection();
      renderCards();
      renderSelectionSummary();
      renderInfo();
      await renderSelectedLogs();
    }
  };
}
