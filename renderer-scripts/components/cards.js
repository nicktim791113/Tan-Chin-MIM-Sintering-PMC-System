import { createStatusPill, formatNumber } from "../utils.js";

export function renderSummaryCards(target, cards) {
  target.innerHTML = cards
    .map(
      (card) => `
        <article class="panel p-5">
          <div class="mb-3 flex items-start justify-between gap-3">
            <div>
              <p class="text-sm text-slate">${card.label}</p>
              <p class="mt-2 text-3xl font-bold text-ink">${card.value}</p>
            </div>
            ${card.badge || ""}
          </div>
          <p class="text-sm text-slate">${card.helper || ""}</p>
        </article>
      `
    )
    .join("");
}

export function renderMachineProgressCards(target, machines) {
  target.innerHTML = machines
    .map((machine) => {
      const usage = Math.min(machine.usage_percent ?? 0, 100);
      return `
        <article class="panel p-5">
          <div class="mb-4 flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <p class="text-sm font-semibold text-slate truncate">${machine.machine_code}</p>
              <h3 class="mt-1 text-lg font-bold text-ink truncate">${machine.machine_name}</h3>
            </div>
            ${createStatusPill(machine.alert_state, machine.alert_state)}
          </div>
          <div class="mb-3 h-3 overflow-hidden rounded-full bg-slate-100">
            <div class="h-full rounded-full bg-ink" style="width: ${usage}%"></div>
          </div>
          <div class="flex items-center justify-between text-sm text-slate">
            <span>${formatNumber(machine.current_solvent_accum_weight)} / ${formatNumber(machine.solvent_weight_limit)} kg</span>
            <span>${formatNumber(machine.usage_percent ?? 0)}%</span>
          </div>
        </article>
      `;
    })
    .join("");
}
