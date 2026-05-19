import { renderTable } from "./components/table.js";
import {
  createStatusPill,
  escapeHtml,
  formatDateTime,
  formatNumber,
  humanizeFixtureQuickType,
  humanizeFixtureType,
  resetForm,
  serializeForm,
  setOptions
} from "./utils.js";

const FIXTURE_FIELD_MAP = {
  tray: { elementId: "product-tray-fixture-id", valueKey: "tray_fixture_id" },
  support_block: { elementId: "product-support-fixture-id", valueKey: "support_fixture_id" },
  ceramic_tray: { elementId: "product-ceramic-tray-fixture-id", valueKey: "ceramic_tray_fixture_id" },
  foot: { elementId: "product-foot-fixture-id", valueKey: "foot_fixture_id" }
};

const SOURCE_LABELS = {
  local: "本地建立",
  erp: "ERP 同步",
  hybrid: "混合維護"
};

const SYNC_LABELS = {
  local_only: "僅本地",
  pending_sync: "待同步",
  synced: "已同步",
  stale: "待更新",
  sync_error: "同步異常",
  unlinked: "未關聯"
};

const STATUS_RANK = {
  active: 0,
  inactive: 1,
  archived: 2
};

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

function createSyncPill(value) {
  const tone =
    value === "synced"
      ? "bg-emerald-100 text-emerald-700"
      : value === "pending_sync"
        ? "bg-sky-100 text-sky-700"
        : value === "stale"
          ? "bg-amber-100 text-amber-700"
          : value === "sync_error"
            ? "bg-red-100 text-red-700"
            : "bg-slate-200 text-slate-700";
  const label = SYNC_LABELS[value] || value || "-";
  return `<span class="status-pill ${tone}">${escapeHtml(label)}</span>`;
}

function fixtureSummary(spec) {
  const parts = [];
  if (spec.tray_fixture_code) {
    parts.push(`托盤：${spec.tray_fixture_code}`);
  }
  if (spec.support_fixture_code) {
    parts.push(`墊塊：${spec.support_fixture_code} x${spec.support_stack_quantity}`);
  }
  if (spec.ceramic_tray_fixture_code) {
    parts.push(`陶瓷托盤：${spec.ceramic_tray_fixture_code}`);
  }
  if (spec.foot_fixture_code) {
    parts.push(`墊腳：${spec.foot_fixture_code}`);
  }
  return parts.length ? parts.join("<br>") : "-";
}

function compareByStatus(left, right) {
  return (STATUS_RANK[left.status] ?? 99) - (STATUS_RANK[right.status] ?? 99);
}

function matchesQuery(values, rawQuery) {
  const query = String(rawQuery || "").trim().toLowerCase();
  if (!query) {
    return true;
  }
  return values.some((value) => String(value || "").toLowerCase().includes(query));
}

function normalizePageSize(value) {
  const size = Number(value);
  return PAGE_SIZE_OPTIONS.includes(size) ? size : PAGE_SIZE_OPTIONS[0];
}

function buildVisiblePages(totalPages, currentPage) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_value, index) => index + 1);
  }

  const pages = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
  if (currentPage <= 3) {
    pages.add(2);
    pages.add(3);
    pages.add(4);
  }
  if (currentPage >= totalPages - 2) {
    pages.add(totalPages - 1);
    pages.add(totalPages - 2);
    pages.add(totalPages - 3);
  }

  return [...pages]
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((left, right) => left - right);
}

function renderPagination(target, key, pageInfo) {
  if (!pageInfo.totalRows) {
    target.innerHTML = "";
    return;
  }

  const visiblePages = buildVisiblePages(pageInfo.totalPages, pageInfo.page);
  const numberButtons = visiblePages
    .map((page, index) => {
      const previous = visiblePages[index - 1];
      const gap = previous && page - previous > 1 ? '<span class="px-1 text-sm text-slate-400">…</span>' : "";
      const buttonClass = page === pageInfo.page ? "btn-primary text-xs" : "btn-secondary text-xs";
      return `${gap}<button type="button" class="${buttonClass}" data-pagination-target="${key}" data-pagination-page="${page}">${page}</button>`;
    })
    .join("");

  const firstDisabled = pageInfo.page === 1 ? "disabled" : "";
  const lastDisabled = pageInfo.page === pageInfo.totalPages ? "disabled" : "";
  const disabledClass = "disabled:cursor-not-allowed disabled:opacity-50";

  target.innerHTML = `
    <div class="product-pagination">
      <p class="product-pagination-meta">
        顯示 ${pageInfo.startIndex}-${pageInfo.endIndex} 筆，共 ${pageInfo.totalRows} 筆，第 ${pageInfo.page}/${pageInfo.totalPages} 頁
      </p>
      <div class="product-pagination-controls">
        <button type="button" class="btn-secondary text-xs ${disabledClass}" data-pagination-target="${key}" data-pagination-page="1" ${firstDisabled}>第一頁</button>
        <button type="button" class="btn-secondary text-xs ${disabledClass}" data-pagination-target="${key}" data-pagination-page="${pageInfo.page - 1}" ${firstDisabled}>上一頁</button>
        ${numberButtons}
        <button type="button" class="btn-secondary text-xs ${disabledClass}" data-pagination-target="${key}" data-pagination-page="${pageInfo.page + 1}" ${lastDisabled}>下一頁</button>
        <button type="button" class="btn-secondary text-xs ${disabledClass}" data-pagination-target="${key}" data-pagination-page="${pageInfo.totalPages}" ${lastDisabled}>最後頁</button>
      </div>
    </div>
  `;
}

