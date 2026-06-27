// Mirrors the publish-gating predicate in src/shared/publishState.js (CJS, used
// by the main process). The renderer cannot import that CJS module — Vite serves
// first-party CommonJS untransformed in dev — so the predicate is reimplemented
// here as ESM. tests/unit/renderer/share-gate.test.js locks the two in sync.
export function compShareDisabledTooltip(comp) {
  const c = comp || {};
  const neverPublished = !c.publishedFileId;
  const stale = Boolean(c.publishedAt) && c.updatedAt !== c.publishedAt;
  if (neverPublished) return "Publish this comp first";
  if (stale) return "Publish your latest changes first";
  return null;
}

export function shareDisabledTooltip(build, editorDirty) {
  const b = build || {};
  const neverPublished = !b.publishedFileId;
  const stale = Boolean(b.publishedAt) && b.updatedAt !== b.publishedAt;
  if (neverPublished) return "Publish this build first";
  if (stale || editorDirty) return "Publish your latest changes first";
  return null;
}
