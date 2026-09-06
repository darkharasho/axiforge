// Comp drag-and-drop module — powered by SortableJS.
// Handles:
// - Dragging pool cards onto party line slots (clone mode)
// - Reordering party lines via the P# label handle
// - Slot swaps/moves within and across lines

import Sortable from "sortablejs";

let _sortableInstances = [];

// ── Drag-session CSS class ────────────────────────────────────────────────────
// While any drag is active we add "comp-dragging" to the party panel.
// The stylesheet rule for .comp-detail__party-panel.comp-dragging .comp-line__slots
// removes max-height and overflow constraints so the SortableJS ghost is visible
// when dragged into a full line that would need an extra row.

function _addDraggingClass() {
  document.querySelector(".comp-detail__party-panel")?.classList.add("comp-dragging");
}

export function collapseHoverExpanded() {
  document.querySelector?.(".comp-detail__party-panel")?.classList.remove("comp-dragging");
}

/**
 * Wire up drag-and-drop interactions for the comp detail view.
 * Call after the detail DOM has been rendered.
 *
 * @param {{ onDropBuildToLine: Function, onReorderLines: Function, onRemoveSlotFromLine: Function }} callbacks
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
        // Same threshold as the library list — Sortable defaults it to 0, so a
        // click that wobbles a pixel starts a real drag. See drag-drop.js.
        fallbackTolerance: 8,
        fallbackClass: "comp-drag-icon-ghost",
        draggable: ".mini-card",
        onStart(evt) {
          _addDraggingClass();
          // Center the 42×42 ghost under the cursor instead of anchoring
          // it at the original card's top-left corner.
          const rect = evt.item.getBoundingClientRect();
          const oe = evt.originalEvent;
          const grabX = oe ? oe.clientX - rect.left : rect.width / 2;
          const grabY = oe ? oe.clientY - rect.top : rect.height / 2;
          requestAnimationFrame(() => {
            const ghost = document.querySelector(".comp-drag-icon-ghost");
            if (ghost) {
              ghost.style.transform = `translate(${grabX - 21}px, ${grabY - 21}px)`;
            }
          });
        },
        onEnd() {
          collapseHoverExpanded();
        },
      })
    );
  }

  // ── Tag chip sortable (clone mode) ───────────────────────────────
  // Category chips share the "comp-builds" group so they can be dropped onto lines.
  // The chip carries data-category-id; the line onAdd handler routes it to
  // onDropCategoryToLine, which expands it into its member builds.
  const catListEl = document.querySelector(".comp-cat-list");
  if (catListEl) {
    _sortableInstances.push(
      new Sortable(catListEl, {
        group: { name: "comp-builds", pull: "clone", put: false },
        sort: false,
        animation: 150,
        forceFallback: true,
        // Same threshold as the library list — Sortable defaults it to 0, so a
        // click that wobbles a pixel starts a real drag. See drag-drop.js.
        fallbackTolerance: 8,
        fallbackClass: "comp-cat-drag-ghost",
        draggable: ".comp-cat-chip",
        onStart() {
          _addDraggingClass();
          document.querySelector(".comp-line-trash")?.classList.add("comp-line-trash--visible");
        },
        onEnd() {
          collapseHoverExpanded();
          document.querySelector(".comp-line-trash")?.classList.remove("comp-line-trash--visible");
        },
      })
    );
  }

  // ── Party line slots sortable (one per line) ─────────────────────
  document.querySelectorAll(".comp-line__slots").forEach((lineSlotsEl) => {
    _sortableInstances.push(
      new Sortable(lineSlotsEl, {
        group: {
          name: "comp-builds",
          pull(to) {
            return (
              to.el.classList.contains("comp-line-trash") ||
              to.el.classList.contains("comp-line__slots")
            );
          },
          put: true,
        },
        animation: 150,
        ghostClass: "comp-slot-ghost",
        draggable: ".comp-slot--filled",
        onUpdate() {
          const lineId = lineSlotsEl.closest("[data-line-id]")?.dataset.lineId;
          const newSlots = [...lineSlotsEl.querySelectorAll(".comp-slot--filled")]
            .map((el) => el.dataset.buildId);
          callbacks.onReorderSlotsInLine?.(lineId, newSlots);
        },
        onMove(evt) {
          if (evt.from === evt.to) return true; // allow reorder within same line
          const capacity = parseInt(evt.to.dataset.capacity || "5", 10);
          const filledCount = evt.to.querySelectorAll(".comp-slot--filled").length;
          if (filledCount >= capacity) return false;
        },
        onAdd(evt) {
          const toLineId = lineSlotsEl.closest("[data-line-id]")?.dataset.lineId;
          if (evt.item.dataset.categoryId) {
            // Tag chip dropped onto line → expand into its member builds
            const categoryId = evt.item.dataset.categoryId;
            evt.item.remove();
            callbacks.onDropCategoryToLine?.(categoryId, toLineId);
          } else if (evt.item.classList.contains("comp-slot--filled")) {
            // Slot moved from another line (or returned to original line)
            const fromLineId = evt.item.dataset.lineId;
            const fromSlotIdx = parseInt(evt.item.dataset.slotIdx, 10);
            const buildId = evt.item.dataset.buildId;
            evt.item.remove();
            callbacks.onMoveSlotToLine?.(buildId, fromLineId, fromSlotIdx, toLineId);
          } else {
            // Pool card dropped onto line
            const buildId = evt.item.dataset.buildId;
            callbacks.onDropBuildToLine(buildId, toLineId);
            evt.item.remove();
          }
        },
        onStart() {
          _addDraggingClass();
          document.querySelector(".comp-line-trash")?.classList.add("comp-line-trash--visible");
        },
        onEnd() {
          collapseHoverExpanded();
          document.querySelector(".comp-line-trash")?.classList.remove("comp-line-trash--visible");
        },
      })
    );
  });

  // ── Trash zone sortable ──────────────────────────────────────────
  const trashZoneEl = document.querySelector(".comp-line-trash");
  if (trashZoneEl) {
    _sortableInstances.push(
      new Sortable(trashZoneEl, {
        group: { name: "comp-builds", pull: false, put: true },
        animation: 150,
        onAdd(evt) {
          // A tag chip dragged here is meaningless (nothing to remove) — just discard it.
          if (evt.item.dataset.categoryId) {
            evt.item.remove();
            return;
          }
          const lineId = evt.item.dataset.lineId;
          const slotIdx = parseInt(evt.item.dataset.slotIdx, 10);
          evt.item.remove();
          callbacks.onRemoveSlotFromLine?.(lineId, slotIdx);
        },
        onOver() {
          trashZoneEl.classList.add("comp-line-trash--over");
        },
        onLeave() {
          trashZoneEl.classList.remove("comp-line-trash--over");
        },
      })
    );
  }

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
  collapseHoverExpanded();
  _sortableInstances.forEach((s) => {
    try {
      s.destroy();
    } catch {
      /* DOM may already be gone */
    }
  });
  _sortableInstances = [];
}
