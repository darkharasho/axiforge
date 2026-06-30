// Share + chat-link seam for the web playground. Wraps the same pure-JS encoders
// the desktop uses (@axiapps/code) and the chat-link generator (gw2buildlink via
// src/main/buildChatLink.js), plus URL-hash helpers for transient sharing.
const { encodeShareCode, decodeShareCode, isValidShareCode } = require("@axiapps/code");
const {
  generateChatLink,
  previewChatLink,
  decodeChatLinkToBuild,
} = require("../../main/buildChatLink.js");

function createShareApi() {
  async function hashToBuild(hash) {
    const code = String(hash || "").replace(/^#/, "").trim();
    if (!code) return null;
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
    buildToHash: async (build) => encodeShareCode(build),
    hashToBuild,
  };
}

module.exports = { createShareApi };
