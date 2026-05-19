export function createModal(root) {
  return {
    open(content) {
      root.innerHTML = `
        <div class="fixed inset-0 z-40 flex items-center justify-center bg-ink/45 p-6">
          <div class="panel max-w-2xl p-6">
            <div class="flex justify-end">
              <button type="button" class="btn-secondary" data-modal-close>關閉</button>
            </div>
            <div class="mt-4">${content}</div>
          </div>
        </div>
      `;
      root.classList.remove("hidden");
    },
    close() {
      root.innerHTML = "";
      root.classList.add("hidden");
    }
  };
}
