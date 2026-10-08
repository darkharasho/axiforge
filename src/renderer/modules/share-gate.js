// Tooltips for the Discord share buttons. Status comes from publish-status.js,
// the ESM twin of src/shared/publishState.js (which main's shareGate.js uses).
import { publishStatus, compPublishStatus, buildLookup } from "./publish-status.js";

// queueState: this record's state in the publish queue. An upload in flight
// doesn't block: the main process waits for it before sharing.
const IN_FLIGHT = new Set(["queued", "publishing"]);
const FAILED = "Publishing failed — retry it first";
const NEVER = "Not published yet — Copy link publishes it";
const STALE = "Your latest changes aren't published yet";

export function compShareDisabledTooltip(comp, builds, queueState = null) {
  if (IN_FLIGHT.has(queueState)) return null;
  if (queueState === "failed") return FAILED;
  const { status } = compPublishStatus(comp, buildLookup(builds));
  if (status === "never") return NEVER;
  if (status === "stale") return STALE;
  return null;
}

export function shareDisabledTooltip(build, editorDirty, queueState = null) {
  if (editorDirty) return "Save your changes first";
  if (IN_FLIGHT.has(queueState)) return null;
  if (queueState === "failed") return FAILED;
  const status = publishStatus(build);
  if (status === "never") return NEVER;
  if (status === "stale") return STALE;
  return null;
}
