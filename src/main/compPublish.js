"use strict";

function serializeCompForPublish(comp, buildsMap) {
  const { id, name, notes, tags, gameMode, partyLines } = comp;
  return {
    id, name, notes, tags, gameMode, partyLines,
    builds: { ...buildsMap },
  };
}

module.exports = { serializeCompForPublish };
