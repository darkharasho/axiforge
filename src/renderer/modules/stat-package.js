// Mirrors src/shared/statPackage.js (CJS, used by the main process). The
// renderer and the SPA cannot import that CJS module -- Vite serves first-party
// CommonJS untransformed in dev -- so it is reimplemented here as ESM.
// tests/unit/renderer/stat-package.test.js locks the two in sync.

export const STAT_SLOT_KEYS = [
  "head", "shoulders", "chest", "hands", "legs", "feet",
  "mainhand1", "offhand1", "mainhand2", "offhand2",
  "back", "amulet", "ring1", "ring2", "accessory1", "accessory2",
  "breather", "aquatic1", "aquatic2",
];

/**
 * The statPackage in every slot when all slots are empty (uniform imports
 * store only the package), otherwise the slots unchanged.
 */
export function expandStatPackage(slots, statPackage) {
  const current = slots && typeof slots === "object" ? slots : {};
  if (!statPackage || Object.values(current).some(Boolean)) return current;
  return Object.fromEntries(STAT_SLOT_KEYS.map((key) => [key, statPackage]));
}
