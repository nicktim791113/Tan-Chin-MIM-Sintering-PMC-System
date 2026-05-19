import { renderTable } from "./components/table.js";
import { formatDateTime, formatNumber, serializeForm, setOptions, todayLocalInputValue } from "./utils.js";

export function createReportsModule(context) {
  const form = document.getElementById("report-form");
  const machineTypeFilter = document.getElementById("report-machine-type-filter");
  const machineFilter = document.getElementById("report-machine-filter");
  const degreasingRoot = document.getElementById("report-degreasing-table");
  const solventRoot = document.getElementById("report-solvent-table");
  const vacuumRoot = document.getElementById("report-vacuum-table");
  const sinteringRoot = document.getElementById("report-sintering-table");

  function updateMachineOptions() {
    const selectedType = machineTypeFilter.value;
    const machines = context.getState().machines;
    const filteredMachines = selectedType
      ? machines.filter((m) => m.machine_type === selectedType)
      : machines;

    setOptions(
      machineFilter,
      filteredMachines,
      {
        placeholder: "全部指定設備",
        valueKey: "id",
        labelKey: (item) => `${item.machine_code} | ${item.machine_name}`
      }
    );
  }

  async function refreshWithFilters(filters = {}) {
    const snapshot = await context.api.reports.getSnapshot(filters);

    renderTable(
      degreasingRoot,
      [
        { key: "machine_code", label: "設備編號" },
        { key: "part_no", label: "產品編號" },
        { key: "product_name", label: "產品名稱" },
        { 
          key: "quantity_pcs", 
          label: "數量",
          render: (row) => row.quantity_pcs != null ? `${formatNumber(row.quantity_pcs)} pcs` : "-"
        },
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
        },
        {
          key: "ended_at",
          label: "預計結束時間",
          render: (row) => formatDateTime(row.ended_at) || "-"
        }
      ],
      snapshot.degreasing_batches,
      { emptyMessage: "此條件下沒有浸泡式脫脂投入紀錄。" }
    );

    renderTable(
      solventRoot,
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
        }
      ],
      snapshot.solvent_change_logs,
      { emptyMessage: "此條件下沒有溶劑更換紀錄。" }
    );

    renderTable(
      vacuumRoot,
      [
        { key: "batch_no", label: "批次號" },
        { key: "vacuum_machine_code", label: "爐號" },
        {
          key: "estimated_load_rate",
          label: "預估裝載率",
          render: (row) =>
            row.estimated_load_rate === null ? "-" : `${formatNumber(row.estimated_load_rate)}%`
        },
        { key: "operator_name", label: "作業人員" },
        {
          key: "planned_date",
          label: "計畫日期",
          render: (row) => formatDateTime(row.planned_date)
        }
      ],
      snapshot.vacuum_batches || [],
      { emptyMessage: "此條件下沒有真空式脫脂批次。" }
    );

    renderTable(
      sinteringRoot,
      [
        { key: "batch_no", label: "批次號" },
        { key: "furnace_machine_code", label: "爐號" },
        {
          key: "estimated_load_rate",
          label: "預估裝載率",
          render: (row) =>
            row.estimated_load_rate === null ? "-" : `${formatNumber(row.estimated_load_rate)}%`
        },
        { key: "operator_name", label: "作業人員" },
        {
          key: "planned_date",
          label: "計畫日期",
          render: (row) => formatDateTime(row.planned_date)
        }
      ],
      snapshot.sintering_batches,
      { emptyMessage: "此條件下沒有真空式燒結批次。" }
    );
  }

  const btnExportCsv = document.getElementById("report-export-csv");
  const btnExportExcel = document.getElementById("report-export-excel");

  function bind() {
    machineTypeFilter.addEventListener("change", updateMachineOptions);

    async function handleExport(format) {
      const payload = serializeForm(form);
      const filters = {
        date_from: payload.date_from,
        date_to: payload.date_to,
        part_no: payload.part_no,
        batch_no: payload.batch_no,
        machine_id: payload.machine_id ? Number(payload.machine_id) : undefined
      };
      
      try {
        await context.api.reports.export(filters, format);
      } catch (err) {
        if (err.message && !err.message.includes("cancelled") && !err.message.includes("canceled")) {
          context.showToast(err.message || `匯出 ${format.toUpperCase()} 失敗。`, "error");
        }
      }
    }

    btnExportCsv?.addEventListener("click", () => handleExport("csv"));
    btnExportExcel?.addEventListener("click", () => handleExport("excel"));

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const payload = serializeForm(form);
      await refreshWithFilters({
        date_from: payload.date_from,
        date_to: payload.date_to,
        part_no: payload.part_no,
        batch_no: payload.batch_no,
        machine_id: payload.machine_id ? Number(payload.machine_id) : undefined
      });
    });
  }

  async function refresh() {
    updateMachineOptions();
    await refreshWithFilters({
      date_from: form.elements.date_from.value,
      date_to: form.elements.date_to.value
    });
  }

  return {
    init() {
      bind();
      form.elements.date_from.value = todayLocalInputValue();
      form.elements.date_to.value = todayLocalInputValue();
    },
    refresh
  };
}
