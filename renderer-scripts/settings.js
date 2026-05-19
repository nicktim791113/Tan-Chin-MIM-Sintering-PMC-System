export function createSettingsModule({ api, showToast }) {
  const form = document.getElementById("settings-form");
  const enabledCheckbox = document.getElementById("settings-api-enabled");
  const tokenInput = document.getElementById("settings-api-token");
  const tokenContainer = document.getElementById("settings-api-token-container");
  const degreasingOffsetInput = document.getElementById("settings-degreasing-time-offset");

  function toggleTokenVisibility() {
    if (enabledCheckbox.checked) {
      tokenContainer.style.display = "";
      tokenInput.required = true;
    } else {
      tokenContainer.style.display = "none";
      tokenInput.required = false;
    }
  }

  return {
    async init() {
      if (!form) return;

      enabledCheckbox.addEventListener("change", toggleTokenVisibility);

      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
          await api.settings.saveSettings({
            api_key_enabled: enabledCheckbox.checked,
            api_key_token: tokenInput.value,
            degreasing_time_offset: Number(degreasingOffsetInput.value) || 8
          });
          showToast("系統管理設定已更新成功。", "success");
        } catch (error) {
          showToast(error.message || "更新設定失敗。", "error");
        }
      });
    },

    async refresh() {
      if (!form) return;
      try {
        const settings = await api.settings.getSettings();
        enabledCheckbox.checked = settings.api_key_enabled;
        tokenInput.value = settings.api_key_token || "";
        degreasingOffsetInput.value = settings.degreasing_time_offset ?? 8;
        toggleTokenVisibility();
      } catch (error) {
        showToast(error.message || "讀取系統管理設定失敗。", "error");
      }
    }
  };
}
