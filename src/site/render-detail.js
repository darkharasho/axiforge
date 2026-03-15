/**
 * Initialises a global hover tooltip using the desktop's .hover-preview structure.
 * Call once at startup after the DOM is ready.
 */
export function initDetailTooltip() {
  const tooltip = document.createElement("div");
  tooltip.className = "hover-preview spa-tooltip";
  tooltip.innerHTML = `
    <div class="hover-preview__head" style="display:grid; grid-template-columns:42px 1fr; gap:8px; align-items:center;">
      <img class="hover-preview__icon" style="width:42px; height:42px; border-radius:8px; border:1px solid #3f5f95;" />
      <div>
        <h4 class="hover-preview__title" style="margin:0; font-size:0.9rem;"></h4>
        <p class="hover-preview__meta" style="margin:0; font-size:0.75rem; color:var(--muted);"></p>
      </div>
    </div>
    <p class="hover-preview__desc" style="margin:8px 0 0; font-size:0.82rem; color:#d8e6ff;"></p>
  `;
  document.body.append(tooltip);

  const iconEl = tooltip.querySelector(".hover-preview__icon");
  const titleEl = tooltip.querySelector(".hover-preview__title");
  const metaEl = tooltip.querySelector(".hover-preview__meta");
  const descEl = tooltip.querySelector(".hover-preview__desc");

  document.addEventListener("mouseover", (e) => {
    const target = e.target.closest("[data-name]");
    if (!target) return;

    const name = target.dataset.name || "";
    const desc = target.dataset.desc || "";
    const icon = target.dataset.icon || "";
    const meta = target.dataset.meta || "";

    titleEl.textContent = name;
    descEl.textContent = desc;
    metaEl.textContent = meta;

    if (icon) {
      iconEl.src = icon;
      iconEl.style.display = "";
    } else {
      iconEl.src = "";
      iconEl.style.display = "none";
    }

    tooltip.classList.add("visible");

    // Position after making visible so we can measure tooltip size
    requestAnimationFrame(() => {
      const rect = target.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      let top = rect.bottom + 8;
      let left = rect.left;

      // Flip above if would go off bottom
      if (top + tooltipRect.height > window.innerHeight - 8) {
        top = rect.top - tooltipRect.height - 8;
      }

      // Shift left if near right edge
      if (left + tooltipRect.width > window.innerWidth - 8) {
        left = window.innerWidth - tooltipRect.width - 8;
      }

      tooltip.style.left = Math.max(8, left) + "px";
      tooltip.style.top = Math.max(8, top) + "px";
    });
  });

  document.addEventListener("mouseout", (e) => {
    const target = e.target.closest("[data-name]");
    if (!target) return;
    // Only hide if the mouse is leaving the [data-name] element entirely,
    // not just moving between its children (which also fire mouseout).
    if (target.contains(e.relatedTarget)) return;
    tooltip.classList.remove("visible");
  });
}
