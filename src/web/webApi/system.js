// Browser implementations of clipboard / external-link / dialog / version seams.
function createSystemApi({ appVersion } = {}) {
  return {
    writeClipboardText: async (text) => {
      await navigator.clipboard.writeText(String(text ?? ""));
      return true;
    },
    readClipboardText: async () => {
      try { return await navigator.clipboard.readText(); } catch { return ""; }
    },
    openExternal: async (url) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    showError: async (title, body) => {
      window.alert(`${title}\n\n${body || ""}`.trim());
    },
    getAppVersion: async () => appVersion || "web",
  };
}

export { createSystemApi };
