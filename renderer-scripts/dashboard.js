import { renderMachineProgressCards, renderSummaryCards } from "./components/cards.js";
import { renderTable } from "./components/table.js";
import { createStatusPill, formatDateTime, formatNumber } from "./utils.js";

export function createDashboardModule(context) {
  const summaryCards = document.getElementById("dashboard-summary-cards");
  const machineCards = document.getElementById("dashboard-machine-cards");
  const upcomingVacuumTable = document.getElementById("dashboard-upcoming-vacuum");
  const upcomingSinteringTable = document.getElementById("dashboard-upcoming-sintering");
  const recentTable = document.getElementById("dashboard-recent-degreasing");

  async function refresh() {
    const summary = await context.api.dashboard.getSummary();
    context.mergeState({ dashboard: summary });

    renderSummaryCards(summaryCards, [
      {
        label: "待更換溶劑設備",
        value: String(summary.degreasing.solvent_alert_count),
        helper: "目前已達門檻、需要安排更換溶劑的浸泡式脫脂設備數量。"
      },
      {
        label: "接近更換門檻",
        value: String(summary.degreasing.near_threshold_count),
        helper: "累積使用量已接近上限，建議優先留意的設備。"
      },
      {
        label: "真空式燒結爐",
        value: String(summary.furnaces.length),
        helper: "已建檔的真空式燒結爐數量。"
      },
      {
        label: "真空式脫脂爐",
        value: String(summary.vacuum_units.length),
        helper: "已建檔的真空式脫脂爐數量。"
      },
      {
        label: "平均預估裝載率",
        value: `${formatNumber(summary.average_estimated_load_rate)}%`,
        helper: "依已建立的真空式燒結批次計算。"
      }
    ]);

    renderMachineProgressCards(machineCards, summary.degreasing.machines);

    renderTable(
      upcomingVacuumTable,
      [
        { key: "batch_no", label: "批次號" },
        {
          key: "planned_date",
          label: "計畫日期",
          render: (row) => formatDateTime(row.planned_date)
        },
        {
          key: "vacuum_machine_code",
          label: "爐號",
          render: (row) => row.vacuum_machine_code || "-"
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
        }
      ],
      summary.upcoming_vacuum,
      { emptyMessage: "目前沒有近期真空式脫脂排程。" }
    );

    renderTable(
      upcomingSinteringTable,
      [
        { key: "batch_no", label: "批次號" },
        {
          key: "planned_date",
          label: "計畫日期",
          render: (row) => formatDateTime(row.planned_date)
        },
        {
          key: "furnace_machine_code",
          label: "爐號",
          render: (row) => row.furnace_machine_code || "-"
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
        }
      ],
      summary.upcoming_sintering,
      { emptyMessage: "目前沒有近期真空式燒結排程。" }
    );

    renderTable(
      recentTable,
      [
        {
          key: "machine_code",
          label: "設備",
          render: (row) =>
            `${row.machine_code}<br><span class="text-xs text-slate-500">${row.machine_name}</span>`
        },
        { key: "part_no", label: "料號" },
        {
          key: "batch_no",
          label: "批號 / 工單",
          render: (row) => row.batch_no || row.work_order_no || "-"
        },
        {
          key: "input_weight",
          label: "投入重量",
          render: (row) => `${formatNumber(row.input_weight)} kg`
        },
        {
          key: "operated_at",
          label: "作業時間",
          render: (row) => formatDateTime(row.operated_at)
        }
      ],
      summary.recent_degreasing,
      { emptyMessage: "目前沒有最近的浸泡式脫脂投入紀錄。" }
    );
  }

  return {
    refresh
  };
}
