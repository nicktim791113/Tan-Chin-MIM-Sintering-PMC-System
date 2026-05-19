import { renderTable } from "./components/table.js";
import {
  currentDateTimeLocalValue,
  createStatusPill,
  formatDateTime,
  formatNumber,
  resetForm,
  serializeForm
} from "./utils.js";

export function createDegreasingModule(context) {
  const cardsRoot = document.getElementById("degreasing-machine-cards");
  const infoRoot = document.getElementById("degreasing-machine-info");
  const form = document.getElementById("degreasing-form");
  const tableRoot = document.getElementById("degreasing-batches-table");
  const selectionSummary = document.getElementById("degreasing-selection-summary");
  const itemsRoot = document.getElementById("degreasing-items");
  const selectedMachineIds = new Set();
  
  let items = [{ id: Date.now(), part_no: "", product_name: "", work_order_no: "", input_weight: "", item_notes: "", quantity_pcs: "" }];
  let defaultTimeOffset = 8;
  let availableProducts = [];

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
                <span>目前累積重量</span>
                <strong class="${active ? "text-white" : "text-ink"}">${formatNumber(machine.current_solvent_accum_weight)} kg</strong>
              </div>
              <div class="flex items-center justify-between">
                <span>更換門檻</span>
                <strong class="${active ? "text-white" : "text-ink"}">${formatNumber(machine.solvent_weight_limit)} kg</strong>
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
    const maxUsagePercent = selectedMachines.reduce(
      (highest, machine) => Math.max(highest, getUsagePercent(machine)),
      0
    );

    selectionSummary.innerHTML = `
      <span class="chip">已選取 ${selectedMachines.length} 台</span>
      <span class="chip">目前累積總重 ${formatNumber(totalAccumWeight)} kg</span>
      <span class="chip">最高使用率 ${formatNumber(maxUsagePercent)}%</span>
    `;
  }

  function renderInfo() {
    const selectedMachines = getSelectedMachines();
    if (!selectedMachines.length) {
      infoRoot.innerHTML =
        '<p class="text-sm text-slate">先在下方設備卡片多選設備，再一次套用相同的投入資料。</p>';
      return;
    }

    const selectedCodes = selectedMachines
      .map((machine) => `<span class="chip">${machine.machine_code} / ${machine.machine_name}</span>`)
      .join("");
    const totalAccumWeight = selectedMachines.reduce(
      (sum, machine) => sum + Number(machine.current_solvent_accum_weight || 0),
      0
    );
    const averageLimit =
      selectedMachines.reduce((sum, machine) => sum + Number(machine.solvent_weight_limit || 0), 0) /
      selectedMachines.length;

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
            <p class="text-xs uppercase tracking-wide text-slate">累積使用總重</p>
            <p class="mt-2 text-2xl font-bold text-ink">${formatNumber(totalAccumWeight)} kg</p>
          </div>
          <div class="info-tile">
            <p class="text-xs uppercase tracking-wide text-slate">平均更換門檻</p>
            <p class="mt-2 text-2xl font-bold text-ink">${formatNumber(averageLimit)} kg</p>
          </div>
        </div>
        <div class="subtle-card">
          <p class="text-sm font-semibold text-ink">本次會套用到以下設備</p>
          <div class="mt-3 flex flex-wrap gap-2">${selectedCodes}</div>
          <p class="mt-4 text-sm text-slate">
            送出後，系統會對每一台選取設備各新增一筆投入紀錄，並同步累加溶劑使用重量。
          </p>
        </div>
      </div>
    `;
  }

  async function renderTableForSelection() {
    const machineIds = Array.from(selectedMachineIds);
    if (!machineIds.length) {
      renderTable(tableRoot, [{ key: "placeholder", label: "說明" }], [], {
        emptyMessage: "選取設備後會顯示最近的投入紀錄。"
      });
      return;
    }

    const rows = await context.api.degreasing.listBatches({
      machine_ids: machineIds,
      limit: 20
    });

    renderTable(
      tableRoot,
      [
        { key: "machine_code", label: "設備編號" },
        { key: "part_no", label: "產品編號" },
        { key: "product_name", label: "產品名稱" },
        { key: "batch_no", label: "批號" },
        { key: "work_order_no", label: "製令編號" },
        {
          key: "input_weight",
          label: "投入重量",
          render: (row) => `${formatNumber(row.input_weight)} kg`
        },
        { key: "operator_name", label: "作業人員" },
        {
          key: "operated_at",
          label: "作業時間",
          render: (row) => formatDateTime(row.operated_at)
        }
      ],
      rows,
      { emptyMessage: "目前沒有符合條件的投入紀錄。" }
    );
  }

  function renderItems() {
    if (!items.length) {
      itemsRoot.innerHTML = '<p class="text-sm text-slate px-2">尚未加入任何品項。</p>';
      return;
    }

    const datalistHTML = `
      <datalist id="degreasing-product-list">
        ${availableProducts.map((p) => `<option value="[${p.part_no}] ${p.product_name}"></option>`).join("")}
      </datalist>
    `;

    itemsRoot.innerHTML = datalistHTML + items
      .map(
        (item) => `
        <div class="flex flex-wrap md:flex-nowrap items-center gap-3 p-3 border border-slate-100 rounded-lg group hover:border-blue-200 transition-colors bg-white">
          <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3 flex-1">
            <label class="field m-0"><span class="label text-[10px]">產品編號 <span class="text-red-500">*</span></span><input class="input py-1.5" type="text" data-item-id="${item.id}" data-item-field="part_no" value="${item.part_no}" list="degreasing-product-list" required autocomplete="off" placeholder="可輸入名稱搜尋"></label>
            <label class="field m-0"><span class="label text-[10px]">產品名稱</span><input class="input py-1.5" type="text" data-item-id="${item.id}" data-item-field="product_name" value="${item.product_name || ''}"></label>
            <label class="field m-0"><span class="label text-[10px]">數量 (pcs)</span><input class="input py-1.5" type="number" step="1" min="0" data-item-id="${item.id}" data-item-field="quantity_pcs" value="${item.quantity_pcs || ''}"></label>
            <label class="field m-0"><span class="label text-[10px]">投入重量 (kg) <span class="text-red-500">*</span></span><input class="input py-1.5" type="number" step="0.1" min="0" data-item-id="${item.id}" data-item-field="input_weight" value="${item.input_weight}" required></label>
            <label class="field m-0"><span class="label text-[10px]">製令編號</span><input class="input py-1.5" type="text" data-item-id="${item.id}" data-item-field="work_order_no" value="${item.work_order_no}"></label>
            <label class="field m-0"><span class="label text-[10px]">備註</span><input class="input py-1.5" type="text" data-item-id="${item.id}" data-item-field="item_notes" value="${item.item_notes || ''}"></label>
          </div>
          <button type="button" class="btn-icon text-red-400 hover:text-red-600 hover:bg-red-50 shrink-0 self-end mb-1" data-delete-item="${item.id}" title="刪除品項">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
          </button>
        </div>
      `
      )
      .join("");
  }

  function resetOperationForm() {
    resetForm(form, {
      operated_at: currentDateTimeLocalValue()
    });
    items = [{ id: Date.now(), part_no: "", product_name: "", work_order_no: "", input_weight: "", item_notes: "", quantity_pcs: "" }];
    renderItems();
    autoUpdateEndedAt();
  }

  function autoUpdateEndedAt() {
    const operatedAtInput = form.elements.operated_at;
    const endedAtInput = form.elements.ended_at;
    if (!operatedAtInput || !endedAtInput) return;
    
    if (operatedAtInput.value && !endedAtInput.dataset.manualModified) {
      const d = new Date(operatedAtInput.value);
      if (!isNaN(d.getTime())) {
        d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
        d.setHours(d.getHours() + defaultTimeOffset);
        endedAtInput.value = d.toISOString().slice(0, 16);
      }
    }
  }

  async function fetchSettings() {
    try {
      const settings = await context.api.settings.getSettings();
      defaultTimeOffset = settings.degreasing_time_offset ?? 8;
    } catch {
      defaultTimeOffset = 8;
    }
  }

  async function fetchProducts() {
    try {
      availableProducts = await context.api.products.list({ limit: 10000 });
    } catch {
      availableProducts = [];
    }
  }

  function updateView() {
    renderCards();
    renderSelectionSummary();
    renderInfo();
    renderTableForSelection().catch((error) => context.showToast(error.message, "error"));
  }

  function selectAllMachines() {
    getMachines().forEach((machine) => selectedMachineIds.add(machine.id));
    updateView();
  }

  function clearSelection() {
    selectedMachineIds.clear();
    updateView();
  }

  function selectAlertMachines() {
    selectedMachineIds.clear();
    getMachines()
      .filter((machine) => machine.alert_state !== "normal")
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

    document.getElementById("degreasing-select-all").addEventListener("click", selectAllMachines);
    document.getElementById("degreasing-clear-selection").addEventListener("click", clearSelection);
    document.getElementById("degreasing-select-alerts").addEventListener("click", selectAlertMachines);

    document.getElementById("degreasing-add-item").addEventListener("click", () => {
      items.push({ id: Date.now(), part_no: "", product_name: "", work_order_no: "", input_weight: "", item_notes: "", quantity_pcs: "" });
      renderItems();
    });

    itemsRoot.addEventListener("input", (e) => {
      if (e.target.dataset.itemId) {
        const id = Number(e.target.dataset.itemId);
        const field = e.target.dataset.itemField;
        const item = items.find((i) => i.id === id);
        if (!item) return;

        if (field === "part_no" && e.target.value) {
          const val = e.target.value;
          const match = val.match(/^\[(.*?)\]\s?(.*)$/);
          if (match) {
            item.part_no = match[1];
            item.product_name = match[2];
            e.target.value = item.part_no;
            const container = e.target.closest(".flex-1");
            const nameInput = container.querySelector('[data-item-field="product_name"]');
            if (nameInput) nameInput.value = item.product_name;
            return;
          }
        }

        item[field] = e.target.value;
      }
    });

    itemsRoot.addEventListener("click", (e) => {
      const delBtn = e.target.closest("[data-delete-item]");
      if (delBtn) {
        if (items.length <= 1) {
          context.showToast("必須至少保留一個品項。", "warning");
          return;
        }
        const id = Number(delBtn.dataset.deleteItem);
        items = items.filter((i) => i.id !== id);
        renderItems();
      }
    });

    if (form.elements.operated_at) {
      form.elements.operated_at.addEventListener("change", autoUpdateEndedAt);
    }
    
    if (form.elements.ended_at) {
      form.elements.ended_at.addEventListener("input", () => {
        form.elements.ended_at.dataset.manualModified = "true";
      });
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const machineIds = Array.from(selectedMachineIds);
        if (!machineIds.length) {
          throw new Error("請至少選取一台浸泡式脫脂設備。");
        }
        
        const submitItems = items.map(item => ({
          part_no: item.part_no,
          product_name: item.product_name,
          work_order_no: item.work_order_no,
          input_weight: Number(item.input_weight || 0),
          quantity_pcs: item.quantity_pcs ? Number(item.quantity_pcs) : null,
          item_notes: item.item_notes
        })).filter(item => item.part_no && item.input_weight > 0);

        if (!submitItems.length) {
          throw new Error("請至少填入一個完整且重量大於 0 的品項。");
        }

        const payload = serializeForm(form);
        const result = await context.api.degreasing.createBatchBulk({
          machine_ids: machineIds,
          batch_no: payload.batch_no,
          operator_name: payload.operator_name,
          operated_at: payload.operated_at,
          ended_at: payload.ended_at,
          notes: payload.notes,
          items: submitItems
        });
        
        delete form.elements.ended_at.dataset.manualModified;
        context.showToast(`已為 ${result.machine_count} 台設備建立投入紀錄。`, "success");
        resetOperationForm();
        await context.refreshAll();
      } catch (error) {
        context.showToast(error.message || "建立投入紀錄失敗。", "error");
      }
    });
  }

  return {
    async init() {
      await fetchSettings();
      await fetchProducts();
      bind();
      resetOperationForm();
    },
    async refresh() {
      syncSelection();
      renderCards();
      renderSelectionSummary();
      renderInfo();
      await renderTableForSelection();
    }
  };
}
