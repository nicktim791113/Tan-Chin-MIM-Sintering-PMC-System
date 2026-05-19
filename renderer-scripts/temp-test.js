

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
  local: "?砍撱箇?",
  erp: "ERP ?郊",
  hybrid: "瘛瑕?蝬剛風"
};

const SYNC_LABELS = {
  local_only: "???,
  pending_sync: "敺?甇?,
  synced: "撌脣?甇?,
  stale: "敺??,
  sync_error: "?郊?啣虜",
  unlinked: "?芷???
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
    parts.push(`?嚗?{spec.tray_fixture_code}`);
  }
  if (spec.support_fixture_code) {
    parts.push(`憓?嚗?{spec.support_fixture_code} x${spec.support_stack_quantity}`);
  }
  if (spec.ceramic_tray_fixture_code) {
    parts.push(`?嗥?嚗?{spec.ceramic_tray_fixture_code}`);
  }
  if (spec.foot_fixture_code) {
    parts.push(`憓嚗?{spec.foot_fixture_code}`);
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
      const gap = previous && page - previous > 1 ? '<span class="px-1 text-sm text-slate-400">??/span>' : "";
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
        憿舐內 ${pageInfo.startIndex}-${pageInfo.endIndex} 蝑???${pageInfo.totalRows} 蝑?蝚?${pageInfo.page}/${pageInfo.totalPages} ??      </p>
      <div class="product-pagination-controls">
        <button type="button" class="btn-secondary text-xs ${disabledClass}" data-pagination-target="${key}" data-pagination-page="1" ${firstDisabled}>蝚砌???/button>
        <button type="button" class="btn-secondary text-xs ${disabledClass}" data-pagination-target="${key}" data-pagination-page="${pageInfo.page - 1}" ${firstDisabled}>銝???/button>
        ${numberButtons}
        <button type="button" class="btn-secondary text-xs ${disabledClass}" data-pagination-target="${key}" data-pagination-page="${pageInfo.page + 1}" ${lastDisabled}>銝???/button>
        <button type="button" class="btn-secondary text-xs ${disabledClass}" data-pagination-target="${key}" data-pagination-page="${pageInfo.totalPages}" ${lastDisabled}>?敺?</button>
      </div>
    </div>
  `;
}

function createProductsModule(context) {
  const overviewToggleButton = document.getElementById("product-overview-toggle");
  const overviewContent = document.getElementById("product-overview-content");
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

  const specSearchInput = document.getElementById("product-spec-search");
  const specStatusFilter = document.getElementById("product-spec-status-filter");
  const specMasterFilter = document.getElementById("product-spec-master-filter");
  const specPageSizeFilter = document.getElementById("product-spec-page-size");
  const specFilterSelectedButton = document.getElementById("product-spec-filter-selected");
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
  let overviewExpanded = false;

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
    specs: { query: "", status: "active", masterId: "" }
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
      .supportBlocks.filter((fixture) => fixture.fixture_type === fixtureType && fixture.status === "active")
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
    return getSpecs().filter((spec) => {
      if (filters.specs.status !== "all" && spec.status !== filters.specs.status) {
        return false;
      }
      if (filters.specs.masterId && String(spec.product_master_id) !== String(filters.specs.masterId)) {
        return false;
      }
      return matchesQuery(
        [
          spec.product_code,
          spec.product_name,
          spec.spec_code,
          spec.spec_name,
          spec.erp_spec_id,
          spec.erp_route_id,
          spec.preferred_furnace_type,
          spec.tray_fixture_code,
          spec.support_fixture_code,
          spec.ceramic_tray_fixture_code,
          spec.foot_fixture_code,
          spec.notes
        ],
        filters.specs.query
      );
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

  function renderOverviewVisibility() {
    overviewContent.classList.toggle("hidden", !overviewExpanded);
    overviewToggleButton.textContent = overviewExpanded ? "?嗉絲隤芣?" : "撅?隤芣?";
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
    if (!masters.length) {
      selectedMasterId = null;
      return;
    }
    if (masters.some((master) => master.id === selectedMasterId)) {
      return;
    }
    selectedMasterId = (getActiveMasters()[0] || masters[0]).id;
  }

  function syncMasterOptions(selectedValue = selectedMasterId) {
    setOptions(specMasterSelect, getSelectableMasters(selectedValue), {
      placeholder: "隢??蜓瑼?,
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

    setOptions(specMasterFilter, masters, {
      placeholder: "?券?Ｗ?銝餅?",
      valueKey: "id",
      labelKey: (item) => `${item.product_code} | ${item.product_name}`,
      selectedValue: filters.specs.masterId
    });
  }

  function syncFixtureSelectors(spec = null) {
    Object.entries(FIXTURE_FIELD_MAP).forEach(([fixtureType, config]) => {
      setOptions(document.getElementById(config.elementId), getFixturesByType(fixtureType), {
        placeholder: `隢??{humanizeFixtureType(fixtureType)}`,
        valueKey: "id",
        labelKey: (item) =>
          `${item.block_code} | ${item.block_name} / ${humanizeFixtureQuickType(item.fixture_quick_type)} / ${formatNumber(item.height)} mm`,
        selectedValue: spec?.[config.valueKey]
      });
    });
  }

  function renderMasterSummary() {
    const master = getSelectedMaster();
    if (!master) {
      specMasterSummary.innerHTML = `
        <div class="product-summary-card text-sm text-slate">
          隢?撱箇??Ｗ?銝餅?嚗??啣?撠??ˊ蝔??潦?        </div>
      `;
      return;
    }

    const statusNote =
      master.status === "archived"
        ? "甇斤?蜓瑼歇撠?嚗????箇?冽雿平?詨銝准?
        : master.status === "inactive"
          ? "甇斤?蜓瑼???其葉嚗遣霅啁Ⅱ隤??憓??潦?
          : "甇斤?蜓瑼甇?虜撱箇??雁霅瑁ˊ蝔??潦?;

    specMasterSummary.innerHTML = `
      <div class="product-summary-card">
        <div class="product-summary-header">
          <div>
            <p class="text-xs uppercase tracking-wide text-slate">?桀?雿平?身銝餅?</p>
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
            <p class="text-xs uppercase tracking-wide text-slate">ERP ??</p>
            <p class="mt-1 text-sm font-semibold text-ink">${escapeHtml(master.erp_item_code || "-")}</p>
          </div>
          <div class="product-summary-metric">
            <p class="text-xs uppercase tracking-wide text-slate">ERP ?Ｗ? ID</p>
            <p class="mt-1 text-sm font-semibold text-ink">${escapeHtml(master.erp_item_id || "-")}</p>
          </div>
          <div class="product-summary-metric">
            <p class="text-xs uppercase tracking-wide text-slate">銝餅??活</p>
            <p class="mt-1 text-sm font-semibold text-ink">${escapeHtml(master.revision || "-")}</p>
          </div>
          <div class="product-summary-metric">
            <p class="text-xs uppercase tracking-wide text-slate">閬蝑</p>
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
        ? "??0 蝑?
        : `憿舐內 ${pageInfo.startIndex}-${pageInfo.endIndex} / ??${pageInfo.totalRows} 蝑;

    renderTable(
      masterTableRoot,
      [
        { key: "product_code", label: "?Ｗ?隞?Ⅳ" },
        { key: "product_name", label: "?Ｗ??迂" },
        {
          key: "erp_item_code",
          label: "ERP ??",
          render: (row) => escapeHtml(row.erp_item_code || "-")
        },
        {
          key: "revision",
          label: "?活",
          render: (row) => escapeHtml(row.revision || "-")
        },
        {
          key: "spec_count",
          label: "閬蝑",
          render: (row) => String(row.spec_count || 0)
        },
        {
          key: "status",
          label: "???,
          render: (row) => createStatusPill(row.status, row.status)
        },
        {
          key: "sync_status",
          label: "?郊???,
          render: (row) => createSyncPill(row.sync_status)
        },
        {
          key: "updated_at",
          label: "?湔??",
          render: (row) => formatDateTime(row.updated_at)
        },
        {
          key: "actions",
          label: "??",
          render: (row) => `
            <div class="flex flex-wrap gap-2">
              <button type="button" class="btn-secondary text-xs" data-master-open-specs="${row.id}">?亦?閬</button>
              <button type="button" class="btn-secondary text-xs" data-master-edit="${row.id}">蝺刻摩</button>
              ${
                row.status === "active"
                  ? `<button type="button" class="btn-secondary text-xs" data-master-dispose="${row.id}">?芷 / 雿誥</button>`
                  : `<button type="button" class="btn-secondary text-xs" data-master-restore="${row.id}">?Ｗ儔 / ?</button>`
              }
            </div>
          `
        }
      ],
      pageInfo.rows,
      {
        emptyMessage: "?桀?璇辣銝???蜓瑼?,
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
        ? "??0 蝑?
        : `憿舐內 ${pageInfo.startIndex}-${pageInfo.endIndex} / ??${pageInfo.totalRows} 蝑;

    renderTable(
      specTableRoot,
      [
        {
          key: "product_code",
          label: "?Ｗ? / 閬",
          render: (row) => `
            <div>
              <div class="font-semibold text-ink">${escapeHtml(row.product_code)} | ${escapeHtml(row.product_name)}</div>
              <div class="mt-1 text-xs text-slate-500">${escapeHtml(row.spec_name)} / ${escapeHtml(row.spec_code)}</div>
            </div>
          `
        },
        {
          key: "product_height",
          label: "?Ｗ?擃漲",
          render: (row) => `${formatNumber(row.product_height)} mm`
        },
        {
          key: "tray_capacity",
          label: "?桃摰寥?",
          render: (row) => `${row.tray_capacity} pcs`
        },
        {
          key: "fixtures",
          label: "瘝餃?蔭",
          render: (row) => fixtureSummary(row)
        },
        {
          key: "status",
          label: "???,
          render: (row) => createStatusPill(row.status, row.status)
        },
        {
          key: "sync_status",
          label: "?郊???,
          render: (row) => createSyncPill(row.sync_status)
        },
        {
          key: "updated_at",
          label: "?湔??",
          render: (row) => formatDateTime(row.updated_at)
        },
        {
          key: "actions",
          label: "??",
          render: (row) => `
            <div class="flex flex-wrap gap-2">
              <button type="button" class="btn-secondary text-xs" data-spec-edit="${row.id}">蝺刻摩</button>
              ${
                row.status === "active"
                  ? `<button type="button" class="btn-secondary text-xs" data-spec-dispose="${row.id}">?芷 / 雿誥</button>`
                  : `<button type="button" class="btn-secondary text-xs" data-spec-restore="${row.id}">?Ｗ儔 / ?</button>`
              }
            </div>
          `
        }
      ],
      pageInfo.rows,
      {
        emptyMessage: "?桀?璇辣銝??ˊ蝔??潦?,
        wrapperClass: "table-shell product-table-shell",
        emptyClass: "panel product-table-empty text-sm text-slate-500"
      }
    );
    renderPagination(specPaginationRoot, "specs", pageInfo);
  }

  function populateMasterForm(masterId) {
    const master = getMasters().find((entry) => entry.id === masterId);
    if (!master) {
      return;
    }

    switchSubview("masters");
    editingMasterId = masterId;
    selectedMasterId = masterId;
    masterFormTitle.textContent = `蝺刻摩?Ｗ?銝餅?嚗?{master.product_code}`;
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
    specFormTitle.textContent = `蝺刻摩鋆賜?閬嚗?{spec.product_code} / ${spec.spec_name}`;
    specForm.elements.product_master_id.value = String(spec.product_master_id || "");
    specForm.elements.spec_code.value = spec.spec_code || "DEFAULT";
    specForm.elements.spec_name.value = spec.spec_name || "?身鋆賜?閬";
    specForm.elements.process_revision.value = spec.process_revision || "";
    specForm.elements.erp_spec_id.value = spec.erp_spec_id || "";
    specForm.elements.erp_route_id.value = spec.erp_route_id || "";
    specForm.elements.product_height.value = spec.product_height;
    specForm.elements.tray_capacity.value = spec.tray_capacity;
    specForm.elements.support_stack_quantity.value = spec.support_stack_quantity || 1;
    specForm.elements.preferred_furnace_type.value = spec.preferred_furnace_type || "";
    specForm.elements.source_system.value = spec.source_system || "local";
    specForm.elements.sync_status.value = spec.sync_status || "local_only";
    specForm.elements.can_mix_load.checked = Boolean(spec.can_mix_load);
    specForm.elements.notes.value = spec.notes || "";
    syncMasterOptions(selectedMasterId);
    syncSpecMasterFilterOptions();
    syncFixtureSelectors(spec);
    renderMasterSummary();
    renderSpecTable();
    specForm.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function resetMasterForm() {
    editingMasterId = null;
    masterFormTitle.textContent = "?啣??Ｗ?銝餅?";
    resetForm(masterForm, {
      source_system: "local",
      sync_status: "local_only"
    });
  }

  function resetSpecForm() {
    editingSpecId = null;
    specFormTitle.textContent = "?啣?鋆賜?閬";
    resetForm(specForm, {
      product_master_id: selectedMasterId || "",
      spec_code: "DEFAULT",
      spec_name: "?身鋆賜?閬",
      process_revision: "A0",
      support_stack_quantity: 1,
      source_system: "local",
      sync_status: "local_only",
      can_mix_load: false
    });
    syncMasterOptions(selectedMasterId);
    syncFixtureSelectors();
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
    filters.specs.query = "";
    filters.specs.status = "active";
    filters.specs.masterId = "";
    pagination.specs.page = 1;
    specSearchInput.value = "";
    specStatusFilter.value = "active";
    syncSpecMasterFilterOptions();
    renderSpecTable();
  }

  function jumpToSpecs(masterId) {
    selectedMasterId = masterId;
    filters.specs.masterId = String(masterId);
    pagination.specs.page = 1;
    syncMasterOptions(selectedMasterId);
    syncSpecMasterFilterOptions();
    renderMasterSummary();
    renderSpecTable();
    if (!editingSpecId) {
      resetSpecForm();
    }
    switchSubview("specs");
    specMasterSummary.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function applySelectedMasterToSpecFilter() {
    if (!selectedMasterId) {
      context.showToast("?桀?瘝??臬葆?亦??Ｗ?銝餅???, "info");
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
      `蝣箏?閬???蜓瑼?{master.product_code}??嚗n\n蝟餌絞??瑼Ｘ?臬撌脰◤撘嚗n- ?芯蝙?券?嚗?亙?么n- 撌脖蝙?券?嚗?箏?摮
    );
    if (!confirmed) {
      return;
    }

    const result = await context.api.productMasters.dispose({ id: masterId });
    if (result.action === "deleted") {
      context.showToast(`?Ｗ?銝餅? ${master.product_code} 撌脣?扎, "success");
    } else {
      context.showToast(`?Ｗ?銝餅? ${master.product_code} 撌脣?摮??撌脫?甇瑕撘?, "info");
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
      `蝣箏?閬??ˊ蝔??潦?{spec.product_code} / ${spec.spec_name}??嚗n\n蝟餌絞??瑼Ｘ?臬撌脰◤撘嚗n- ?芯蝙?券?嚗?亙?么n- 撌脖蝙?券?嚗?箏?摮
    );
    if (!confirmed) {
      return;
    }

    const result = await context.api.products.dispose({ id: specId });
    if (result.action === "deleted") {
      context.showToast(`鋆賜?閬 ${spec.spec_name} 撌脣?扎, "success");
    } else {
      context.showToast(`鋆賜?閬 ${spec.spec_name} 撌脣?摮??撌脫?甇瑕撘?, "info");
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
      `蝣箏?閬敺拍?蜓瑼?{master.product_code}??嚗n\n?Ｗ儔敺?銝雿萄?摨?鋆賜?閬??嚗蒂??箇?冽雿平?詨銝准
    );
    if (!confirmed) {
      return;
    }

    const result = await context.api.productMasters.restore({ id: masterId });
    selectedMasterId = masterId;
    context.showToast(`?Ｗ?銝餅? ${result.productMaster.product_code} 撌脫敺拙??具, "success");
    await context.refreshAll();
    resetSpecForm();
  }

  async function restoreSpec(specId) {
    const spec = getSpecs().find((entry) => entry.id === specId);
    if (!spec) {
      return;
    }

    const confirmed = window.confirm(
      `蝣箏?閬敺抵ˊ蝔??潦?{spec.product_code} / ${spec.spec_name}??嚗n\n?乩?撅斤?蜓瑼?撠????蝟餌絞銋?銝雿菜敺抵府銝餅??
    );
    if (!confirmed) {
      return;
    }

    const result = await context.api.products.restore({ id: specId });
    selectedMasterId = result.product.product_master_id || selectedMasterId;
    context.showToast(`鋆賜?閬 ${result.product.spec_name} 撌脫敺拙??具, "success");
    await context.refreshAll();
  }

  async function refresh() {
    syncSelectedMaster();
    syncMasterOptions(selectedMasterId);
    syncSpecMasterFilterOptions();
    syncFixtureSelectors(
      editingSpecId ? getSpecs().find((entry) => entry.id === editingSpecId) || null : null
    );
    renderOverviewVisibility();
    switchSubview(activeSubview);
    renderMasterSummary();
    renderMasterTable();
    renderSpecTable();
  }

  function bind() {
    overviewToggleButton.addEventListener("click", () => {
      overviewExpanded = !overviewExpanded;
      renderOverviewVisibility();
    });

    subviewButtons.forEach((button) => {
      button.addEventListener("click", () => switchSubview(button.dataset.productSubviewTarget));
    });

    if (masterSearchModalBtn) {
      masterSearchModalBtn.addEventListener("click", () => {
        if (masterSearchModal) {
          masterSearchModal.classList.remove("hidden");
          masterSearchInput.focus();
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

    specSearchInput.addEventListener("input", () => {
      filters.specs.query = specSearchInput.value;
      pagination.specs.page = 1;
      renderSpecTable();
    });

    specStatusFilter.addEventListener("change", () => {
      filters.specs.status = specStatusFilter.value;
      pagination.specs.page = 1;
      renderSpecTable();
    });

    specMasterFilter.addEventListener("change", () => {
      filters.specs.masterId = specMasterFilter.value;
      pagination.specs.page = 1;
      if (filters.specs.masterId) {
        selectedMasterId = Number(filters.specs.masterId);
      }
      renderMasterSummary();
      renderSpecTable();
      if (!editingSpecId) {
        resetSpecForm();
      }
    });

    specPageSizeFilter.addEventListener("change", () => {
      pagination.specs.pageSize = normalizePageSize(specPageSizeFilter.value);
      pagination.specs.page = 1;
      renderSpecTable();
    });

    specFilterSelectedButton.addEventListener("click", applySelectedMasterToSpecFilter);
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
          context.showToast("?Ｗ?銝餅?撌脫?啜?, "success");
        } else {
          savedMaster = await context.api.productMasters.create(request);
          context.showToast("?Ｗ?銝餅?撌脫憓?, "success");
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
          product_height: Number(payload.product_height || 0),
          tray_capacity: Number(payload.tray_capacity || 0),
          tray_fixture_id: payload.tray_fixture_id ? Number(payload.tray_fixture_id) : undefined,
          support_fixture_id: payload.support_fixture_id ? Number(payload.support_fixture_id) : undefined,
          support_stack_quantity: Number(payload.support_stack_quantity || 1),
          ceramic_tray_fixture_id: payload.ceramic_tray_fixture_id
            ? Number(payload.ceramic_tray_fixture_id)
            : undefined,
          foot_fixture_id: payload.foot_fixture_id ? Number(payload.foot_fixture_id) : undefined,
          can_mix_load: specForm.elements.can_mix_load.checked,
          preferred_furnace_type: payload.preferred_furnace_type,
          source_system: payload.source_system,
          sync_status: payload.sync_status,
          notes: payload.notes
        };

        const selectedMaster = getMasters().find((master) => master.id === request.product_master_id);
        if (!editingSpecId && selectedMaster?.status !== "active") {
          throw new Error("?芾?典??其葉??蜓瑼??啣?鋆賜?閬??);
        }

        if (editingSpecId) {
          await context.api.products.update({ id: editingSpecId, ...request });
          context.showToast("鋆賜?閬撌脫?啜?, "success");
        } else {
          await context.api.products.create(request);
          context.showToast("鋆賜?閬撌脫憓?, "success");
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
    document.getElementById("product-spec-form-reset").addEventListener("click", resetSpecForm);

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
      masterStatusFilter.value = filters.masters.status;
      masterPageSizeFilter.value = String(pagination.masters.pageSize);
      specStatusFilter.value = filters.specs.status;
      specPageSizeFilter.value = String(pagination.specs.pageSize);
      switchSubview(activeSubview);
      renderOverviewVisibility();
      resetMasterForm();
      resetSpecForm();
      syncSpecMasterFilterOptions();
    },
    refresh
  };
}

