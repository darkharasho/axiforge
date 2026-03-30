import { state } from "./state.js";

// Module-level injection: set by renderer.js entry point after all modules are loaded.
// Avoids circular dep between custom-select → render-pages → custom-select.
let _bindHoverPreview = null;
let _onError = (err) => console.error("[AxiForge cselect]", err);

export function initCustomSelect({ bindHoverPreview, onError } = {}) {
  if (bindHoverPreview) _bindHoverPreview = bindHoverPreview;
  if (onError) _onError = onError;
}

export function renderCustomSelect(host, config = {}) {
  if (!host) return;
  const hasGroups = Array.isArray(config.groups) && config.groups.length > 0;
  const allOptions = hasGroups
    ? config.groups.flatMap((g) => g.options || [])
    : Array.isArray(config.options) ? config.options : [];
  const currentValue = String(config.value ?? "");
  const selectedOption =
    allOptions.find((option) => String(option.value) === currentValue) ||
    allOptions.find((option) => !option.disabled) ||
    allOptions[0] ||
    null;

  host.innerHTML = "";
  host.classList.add("cselect-host");

  const root = document.createElement("div");
  root.className = `cselect ${String(config.className || "").trim()}`.trim();

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "cselect__trigger";
  trigger.disabled = Boolean(config.disabled) || !allOptions.length;
  trigger.append(makeCustomSelectValueNode(selectedOption, config.placeholder || "Select"));

  const chevron = document.createElement("span");
  chevron.className = "cselect__chevron";
  chevron.textContent = "▾";
  trigger.append(chevron);

  const menu = document.createElement("div");
  menu.className = "cselect__menu";
  const list = document.createElement("div");
  list.className = "cselect__list";

  function makeOptionButton(option, { grouped = false } = {}) {
    const button = document.createElement("button");
    button.type = "button";
    const isSelected = String(option.value) === String(selectedOption?.value ?? "");
    button.className = `cselect__option${grouped ? " cselect__option--grouped" : ""}${isSelected ? " cselect__option--selected" : ""}`;
    button.disabled = Boolean(option.disabled);
    button.append(makeCustomSelectValueNode(option, config.placeholder || "Select"));

    if (option.kind && option.entity && _bindHoverPreview) {
      _bindHoverPreview(button, option.kind, () => option.entity);
    }

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (button.disabled) return;
      closeCustomSelect();

      // Update trigger to reflect the newly selected option
      const valueNode = trigger.querySelector(".cselect__value");
      if (valueNode) {
        const newValue = makeCustomSelectValueNode(option, config.placeholder || "Select");
        valueNode.replaceWith(newValue);
      }

      // Update selected class on all options
      for (const opt of list.querySelectorAll(".cselect__option")) {
        opt.classList.toggle("cselect__option--selected", opt === button);
      }

      if (typeof config.onChange === "function") {
        Promise.resolve(config.onChange(option.value, option)).catch((err) => _onError(err));
      }
    });
    return button;
  }

  // Track group elements for search filtering (direct references avoid attribute selectors)
  const groupRefs = [];

  if (hasGroups) {
    for (const group of config.groups) {
      const header = document.createElement("div");
      header.className = "cselect__group-header";
      header.dataset.group = group.label;
      header.append(makeCustomSelectValueNode({ label: group.label, icon: group.icon }));
      list.append(header);

      const optionRefs = [];
      for (const option of group.options || []) {
        const btn = makeOptionButton(option, { grouped: true });
        btn.dataset.value = option.value;
        list.append(btn);
        optionRefs.push({ el: btn, label: option.label });
      }
      groupRefs.push({ headerEl: header, groupLabel: group.label, options: optionRefs });
    }
  } else if (allOptions.length) {
    for (const option of allOptions) {
      list.append(makeOptionButton(option));
    }
  } else {
    const empty = document.createElement("p");
    empty.className = "cselect__empty";
    empty.textContent = "No options";
    list.append(empty);
  }

  menu.append(list);

  if (config.searchable && hasGroups) {
    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.className = "cselect__search";
    searchInput.placeholder = "Search...";
    searchInput.addEventListener("click", (e) => { e.stopPropagation(); });
    searchInput.addEventListener("input", () => {
      const query = searchInput.value.toLowerCase().trim();
      for (const groupRef of groupRefs) {
        let groupHasVisible = false;
        const matchesGroup = groupRef.groupLabel.toLowerCase().includes(query);
        for (const optRef of groupRef.options) {
          const matchesOption = optRef.label.toLowerCase().includes(query);
          const visible = !query || matchesOption || matchesGroup;
          optRef.el.style.display = visible ? "" : "none";
          if (visible) groupHasVisible = true;
        }
        groupRef.headerEl.style.display = groupHasVisible ? "" : "none";
      }
    });
    menu.insertBefore(searchInput, list);
  }

  root.append(trigger, menu);
  host.append(root);

  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleCustomSelect(root);
  });
}

