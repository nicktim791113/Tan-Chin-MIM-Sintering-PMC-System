import { renderTable } from "./components/table.js";
import {
  createStatusPill,
  escapeHtml,
  formatDateTime,
  formatNumber,
  resetForm,
  serializeForm,
  todayLocalInputValue
} from "./utils.js";

function buildProductOptions(products, selectedValue = "") {
  const activeProducts = products.filter((product) => product.status === "active");
  const selectedProduct = products.find((product) => String(product.id) === String(selectedValue));
  const options =
    selectedProduct && !activeProducts.some((product) => product.id === selectedProduct.id)
      ? [selectedProduct, ...activeProducts]
      : activeProducts;

  return [
    '<option value="">請選擇產品</option>',
    ...options.map((product) => {
      const selected = String(product.id) === String(selectedValue) ? "selected" : "";
      return `<option value="${product.id}" ${selected}>${escapeHtml(product.display_label || `${product.part_no} | ${product.part_name}`)}</option>`;
    })
  ].join("");
}

function helpIcon(label, tooltip) {
  return `<span class="help-icon" tabindex="0" aria-label="${escapeHtml(label)}" data-tooltip="${escapeHtml(tooltip)}">?</span>`;
}

function relationLabel(relation) {
  if (relation === "recommended") {
    return "推薦";
  }
  if (relation === "allowed") {
    return "可用";
  }
  if (relation === "restricted") {
    return "限制";
  }
  return "";
}

