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

// The AxiForge share code uses a printable-ASCII alphabet full of URL-hostile
// characters ("<", ">", "%", "&", "+", "#", "?", "!", "*", ...). Percent-encoding
// them survives a clean copy of the share-link button, but NOT a round-trip
// through a browser address bar or Discord's link parser — a lone "%" or a raw
// "<" corrupts the URL irrecoverably. base64url (A-Za-z0-9-_ only) is immune to
// all of that, so the `b=` param carries the code base64url-encoded.
function b64urlEncode(str) {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s) {
  let t = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  return atob(t);
}

// The codec returns skills in a FLAT shape ({ healId, utilityIds:[…], eliteId }),
// but the editor + build store everywhere else expect a NESTED shape
// ({ heal:{id}, utility:[{id}…], elite:{id} }). The desktop clipboard-import path
// bridges this with normalizeImportedSkills; the web hash-load path used to skip
// it, so opening a shared link dropped every skill (heal/utility/elite) — and the
// editor's auto-resync then rewrote the URL with a skill-less code. Nest here so a
// decoded shared build matches what loadBuildIntoEditor/saveBuild read.
function nestSkills(flat) {
  const s = flat && typeof flat === "object" ? flat : {};
  const ref = (id) => (Number(id) > 0 ? { id: Number(id) } : null);
  const ids = Array.isArray(s.utilityIds) ? s.utilityIds : [];
  return {
    heal: ref(s.healId),
    utility: ids.slice(0, 3).map((id) => ref(id)).filter(Boolean),
    elite: ref(s.eliteId),
  };
}

export function createShareApi() {
  // Recover the raw share code from a `b=` value, accepting (in order): a
  // base64url-encoded code (current format), or a raw code (legacy links whose
  // percent-encoding happened to survive).
  function codeFromBParam(bParam) {
    if (!bParam) return null;
    try {
      const decoded = b64urlDecode(bParam);
      if (isValidShareCode(decoded)) return decoded;
    } catch { /* not base64url */ }
    if (isValidShareCode(bParam)) return bParam; // legacy raw code
    return null;
  }

  async function hashToBuild(hash) {
    const raw = String(hash || "").replace(/^#/, "").trim();
    if (!raw) return null;
    // Format: "b=<base64url-code>&n=<name>". Legacy: a bare (percent-encoded) code.
    let code, name;
    if (/(^|&)b=/.test(raw)) {
      const params = new URLSearchParams(raw);
      code = codeFromBParam(params.get("b") || "");
      name = params.get("n") || "";
    } else {
      let bare = raw;
      try { bare = decodeURIComponent(raw); } catch { /* already raw */ }
      code = isValidShareCode(bare) ? bare : null;
    }
    if (!code) return null;
    try {
      const build = decodeShareCode(code);
      // Codec emits flat skills; the editor/store expect nested. Convert both the
      // terrestrial and underwater sets so nothing is dropped on load.
      build.skills = nestSkills(build.skills);
      build.underwaterSkills = nestSkills(build.underwaterSkills);
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
      params.set("b", b64urlEncode(encodeShareCode(build))); // URL-safe alphabet
      // serializeEditorToBuild defaults an unnamed build's title to "Untitled
      // Build" — treat that (and empty) as no name so it doesn't pollute the URL.
      const name = String(build?.title || "").trim();
      if (name && name !== "Untitled Build") params.set("n", name);
      return params.toString();
    },
    hashToBuild,
  };
}
