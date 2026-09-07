"use strict";

const { HistoryStore } = require("./historyStore");
const diffBuild = require("./history/diffBuild");

/**
 * Version history for builds.
 *
 * The storage half lives in HistoryStore, shared with comps. What stays here is
 * what is actually about builds: the directory its logs live in and the differ
 * that decides what counts as an edit.
 *
 * `summarizeBuildChange` used to live here, comparing JSON.stringify of whole
 * sub-objects. `majorTraitsByTier` and `minorTraits` embed the entire GW2
 * catalog of trait options, so a game patch that reworded one option's
 * description made an untouched build read as edited. `history/diffBuild.js`
 * replaces it: it compares entities by identity, and catalog data round-trips
 * as `derived` ops that never write a version.
 *
 * @param {string} baseDir
 * @param {{folderNameOf?: (id: string) => string|undefined}} [summaryOpts]
 *   optional resolvers used to phrase summaries ("moved to Raids").
 */
class BuildHistoryStore extends HistoryStore {
  constructor(baseDir, summaryOpts = {}) {
    super(baseDir, {
      subdir: "builds",
      differ: diffBuild,
      summaryOpts,
      // A build is saved by an explicit click — there is no autosave in the
      // editor — so every save is already a decision, and merging two of them
      // inside a five-minute window destroys the state between: change an
      // enrichment and change it again, and the log kept only the second.
      coalesce: false,
      // Moving a build between folders, adding it to a comp, dragging it in
      // the library: written on the user's behalf, not edits to the build.
      versionIncidental: false,
    });
  }
}

module.exports = { BuildHistoryStore };
