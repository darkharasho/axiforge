/**
 * Initialises a global hover tooltip using the desktop's .hover-preview structure.
 * Call once at startup after the DOM is ready.
 */
export function initDetailTooltip() {
  const tooltip = document.createElement("div");
  tooltip.className = "tooltip hover-preview spa-tooltip";
  tooltip.innerHTML = `
    <div class="hover-preview__head">
      <div class="hover-preview__title tooltip__name"></div>
    </div>
    <div class="hover-preview__desc tooltip__desc"></div>
  `;
  document.body.append(tooltip);

  const titleEl = tooltip.querySelector(".tooltip__name");
  const descEl = tooltip.querySelector(".tooltip__desc");

  document.addEventListener("mouseover", (e) => {
    const target = e.target.closest("[data-name]");
    if (!target) return;

    const name = target.dataset.name || "";
    const desc = target.dataset.desc || "";

    titleEl.textContent = name;
    descEl.textContent = desc;

    const rect = target.getBoundingClientRect();
    tooltip.style.left = rect.left + "px";
    tooltip.style.top = (rect.bottom + 6) + "px";

    tooltip.classList.add("visible");
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