export function createStructuredBatchModule(context, config) {
  const form = document.getElementById(config.formId);
  const itemsRoot = document.getElementById(config.itemsRootId);
  const machineCardsRoot = document.getElementById(config.machineCardsRootId);
  const machineInfoRoot = document.getElementById(config.machineInfoRootId);
  const recommendationsRoot = document.getElementById(config.recommendationsRootId);
  const recommendationDetail = document.getElementById(config.recommendationDetailId);
  const batchesRoot = document.getElementById(config.batchesRootId);
  let layoutResult = null;
  let selectedMachineId = null;
  const supportOptionsCache = new Map();

  function getMachines() {
    return config.getMachines();
  }

  function syncSelectedMachine() {
    const machines = getMachines();
    if (!machines.length) {
      selectedMachineId = null;
      return;
    }

    if (selectedMachineId && machines.some((machine) => machine.machine_id === selectedMachineId)) {
      return;
    }

    selectedMachineId = machines[0].machine_id;
  }

  function getSelectedMachine() {
    return getMachines().find((machine) => machine.machine_id === selectedMachineId) || null;
  }

  function fallbackSupportOptions() {
    return {
      has_rules: false,
      has_preferred_configuration: false,
      relations: [],
      options: context
        .getState()
        .supportBlocks.filter(
          (block) => (block.fixture_type === "support_block" || block.fixture_type === "isolate") && block.status === "active"
        )
        .sort((left, right) => left.block_code.localeCompare(right.block_code, "en"))
        .map((block) => ({
          ...block,
          relation: null
        }))
    };
  }

  async function getSupportOptions(productId) {
    if (!productId) {
      return fallbackSupportOptions();
    }

    if (supportOptionsCache.has(productId)) {
      return await supportOptionsCache.get(productId);
    }

    const request = context.api.supportBlocks.getOptionsForProduct({
      product_id: productId,
      fixture_type: "support_block"
    });
    supportOptionsCache.set(productId, request);
    const resolved = await request;
    supportOptionsCache.set(productId, resolved);
    return resolved;
  }

  function buildSupportOptions(options, selectedValue = "") {
    return [
      '<option value="">請選擇墊塊</option>',
      ...options.map((option) => {
        const relationText = option.relation
          ? ` / ${relationLabel(option.relation.compatibility_status)}`
          : "";
        const selected = String(option.id) === String(selectedValue) ? "selected" : "";
        return `<option value="${option.id}" ${selected}>${escapeHtml(option.block_code)} | ${escapeHtml(option.block_name)}${escapeHtml(relationText)}</option>`;
      })
    ].join("");
  }

  function createItemRow(defaults = {}) {
    const row = document.createElement("div");
    row.className = "rounded-3xl border border-slate-200 bg-slate-50 p-4";
    row.dataset.itemRow = "true";
    row.innerHTML = `
      <div class="grid gap-3 xl:grid-cols-[2fr,0.8fr,1fr,1.4fr,1fr,auto]">
        <label class="field">
          <span class="label">產品</span>
          <select class="select" name="product_id">${buildProductOptions(
            context.getState().products,
            defaults.product_id
          )}</select>
        </label>
        <label class="field">
          <span class="label">數量</span>
          <input class="input" type="number" min="1" name="quantity" value="${defaults.quantity || 1}">
        </label>
        <label class="field">
          <span class="label label-with-help">單件高度${helpIcon(
            "單件高度說明",
            "預設帶入作業標準的產品高度，可依批次改寫；此值不含托盤、墊塊或其他治具。"
          )}</span>
          <input class="input" type="number" step="0.1" min="0" name="unit_height" value="${defaults.unit_height || ""}">
        </label>
        <label class="field">
          <span class="label label-with-help">墊塊指定${helpIcon(
            "墊塊指定說明",
            "選擇墊塊後會依治具高度與作業標準堆疊數帶入墊塊總高度；可用項目會受製程治具對應表提示影響。"
          )}</span>
          <select class="select" name="support_block_id">${buildSupportOptions(
            fallbackSupportOptions().options,
            defaults.support_block_id
          )}</select>
        </label>
        <label class="field">
          <span class="label label-with-help">墊塊總高度${helpIcon(
            "墊塊總高度說明",
            "不含產品高度。有值時會覆寫作業標準中的墊塊 / 隔離類治具高度，再與單件高度和其他治具高度加總。"
          )}</span>
          <input class="input" type="number" step="0.1" min="0" name="support_block_height" value="${defaults.support_block_height || ""}">
        </label>
        <div class="flex items-end">
          <button type="button" class="btn-secondary w-full" data-remove-item>移除</button>
        </div>
      </div>
      <div class="mt-3 subtle-card" data-support-hint>
        <p class="text-sm text-slate">選擇產品後，這裡會顯示作業標準治具清單、墊塊規則，以及高度計算來源。</p>
      </div>
    `;
    itemsRoot.appendChild(row);
    syncRow(row).catch((error) => context.showToast(error.message, "error"));
  }

  function collectItems() {
    const rows = Array.from(itemsRoot.children);
    const items = rows
      .map((row) => ({
        product_id: Number(row.querySelector('[name="product_id"]').value),
        quantity: Number(row.querySelector('[name="quantity"]').value),
        unit_height: row.querySelector('[name="unit_height"]').value,
        support_block_id: Number(row.querySelector('[name="support_block_id"]').value),
        support_block_height: row.querySelector('[name="support_block_height"]').value
      }))
      .filter((item) => item.product_id);

    if (items.length === 0) {
      throw new Error(`請至少新增一筆${config.itemLabel}品項。`);
    }

    return items.map((item) => ({
      ...item,
      unit_height: item.unit_height === "" ? undefined : Number(item.unit_height),
      support_block_id: item.support_block_id || undefined,
      support_block_height:
        item.support_block_height === "" ? undefined : Number(item.support_block_height)
    }));
  }

  async function syncRow(row) {
    const productId = Number(row.querySelector('[name="product_id"]').value) || null;
    const supportSelect = row.querySelector('[name="support_block_id"]');
    const supportHeightInput = row.querySelector('[name="support_block_height"]');
    const unitHeightInput = row.querySelector('[name="unit_height"]');
    const hintRoot = row.querySelector("[data-support-hint]");
    const product = context.getState().products.find((item) => item.id === productId) || null;
    const currentSupportId = supportSelect.value;
    const supportOptions = await getSupportOptions(productId);

    supportSelect.innerHTML = buildSupportOptions(supportOptions.options, currentSupportId);

    if (product && !unitHeightInput.value) {
      unitHeightInput.value = product.product_height;
    }

    if (product && !supportSelect.value && product.support_fixture_id) {
      const hasDefault = supportOptions.options.some(
        (option) => String(option.id) === String(product.support_fixture_id)
      );
      if (hasDefault) {
        supportSelect.value = String(product.support_fixture_id);
      }
    }

    const selectedSupportBlock = context
      .getState()
      .supportBlocks.find((item) => String(item.id) === supportSelect.value);
    if (selectedSupportBlock && product) {
      const stackQuantity = Math.max(1, Number(product.support_stack_quantity || 1));
      supportHeightInput.value = selectedSupportBlock.height * stackQuantity;
    } else if (product) {
      supportHeightInput.value = product.support_block_height || "";
    } else if (!supportSelect.value) {
      supportHeightInput.value = "";
    }

    if (!productId || !product) {
      hintRoot.innerHTML =
        '<p class="text-sm text-slate">選擇產品後，這裡會顯示作業標準治具清單、墊塊規則，以及高度計算來源。</p>';
      return;
    }

    let fixturesHtml = '<p class="mt-1 text-sm text-slate">無治具</p>';
    if (product.spec_fixtures && product.spec_fixtures.length > 0) {
      fixturesHtml = product.spec_fixtures.map(f => {
        return `<p class="mt-1 text-sm text-slate">${escapeHtml(f.block_code)} x ${f.quantity || 1} / ${formatNumber(f.height * (f.quantity || 1))} mm (${escapeHtml(f.block_name)})</p>`;
      }).join('');
    }

    hintRoot.innerHTML = `
      <div class="toolbar-row">
        <div>
          <p class="text-sm font-semibold text-ink">作業標準治具清單</p>
          ${fixturesHtml}
        </div>
        <div class="flex flex-wrap gap-2">
          <span class="chip">正式規則 ${supportOptions.has_rules ? "已建立" : "未建立"}</span>
        </div>
      </div>
      <div class="mt-3 border-t border-slate-200 pt-3 text-sm text-slate">
        <p class="font-semibold text-ink">高度計算：單件高度 + 作業標準治具高度 + 墊塊總高度覆寫值</p>
        <p class="mt-1">「墊塊總高度」不含產品本身高度。留空時使用作業標準治具清單；有填寫時，墊塊 / 隔離類治具改用填入值。</p>
        <p class="mt-1 text-xs font-semibold text-ink">例：產品 10 mm、托盤 3 mm、墊塊 5 mm。留空為 18 mm；填 6 mm 則為 19 mm。</p>
      </div>
    `;
  }

  function renderMachineCards() {
    const machines = getMachines();
    if (!machines.length) {
      machineCardsRoot.innerHTML = `<div class="subtle-card text-sm text-slate">目前沒有可用的${config.machineLabel}。</div>`;
      return;
    }

    machineCardsRoot.innerHTML = machines
      .map((machine) => {
        const active = machine.machine_id === selectedMachineId;
        return `
          <button type="button" class="device-card ${active ? "device-card-active" : ""}" data-machine-pick="${machine.machine_id}">
            <div class="mb-2 flex items-start justify-between gap-3">
              <div>
                <p class="text-[10px] uppercase tracking-wide ${active ? "text-white/70" : "text-slate"}">${machine.machine_code}</p>
                <h3 class="mt-0.5 text-base font-bold leading-tight ${active ? "text-white" : "text-ink"}">${machine.machine_name}</h3>
              </div>
              ${createStatusPill(machine.machine_status, machine.machine_status)}
            </div>
            <div class="grid gap-1.5 text-[11px] ${active ? "text-white/80" : "text-slate"}">
              <div class="flex items-center justify-between">
                <span>層數</span>
                <strong class="${active ? "text-white" : "text-ink"}">${machine.total_layers}</strong>
              </div>
              <div class="flex items-center justify-between">
                <span>每層位置數</span>
                <strong class="${active ? "text-white" : "text-ink"}">${machine.positions_per_layer}</strong>
              </div>
              <div class="flex items-center justify-between">
                <span>基礎層高</span>
                <strong class="${active ? "text-white" : "text-ink"}">${formatNumber(machine.base_layer_gap)} mm</strong>
              </div>
            </div>
          </button>
        `;
      })
      .join("");
  }

  function renderMachineInfo() {
    const machine = getSelectedMachine();
    if (!machine) {
      form.elements[config.machineIdPayloadKey].value = "";
      machineInfoRoot.innerHTML = `<p class="text-sm text-slate">請先點選一台${config.machineLabel}。</p>`;
      return;
    }

    form.elements[config.machineIdPayloadKey].value = String(machine.machine_id);
    machineInfoRoot.innerHTML = `
      <div class="metric-strip">
        <div class="info-tile">
          <p class="text-xs uppercase tracking-wide text-slate">目前選擇</p>
          <p class="mt-2 text-xl font-bold text-ink">${escapeHtml(machine.machine_code)}</p>
          <p class="mt-1 text-sm text-slate">${escapeHtml(machine.machine_name)}</p>
        </div>
        <div class="info-tile">
          <p class="text-xs uppercase tracking-wide text-slate">層數 x 每層位置數</p>
          <p class="mt-2 text-xl font-bold text-ink">${machine.total_layers} x ${machine.positions_per_layer}</p>
          <p class="mt-1 text-sm text-slate">前 / 後雙面放盤皆計入容量</p>
        </div>
        <div class="info-tile">
          <p class="text-xs uppercase tracking-wide text-slate">有效空間</p>
          <p class="mt-2 text-xl font-bold text-ink">${formatNumber(machine.effective_width)} x ${formatNumber(machine.effective_depth)} mm</p>
          <p class="mt-1 text-sm text-slate">總高度 ${formatNumber(machine.total_inner_height)} mm</p>
        </div>
      </div>
    `;
  }

  function renderRecommendationDetail() {
    const recommendation =
      layoutResult?.results.find((entry) => entry.machine_id === selectedMachineId) ||
      layoutResult?.results[0];

    if (!recommendation) {
      recommendationDetail.innerHTML =
        '<p class="text-sm text-slate">先輸入品項後按下試算，這裡會顯示設備可行性、裝載率與層位建議。</p>';
      return;
    }

    const matchReasons = recommendation.match_reasons || [];
    const warnings = recommendation.warnings || [];
    const conflicts = recommendation.conflicts || [];

    recommendationDetail.innerHTML = `
      <div class="space-y-4">
        <div class="grid gap-4 xl:grid-cols-[1.1fr,1fr]">
          <div class="subtle-card">
            <div class="toolbar-row">
              <div>
                <p class="text-sm text-slate">選定${config.machineLabel}</p>
                <h4 class="mt-1 text-xl font-bold text-ink">${escapeHtml(recommendation.machine_code)} | ${escapeHtml(recommendation.machine_name)}</h4>
              </div>
              ${createStatusPill(recommendation.feasible ? "可行" : "不可行", recommendation.feasible ? "active" : "needs_change")}
            </div>
            <div class="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div class="info-tile">
                <p class="text-xs uppercase tracking-wide text-slate">預估裝載率</p>
                <p class="mt-2 text-2xl font-bold text-ink">${formatNumber(recommendation.estimated_load_rate)}%</p>
              </div>
              <div class="info-tile">
                <p class="text-xs uppercase tracking-wide text-slate">推薦分數</p>
                <p class="mt-2 text-2xl font-bold text-ink">${formatNumber(recommendation.recommendation_score)} 分</p>
              </div>
              <div class="info-tile">
                <p class="text-xs uppercase tracking-wide text-slate">需求位置 / 容量</p>
                <p class="mt-2 text-2xl font-bold text-ink">${recommendation.total_required_positions} / ${recommendation.total_capacity_positions}</p>
              </div>
              <div class="info-tile">
                <p class="text-xs uppercase tracking-wide text-slate">層數 x 每層位置數</p>
                <p class="mt-2 text-2xl font-bold text-ink">${recommendation.total_layers} x ${recommendation.positions_per_layer}</p>
              </div>
            </div>
          </div>
          <div class="subtle-card">
            <p class="text-sm font-semibold text-ink">判斷說明</p>
            <div class="mt-3 list-stack">
              ${
                matchReasons.length
                  ? matchReasons
                      .map((reason) => `<div class="rounded-2xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">${escapeHtml(reason)}</div>`)
                      .join("")
                  : '<div class="rounded-2xl bg-slate-100 px-3 py-2 text-sm text-slate">目前沒有額外加分原因。</div>'
              }
              ${
                warnings.length
                  ? warnings
                      .map((warning) => `<div class="rounded-2xl bg-amber-50 px-3 py-2 text-sm text-amber-700">${escapeHtml(warning)}</div>`)
                      .join("")
                  : ""
              }
              ${
                conflicts.length
                  ? conflicts
                      .map((conflict) => `<div class="rounded-2xl bg-red-50 px-3 py-2 text-sm text-red-700">${escapeHtml(conflict)}</div>`)
                      .join("")
                  : '<div class="rounded-2xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">目前沒有明顯衝突，可進一步建立批次。</div>'
              }
            </div>
          </div>
        </div>
        <div class="grid gap-4 xl:grid-cols-[1.1fr,1fr]">
          <div class="subtle-card">
            <p class="text-sm font-semibold text-ink">品項分析</p>
            <div class="mt-3 list-stack">
              ${recommendation.item_analysis
                .map((item) => {
                  const relationHtml = item.support_block_relation
                    ? createStatusPill(item.support_block_relation, item.support_block_relation)
                    : '<span class="chip">未指定正式規則</span>';
                  return `
                    <div class="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <div class="toolbar-row">
                        <div>
                          <p class="font-semibold text-ink">${escapeHtml(item.part_no)} | ${escapeHtml(item.part_name)}${item.spec_name ? ` / ${escapeHtml(item.spec_name)}` : ""}</p>
                          <p class="mt-1 text-sm text-slate">需求高度 ${formatNumber(item.required_height)} mm / 需求位置 ${item.tray_count}</p>
                        </div>
                        <div class="flex flex-wrap gap-2">
                          ${relationHtml}
                          ${createStatusPill(item.height_fits ? "高度可行" : "高度超限", item.height_fits ? "active" : "needs_change")}
                        </div>
                      </div>
                    </div>
                  `;
                })
                .join("")}
            </div>
          </div>
          <div class="subtle-card">
            <p class="text-sm font-semibold text-ink">前 / 後位置建議</p>
            <div class="mt-3 list-stack">
              ${
                recommendation.layer_suggestions.length
                  ? recommendation.layer_suggestions
                      .slice(0, 16)
                      .map(
                        (item) => `
                          <div class="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm">
                            <p class="font-semibold text-ink">第 ${item.layer_no} 層 / ${escapeHtml(item.position_label)} 位置 / ${escapeHtml(item.part_no)}${item.spec_name ? ` / ${escapeHtml(item.spec_name)}` : ""}</p>
                            <p class="mt-1 text-slate">托盤 ${item.tray_index} / 總高度 ${formatNumber(item.required_height)} mm${item.support_block_code ? ` / 墊塊 ${escapeHtml(item.support_block_code)}` : ""}</p>
                          </div>
                        `
                      )
                      .join("")
                  : '<div class="rounded-2xl bg-slate-100 px-3 py-2 text-sm text-slate">目前沒有層位建議資料。</div>'
              }
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderRecommendations() {
    const rows = layoutResult?.results || [];
    renderTable(
      recommendationsRoot,
      [
        { key: "machine_code", label: config.machineShortLabel },
        { key: "machine_name", label: `${config.machineLabel}名稱` },
        {
          key: "feasible",
          label: "可行性",
          render: (row) => createStatusPill(row.feasible ? "可行" : "不可行", row.feasible ? "active" : "needs_change")
        },
        {
          key: "estimated_load_rate",
          label: "預估裝載率",
          render: (row) => `${formatNumber(row.estimated_load_rate)}%`
        },
        {
          key: "positions",
          label: "需求 / 容量",
          render: (row) => `${row.total_required_positions} / ${row.total_capacity_positions}`
        },
        {
          key: "recommendation_score",
          label: "推薦分數",
          render: (row) => `${formatNumber(row.recommendation_score)} 分`
        },
        {
          key: "actions",
          label: "操作",
          render: (row) =>
            `<button type="button" class="btn-secondary text-xs" data-use-recommendation="${row.machine_id}">${
              row.machine_id === selectedMachineId ? "目前選擇" : "改用此設備"
            }</button>`
        }
      ],
      rows,
      { emptyMessage: `請先建立${config.itemLabel}品項並執行試算。` }
    );

    renderRecommendationDetail();
  }

  async function refresh() {
    supportOptionsCache.clear();
    syncSelectedMachine();
    renderMachineCards();
    renderMachineInfo();
    await Promise.all(Array.from(itemsRoot.children).map((row) => syncRow(row)));

    const rows = await config.listBatches({});
    renderTable(
      batchesRoot,
      [
        { key: "batch_no", label: "批次號" },
        {
          key: "planned_date",
          label: "計畫日期",
          render: (row) => formatDateTime(row.planned_date)
        },
        {
          key: config.machineCodeKey,
          label: config.machineShortLabel,
          render: (row) => row[config.machineCodeKey] || "-"
        },
        {
          key: "estimated_load_rate",
          label: "預估裝載率",
          render: (row) =>
            row.estimated_load_rate === null ? "-" : `${formatNumber(row.estimated_load_rate)}%`
        },
        {
          key: "status",
          label: "狀態",
          render: (row) => createStatusPill(row.status, row.status)
        },
        { key: "item_count", label: "品項數" }
      ],
      rows,
      { emptyMessage: `目前沒有${config.pageLabel}批次資料。` }
    );

    renderRecommendations();
  }

  function resetBatchForm() {
    resetForm(form, {
      planned_date: todayLocalInputValue(),
      status: "planned",
      [config.machineIdPayloadKey]: selectedMachineId ? String(selectedMachineId) : ""
    });
    itemsRoot.innerHTML = "";
    createItemRow();
    layoutResult = null;
    renderMachineInfo();
    renderRecommendations();
  }

  function bind() {
    document.getElementById(config.addItemButtonId).addEventListener("click", () => createItemRow());
    document.getElementById(config.resetButtonId).addEventListener("click", resetBatchForm);

    itemsRoot.addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove-item]");
      if (!button) {
        return;
      }

      if (itemsRoot.children.length > 1) {
        button.closest("[data-item-row]").remove();
      }
    });

    itemsRoot.addEventListener("change", async (event) => {
      const row = event.target.closest("[data-item-row]");
      if (!row) {
        return;
      }

      const productSelect = event.target.closest('select[name="product_id"]');
      const supportSelect = event.target.closest('select[name="support_block_id"]');

      if (productSelect || supportSelect) {
        await syncRow(row);
      }
    });

    machineCardsRoot.addEventListener("click", (event) => {
      const button = event.target.closest("[data-machine-pick]");
      if (!button) {
        return;
      }

      selectedMachineId = Number(button.dataset.machinePick);
      form.elements[config.machineIdPayloadKey].value = String(selectedMachineId);
      renderMachineCards();
      renderMachineInfo();
      renderRecommendationDetail();
    });

    document.getElementById(config.calculateButtonId).addEventListener("click", async () => {
      try {
        const items = collectItems();
        const previousMachineId = selectedMachineId;
        layoutResult = await config.calculateLayout({ items });
        if (
          !previousMachineId ||
          !layoutResult.results.some((result) => result.machine_id === previousMachineId)
        ) {
          selectedMachineId = layoutResult.results[0]?.machine_id || null;
        }
        form.elements[config.machineIdPayloadKey].value = selectedMachineId
          ? String(selectedMachineId)
          : "";
        renderMachineCards();
        renderMachineInfo();
        renderRecommendations();
        context.showToast(`${config.pageLabel}試算完成。`, "success");
      } catch (error) {
        context.showToast(error.message || `${config.pageLabel}試算失敗。`, "error");
      }
    });

    recommendationsRoot.addEventListener("click", (event) => {
      const button = event.target.closest("[data-use-recommendation]");
      if (!button) {
        return;
      }

      selectedMachineId = Number(button.dataset.useRecommendation);
      form.elements[config.machineIdPayloadKey].value = String(selectedMachineId);
      renderMachineCards();
      renderMachineInfo();
      renderRecommendations();
      context.showToast(`已切換為 ${config.machineLabel} 推薦結果。`, "info");
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const payload = serializeForm(form);
        const items = collectItems();
        const request = {
          batch_no: payload.batch_no,
          planned_date: payload.planned_date,
          status: payload.status,
          operator_name: payload.operator_name,
          notes: payload.notes,
          items
        };

        request[config.machineIdPayloadKey] = payload[config.machineIdPayloadKey]
          ? Number(payload[config.machineIdPayloadKey])
          : undefined;

        await config.createBatch(request);
        context.showToast(`${config.pageLabel}批次已建立。`, "success");
        resetBatchForm();
        await context.refreshAll();
      } catch (error) {
        context.showToast(error.message || `${config.pageLabel}批次建立失敗。`, "error");
      }
    });
  }

  return {
    init() {
      bind();
      syncSelectedMachine();
      resetBatchForm();
    },
    refresh
  };
}
