// Share + chat-link seam for the web playground. Wraps the same pure-JS encoders
// the desktop uses (@axiapps/code) and the chat-link generator (gw2buildlink via
// src/main/buildChatLink.js), plus URL-hash helpers for transient sharing.
import { encodeShareCode, decodeShareCode, isValidShareCode } from "@axiapps/code";
// buildChatLink.js is first-party CommonJS. babel-jest handles its named imports
// via CJS interop; for the browser bundle a small Vite plugin (see
// src/web/vite.config.js) rewrites its lone `module.exports` line to an ESM
// `export`, so these named imports resolve in Vite dev + build too.
import {
  generateChatLink,
  previewChatLink,
  decodeChatLinkToBuild,
} from "../../main/buildChatLink.js";

export function createShareApi() {
  async function hashToBuild(hash) {
    const raw = String(hash || "").replace(/^#/, "").trim();
    if (!raw) return null;
    // New format: "b=<code>&n=<name>" (URLSearchParams). Legacy: the bare code.
    // The share code itself doesn't carry the build name, so it rides as `n=`.
    let code, name;
    if (/(^|&)b=/.test(raw)) {
      const params = new URLSearchParams(raw);
      code = params.get("b") || "";
      name = params.get("n") || "";
    } else {
      try { code = decodeURIComponent(raw); } catch { code = raw; }
    }
    if (!code) return null;
    try {
      if (!isValidShareCode(code)) return null;
      const build = decodeShareCode(code);
      if (name) build.title = name;
      return build;
    } catch {
      return null;
    }
  }

  return {
    encodeShareCode: async (build) => encodeShareCode(build),
    decodeShareCode: async (code) => decodeShareCode(code),
    isShareCode: async (text) => Boolean(isValidShareCode(text)),
    generateChatLink: async (build) => generateChatLink(build),
    previewChatLink: async (link) => previewChatLink(link),
    importChatLink: async (link, name, folderId, gameMode) => {
      // Build the desktop's importChatLink shape from the pure decoder.
      const build = await decodeChatLinkToBuild(link);
      if (!build) throw new Error("Could not import that chat link.");
      return { ...build, name: name || build.name, folderId: folderId ?? null, gameMode: gameMode || build.gameMode || "pve" };
    },
    importGw2Skills: async () => {
      throw new Error("Importing from gw2skills.net is not available in the web playground.");
    },
    // URL-fragment form: "b=<code>&n=<name>". The build name is not part of the
    // share code, so it travels as a readable `n=` param (hashToBuild reads it back).
    buildToHash: async (build) => {
      const params = new URLSearchParams();
      params.set("b", encodeShareCode(build));
      // serializeEditorToBuild defaults an unnamed build's title to "Untitled
      // Build" — treat that (and empty) as no name so it doesn't pollute the URL.
      const name = String(build?.title || "").trim();
      if (name && name !== "Untitled Build") params.set("n", name);
      return params.toString();
    },
    hashToBuild,
  };
}
