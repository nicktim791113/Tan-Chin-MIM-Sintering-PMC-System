import { escapeHtml } from "../utils.js";

export function renderTable(target, columns, rows, options = {}) {
  const emptyMessage = options.emptyMessage || "目前沒有資料。";
  const wrapperClass = options.wrapperClass || "table-shell";
  const emptyClass = options.emptyClass || "panel rounded-3xl p-6 text-sm text-slate-500";

  if (!rows || rows.length === 0) {
    target.innerHTML = `
      <div class="${escapeHtml(emptyClass)}">
        ${escapeHtml(emptyMessage)}
      </div>
    `;
    return;
  }

  const head = columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("");

  const body = rows
    .map((row) => {
      const cells = columns
        .map((column) => {
          const rawValue =
            typeof column.render === "function" ? column.render(row) : escapeHtml(row[column.key] ?? "");
          return `<td>${rawValue}</td>`;
        })
        .join("");

      return `<tr class="border-b border-slate-100 last:border-0">${cells}</tr>`;
    })
    .join("");

  target.innerHTML = `
    <div class="${escapeHtml(wrapperClass)}">
      <table class="table-base">
        <thead>
          <tr>${head}</tr>
        </thead>
        <tbody class="divide-y divide-slate-100 bg-white">
          ${body}
        </tbody>
      </table>
    </div>
  `;
}
