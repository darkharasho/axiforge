import { MIGHT_MAX_STACKS, STABILITY_MAX_STACKS } from "./constants.js";

// Assumed-boon presets for the Equipment attributes panel. Stacking boons are
// counts; the rest are on/off toggles.
export function emptyBoonPreset() {
  return {
    might: 0, fury: false, alacrity: false,
    quickness: false, protection: false, regeneration: false,
    resolution: false, resistance: false, stability: 0,
    swiftness: false, vigor: false, aegis: false,
  };
}

// Every boon at full uptime — the "in a well-supported squad" view.
export function fullBoonPreset() {
  const preset = emptyBoonPreset();
  for (const key of Object.keys(preset)) preset[key] = true;
  preset.might = MIGHT_MAX_STACKS;
  preset.stability = STABILITY_MAX_STACKS;
  return preset;
}
