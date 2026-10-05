// Tooltips for the Discord share buttons. Status comes from publish-status.js,
// the ESM twin of src/shared/publishState.js (which main's shareGate.js uses).
import { publishStatus, compPublishStatus, buildLookup } from "./publish-status.js";

export function compShareDisabledTooltip(comp, builds) {
  const { status } = compPublishStatus(comp, buildLookup(builds));
  if (status === "never") return "Publish this comp first";
  if (status === "stale") return "Publish your latest changes first";
  return null;
}

export function shareDisabledTooltip(build, editorDirty) {
  const status = publishStatus(build);
  if (status === "never") return "Publish this build first";
  if (status === "stale" || editorDirty) return "Publish your latest changes first";
  return null;
}
