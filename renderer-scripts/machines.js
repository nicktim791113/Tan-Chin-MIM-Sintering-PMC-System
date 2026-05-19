import {
  createStatusPill,
  escapeHtml,
  formatDateTime,
  formatNumber,
  resetForm,
  serializeForm
} from "./utils.js";

const MACHINE_TYPE_LABELS = {
  degreasing_immersion: "浸泡式脫脂設備",
  degreasing_reserved: "真空式脫脂設備",
  sintering_furnace: "真空式燒結爐"
};

const STATUS_OPTIONS = [
  { value: "active", label: "啟用" },
  { value: "inactive", label: "停用" },
  { value: "maintenance", label: "維護中" }
];

function usesStructuredProfile(machineType) {
  return machineType === "degreasing_reserved" || machineType === "sintering_furnace";
}

function getStructuredTitle(machineType) {
  return machineType === "degreasing_reserved" ? "真空式脫脂爐結構參數" : "真空式燒結爐結構參數";
}

function getDefaultStructuredProfile() {
  return {
    total_layers: 8,
    total_inner_height: 960,
    effective_width: 600,
    effective_depth: 500,
    base_layer_gap: 120,
    positions_per_layer: 2,
    gap_adjust_rule: {
      adjustable: true,
      maxExtraGap: 20
    }
  };
}

function formatNote(notes) {
  return notes ? escapeHtml(notes) : "無";
}

function renderStat(label, value) {
  return `
    <div class="rounded-xl bg-slate-50 px-2.5 py-2">
      <p class="text-[10px] uppercase tracking-[0.1em] text-slate-500">${escapeHtml(label)}</p>
      <p class="mt-0.5 text-xs font-semibold text-ink">${value}</p>
    </div>
  `;
}

function renderEmptyState(target, message) {
  target.innerHTML = `
    <div class="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
      ${escapeHtml(message)}
    </div>
  `;
}

function renderStatusOptions(selectedValue) {
  return STATUS_OPTIONS.map(
    (option) => `
      <option value="${option.value}" ${option.value === selectedValue ? "selected" : ""}>
        ${option.label}
      </option>
    `
  ).join("");
}

