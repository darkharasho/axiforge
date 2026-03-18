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
        fallbackClass: "comp-drag-icon-ghost",
        draggable: ".comp-pool-card",
        onStart(evt) {
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
          /* no-op — handled by line's onAdd */
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
        onMove(evt) {
          // Prevent ghost from being placed after the last slot (would wrap to next row)
          const kids = lineSlotsEl.children;
          if (
            kids.length > 0 &&
            evt.willInsertAfter &&
            evt.related === kids[kids.length - 1]
          ) {
            return false;
          }
          return true;
        },
        onUpdate() {
          const lineId = lineSlotsEl.closest("[data-line-id]")?.dataset.lineId;
          const newSlots = [...lineSlotsEl.querySelectorAll(".comp-slot--filled")]
            .map((el) => el.dataset.buildId);
          callbacks.onReorderSlotsInLine?.(lineId, newSlots);
        },
        onAdd(evt) {
          const toLineId = lineSlotsEl.closest("[data-line-id]")?.dataset.lineId;
          if (evt.item.classList.contains("comp-slot--filled")) {
            // Slot moved from another line
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
          document.querySelector(".comp-line-trash")?.classList.add("comp-line-trash--visible");
        },
        onEnd() {
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
  _sortableInstances.forEach((s) => {
    try {
      s.destroy();
    } catch {
      /* DOM may already be gone */
    }
  });
  _sortableInstances = [];
}
