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
    let code = String(hash || "").replace(/^#/, "").trim();
    if (!code) return null;
    // The share code contains chars ("<", ":") the browser percent-encodes in
    // location.hash, so decode before validating (buildToHash encodes to match).
    try { code = decodeURIComponent(code); } catch { /* already raw */ }
    try {
      if (!isValidShareCode(code)) return null;
      return decodeShareCode(code);
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
    // URL-fragment-safe form of the share code (hashToBuild decodes it back).
    buildToHash: async (build) => encodeURIComponent(encodeShareCode(build)),
    hashToBuild,
  };
}