export function createProductsModule(context) {
  const overviewModalBtn = document.getElementById("product-overview-modal-btn");
  const overviewModal = document.getElementById("product-overview-modal");
  const overviewModalClose = document.getElementById("product-overview-modal-close");
  const subviewButtons = Array.from(document.querySelectorAll("[data-product-subview-target]"));
  const subviewPanels = Array.from(document.querySelectorAll("[data-product-subview-panel]"));

  const masterSearchModal = document.getElementById("product-search-modal");
  const masterSearchModalClose = document.getElementById("product-search-modal-close");
  const masterSearchModalBtn = document.getElementById("product-master-search-modal-btn");
  const searchProductCode = document.getElementById("search-product-code");
  const searchProductName = document.getElementById("search-product-name");
  const searchErpItemCode = document.getElementById("search-erp-item-code");
  const searchErpItemId = document.getElementById("search-erp-item-id");
  const searchRevision = document.getElementById("search-revision");
  const searchSpecCount = document.getElementById("search-spec-count");
  const searchStatus = document.getElementById("search-status");
  const searchSyncStatus = document.getElementById("search-sync-status");
  const searchUpdatedAt = document.getElementById("search-updated-at");
  const searchConfirmBtn = document.getElementById("product-master-search-confirm");
  const masterLimitHint = document.getElementById("product-master-limit-hint");
  const masterPageSizeFilter = document.getElementById("product-master-page-size");
  const masterResultCount = document.getElementById("product-master-result-count");
  const masterFilterClearButton = document.getElementById("product-master-filter-clear");
  const masterForm = document.getElementById("product-master-form");
  const masterFormTitle = document.getElementById("product-master-form-title");
  const masterTableRoot = document.getElementById("product-masters-table");
  const masterPaginationRoot = document.getElementById("product-masters-pagination");

  const specSearchModal = document.getElementById("product-spec-search-modal");
  const specSearchModalClose = document.getElementById("product-spec-search-modal-close");
  const specSearchModalBtn = document.getElementById("product-spec-search-modal-btn");
  const searchSpecMasterId = document.getElementById("search-spec-master-id");
  const searchSpecCode = document.getElementById("search-spec-code");
  const searchSpecName = document.getElementById("search-spec-name");
  const searchSpecStatus = document.getElementById("search-spec-status");
  const searchSpecConfirmBtn = document.getElementById("product-spec-search-confirm");
  const specPageSizeFilter = document.getElementById("product-spec-page-size");
  const specFilterClearButton = document.getElementById("product-spec-filter-clear");
  const specResultCount = document.getElementById("product-spec-result-count");
  const specForm = document.getElementById("product-spec-form");
  const specFormTitle = document.getElementById("product-spec-form-title");
  const specMasterSelect = document.getElementById("product-spec-master-id");
  const specMasterSummary = document.getElementById("product-spec-master-summary");
  const specTableRoot = document.getElementById("products-table");
  const specPaginationRoot = document.getElementById("products-pagination");

  let editingMasterId = null;
  let editingSpecId = null;
  let selectedMasterId = null;
  let activeSubview = "masters";
  const filters = {
    masters: {
      hasSearched: false,
      product_code: "",
      product_name: "",
      erp_item_code: "",
      erp_item_id: "",
      revision: "",
      spec_count: "",
      status: "all",
      sync_status: "all",
      updated_at: ""
    },
    specs: {
      hasSearched: false,
      masterId: "",
      spec_code: "",
      spec_name: "",
      erp_spec_id: "",
      status: "all",
      sync_status: "all"
    }
  };

  const pagination = {
    masters: { page: 1, pageSize: PAGE_SIZE_OPTIONS[0] },
    specs: { page: 1, pageSize: PAGE_SIZE_OPTIONS[0] }
  };

  function getMasters() {
    return [...context.getState().productMasters].sort((left, right) => {
      const statusCompare = compareByStatus(left, right);
      if (statusCompare !== 0) {
        return statusCompare;
      }
      return left.product_code.localeCompare(right.product_code, "en");
    });
  }

  function getSpecs() {
    return [...context.getState().products].sort((left, right) => {
      const masterCompare = left.product_code.localeCompare(right.product_code, "en");
      if (masterCompare !== 0) {
        return masterCompare;
      }
      const statusCompare = compareByStatus(left, right);
      if (statusCompare !== 0) {
        return statusCompare;
      }
      return left.spec_code.localeCompare(right.spec_code, "en");
    });
  }

  function getSelectedMaster() {
    return getMasters().find((master) => master.id === selectedMasterId) || null;
  }

  function getActiveMasters() {
    return getMasters().filter((master) => master.status === "active");
  }

  function getSelectableMasters(selectedValue = selectedMasterId) {
    const activeMasters = getActiveMasters();
    const selectedMaster = getMasters().find((master) => String(master.id) === String(selectedValue));
    if (selectedMaster && !activeMasters.some((master) => master.id === selectedMaster.id)) {
      return [selectedMaster, ...activeMasters];
    }
    return activeMasters;
  }

  function getFixturesByType(fixtureType) {
    return context
      .getState()
      .supportBlocks.filter((fixture) => {
        if (fixture.status !== "active") return false;
        if (fixtureType === "support_block" && fixture.fixture_type === "isolate") return true;
        return fixture.fixture_type === fixtureType;
      })
      .sort((left, right) => left.block_code.localeCompare(right.block_code, "en"));
  }

  function getFilteredMasters() {
    if (!filters.masters.hasSearched) {
      return [];
    }

    return getMasters().filter((master) => {
      if (filters.masters.status !== "all" && master.status !== filters.masters.status) return false;
      if (filters.masters.sync_status !== "all" && master.sync_status !== filters.masters.sync_status) return false;
      
      const { product_code, product_name, erp_item_code, erp_item_id, revision, updated_at } = filters.masters;
      
      if (product_code && !master.product_code?.toLowerCase().includes(product_code.toLowerCase())) return false;
      if (product_name && !master.product_name?.toLowerCase().includes(product_name.toLowerCase())) return false;
      if (erp_item_code && !master.erp_item_code?.toLowerCase().includes(erp_item_code.toLowerCase())) return false;
      if (erp_item_id && !master.erp_item_id?.toLowerCase().includes(erp_item_id.toLowerCase())) return false;
      if (revision && !master.revision?.toLowerCase().includes(revision.toLowerCase())) return false;
      
      if (filters.masters.spec_count && master.spec_count !== Number(filters.masters.spec_count)) return false;
      if (updated_at && (!master.updated_at || !master.updated_at.startsWith(updated_at))) return false;

      return true;
    });
  }

  function getFilteredSpecs() {
    if (!filters.specs.hasSearched) {
      return [];
    }

    return getSpecs().filter((spec) => {
      if (filters.specs.status !== "all" && spec.status !== filters.specs.status) return false;
      if (filters.specs.masterId && String(spec.product_master_id) !== String(filters.specs.masterId)) return false;

      const { spec_code, spec_name } = filters.specs;
      
      if (spec_code && !spec.spec_code?.toLowerCase().includes(spec_code.toLowerCase())) return false;
      if (spec_name && !spec.spec_name?.toLowerCase().includes(spec_name.toLowerCase())) return false;

      return true;
    });
  }

  function buildPageInfo(rows, key) {
    const state = pagination[key];
    const totalRows = rows.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / state.pageSize));

    if (state.page > totalPages) {
      state.page = totalPages;
    }
    if (state.page < 1) {
      state.page = 1;
    }

    const start = totalRows === 0 ? 0 : (state.page - 1) * state.pageSize;
    const end = totalRows === 0 ? 0 : Math.min(start + state.pageSize, totalRows);

    return {
      rows: rows.slice(start, end),
      totalRows,
      totalPages,
      page: state.page,
      pageSize: state.pageSize,
      startIndex: totalRows === 0 ? 0 : start + 1,
      endIndex: end
    };
  }



  function switchSubview(view) {
    activeSubview = view;
    subviewButtons.forEach((button) => {
      button.classList.toggle("product-subtab-active", button.dataset.productSubviewTarget === view);
    });
    subviewPanels.forEach((panel) => {
      panel.classList.toggle("hidden", panel.dataset.productSubviewPanel !== view);
    });
  }

  function syncSelectedMaster() {
    const masters = getMasters();
    if (!masters.length || !selectedMasterId) {
      selectedMasterId = null;
      return;
    }
    if (masters.some((master) => master.id === selectedMasterId)) {
      return;
    }
    selectedMasterId = null;
  }

  function syncMasterOptions(selectedValue = selectedMasterId) {
    setOptions(specMasterSelect, getSelectableMasters(selectedValue), {
      placeholder: "請選擇產品主檔",
      valueKey: "id",
      labelKey: (item) => `${item.product_code} | ${item.product_name}`,
      selectedValue
    });
  }

  function syncSpecMasterFilterOptions() {
    const masters = getMasters();
    if (filters.specs.masterId && !masters.some((master) => String(master.id) === String(filters.specs.masterId))) {
      filters.specs.masterId = "";
    }

    setOptions(searchSpecMasterId, masters, {
      placeholder: "全部產品主檔",
      valueKey: "id",
      labelKey: (item) => `${item.product_code} | ${item.product_name}`,
      selectedValue: filters.specs.masterId
    });
  }

  
  function renderMasterSummary() {
    const master = getSelectedMaster();
    if (!master) {
      specMasterSummary.innerHTML = `
        <div class="product-summary-card text-sm text-slate">
          請先建立產品主檔，再新增對應的製程規格。
        </div>
      `;
      return;
    }

    const statusNote =
      master.status === "archived"
        ? "此產品主檔已封存，不會再出現在新作業選單中。"
        : master.status === "inactive"
          ? "此產品主檔目前停用中，建議確認後再新增規格。"
          : "此產品主檔可正常建立與維護製程規格。";

    specMasterSummary.innerHTML = `
      <div class="product-summary-card">
        <div class="product-summary-header">
          <div>
            <p class="text-xs uppercase tracking-wide text-slate">目前作業預設主檔</p>
            <h3 class="mt-1 text-base font-black text-ink">${escapeHtml(master.product_code)} | ${escapeHtml(master.product_name)}</h3>
          </div>
          <div class="flex flex-wrap gap-2">
            <span class="chip">${escapeHtml(SOURCE_LABELS[master.source_system] || master.source_system)}</span>
            ${createStatusPill(master.status, master.status)}
            ${createSyncPill(master.sync_status)}
          </div>
        </div>
        <div class="product-summary-metrics">
          <div class="product-summary-metric">
            <p class="text-xs uppercase tracking-wide text-slate">ERP 料號</p>
            <p class="mt-1 text-sm font-semibold text-ink">${escapeHtml(master.erp_item_code || "-")}</p>
          </div>
          <div class="product-summary-metric">
            <p class="text-xs uppercase tracking-wide text-slate">ERP 產品 ID</p>
            <p class="mt-1 text-sm font-semibold text-ink">${escapeHtml(master.erp_item_id || "-")}</p>
          </div>
          <div class="product-summary-metric">
            <p class="text-xs uppercase tracking-wide text-slate">主檔版次</p>
            <p class="mt-1 text-sm font-semibold text-ink">${escapeHtml(master.revision || "-")}</p>
          </div>
          <div class="product-summary-metric">
            <p class="text-xs uppercase tracking-wide text-slate">規格筆數</p>
            <p class="mt-1 text-sm font-semibold text-ink">${master.spec_count}</p>
          </div>
        </div>
        <p class="mt-2 text-sm text-slate">${escapeHtml(statusNote)}</p>
      </div>
    `;
  }

  function renderMasterTable() {
    if (masterLimitHint) {
      masterLimitHint.classList.toggle("hidden", !!filters.masters.query);
    }
    const pageInfo = buildPageInfo(getFilteredMasters(), "masters");
    masterResultCount.textContent =
      pageInfo.totalRows === 0
        ? "共 0 筆"
        : `顯示 ${pageInfo.startIndex}-${pageInfo.endIndex} / 共 ${pageInfo.totalRows} 筆`;

    renderTable(
      masterTableRoot,
      [
        { key: "product_code", label: "產品代碼" },
        { key: "product_name", label: "產品名稱" },
        {
          key: "erp_item_code",
          label: "ERP 料號",
          render: (row) => escapeHtml(row.erp_item_code || "-")
        },
        {
          key: "revision",
          label: "版次",
          render: (row) => escapeHtml(row.revision || "-")
        },
        {
          key: "spec_count",
          label: "規格筆數",
          render: (row) => String(row.spec_count || 0)
        },
        {
          key: "status",
          label: "狀態",
          render: (row) => createStatusPill(row.status, row.status)
        },
        {
          key: "sync_status",
          label: "同步狀態",
          render: (row) => createSyncPill(row.sync_status)
        },
        {
          key: "updated_at",
          label: "更新時間",
          render: (row) => formatDateTime(row.updated_at)
        },
        {
          key: "actions",
          label: "操作",
          render: (row) => `
            <div class="flex flex-wrap gap-2">
              <button type="button" class="btn-secondary text-xs" data-master-open-specs="${row.id}">查看規格</button>
              <button type="button" class="btn-secondary text-xs" data-master-edit="${row.id}">編輯</button>
              ${
                row.status === "active"
                  ? `<button type="button" class="btn-secondary text-xs" data-master-dispose="${row.id}">刪除 / 作廢</button>`
                  : `<button type="button" class="btn-secondary text-xs" data-master-restore="${row.id}">恢復 / 啟用</button>`
              }
            </div>
          `
        }
      ],
      pageInfo.rows,
      {
        emptyMessage: "目前條件下沒有產品主檔。",
        wrapperClass: "table-shell product-table-shell",
        emptyClass: "panel product-table-empty text-sm text-slate-500"
      }
    );
    renderPagination(masterPaginationRoot, "masters", pageInfo);
  }

  function renderSpecTable() {
    const pageInfo = buildPageInfo(getFilteredSpecs(), "specs");
    specResultCount.textContent =
      pageInfo.totalRows === 0
        ? "共 0 筆"
        : `顯示 ${pageInfo.startIndex}-${pageInfo.endIndex} / 共 ${pageInfo.totalRows} 筆`;

    renderTable(
      specTableRoot,
      [
        {
          key: "product_code",
          label: "產品 / 規格",
          render: (row) => `
            <div>
              <div class="font-semibold text-ink">${escapeHtml(row.product_code)} | ${escapeHtml(row.product_name)}</div>
              <div class="mt-1 text-xs text-slate-500">${escapeHtml(row.spec_name)} / ${escapeHtml(row.spec_code)}</div>
            </div>
          `
        },
        {
          key: "product_height",
          label: "產品高度",
          render: (row) => `${formatNumber(row.product_height)} mm`
        },
        {
          key: "tray_capacity",
          label: "單盤容量",
          render: (row) => `${row.tray_capacity} pcs`
        },
        {
          key: "fixtures",
          label: "治具配置",
          render: (row) => fixtureSummary(row)
        },
        {
          key: "status",
          label: "狀態",
          render: (row) => createStatusPill(row.status, row.status)
        },
        {
          key: "sync_status",
          label: "同步狀態",
          render: (row) => createSyncPill(row.sync_status)
        },
        {
          key: "updated_at",
          label: "更新時間",
          render: (row) => formatDateTime(row.updated_at)
        },
        {
          key: "actions",
          label: "操作",
          render: (row) => `
            <div class="flex flex-wrap gap-2">
              <button type="button" class="btn-secondary text-xs" data-spec-edit="${row.id}">編輯</button>
              ${
                row.status === "active"
                  ? `<button type="button" class="btn-secondary text-xs" data-spec-dispose="${row.id}">刪除 / 作廢</button>`
                  : `<button type="button" class="btn-secondary text-xs" data-spec-restore="${row.id}">恢復 / 啟用</button>`
              }
            </div>
          `
        }
      ],
      pageInfo.rows,
      {
        emptyMessage: "目前條件下沒有製程規格。",
        wrapperClass: "table-shell product-table-shell",
        emptyClass: "panel product-table-empty text-sm text-slate-500"
      }
    );
    renderPagination(specPaginationRoot, "specs", pageInfo);
  }

  
  function renderSpecFixturesList(fixtures = []) {
    const list = document.getElementById("product-spec-fixtures-list");
    if (!list) return;
    list.innerHTML = "";
    if (fixtures.length === 0) {
      list.innerHTML = '<div class="p-3 text-sm text-slate-500 text-center border border-dashed border-slate-200 rounded">尚無治具，請點擊右上角新增。</div>';
      return;
    }
    
    const allFixtures = context.getState().supportBlocks;
    let optionsHtml = '<option value="">請選擇治具</option>';
    allFixtures.forEach(fix => {
      optionsHtml += `<option value="${fix.id}">${escapeHtml(fix.block_code)} | ${escapeHtml(fix.block_name)} / ${formatNumber(fix.height)} mm</option>`;
    });

    fixtures.forEach((f, idx) => {
      const row = document.createElement("div");
      row.className = "flex flex-wrap items-center gap-2 p-2 bg-slate-50 border border-slate-100 rounded fixture-item-row";
      
      row.innerHTML = `
        <div class="flex-1 min-w-[200px]">
          <select class="select fixture-select" required>
            ${optionsHtml}
          </select>
        </div>
        <div class="w-24">
          <input type="number" class="input fixture-qty" min="1" step="1" value="${f.quantity || 1}" required placeholder="數量">
        </div>
        <button type="button" class="btn-danger text-xs fixture-remove">移除</button>
      `;
      
      const select = row.querySelector('.fixture-select');
      select.value = f.fixture_id || "";
      
      row.querySelector('.fixture-remove').addEventListener('click', () => {
        row.remove();
        if (list.children.length === 0) {
          list.innerHTML = '<div class="p-3 text-sm text-slate-500 text-center border border-dashed border-slate-200 rounded">尚無治具，請點擊右上角新增。</div>';
        }
      });
      
      list.appendChild(row);
    });
  }

  function getSpecFixturesFromDom() {
    const list = document.getElementById("product-spec-fixtures-list");
    if (!list) return [];
    const rows = list.querySelectorAll('.fixture-item-row');
    const fixtures = [];
    rows.forEach((row, idx) => {
      const fixture_id = parseInt(row.querySelector('.fixture-select').value, 10);
      const quantity = parseInt(row.querySelector('.fixture-qty').value, 10);
      if (fixture_id && quantity) {
        fixtures.push({
          fixture_id,
          quantity,
          sequence_order: idx + 1
        });
      }
    });
    return fixtures;
  }

  function populateMasterForm(masterId) {
    const master = getMasters().find((entry) => entry.id === masterId);
    if (!master) {
      return;
    }

    switchSubview("masters");
    editingMasterId = masterId;
    selectedMasterId = masterId;
    masterFormTitle.textContent = `編輯產品資料：${master.product_code}`;
    masterForm.elements.product_code.value = master.product_code;
    masterForm.elements.product_name.value = master.product_name;
    masterForm.elements.erp_item_code.value = master.erp_item_code || "";
    masterForm.elements.erp_item_id.value = master.erp_item_id || "";
    masterForm.elements.revision.value = master.revision || "";
    masterForm.elements.source_system.value = master.source_system || "local";
    masterForm.elements.sync_status.value = master.sync_status || "local_only";
    masterForm.elements.notes.value = master.notes || "";
    syncMasterOptions(selectedMasterId);
    renderMasterSummary();
    if (masterSearchModal) masterSearchModal.classList.add("hidden");
  }

  function populateSpecForm(specId) {
    const spec = getSpecs().find((entry) => entry.id === specId);
    if (!spec) {
      return;
    }

    switchSubview("specs");
    editingSpecId = specId;
    selectedMasterId = spec.product_master_id;
    filters.specs.masterId = String(spec.product_master_id || "");
    pagination.specs.page = 1;
    specFormTitle.textContent = `編輯作業標準：${spec.product_code} / ${spec.spec_name}`;
    specForm.elements.product_master_id.value = String(spec.product_master_id || "");
    specForm.elements.spec_code.value = spec.spec_code || "DEFAULT";
    specForm.elements.spec_name.value = spec.spec_name || "預設製程規格";
    specForm.elements.process_revision.value = spec.process_revision || "";
    specForm.elements.product_height.value = spec.product_height;
    specForm.elements.tray_capacity.value = spec.tray_capacity;
    renderSpecFixturesList(spec.spec_fixtures || []);
    specForm.elements.preferred_furnace_type.value = spec.preferred_furnace_type || "";
    specForm.elements.can_mix_load.checked = Boolean(spec.can_mix_load);
    specForm.elements.notes.value = spec.notes || "";
    syncMasterOptions(selectedMasterId);
    syncSpecMasterFilterOptions();
    
    renderMasterSummary();
    renderSpecTable();
    if (specSearchModal) specSearchModal.classList.add("hidden");
    specForm.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function resetMasterForm() {
    editingMasterId = null;
    masterFormTitle.textContent = "產品資料設定";
    resetForm(masterForm, {
      source_system: "local",
      sync_status: "local_only"
    });
  }

  function resetSpecForm(options = {}) {
    const { clearSelectedMaster = false } = options;
    editingSpecId = null;
    if (clearSelectedMaster) {
      selectedMasterId = null;
    }
    specFormTitle.textContent = "作業標準設定";
    resetForm(specForm, {
      product_master_id: selectedMasterId || "",
      spec_code: "",
      spec_name: "",
      process_revision: "",
      product_height: "",
      tray_capacity: "",
      can_mix_load: false
    });
    renderSpecFixturesList([]);
    syncMasterOptions(selectedMasterId);
    renderMasterSummary();
  }

  function clearMasterFilters() {
    filters.masters = {
      hasSearched: false,
      product_code: "",
      product_name: "",
      erp_item_code: "",
      erp_item_id: "",
      revision: "",
      spec_count: "",
      status: "all",
      sync_status: "all",
      updated_at: ""
    };
    searchProductCode.value = "";
    searchProductName.value = "";
    searchErpItemCode.value = "";
    searchErpItemId.value = "";
    searchRevision.value = "";
    searchSpecCount.value = "";
    searchStatus.value = "all";
    searchSyncStatus.value = "all";
    searchUpdatedAt.value = "";
    pagination.masters.page = 1;
    renderMasterTable();
  }

  function clearSpecFilters() {
    filters.specs = {
      hasSearched: false,
      masterId: "",
      spec_code: "",
      spec_name: "",
      status: "all"
    };
    if (searchSpecMasterId) searchSpecMasterId.value = "";
    if (searchSpecCode) searchSpecCode.value = "";
    if (searchSpecName) searchSpecName.value = "";
    if (searchSpecStatus) searchSpecStatus.value = "all";
    
    pagination.specs.page = 1;
    syncSpecMasterFilterOptions();
    renderSpecTable();
  }

  function jumpToSpecs(masterId) {
    selectedMasterId = masterId;
    filters.specs.masterId = String(masterId);
    filters.specs.hasSearched = true;
    pagination.specs.page = 1;
    syncMasterOptions(selectedMasterId);
    syncSpecMasterFilterOptions();
    renderMasterSummary();
    renderSpecTable();
    if (!editingSpecId) {
      resetSpecForm();
    }
    switchSubview("specs");
    if (specSearchModal) {
      specSearchModal.classList.remove("hidden");
    }
  }

  function applySelectedMasterToSpecFilter() {
    if (!selectedMasterId) {
      context.showToast("目前沒有可帶入的產品主檔。", "info");
      return;
    }

    filters.specs.masterId = String(selectedMasterId);
    pagination.specs.page = 1;
    syncSpecMasterFilterOptions();
    renderSpecTable();
    if (!editingSpecId) {
      resetSpecForm();
    }
  }

  function setPage(key, page) {
    const state = pagination[key];
    state.page = Math.max(1, Number(page) || 1);
    if (key === "masters") {
      renderMasterTable();
      return;
    }
    renderSpecTable();
  }

  async function disposeMaster(masterId) {
    const master = getMasters().find((entry) => entry.id === masterId);
    if (!master) {
      return;
    }

    const confirmed = window.confirm(
      `確定要處理產品主檔「${master.product_code}」嗎？\n\n系統會先檢查是否已被引用：\n- 未使用過：直接刪除\n- 已使用過：改為封存`
    );
    if (!confirmed) {
      return;
    }

    const result = await context.api.productMasters.dispose({ id: masterId });
    if (result.action === "deleted") {
      context.showToast(`產品主檔 ${master.product_code} 已刪除。`, "success");
    } else {
      context.showToast(`產品主檔 ${master.product_code} 已封存，因為已有歷史引用。`, "info");
    }

    if (selectedMasterId === masterId) {
      selectedMasterId = null;
    }
    if (editingMasterId === masterId) {
      resetMasterForm();
    }
    if (editingSpecId && !context.getState().products.some((spec) => spec.id === editingSpecId)) {
      resetSpecForm();
    }

    await context.refreshAll();
    resetSpecForm();
  }

  async function disposeSpec(specId) {
    const spec = getSpecs().find((entry) => entry.id === specId);
    if (!spec) {
      return;
    }

    const confirmed = window.confirm(
      `確定要處理製程規格「${spec.product_code} / ${spec.spec_name}」嗎？\n\n系統會先檢查是否已被引用：\n- 未使用過：直接刪除\n- 已使用過：改為封存`
    );
    if (!confirmed) {
      return;
    }

    const result = await context.api.products.dispose({ id: specId });
    if (result.action === "deleted") {
      context.showToast(`製程規格 ${spec.spec_name} 已刪除。`, "success");
    } else {
      context.showToast(`製程規格 ${spec.spec_name} 已封存，因為已有歷史引用。`, "info");
    }

    if (editingSpecId === specId) {
      resetSpecForm();
    }

    await context.refreshAll();
  }

  async function restoreMaster(masterId) {
    const master = getMasters().find((entry) => entry.id === masterId);
    if (!master) {
      return;
    }

    const confirmed = window.confirm(
      `確定要恢復產品主檔「${master.product_code}」嗎？\n\n恢復後會一併將底下製程規格重新啟用，並重新出現在新作業選單中。`
    );
    if (!confirmed) {
      return;
    }

    const result = await context.api.productMasters.restore({ id: masterId });
    selectedMasterId = masterId;
    context.showToast(`產品主檔 ${result.productMaster.product_code} 已恢復啟用。`, "success");
    await context.refreshAll();
    resetSpecForm();
  }

  async function restoreSpec(specId) {
    const spec = getSpecs().find((entry) => entry.id === specId);
    if (!spec) {
      return;
    }

    const confirmed = window.confirm(
      `確定要恢復製程規格「${spec.product_code} / ${spec.spec_name}」嗎？\n\n若上層產品主檔目前為封存狀態，系統也會一併恢復該主檔。`
    );
    if (!confirmed) {
      return;
    }

    const result = await context.api.products.restore({ id: specId });
    selectedMasterId = result.product.product_master_id || selectedMasterId;
    context.showToast(`製程規格 ${result.product.spec_name} 已恢復啟用。`, "success");
    await context.refreshAll();
  }

  async function refresh() {
    syncSelectedMaster();
    syncMasterOptions(selectedMasterId);
    syncSpecMasterFilterOptions();
    renderSpecFixturesList(
      editingSpecId ? (getSpecs().find((entry) => entry.id === editingSpecId)?.spec_fixtures || []) : []
    );
    switchSubview(activeSubview);
    renderMasterSummary();
    renderMasterTable();
    renderSpecTable();
  }

  function bind() {
    if (overviewModalBtn && overviewModal && overviewModalClose) {
      overviewModalBtn.addEventListener("click", () => {
        overviewModal.classList.remove("hidden");
      });
      overviewModalClose.addEventListener("click", () => {
        overviewModal.classList.add("hidden");
      });
      overviewModal.addEventListener("click", (event) => {
        if (event.target === overviewModal) {
          overviewModal.classList.add("hidden");
        }
      });
    }

    subviewButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const target = button.dataset.productSubviewTarget;
        if (target === "specs" && activeSubview !== "specs") {
          resetSpecForm({ clearSelectedMaster: true });
        }
        switchSubview(target);
      });
    });

    if (masterSearchModalBtn) {
      masterSearchModalBtn.addEventListener("click", () => {
        if (masterSearchModal) {
          masterSearchModal.classList.remove("hidden");
          if (searchProductCode) searchProductCode.focus();
        }
      });
    }

    if (masterSearchModalClose) {
      masterSearchModalClose.addEventListener("click", () => {
        if (masterSearchModal) masterSearchModal.classList.add("hidden");
      });
    }

    const masterFormResetButton = document.getElementById("product-master-form-reset");
    if (masterFormResetButton) {
      masterFormResetButton.addEventListener("click", resetMasterForm);
    }

    if (searchConfirmBtn) {
      searchConfirmBtn.addEventListener("click", () => {
        filters.masters.hasSearched = true;
        filters.masters.product_code = searchProductCode.value;
        filters.masters.product_name = searchProductName.value;
        filters.masters.erp_item_code = searchErpItemCode.value;
        filters.masters.erp_item_id = searchErpItemId.value;
        filters.masters.revision = searchRevision.value;
        filters.masters.spec_count = searchSpecCount.value;
        filters.masters.status = searchStatus.value;
        filters.masters.sync_status = searchSyncStatus.value;
        filters.masters.updated_at = searchUpdatedAt.value;
        pagination.masters.page = 1;
        renderMasterTable();
      });
    }

    masterPageSizeFilter.addEventListener("change", () => {
      pagination.masters.pageSize = normalizePageSize(masterPageSizeFilter.value);
      pagination.masters.page = 1;
      renderMasterTable();
    });

    masterFilterClearButton.addEventListener("click", clearMasterFilters);

    if (specSearchModalBtn) {
      specSearchModalBtn.addEventListener("click", () => {
        if (specSearchModal) {
          specSearchModal.classList.remove("hidden");
          if (searchSpecCode) searchSpecCode.focus();
        }
      });
    }

    if (specSearchModalClose) {
      specSearchModalClose.addEventListener("click", () => {
        if (specSearchModal) specSearchModal.classList.add("hidden");
      });
    }

    if (searchSpecConfirmBtn) {
      searchSpecConfirmBtn.addEventListener("click", () => {
        filters.specs.hasSearched = true;
        filters.specs.masterId = searchSpecMasterId.value;
        filters.specs.spec_code = searchSpecCode.value;
        filters.specs.spec_name = searchSpecName.value;
        filters.specs.status = searchSpecStatus.value;
        pagination.specs.page = 1;
        renderSpecTable();
      });
    }

    specPageSizeFilter.addEventListener("change", () => {
      pagination.specs.pageSize = normalizePageSize(specPageSizeFilter.value);
      pagination.specs.page = 1;
      renderSpecTable();
    });

    specFilterClearButton.addEventListener("click", clearSpecFilters);

    masterPaginationRoot.addEventListener("click", (event) => {
      const button = event.target.closest("[data-pagination-target='masters']");
      if (!button || button.disabled) {
        return;
      }
      setPage("masters", Number(button.dataset.paginationPage));
    });

    specPaginationRoot.addEventListener("click", (event) => {
      const button = event.target.closest("[data-pagination-target='specs']");
      if (!button || button.disabled) {
        return;
      }
      setPage("specs", Number(button.dataset.paginationPage));
    });

    
    const addFixtureBtn = document.getElementById("product-spec-add-fixture-btn");
    if (addFixtureBtn) {
      addFixtureBtn.addEventListener("click", () => {
        const list = document.getElementById("product-spec-fixtures-list");
        const emptyMsg = list.querySelector('.text-center');
        if (emptyMsg) emptyMsg.remove();
        
        const fixtures = getSpecFixturesFromDom();
        fixtures.push({ fixture_id: "", quantity: 1 });
        renderSpecFixturesList(fixtures);
      });
    }

    masterForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const payload = serializeForm(masterForm);
        const request = {
          product_code: payload.product_code,
          product_name: payload.product_name,
          erp_item_code: payload.erp_item_code,
          erp_item_id: payload.erp_item_id,
          revision: payload.revision,
          source_system: payload.source_system,
          sync_status: payload.sync_status,
          notes: payload.notes
        };

        let savedMaster = null;
        if (editingMasterId) {
          savedMaster = await context.api.productMasters.update({ id: editingMasterId, ...request });
          context.showToast("產品主檔已更新。", "success");
        } else {
          savedMaster = await context.api.productMasters.create(request);
          context.showToast("產品主檔已新增。", "success");
        }

        selectedMasterId = savedMaster.id;
        resetMasterForm();
        await context.refreshAll();
        resetSpecForm();
      } catch (error) {
        context.showToast(error.message, "error");
      }
    });

    specForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const payload = serializeForm(specForm);
        const request = {
          product_master_id: payload.product_master_id ? Number(payload.product_master_id) : undefined,
          spec_code: payload.spec_code,
          spec_name: payload.spec_name,
          process_revision: payload.process_revision,
          erp_spec_id: payload.erp_spec_id,
          erp_route_id: payload.erp_route_id,
          product_height: payload.product_height === "" ? undefined : Number(payload.product_height),
          tray_capacity: payload.tray_capacity === "" ? undefined : Number(payload.tray_capacity),
          spec_fixtures: getSpecFixturesFromDom(),
          can_mix_load: specForm.elements.can_mix_load.checked,
          preferred_furnace_type: payload.preferred_furnace_type,
          source_system: payload.source_system,
          sync_status: payload.sync_status,
          notes: payload.notes
        };

        const selectedMaster = getMasters().find((master) => master.id === request.product_master_id);
        if (!editingSpecId && selectedMaster?.status !== "active") {
          throw new Error("只能在啟用中的產品主檔下新增製程規格。");
        }

        if (editingSpecId) {
          await context.api.products.update({ id: editingSpecId, ...request });
          context.showToast("製程規格已更新。", "success");
        } else {
          await context.api.products.create(request);
          context.showToast("製程規格已新增。", "success");
        }

        selectedMasterId = request.product_master_id || selectedMasterId;
        filters.specs.masterId = String(selectedMasterId || "");
        pagination.specs.page = 1;
        resetSpecForm();
        await context.refreshAll();
      } catch (error) {
        context.showToast(error.message, "error");
      }
    });

    document.getElementById("product-master-form-reset").addEventListener("click", resetMasterForm);
    document.getElementById("product-spec-form-reset").addEventListener("click", () =>
      resetSpecForm({ clearSelectedMaster: true })
    );

    specMasterSelect.addEventListener("change", () => {
      selectedMasterId = Number(specMasterSelect.value) || null;
      renderMasterSummary();
      if (!editingSpecId) {
        resetSpecForm();
      }
    });

    masterTableRoot.addEventListener("click", (event) => {
      const openSpecsButton = event.target.closest("[data-master-open-specs]");
      if (openSpecsButton) {
        jumpToSpecs(Number(openSpecsButton.dataset.masterOpenSpecs));
        return;
      }

      const editButton = event.target.closest("[data-master-edit]");
      if (editButton) {
        populateMasterForm(Number(editButton.dataset.masterEdit));
        return;
      }

      const disposeButton = event.target.closest("[data-master-dispose]");
      if (disposeButton) {
        disposeMaster(Number(disposeButton.dataset.masterDispose)).catch((error) =>
          context.showToast(error.message, "error")
        );
        return;
      }

      const restoreButton = event.target.closest("[data-master-restore]");
      if (restoreButton) {
        restoreMaster(Number(restoreButton.dataset.masterRestore)).catch((error) =>
          context.showToast(error.message, "error")
        );
      }
    });

    specTableRoot.addEventListener("click", (event) => {
      const editButton = event.target.closest("[data-spec-edit]");
      if (editButton) {
        populateSpecForm(Number(editButton.dataset.specEdit));
        return;
      }

      const disposeButton = event.target.closest("[data-spec-dispose]");
      if (disposeButton) {
        disposeSpec(Number(disposeButton.dataset.specDispose)).catch((error) =>
          context.showToast(error.message, "error")
        );
        return;
      }

      const restoreButton = event.target.closest("[data-spec-restore]");
      if (restoreButton) {
        restoreSpec(Number(restoreButton.dataset.specRestore)).catch((error) =>
          context.showToast(error.message, "error")
        );
      }
    });
  }

  return {
    init() {
      bind();
      syncSelectedMaster();
      if (searchStatus) searchStatus.value = filters.masters.status;
      masterPageSizeFilter.value = String(pagination.masters.pageSize);
      if (searchSpecStatus) searchSpecStatus.value = filters.specs.status;
      specPageSizeFilter.value = String(pagination.specs.pageSize);
      switchSubview(activeSubview);
      resetMasterForm();
      resetSpecForm();
      syncSpecMasterFilterOptions();
    },
    refresh
  };
}