export function makeCustomSelectValueNode(option, placeholder) {
  const value = document.createElement("span");
  value.className = "cselect__value";
  value.append(makeCustomSelectIconNode(option));

  const text = document.createElement("span");
  text.className = "cselect__text";
  const label = document.createElement("span");
  label.className = "cselect__label";
  label.textContent = String(option?.label || placeholder || "Select");
  text.append(label);
  if (option?.meta) {
    const meta = document.createElement("span");
    meta.className = "cselect__meta";
    meta.textContent = String(option.meta);
    text.append(meta);
  }
  value.append(text);
  return value;
}

export function makeCustomSelectIconNode(option) {
  if (option?.iconSvg) {
    const span = document.createElement("span");
    span.className = "cselect__icon cselect__icon--svg";
    span.innerHTML = String(option.iconSvg);
    return span;
  }
  if (option?.icon) {
    const img = document.createElement("img");
    img.className = "cselect__icon";
    img.src = String(option.icon);
    img.alt = `${String(option.label || "Option")} icon`;
    return img;
  }
  const fallback = document.createElement("span");
  fallback.className = "cselect__icon cselect__icon--fallback";
  const source = String(option?.iconText || option?.label || option?.meta || "?").trim();
  fallback.textContent = source ? source.slice(0, 1).toUpperCase() : "?";
  return fallback;
}

export function getSelectAnchorRect(root) {
  // For spec overlays, always anchor to the visible emblem button
  const card = root.closest(".spec-card");
  if (card) {
    const emblem = card.querySelector(".spec-emblem");
    if (emblem) return emblem.getBoundingClientRect();
  }
  const trigger = root.querySelector(".cselect__trigger");
  return trigger?.getBoundingClientRect() ?? null;
}

export function toggleCustomSelect(root) {
  if (!root) return;
  const currentlyOpen = state.openCustomSelect;
  if (currentlyOpen && currentlyOpen !== root) {
    currentlyOpen.classList.remove("cselect--open");
    resetCustomSelectMenuPosition(currentlyOpen.querySelector(".cselect__menu"));
  }
  const shouldOpen = !root.classList.contains("cselect--open");
  if (shouldOpen) {
    const menu = root.querySelector(".cselect__menu");
    const rect = getSelectAnchorRect(root);
    if (rect && menu) {
      const menuEstHeight = 300;
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const dropUp = spaceBelow < menuEstHeight + 8 && spaceAbove > spaceBelow;
      menu.style.position = "fixed";
      menu.style.left = `${Math.min(rect.left, window.innerWidth - 200)}px`;
      menu.style.right = "auto";
      if (dropUp) {
        menu.style.top = "auto";
        menu.style.bottom = `${window.innerHeight - rect.top + 6}px`;
      } else {
        menu.style.top = `${rect.bottom + 6}px`;
        menu.style.bottom = "auto";
      }
    }
  } else {
    resetCustomSelectMenuPosition(root.querySelector(".cselect__menu"));
  }
  root.classList.toggle("cselect--open", shouldOpen);
  state.openCustomSelect = shouldOpen ? root : null;
  if (shouldOpen) {
    const searchInput = root.querySelector(".cselect__search");
    if (searchInput) searchInput.focus();
  }
}

export function resetCustomSelectMenuPosition(menu) {
  if (!menu) return;
  menu.style.position = "";
  menu.style.top = "";
  menu.style.bottom = "";
  menu.style.left = "";
  menu.style.right = "";
}

export function closeCustomSelect() {
  const open = state.openCustomSelect;
  if (!open) return;
  if (open.isConnected) {
    open.classList.remove("cselect--open");
    resetCustomSelectMenuPosition(open.querySelector(".cselect__menu"));
    const searchInput = open.querySelector(".cselect__search");
    if (searchInput) {
      searchInput.value = "";
      try { searchInput.dispatchEvent(new Event("input")); } catch (_) { /* test env */ }
    }
  }
  state.openCustomSelect = null;
}
