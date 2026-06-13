// src/main/compCodec.js
"use strict";

// Re-export comp codec from @axiapps/code package.
// The app uses encodeComp/decodeComp names; the package uses encodeCompCode/decodeCompCode.
const { encodeCompCode, decodeCompCode, isValidCompCode } = require("@axiapps/code");

/**
 * Map a decoded comp (from decodeComp) onto the stored-comp shape, resolving the
 * decoded build *objects* to freshly-created build IDs via buildRefToId.
 *
 * decodeComp returns party-line slots and category members as decoded build object
 * references (or, for a tag slot, a `{ __tagCategoryId }` marker). The import flow
 * creates real builds and records each decoded object → new id in buildRefToId; this
 * helper then rewrites slots and categories to use those ids, turning tag markers back
 * into `tag:<categoryId>` tokens.
 *
 * @param {object} decoded - result of decodeComp()
 * @param {Map<object,string>} buildRefToId - decoded build object → new build id
 * @returns {{ partyLines: Array, categories: Array }}
 */
function remapImportedComp(decoded, buildRefToId) {
  const partyLines = (decoded.partyLines || []).map((line) => ({
    capacity: line.capacity,
    slots: (line.slots || [])
      .map((slot) =>
        slot && slot.__tagCategoryId ? `tag:${slot.__tagCategoryId}` : buildRefToId.get(slot)
      )
      .filter(Boolean),
  }));

  const categories = (decoded.categories || []).map((c) => ({
    id: c.id || undefined,
    name: c.name,
    icon: c.icon,
    buildIds: (c.builds || []).map((ref) => buildRefToId.get(ref)).filter(Boolean),
  }));

  return { partyLines, categories };
}

module.exports = {
  isValidCompCode,
  encodeComp: encodeCompCode,
  decodeComp: decodeCompCode,
  remapImportedComp,
};
