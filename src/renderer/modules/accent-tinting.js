// Profession tinting state machine, extracted out of renderer.js so it can be
// tested without Electron's import-time side effects.
//
// Opening a build tints the app to its profession's accent; leaving restores
// the accent the user chose. Changing the accent while a tint is showing
// updates what will be restored, not what is on screen.
import { PROFESSION_ACCENTS, resolveAccentId, DEFAULT_ACCENT_ID } from "./accents.js";

/**
 * @param {object} deps
 * @param {(id: string, opts?: { transition?: boolean }) => string} deps.applyAccent - sets the accent on <html>, returns the resolved id. From accents.js, injected so it is fakeable in tests.
 * @param {() => (string|null|undefined)} deps.getProfession - returns the current editor profession, or a falsy value. Read live, not snapshotted.
 * @param {() => boolean} deps.isEnabled - returns whether themed build pages are on. Read live, not snapshotted.
 */
export function createAccentTinting({ applyAccent, getProfession, isEnabled }) {
  // The user's own accent, held while a profession tint is showing. Non-null
  // is what marks "a tint is showing" - the old prof- id prefix cannot do
  // that job any more, because a profession's accent is an ordinary accent
  // id and could equally be the user's own pick.
  let _userAccent = DEFAULT_ACCENT_ID;
  let _stashedAccent = null;
  // What applyAccent last set, tracked here (not read back from the DOM) so
  // this module stays DOM-free and testable. Used only to skip re-applying
  // an already-showing accent - e.g. setProfession() firing repeatedly for
  // the same profession shouldn't re-arm applyAccent's crossfade timer.
  let _shown = null;

  /** Resolves id, records it as the user's accent, and returns the resolved id. */
  function setUserAccent(id, { transition = true } = {}) {
    const resolved = resolveAccentId(id);
    _userAccent = resolved;
    // Changing the accent behind a tint updates what gets restored rather
    // than what is on screen.
    if (_stashedAccent !== null) {
      _stashedAccent = resolved;
    } else {
      applyAccent(resolved, { transition });
      _shown = resolved;
    }
    return resolved;
  }

  function applyProfessionAccentIfEnabled() {
    if (!isEnabled()) return;
    const profession = getProfession();
    const accent = profession ? PROFESSION_ACCENTS[profession] : null;
    if (!accent) return;
    if (accent === _shown) return;
    if (_stashedAccent === null) _stashedAccent = _userAccent;
    applyAccent(accent);
    _shown = accent;
  }

  function restoreUserAccentIfNeeded() {
    if (_stashedAccent === null) return;
    applyAccent(_stashedAccent);
    _shown = _stashedAccent;
    _stashedAccent = null;
  }

  return {
    setUserAccent,
    applyProfessionAccentIfEnabled,
    restoreUserAccentIfNeeded,
    // For tests: whether a profession tint is currently showing.
    get isTinting() { return _stashedAccent !== null; },
  };
}
