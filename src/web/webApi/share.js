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

// The build name is not part of the share code. Both the URL-hash and short-link
// forms carry it as a readable side value — but serializeEditorToBuild defaults an
// unnamed build's title to "Untitled Build", so treat that (and empty) as "no name"
// rather than polluting the URL / slug input with a placeholder.
function shareName(build) {
  const name = String(build?.title || "").trim();
  return name && name !== "Untitled Build" ? name : "";
}

export function createShareApi(deps = {}) {
  // Networked short links need a fetch + endpoints; all are injectable so the
  // seam is testable in node and the endpoints can move without touching callers.
  const fetchImpl =
    deps.fetch || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  const shortenEndpoint = deps.shortenEndpoint || "/api/shorten";
  const resolveEndpoint = deps.resolveEndpoint || "/api/b/";

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
      const name = shareName(build);
      if (name) params.set("n", name);
      return params.toString();
    },
    hashToBuild,
    // Mint a short link (build.axi.link/b/<slug>) by POSTing the raw share code
    // to the Worker. Returns the absolute URL, or null on ANY failure so the
    // caller can fall back to the serverless #b= form — sharing never hard-fails
    // offline or when the Worker is down. This is on-demand only (the Copy-link
    // button); the live editor hash-sync stays #b= to avoid a request per edit.
    buildToShortLink: async (build) => {
      if (!fetchImpl) return null;
      let code;
      try {
        code = encodeShareCode(build);
      } catch {
        return null;
      }
      const name = shareName(build);
      const body = name ? { code, name } : { code };
      try {
        const res = await fetchImpl(shortenEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res || !res.ok) return null;
        const data = await res.json();
        const url = data && data.url;
        return typeof url === "string" && url ? url : null;
      } catch {
        return null;
      }
    },
    // Resolve a slug (bare "Ab3xK9c" or a "/b/Ab3xK9c" path) back to a build via
    // the Worker, then run the SAME decode + nestSkills path hashToBuild uses.
    slugToBuild: async (slugOrPath) => {
      const slug = String(slugOrPath || "").replace(/^\/?b\//, "").trim();
      if (!slug || !fetchImpl) return null;
      try {
        const res = await fetchImpl(resolveEndpoint + encodeURIComponent(slug));
        if (!res || !res.ok) return null;
        const data = await res.json();
        const code = data && data.code;
        if (!code || !isValidShareCode(code)) return null;
        const build = decodeShareCode(code);
        build.skills = nestSkills(build.skills);
        build.underwaterSkills = nestSkills(build.underwaterSkills);
        if (data.name) build.title = data.name;
        return build;
      } catch {
        return null;
      }
    },
  };
}
