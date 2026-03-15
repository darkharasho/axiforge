/**
 * Reference Panel sidebar for the BUILD tab.
 * Displays skill/trait details when elements are hovered.
 */

const PLACEHOLDER_HTML = `<p style="color:var(--muted); font-size:0.82rem;">Hover over a skill or trait to see details.</p>`;

/**
 * Creates the reference panel DOM inside the given container.
 *
 * @param {HTMLElement} container - The .detail-panel element to render into.
 */
export function initReferencePanel(container) {
  container.innerHTML = "";

  const host = document.createElement("div");
  host.className = "detail-host";

  const head = document.createElement("div");
  head.className = "equip-section__head";
  const headSpan = document.createElement("span");
  headSpan.textContent = "REFERENCE PANEL";
  head.append(headSpan);

  const card = document.createElement("div");
  card.className = "detail-card";
  card.id = "spa-reference-card";
  card.innerHTML = PLACEHOLDER_HTML;

  host.append(head, card);
  container.append(host);
}

/**
 * Populates the reference panel card with skill/trait data.
 *
 * @param {object} data - { name, icon, description, meta, facts }
 *   name        {string}   - Skill or trait name.
 *   icon        {string}   - URL to the icon image.
 *   description {string}   - In-game description text.
 *   meta        {string}   - Optional meta line (e.g. type/category).
 *   facts       {string[]} - Optional array of fact strings.
 */
export function updateReferencePanel(data) {
  const card = document.getElementById("spa-reference-card");
  if (!card) return;

  card.innerHTML = "";

  // Header: icon + name + meta
  const header = document.createElement("header");

  if (data.icon) {
    const img = document.createElement("img");
    img.src = data.icon;
    img.alt = data.name || "";
    img.width = 56;
    img.height = 56;
    header.append(img);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "detail-card__icon-placeholder";
    header.append(placeholder);
  }

  const headerText = document.createElement("div");

  const nameEl = document.createElement("h3");
  nameEl.textContent = data.name || "";
  headerText.append(nameEl);

  if (data.meta) {
    const metaEl = document.createElement("p");
    metaEl.style.color = "var(--muted)";
    metaEl.style.fontSize = "0.78rem";
    metaEl.style.margin = "2px 0 0";
    metaEl.textContent = data.meta;
    headerText.append(metaEl);
  }

  header.append(headerText);
  card.append(header);

  // Description section
  if (data.description) {
    const descSection = document.createElement("section");

    const descHeading = document.createElement("h4");
    descHeading.textContent = "IN-GAME DESCRIPTION";
    descSection.append(descHeading);

    const descPara = document.createElement("p");
    descPara.textContent = data.description;
    descSection.append(descPara);

    card.append(descSection);
  }

  // Facts section
  if (Array.isArray(data.facts) && data.facts.length > 0) {
    const factsSection = document.createElement("section");

    const factsHeading = document.createElement("h4");
    factsHeading.textContent = "FACTS";
    factsSection.append(factsHeading);

    const factsList = document.createElement("ul");
    for (const fact of data.facts) {
      const li = document.createElement("li");
      li.textContent = fact;
      factsList.append(li);
    }
    factsSection.append(factsList);

    card.append(factsSection);
  }
}