export function createMachinesModule(context) {
  const machineForm = document.getElementById("machine-form");
  const formTitle = document.getElementById("machine-form-title");
  const formSubmitButton = machineForm.querySelector('button[type="submit"]');
  const formResetButton = document.getElementById("machine-form-reset");
  const machineTypeField = document.getElementById("machine-machine-type");
  const solventFields = document.getElementById("machine-solvent-fields");
  const temperatureFields = document.getElementById("machine-temperature-fields");
  const structureFields = document.getElementById("machine-structure-fields");
  const structureTitle = document.getElementById("machine-structure-title");
  const immersionList = document.getElementById("machines-immersion-table");
  const vacuumList = document.getElementById("machines-vacuum-table");
  const furnaceList = document.getElementById("machines-furnace-table");

  let inlineEditingId = null;

  function getMachineById(machineId) {
    return context.getState().machines.find((machine) => machine.id === machineId) || null;
  }

  function getProfileByMachineId(machineId) {
    const { furnaces, vacuumProfiles } = context.getState();
    return [...furnaces, ...vacuumProfiles].find((entry) => entry.machine_id === machineId) || null;
  }

  function syncMachineSections() {
    const machineType = machineTypeField.value;
    const showImmersionFields = machineType === "degreasing_immersion";
    const showStructure = usesStructuredProfile(machineType);

    solventFields.classList.toggle("hidden", !showImmersionFields);
    temperatureFields.classList.toggle("hidden", !showImmersionFields);
    structureFields.classList.toggle("hidden", !showStructure);
    structureTitle.textContent = getStructuredTitle(machineType);
  }

  function resetMachineForm() {
    formTitle.textContent = "新增設備";
    formSubmitButton.textContent = "新增設備";
    formResetButton.textContent = "清除表單";
    resetForm(machineForm, {
      status: "active",
      machine_type: "degreasing_immersion",
      solvent_weight_limit: 1000,
      standard_temperature: 0,
      total_layers: 8,
      total_inner_height: 960,
      effective_width: 600,
      effective_depth: 500,
      base_layer_gap: 120,
      positions_per_layer: 2,
      gap_max_extra: 20
    });
    syncMachineSections();
  }

  function buildCreateRequest(formPayload) {
    const machineType = formPayload.machine_type;
    const request = {
      machine_code: formPayload.machine_code,
      machine_name: formPayload.machine_name,
      machine_type: machineType,
      status: formPayload.status,
      solvent_weight_limit:
        machineType === "degreasing_immersion" ? Number(formPayload.solvent_weight_limit || 0) : 0,
      standard_temperature:
        machineType === "degreasing_immersion" ? Number(formPayload.standard_temperature || 0) : 0,
      notes: formPayload.notes
    };

    if (usesStructuredProfile(machineType)) {
      request.profile = {
        total_layers: Number(formPayload.total_layers || 0),
        total_inner_height: Number(formPayload.total_inner_height || 0),
        effective_width: Number(formPayload.effective_width || 0),
        effective_depth: Number(formPayload.effective_depth || 0),
        base_layer_gap: Number(formPayload.base_layer_gap || 0),
        positions_per_layer: Number(formPayload.positions_per_layer || 2),
        gapAdjustRule: {
          adjustable: true,
          maxExtraGap: Number(formPayload.gap_max_extra || 0)
        }
      };
    }

    return request;
  }

  function renderSummaryCard(machine, profile = null) {
    const isImmersion = machine.machine_type === "degreasing_immersion";
    const structure = {
      ...getDefaultStructuredProfile(),
      ...(profile || {})
    };

    const stats = isImmersion
      ? [
          renderStat("目前累積", `${formatNumber(machine.current_solvent_accum_weight)} kg`),
          renderStat("更換門檻", `${formatNumber(machine.solvent_weight_limit)} kg`),
          renderStat("標準溫度", `${formatNumber(machine.standard_temperature)} °C`),
          renderStat("最後更新", escapeHtml(formatDateTime(machine.updated_at)))
        ].join("")
      : [
          renderStat("層數", escapeHtml(String(structure.total_layers))),
          renderStat("每層位置數", escapeHtml(String(structure.positions_per_layer))),
          renderStat("基礎層距", `${formatNumber(structure.base_layer_gap)} mm`),
          renderStat(
            "有效尺寸",
            `${formatNumber(structure.effective_width)} × ${formatNumber(structure.effective_depth)} mm`
          )
        ].join("");

    return `
      <article class="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm shadow-slate-200/60">
        <div class="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <div class="space-y-1">
            <div class="flex flex-wrap items-center gap-2">
              <h4 class="text-base font-bold text-ink">${escapeHtml(machine.machine_code)}</h4>
              ${createStatusPill(machine.status, machine.status)}
            </div>
            <p class="text-xs font-medium text-ink">${escapeHtml(machine.machine_name)}</p>
            <p class="text-[10px] uppercase tracking-[0.1em] text-slate-500">
              ${escapeHtml(MACHINE_TYPE_LABELS[machine.machine_type] || machine.machine_type)}
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            ${
              isImmersion
                ? createStatusPill(machine.alert_state, machine.alert_state)
                : `<span class="status-pill bg-sky-100 text-sky-700">結構設備</span>`
            }
            <button
              type="button"
              class="btn-secondary text-xs px-2 py-1"
              data-machine-inline-edit="${machine.id}"
            >
              編輯
            </button>
          </div>
        </div>
        <div class="mt-3 grid gap-2 xl:grid-cols-4">
          ${stats}
        </div>
        <div class="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <span class="font-semibold text-ink">備註：</span>${formatNote(machine.notes)}
        </div>
      </article>
    `;
  }

  function renderInlineEditCard(machine, profile = null) {
    const isImmersion = machine.machine_type === "degreasing_immersion";
    const structure = {
      ...getDefaultStructuredProfile(),
      ...(profile || {})
    };
    const maxExtraGap = structure.gap_adjust_rule?.maxExtraGap ?? 20;

    return `
      <article class="rounded-2xl border border-sky-200 bg-sky-50/50 p-3 shadow-sm shadow-sky-100">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
             <div class="flex flex-wrap items-center gap-2">
              <h4 class="text-base font-bold text-ink">${escapeHtml(machine.machine_code)}</h4>
              <p class="text-[10px] uppercase tracking-[0.1em] text-sky-700">快速編輯模式</p>
             </div>
          </div>
        </div>
        <form data-machine-inline-form="${machine.id}" class="product-form-compact">
          <div class="product-master-form-grid items-start">
            <label class="field"><span class="label">設備編號</span><input class="input" name="machine_code" value="${escapeHtml(machine.machine_code)}" required></label>
            <label class="field"><span class="label">設備名稱</span><input class="input" name="machine_name" value="${escapeHtml(machine.machine_name)}" required></label>
            <label class="field"><span class="label">設備狀態</span><select class="select" name="status">${renderStatusOptions(machine.status)}</select></label>
            ${
              isImmersion
                ? `
                  <label class="field"><span class="label">溶劑門檻 (kg)</span><input class="input" type="number" min="0" step="0.1" name="solvent_weight_limit" value="${escapeHtml(String(machine.solvent_weight_limit ?? 0))}"></label>
                  <label class="field"><span class="label">標準溫度 (°C)</span><input class="input" type="number" step="0.1" name="standard_temperature" value="${escapeHtml(String(machine.standard_temperature ?? 0))}"></label>
                `
                : `
                  <label class="field"><span class="label">層數</span><input class="input" type="number" min="1" step="1" name="total_layers" value="${escapeHtml(String(structure.total_layers))}"></label>
                  <label class="field"><span class="label">內部高度 (mm)</span><input class="input" type="number" min="0" step="0.1" name="total_inner_height" value="${escapeHtml(String(structure.total_inner_height))}"></label>
                  <label class="field"><span class="label">有效寬度 (mm)</span><input class="input" type="number" min="0" step="0.1" name="effective_width" value="${escapeHtml(String(structure.effective_width))}"></label>
                  <label class="field"><span class="label">有效深度 (mm)</span><input class="input" type="number" min="0" step="0.1" name="effective_depth" value="${escapeHtml(String(structure.effective_depth))}"></label>
                  <label class="field"><span class="label">基礎層距 (mm)</span><input class="input" type="number" min="0" step="0.1" name="base_layer_gap" value="${escapeHtml(String(structure.base_layer_gap))}"></label>
                  <label class="field"><span class="label">每層位置數</span><input class="input" type="number" min="1" step="1" name="positions_per_layer" value="${escapeHtml(String(structure.positions_per_layer))}"></label>
                  <label class="field"><span class="label">層距加大 (mm)</span><input class="input" type="number" min="0" step="0.1" name="gap_max_extra" value="${escapeHtml(String(maxExtraGap))}"></label>
                `
            }
          </div>
          
          <div class="product-master-form-grid items-start mt-3">
             <label class="field xl:col-span-2 md:col-span-2"><span class="label">備註</span><textarea class="textarea" name="notes" rows="1">${escapeHtml(machine.notes || "")}</textarea></label>
          </div>

          <div class="mt-3 flex flex-wrap justify-end gap-2">
            <button type="button" class="btn-secondary px-3 py-1 text-xs" data-machine-inline-cancel="${machine.id}">取消</button>
            <button type="submit" class="btn-primary px-3 py-1 text-xs">儲存修改</button>
          </div>
        </form>
      </article>
    `;
  }

  function renderMachineList(target, machines, emptyMessage) {
    if (!machines.length) {
      renderEmptyState(target, emptyMessage);
      return;
    }

    target.innerHTML = `
      <div class="grid gap-4 2xl:grid-cols-2">
        ${machines
          .map((machine) => {
            const profile = usesStructuredProfile(machine.machine_type)
              ? getProfileByMachineId(machine.id)
              : null;

            return inlineEditingId === machine.id
              ? renderInlineEditCard(machine, profile)
              : renderSummaryCard(machine, profile);
          })
          .join("")}
      </div>
    `;
  }

  function renderLists() {
    const { machines } = context.getState();
    renderMachineList(
      immersionList,
      machines.filter((machine) => machine.machine_type === "degreasing_immersion"),
      "目前還沒有浸泡式脫脂設備。"
    );
    renderMachineList(
      vacuumList,
      machines.filter((machine) => machine.machine_type === "degreasing_reserved"),
      "目前還沒有真空式脫脂設備。"
    );
    renderMachineList(
      furnaceList,
      machines.filter((machine) => machine.machine_type === "sintering_furnace"),
      "目前還沒有真空式燒結爐。"
    );
  }

  async function handleInlineSubmit(form) {
    const machineId = Number(form.dataset.machineInlineForm);
    const machine = getMachineById(machineId);
    if (!machine) {
      throw new Error("找不到要更新的設備資料。");
    }

    const payload = serializeForm(form);
    const request = {
      id: machineId,
      machine_type: machine.machine_type,
      machine_code: payload.machine_code,
      machine_name: payload.machine_name,
      status: payload.status,
      solvent_weight_limit:
        machine.machine_type === "degreasing_immersion"
          ? Number(payload.solvent_weight_limit || 0)
          : machine.solvent_weight_limit,
      standard_temperature:
        machine.machine_type === "degreasing_immersion"
          ? Number(payload.standard_temperature || 0)
          : machine.standard_temperature,
      notes: payload.notes
    };

    if (usesStructuredProfile(machine.machine_type)) {
      request.profile = {
        total_layers: Number(payload.total_layers || 0),
        total_inner_height: Number(payload.total_inner_height || 0),
        effective_width: Number(payload.effective_width || 0),
        effective_depth: Number(payload.effective_depth || 0),
        base_layer_gap: Number(payload.base_layer_gap || 0),
        positions_per_layer: Number(payload.positions_per_layer || 2),
        gapAdjustRule: {
          adjustable: true,
          maxExtraGap: Number(payload.gap_max_extra || 0)
        }
      };
    }

    await context.api.machines.update(request);
    inlineEditingId = null;
    context.showToast(`已更新設備 ${machine.machine_code}。`, "success");
    await context.refreshAll();
  }

  function bindInlineRoot(root) {
    root.addEventListener("click", (event) => {
      const editButton = event.target.closest("[data-machine-inline-edit]");
      if (editButton) {
        inlineEditingId = Number(editButton.dataset.machineInlineEdit);
        renderLists();
        return;
      }

      const cancelButton = event.target.closest("[data-machine-inline-cancel]");
      if (cancelButton) {
        inlineEditingId = null;
        renderLists();
      }
    });

    root.addEventListener("submit", async (event) => {
      const form = event.target.closest("[data-machine-inline-form]");
      if (!form) {
        return;
      }

      event.preventDefault();

      try {
        await handleInlineSubmit(form);
      } catch (error) {
        context.showToast(error.message || "設備更新失敗。", "error");
      }
    });
  }

  function bind() {
    machineTypeField.addEventListener("change", syncMachineSections);

    machineForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      try {
        const payload = serializeForm(machineForm);
        await context.api.machines.create(buildCreateRequest(payload));
        context.showToast("設備已新增。", "success");
        resetMachineForm();
        await context.refreshAll();
      } catch (error) {
        context.showToast(error.message || "設備新增失敗。", "error");
      }
    });

    formResetButton.addEventListener("click", resetMachineForm);
    bindInlineRoot(immersionList);
    bindInlineRoot(vacuumList);
    bindInlineRoot(furnaceList);
  }

  return {
    init() {
      bind();
      resetMachineForm();
    },
    refresh() {
      const editingMachine = inlineEditingId ? getMachineById(inlineEditingId) : null;
      if (!editingMachine) {
        inlineEditingId = null;
      }

      renderLists();
    }
  };
}
