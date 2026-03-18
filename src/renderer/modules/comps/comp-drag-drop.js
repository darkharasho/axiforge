// Comp drag-and-drop module — powered by SortableJS.
// Handles:
// - Dragging pool cards onto party line slots (clone mode)
// - Reordering party lines via the P# label handle
// - Slot swaps/moves within and across lines

import Sortable from "sortablejs";

let _sortableInstances = [];

/**
 * Wire up drag-and-drop interactions for the comp detail view.
 * Call after the detail DOM has been rendered.
 *
 * @param {{ onDropBuildToLine: Function, onReorderLines: Function }} callbacks
 */
export function wireCompDragDrop(callbacks) {
  // ── Pool sortable (clone mode) ───────────────────────────────────
  const poolListEl = document.querySelector(".comp-pool-list");
  if (poolListEl) {
    _sortableInstances.push(
      new Sortable(poolListEl, {
        group: { name: "comp-builds", pull: "clone", put: false },
        sort: false,
        animation: 150,
        forceFallback: true,
        fallbackClass: "comp-drag-icon-ghost",
        draggable: ".comp-pool-card",
        onEnd() {
          /* no-op — handled by line's onAdd */
        },
      })
    );
  }

  // ── Party line slots sortable (one per line) ─────────────────────
  document.querySelectorAll(".comp-line__slots").forEach((lineSlotsEl) => {
    _sortableInstances.push(
      new Sortable(lineSlotsEl, {
        group: { name: "comp-builds", pull: false, put: true },
        animation: 150,
        ghostClass: "comp-slot-ghost",
        onAdd(evt) {
          const buildId = evt.item.dataset.buildId;
          const lineId =
            lineSlotsEl.closest("[data-line-id]")?.dataset.lineId;
          callbacks.onDropBuildToLine(buildId, lineId);
          evt.item.remove(); // remove clone, re-render will show the slot
        },
      })
    );
  });

  // ── Party line reorder sortable ──────────────────────────────────
  const linesContainerEl = document.querySelector(
    ".comp-detail__party-panel"
  );
  if (linesContainerEl) {
    _sortableInstances.push(
      new Sortable(linesContainerEl, {
        animation: 150,
        handle: ".comp-line__label",
        ghostClass: "comp-line-ghost",
        draggable: ".comp-line",
        filter: ".comp-line--add",
        onEnd(evt) {
          callbacks.onReorderLines(evt.oldIndex, evt.newIndex);
        },
      })
    );
  }
}

/**
 * Destroy all active Sortable instances.
 * Call at the START of renderCompDetail to clean up before re-render.
 */
export function destroyCompDragDrop() {
  _sortableInstances.forEach((s) => {
    try {
      s.destroy();
    } catch {
      /* DOM may already be gone */
    }
  });
  _sortableInstances = [];
}
