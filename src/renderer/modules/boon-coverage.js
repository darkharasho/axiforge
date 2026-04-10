// Boon coverage — party-level aggregation wrapper.
// Core boon computation lives in @axi/gw2-data/engine, accessed via engine-bridge.js.
import { computeBoons, computeCombos } from "./engine-bridge.js";
import { state } from "./state.js";

/**
 * Compute boon/condition coverage for a single build.
 * Thin wrapper around engine bridge, preserving old API signature.
 */
export function computeBoonCoverage(catalog, editor, weaponSkills = []) {
  const bridgeState = {
    editor,
    activeCatalog: catalog,
    upgradeCatalog: state.upgradeCatalog || {},
  };
  return computeBoons(bridgeState, weaponSkills);
}

/**
 * Compute full party coverage for a single build: boons, conditions, combo fields, finishers.
 * Delegates core boon/condition computation to the engine.
 */
export function computePartyCoverage(catalog, editor, weaponSkills = []) {
  // Build a temporary state object for the bridge functions.
  // The bridge needs state.editor and state.activeCatalog/upgradeCatalog.
  const bridgeState = {
    editor,
    activeCatalog: catalog,
    upgradeCatalog: state.upgradeCatalog || {},
  };

  const { boons, conditions } = computeBoons(bridgeState, weaponSkills);
  const { fields: comboFields, finishers: comboFinishers } = computeCombos(bridgeState, weaponSkills, { filterWeapons: true });

  return { boons, conditions, comboFields, comboFinishers };
}
