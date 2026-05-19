const tones = {
  info: "bg-ink text-white",
  success: "bg-emerald-600 text-white",
  warning: "bg-amber-500 text-white",
  error: "bg-kiln text-white"
};

let container = null;

export function initToast(containerElement) {
  container = containerElement;
}

export function showToast(message, tone = "info") {
  if (!container) {
    return;
  }

  const element = document.createElement("div");
  element.className = `rounded-2xl px-4 py-3 text-sm shadow-lg ${tones[tone] || tones.info}`;
  element.textContent = message;
  container.appendChild(element);

  window.setTimeout(() => {
    element.classList.add("opacity-0", "translate-y-2", "transition");
    window.setTimeout(() => element.remove(), 240);
  }, 2600);
}
