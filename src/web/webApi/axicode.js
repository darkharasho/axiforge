// .axicode import for the web playground: decode with the pure @axiapps/code
// codec (zlib is aliased to a pako shim in the browser build) behind a browser
// file input. Web has no library, so we only surface builds; the caller loads
// one into the editor.
import { decodeAxicodeFile } from "@axiapps/code";

export function decodeAxicodeBuffer(buffer) {
  const data = decodeAxicodeFile(buffer); // throws "Not a valid .axicode file: ..." on bad input
  const builds = Array.isArray(data?.builds) ? data.builds : [];
  return { builds };
}

function pickFile() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".axicode";
    input.style.display = "none";
    // 'cancel' fires when the picker is dismissed (supported in modern browsers).
    input.addEventListener(
      "cancel",
      () => {
        input.remove();
        resolve(null);
      },
      { once: true }
    );
    input.addEventListener(
      "change",
      () => {
        const file = input.files && input.files[0];
        input.remove();
        resolve(file || null);
      },
      { once: true }
    );
    document.body.appendChild(input);
    input.click();
  });
}

export function createAxicodeApi({ pick = pickFile } = {}) {
  return {
    importAxicodeFile: async () => {
      const file = await pick();
      if (!file) return { cancelled: true };
      try {
        const buffer = Buffer.from(await file.arrayBuffer());
        return decodeAxicodeBuffer(buffer);
      } catch (err) {
        return { error: err && err.message ? err.message : "Could not read that .axicode file." };
      }
    },
  };
}
