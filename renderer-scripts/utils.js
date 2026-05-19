export function formatNumber(value, digits = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return "-";
  }

  return parsed.toLocaleString("zh-TW", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

export function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function formatDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return toLocalDate(date);
}

export function getStatusTone(value) {
  const map = {
    active: "bg-emerald-100 text-emerald-700",
    inactive: "bg-slate-200 text-slate-700",
    maintenance: "bg-amber-100 text-amber-700",
    normal: "bg-emerald-100 text-emerald-700",
    warning: "bg-amber-100 text-amber-700",
    needs_change: "bg-red-100 text-red-700",
    recommended: "bg-emerald-100 text-emerald-700",
    allowed: "bg-sky-100 text-sky-700",
    restricted: "bg-red-100 text-red-700",
    draft: "bg-slate-200 text-slate-700",
    planned: "bg-sky-100 text-sky-700",
    ready: "bg-indigo-100 text-indigo-700",
    completed: "bg-emerald-100 text-emerald-700",
    archived: "bg-slate-300 text-slate-700"
  };

  return map[value] || "bg-slate-100 text-slate-700";
}

export function humanizeStatus(value) {
  const map = {
    active: "啟用",
    inactive: "停用",
    maintenance: "維護中",
    normal: "正常",
    warning: "接近上限",
    needs_change: "待更換",
    recommended: "推薦",
    allowed: "可用",
    restricted: "限制",
    draft: "草稿",
    planned: "已排程",
    ready: "已就緒",
    completed: "已完成",
    archived: "封存"
  };

  return map[value] || value;
}

export function humanizeMachineType(value) {
  const map = {
    degreasing_immersion: "浸泡式脫脂設備",
    degreasing_reserved: "真空式脫脂設備",
    sintering_furnace: "真空式燒結爐"
  };

  return map[value] || value;
}

export function humanizeFixtureType(value) {
  const map = {
    tray: "承載",
    isolate: "隔離",
    support_block: "墊高",
    foot: "支撐",
    other: "其他"
  };

  return map[value] || value;
}

export function humanizeFixtureQuickType(value) {
  const map = {
    graphite: "石墨",
    ceramic: "陶瓷",
    stainless_steel: "不鏽鋼",
    metal_powder: "金屬粉",
    other: "其他"
  };

  return map[value] || value;
}

export function createStatusPill(label, tone) {
  return `<span class="status-pill ${getStatusTone(tone)}">${escapeHtml(humanizeStatus(label))}</span>`;
}

export function setOptions(selectElement, items, config) {
  const {
    placeholder = "請選擇",
    valueKey = "id",
    labelKey = "name",
    selectedValue = ""
  } = config || {};

  selectElement.innerHTML = [
    `<option value="">${escapeHtml(placeholder)}</option>`,
    ...items.map((item) => {
      const value = item[valueKey];
      const label = typeof labelKey === "function" ? labelKey(item) : item[labelKey];
      const selected = String(value) === String(selectedValue) ? "selected" : "";
      return `<option value="${escapeHtml(value)}" ${selected}>${escapeHtml(label)}</option>`;
    })
  ].join("");
}

export function serializeForm(formElement) {
  const formData = new FormData(formElement);
  return Object.fromEntries(formData.entries());
}

export function resetForm(formElement, defaults = {}) {
  formElement.reset();
  Object.entries(defaults).forEach(([key, value]) => {
    const target = formElement.elements.namedItem(key);
    if (!target) {
      return;
    }

    if (target instanceof RadioNodeList) {
      Array.from(target).forEach((input) => {
        input.checked = String(input.value) === String(value);
      });
      return;
    }

    if (target.type === "checkbox") {
      target.checked = Boolean(value);
      return;
    }

    target.value = value;
  });
}

export function qs(root, selector) {
  return root.querySelector(selector);
}

export function qsa(root, selector) {
  return Array.from(root.querySelectorAll(selector));
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toLocalDate(date) {
  const timezoneOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 10);
}

export function todayLocalInputValue() {
  return toLocalDate(new Date());
}

export function currentDateTimeLocalValue() {
  const now = new Date();
  const timezoneOffset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - timezoneOffset).toISOString().slice(0, 16);
}
