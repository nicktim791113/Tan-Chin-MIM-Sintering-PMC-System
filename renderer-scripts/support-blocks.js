import { renderTable } from "./components/table.js";
import {
  createStatusPill,
  escapeHtml,
  formatDateTime,
  formatNumber,
  humanizeFixtureQuickType,
  humanizeFixtureType,
  resetForm,
  serializeForm
} from "./utils.js";

const FIXTURE_TYPES = ["tray", "isolate", "support_block", "foot", "other"];
const RULE_OPTIONS = [
  { value: "unset", label: "請選擇相容規則" },
  { value: "recommended", label: "推薦" },
  { value: "allowed", label: "可用" },
  { value: "restricted", label: "限制" }
];

function formatProductSpecLabel(product) {
  return `${product.product_code} | ${product.product_name} / ${product.spec_name}`;
}

function buildFixtureSummaryLine(label, code, stackQuantity = null) {
  if (!code) {
    return `<div>${escapeHtml(label)}：-</div>`;
  }

  const suffix = stackQuantity ? ` / 堆疊 ${stackQuantity}` : "";
  return `<div>${escapeHtml(label)}：${escapeHtml(code)}${escapeHtml(suffix)}</div>`;
}

export function createSupportBlocksModule(context) {
  const form = document.getElementById("support-block-form");
  const formTitle = document.getElementById("support-block-form-title");
  const tableRoot = document.getElementById("support-blocks-table");
  const productSelect = document.getElementById("support-rule-product-select");
  const productSummary = document.getElementById("support-rule-product-summary");
  const ruleGrid = document.getElementById("support-rule-grid");

  const searchModal = document.getElementById("support-block-search-modal");
  const searchModalClose = document.getElementById("support-block-search-modal-close");
  const searchModalBtn = document.getElementById("support-block-search-modal-btn");
  const searchCode = document.getElementById("search-support-block-code");
  const searchName = document.getElementById("search-support-block-name");
  const searchType = document.getElementById("search-support-block-type");
  const searchStatus = document.getElementById("search-support-block-status");
  const searchConfirmBtn = document.getElementById("support-block-search-confirm");
  const searchFilterClearBtn = document.getElementById("support-block-filter-clear");
  const resultCount = document.getElementById("support-block-result-count");

  let editingId = null;
  let selectedProductId = null;
  let ruleDrafts = new Map();

  const filters = {
    hasSearched: false,
    code: "",
    name: "",
    type: "all",
    status: "all"
  };

  function getFixtures() {
    return [...context.getState().supportBlocks].sort((left, right) => {
      const typeCompare = FIXTURE_TYPES.indexOf(left.fixture_type) - FIXTURE_TYPES.indexOf(right.fixture_type);
      if (typeCompare !== 0) {
        return typeCompare;
      }

      if (left.status !== right.status) {
        return left.status === "active" ? -1 : 1;
      }

      const quickTypeCompare = String(left.fixture_quick_type || "").localeCompare(
        String(right.fixture_quick_type || ""),
        "en"
      );
      if (quickTypeCompare !== 0) {
        return quickTypeCompare;
      }

      return left.block_code.localeCompare(right.block_code, "en");
    });
  }

  function getFilteredFixtures() {
    if (!filters.hasSearched) return [];
    return getFixtures().filter((fixture) => {
      if (filters.status !== "all" && fixture.status !== filters.status) return false;
      if (filters.type !== "all" && fixture.fixture_quick_type !== filters.type) return false;
      if (filters.code && !fixture.block_code?.toLowerCase().includes(filters.code.toLowerCase())) return false;
      if (filters.name && !fixture.block_name?.toLowerCase().includes(filters.name.toLowerCase())) return false;
      return true;
    });
  }

  function getSelectedProduct() {
    return getAvailableProducts().find((product) => product.id === selectedProductId) || null;
  }

  function getAvailableProducts() {
    return context.getState().products.filter((product) => product.status === "active");
  }

  function setDynamicFieldValue(fieldName, value) {
    const selectElement = form.elements[`${fieldName}_select`];
    const inputElement = form.elements[`${fieldName}_input`];
    if (!selectElement || !inputElement) return;

    selectElement.value = value || selectElement.options[0].value;
    if (selectElement.selectedIndex === -1 && value) {
      selectElement.value = "other";
      selectElement.classList.add("hidden");
      inputElement.parentElement.classList.remove("hidden");
      inputElement.value = value;
    } else {
      selectElement.classList.remove("hidden");
      inputElement.parentElement.classList.add("hidden");
      inputElement.value = "";
    }
  }

  function getDynamicFieldValue(payload, fieldName) {
    if (payload[`${fieldName}_select`] === "other") {
      return payload[`${fieldName}_input`] || "other";
    }
    return payload[`${fieldName}_select`];
  }

  function populateForm(fixtureId) {
    const fixture = context.getState().supportBlocks.find((entry) => entry.id === fixtureId);
    if (!fixture) {
      return;
    }

    editingId = fixtureId;
    formTitle.textContent = `編輯治具：${fixture.block_code}`;
    setDynamicFieldValue("fixture_quick_type", fixture.fixture_quick_type);
    setDynamicFieldValue("fixture_type", fixture.fixture_type);
    form.elements.block_code.value = fixture.block_code;
    form.elements.block_name.value = fixture.block_name;
    form.elements.shape_type.value = fixture.shape_type || "";
    form.elements.height.value = fixture.height || 0;
    form.elements.width.value = fixture.width || "";
    form.elements.length.value = fixture.length || "";
    form.elements.max_stack_count.value = fixture.max_stack_count || 1;
    form.elements.status.value = fixture.status;
    form.elements.notes.value = fixture.notes || "";
    form.scrollIntoView({ behavior: "smooth", block: "start" });
    if (searchModal && !searchModal.classList.contains("hidden")) {
      searchModal.classList.add("hidden");
    }
  }

  function resetFixtureForm() {
    editingId = null;
    formTitle.textContent = "新增治具";
    resetForm(form, {
      fixture_quick_type_select: "",
      fixture_type_select: "",
      max_stack_count: "",
      status: ""
    });
    setDynamicFieldValue("fixture_quick_type", "");
    setDynamicFieldValue("fixture_type", "");
  }

  function syncSelectedProduct() {
    const products = getAvailableProducts();
    if (!products.length) {
      selectedProductId = null;
      ruleDrafts = new Map();
      return;
    }

    if (products.some((product) => product.id === selectedProductId)) {
      return;
    }
    selectedProductId = null;
    ruleDrafts = new Map();
  }

  async function loadRulesForProduct(productId) {
    if (!productId) {
      ruleDrafts = new Map();
      return;
    }

    const rules = await context.api.supportBlocks.listRelations({ product_id: productId });
    ruleDrafts = new Map(
      rules.map((rule) => [
        rule.support_block_id,
        {
          compatibility_status: rule.compatibility_status,
          priority: Number(rule.priority || 0),
          notes: rule.notes || ""
        }
      ])
    );
  }

  function renderProductSelector() {
    const products = getAvailableProducts();
    productSelect.innerHTML = [
      '<option value="">請選擇作業標準</option>',
      ...products.map((product) => {
        const selected = product.id === selectedProductId ? "selected" : "";
        return `<option value="${product.id}" ${selected}>${escapeHtml(formatProductSpecLabel(product))}</option>`;
      })
    ].join("");
  }

  function renderProductSummary() {
    const product = getSelectedProduct();
    if (!product) {
      const message = getAvailableProducts().length
        ? "請先選擇作業標準，之後才能設定治具關聯規則。"
        : "請先建立產品主檔與製程規格，之後才能設定治具關聯規則。";
      productSummary.innerHTML = `<div class="subtle-card text-sm text-slate">${escapeHtml(message)}</div>`;
      return;
    }

    const entries = Array.from(ruleDrafts.values());
    const recommendedCount = entries.filter((entry) => entry.compatibility_status === "recommended").length;
    const allowedCount = entries.filter((entry) => entry.compatibility_status === "allowed").length;
    const restrictedCount = entries.filter((entry) => entry.compatibility_status === "restricted").length;

    productSummary.innerHTML = `
      <div class="space-y-4">
        <div>
          <p class="text-sm text-slate">目前選取的製程規格</p>
          <h3 class="mt-1 text-2xl font-black text-ink">${escapeHtml(product.product_code)} | ${escapeHtml(product.product_name)}</h3>
          <p class="mt-2 text-sm font-semibold text-slate-600">規格：${escapeHtml(product.spec_name)} / ${escapeHtml(product.spec_code)}</p>
        </div>
        <div class="metric-strip">
          <div class="info-tile">
            <p class="text-xs uppercase tracking-wide text-slate">產品高度</p>
            <p class="mt-2 text-2xl font-bold text-ink">${formatNumber(product.product_height)} mm</p>
          </div>
          <div class="info-tile">
            <p class="text-xs uppercase tracking-wide text-slate">單盤容量</p>
            <p class="mt-2 text-2xl font-bold text-ink">${product.tray_capacity} pcs</p>
          </div>
          <div class="info-tile">
            <p class="text-xs uppercase tracking-wide text-slate">混裝設定</p>
            <div class="mt-3">
              ${
                product.can_mix_load
                  ? '<span class="status-pill bg-emerald-100 text-emerald-700">可混裝</span>'
                  : '<span class="status-pill bg-slate-200 text-slate-700">不可混裝</span>'
              }
            </div>
          </div>
        </div>
        <div class="subtle-card">
          <p class="text-sm font-semibold text-ink">目前已指定治具</p>
          <div class="mt-3 list-stack text-sm text-slate">
            ${buildFixtureSummaryLine("托盤", product.tray_fixture_code)}
            ${buildFixtureSummaryLine("墊塊", product.support_fixture_code, product.support_stack_quantity)}
            ${buildFixtureSummaryLine("陶瓷托盤", product.ceramic_tray_fixture_code)}
            ${buildFixtureSummaryLine("墊腳", product.foot_fixture_code)}
          </div>
        </div>
        <div class="subtle-card">
          <div class="toolbar-row">
            <p class="text-sm font-semibold text-ink">關聯規則統計</p>
            <div class="flex flex-wrap gap-2">
              <span class="chip">推薦 ${recommendedCount}</span>
              <span class="chip">可用 ${allowedCount}</span>
              <span class="chip">限制 ${restrictedCount}</span>
            </div>
          </div>
          <p class="mt-3 text-sm text-slate">
            這裡設定的是「這一筆製程規格」可搭配哪些治具，而不是整個產品主檔共用的固定治具。
          </p>
        </div>
      </div>
    `;
  }

  function updateDraft(fixtureId, partial) {
    const current = ruleDrafts.get(fixtureId) || {
      compatibility_status: "unset",
      priority: 0,
      notes: ""
    };
    const next = { ...current, ...partial };
    if (
      next.compatibility_status === "unset" &&
      Number(next.priority || 0) === 0 &&
      !String(next.notes || "").trim()
    ) {
      ruleDrafts.delete(fixtureId);
      return;
    }

    ruleDrafts.set(fixtureId, next);
  }

  function renderFixtureRuleCard(fixture) {
    const draft = ruleDrafts.get(fixture.id) || {
      compatibility_status: "unset",
      priority: 0,
      notes: ""
    };

    return `
      <div class="subtle-card" data-rule-row="${fixture.id}">
        <div class="toolbar-row">
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <h4 class="text-lg font-bold text-ink">${escapeHtml(fixture.block_code)} | ${escapeHtml(fixture.block_name)}</h4>
              ${createStatusPill(fixture.status, fixture.status)}
              <span class="chip">${escapeHtml(humanizeFixtureQuickType(fixture.fixture_quick_type))}</span>
              <span class="chip">${escapeHtml(humanizeFixtureType(fixture.fixture_type))}</span>
              ${
                draft.compatibility_status !== "unset"
                  ? createStatusPill(draft.compatibility_status, draft.compatibility_status)
                  : ""
              }
            </div>
            <p class="mt-2 text-sm text-slate">
              ${escapeHtml(fixture.shape_type || "未分類")} / 高度 ${formatNumber(fixture.height)} mm / 最大堆疊 ${fixture.max_stack_count}
            </p>
          </div>
          <div class="grid gap-3 sm:grid-cols-[180px,110px]">
            <label class="field">
              <span class="label">相容規則</span>
              <select class="select" data-rule-status="${fixture.id}">
                ${RULE_OPTIONS.map((option) => {
                  const selected = option.value === draft.compatibility_status ? "selected" : "";
                  return `<option value="${option.value}" ${selected}>${option.label}</option>`;
                }).join("")}
              </select>
            </label>
            <label class="field">
              <span class="label">優先序</span>
              <input class="input" type="number" min="0" step="1" value="${draft.priority || ""}" data-rule-priority="${fixture.id}">
            </label>
          </div>
        </div>
        <label class="field mt-4">
          <span class="label">規則備註</span>
          <textarea class="textarea" data-rule-notes="${fixture.id}" placeholder="例如：只允許用於高溫規格、需雙層堆疊、不可混裝時使用">${escapeHtml(draft.notes)}</textarea>
        </label>
      </div>
    `;
  }

  function renderRuleGrid() {
    const product = getSelectedProduct();
    const fixtures = getFixtures();

    if (!product) {
      ruleGrid.innerHTML = '<div class="subtle-card text-sm text-slate">請先選擇一筆製程規格。</div>';
      return;
    }

    if (!fixtures.length) {
      ruleGrid.innerHTML = '<div class="subtle-card text-sm text-slate">目前還沒有治具資料。</div>';
      return;
    }

    ruleGrid.innerHTML = FIXTURE_TYPES.map((fixtureType) => {
      const fixturesOfType = fixtures.filter((fixture) => fixture.fixture_type === fixtureType);
      if (!fixturesOfType.length) {
        return "";
      }

      return `
        <div class="mb-6">
          <div class="toolbar-row mb-3">
            <div>
              <h4 class="text-xl font-bold text-ink">${escapeHtml(humanizeFixtureType(fixtureType))}</h4>
              <p class="text-sm text-slate">設定這個製程規格可搭配、推薦或限制使用的${escapeHtml(humanizeFixtureType(fixtureType))}。</p>
            </div>
          </div>
          <div class="list-stack">
            ${fixturesOfType.map((fixture) => renderFixtureRuleCard(fixture)).join("")}
          </div>
        </div>
      `;
    }).join("");
  }

  async function saveRules() {
    if (!selectedProductId) {
      throw new Error("請先選擇要設定的製程規格。");
    }

    const rules = Array.from(ruleDrafts.entries()).map(([supportBlockId, entry]) => ({
      support_block_id: supportBlockId,
      compatibility_status: entry.compatibility_status,
      priority: Number(entry.priority || 0),
      notes: entry.notes
    }));

    await context.api.supportBlocks.replaceRulesForProduct({
      product_id: selectedProductId,
      rules
    });
    context.showToast("治具關聯規則已儲存。", "success");
    await context.refreshAll();
  }

  function bind() {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const payload = serializeForm(form);
      const request = {
        fixture_quick_type: getDynamicFieldValue(payload, "fixture_quick_type"),
        fixture_type: getDynamicFieldValue(payload, "fixture_type"),
        block_code: payload.block_code,
        block_name: payload.block_name,
        shape_type: payload.shape_type,
        height: Number(payload.height || 0),
        width: payload.width ? Number(payload.width) : null,
        length: payload.length ? Number(payload.length) : null,
        max_stack_count: Number(payload.max_stack_count || 1),
        status: payload.status,
        notes: payload.notes
      };

      if (editingId) {
        await context.api.supportBlocks.update({ id: editingId, ...request });
        context.showToast("治具資料已更新。", "success");
      } else {
        await context.api.supportBlocks.create(request);
        context.showToast("治具資料已新增。", "success");
      }

      resetFixtureForm();
      await context.refreshAll();
    });

    document.querySelectorAll("[data-dynamic-field]").forEach(container => {
      const selectElement = container.querySelector("select");
      const inputWrapper = container.querySelector(".hidden.relative") || container.querySelector("div:last-child");
      const inputElement = inputWrapper.querySelector("input");
      const resetBtn = inputWrapper.querySelector("[data-dynamic-reset]");

      selectElement.addEventListener("change", () => {
        if (selectElement.value === "other") {
          selectElement.classList.add("hidden");
          inputWrapper.classList.remove("hidden");
          inputElement.focus();
        }
      });

      resetBtn.addEventListener("click", () => {
        inputWrapper.classList.add("hidden");
        selectElement.classList.remove("hidden");
        selectElement.value = selectElement.options[0].value;
        inputElement.value = "";
      });
    });

    if (searchModalBtn) {
      searchModalBtn.addEventListener("click", () => {
        searchModal.classList.remove("hidden");
        if (!filters.hasSearched) {
          resultCount.textContent = "請設定條件並開始搜尋";
          tableRoot.innerHTML = "";
        }
      });
    }

    if (searchModalClose) {
      searchModalClose.addEventListener("click", () => searchModal.classList.add("hidden"));
    }

    if (searchConfirmBtn) {
      searchConfirmBtn.addEventListener("click", () => {
        filters.hasSearched = true;
        filters.code = searchCode.value;
        filters.name = searchName.value;
        filters.type = searchType.value;
        filters.status = searchStatus.value;
        renderFixtureTable();
      });
    }

    if (searchFilterClearBtn) {
      searchFilterClearBtn.addEventListener("click", () => {
        filters.hasSearched = false;
        filters.code = "";
        filters.name = "";
        filters.type = "all";
        filters.status = "all";
        if (searchCode) searchCode.value = "";
        if (searchName) searchName.value = "";
        if (searchType) searchType.value = "all";
        if (searchStatus) searchStatus.value = "all";
        renderFixtureTable();
      });
    }

    document.getElementById("support-block-form-reset").addEventListener("click", resetFixtureForm);
    tableRoot.addEventListener("click", (event) => {
      const button = event.target.closest("[data-support-block-edit]");
      if (button) {
        populateForm(Number(button.dataset.supportBlockEdit));
      }
    });

    productSelect.addEventListener("change", async () => {
      selectedProductId = Number(productSelect.value) || null;
      await loadRulesForProduct(selectedProductId);
      renderProductSummary();
      renderRuleGrid();
    });

    ruleGrid.addEventListener("change", (event) => {
      const statusTarget = event.target.closest("[data-rule-status]");
      const priorityTarget = event.target.closest("[data-rule-priority]");

      if (statusTarget) {
        const fixtureId = Number(statusTarget.dataset.ruleStatus);
        updateDraft(fixtureId, { compatibility_status: statusTarget.value });
        renderProductSummary();
        renderRuleGrid();
        return;
      }

      if (priorityTarget) {
        const fixtureId = Number(priorityTarget.dataset.rulePriority);
        updateDraft(fixtureId, { priority: Number(priorityTarget.value || 0) });
        renderProductSummary();
      }
    });

    ruleGrid.addEventListener("input", (event) => {
      const notesTarget = event.target.closest("[data-rule-notes]");
      if (!notesTarget) {
        return;
      }

      const fixtureId = Number(notesTarget.dataset.ruleNotes);
      updateDraft(fixtureId, { notes: notesTarget.value });
    });

    document.getElementById("support-rule-save").addEventListener("click", () => {
      saveRules().catch((error) => context.showToast(error.message, "error"));
    });
    document.getElementById("support-rule-reset").addEventListener("click", async () => {
      await loadRulesForProduct(selectedProductId);
      renderProductSummary();
      renderRuleGrid();
      context.showToast("已還原成目前已儲存的規則。", "info");
    });
    document.getElementById("support-rule-clear").addEventListener("click", () => {
      ruleDrafts = new Map();
      renderProductSummary();
      renderRuleGrid();
      context.showToast("已清空畫面上的規則草稿，尚未寫入資料庫。", "info");
    });
  }

  function renderFixtureTable() {
    if (!filters.hasSearched) {
      tableRoot.innerHTML = "";
      if (resultCount) resultCount.textContent = "請設定條件並開始搜尋";
      return;
    }

    const results = getFilteredFixtures();
    if (resultCount) resultCount.textContent = `找到 ${results.length} 筆資料`;

    renderTable(
      tableRoot,
      [
        { key: "block_code", label: "治具代碼" },
        { key: "block_name", label: "治具名稱" },
        {
          key: "fixture_quick_type",
          label: "治具材質與外形",
          render: (row) => humanizeFixtureQuickType(row.fixture_quick_type)
        },
        {
          key: "fixture_type",
          label: "排盤用途 (系統邏輯)",
          render: (row) => humanizeFixtureType(row.fixture_type)
        },
        { key: "shape_type", label: "形狀分類", render: (row) => row.shape_type || "-" },
        {
          key: "height",
          label: "高度",
          render: (row) => `${formatNumber(row.height)} mm`
        },
        {
          key: "max_stack_count",
          label: "最大堆疊",
          render: (row) => String(row.max_stack_count)
        },
        {
          key: "status",
          label: "狀態",
          render: (row) => createStatusPill(row.status, row.status)
        },
        {
          key: "updated_at",
          label: "更新時間",
          render: (row) => formatDateTime(row.updated_at)
        },
        {
          key: "actions",
          label: "操作",
          render: (row) =>
            `<button type="button" class="btn-secondary text-xs" data-support-block-edit="${row.id}">編輯</button>`
        }
      ],
      results,
      { emptyMessage: "沒有符合的治具資料。" }
    );
  }

  return {
    async init() {
      bind();
      resetFixtureForm();
      syncSelectedProduct();
      await loadRulesForProduct(selectedProductId);
      renderProductSelector();
      renderProductSummary();
      renderRuleGrid();
      renderFixtureTable();
    },
    async refresh() {
      syncSelectedProduct();
      renderProductSelector();
      await loadRulesForProduct(selectedProductId);
      renderProductSummary();
      renderRuleGrid();
      renderFixtureTable();

    }
  };
}
