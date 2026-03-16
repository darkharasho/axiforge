// AxiForge — Notes tab module
// Toolbar-driven markdown editor with @ mention autocomplete and preview toggle.

import { marked } from "marked";
import { state } from "./state.js";

let _el = {};
let _markEditorChanged = () => {};
let _readOnly = false;
let _previewMode = false;

export function initNotes({ notesPanel }, { readOnly = false } = {}) {
  _el = { notesPanel };
  _readOnly = readOnly;
}

export function initNotesCallbacks({ markEditorChanged }) {
  _markEditorChanged = markEditorChanged;
}

// ── Toolbar SVG icons ────────────────────────────────────────────────────

const ICONS = {
  ul: '<svg viewBox="0 0 16 16"><circle cx="3" cy="4" r="1.2" fill="currentColor" stroke="none"/><line x1="6" y1="4" x2="14" y2="4"/><circle cx="3" cy="8" r="1.2" fill="currentColor" stroke="none"/><line x1="6" y1="8" x2="14" y2="8"/><circle cx="3" cy="12" r="1.2" fill="currentColor" stroke="none"/><line x1="6" y1="12" x2="14" y2="12"/></svg>',
  ol: '<svg viewBox="0 0 16 16"><text x="1" y="5.5" font-size="5" fill="currentColor" stroke="none" font-weight="600">1</text><line x1="6" y1="4" x2="14" y2="4"/><text x="1" y="9.5" font-size="5" fill="currentColor" stroke="none" font-weight="600">2</text><line x1="6" y1="8" x2="14" y2="8"/><text x="1" y="13.5" font-size="5" fill="currentColor" stroke="none" font-weight="600">3</text><line x1="6" y1="12" x2="14" y2="12"/></svg>',
  hr: '<svg viewBox="0 0 16 16"><line x1="1" y1="8" x2="15" y2="8" stroke-width="2.5"/></svg>',
  table: '<svg viewBox="0 0 16 16"><rect x="1" y="2" width="14" height="12" rx="1.5"/><line x1="1" y1="6" x2="15" y2="6"/><line x1="1" y1="10" x2="15" y2="10"/><line x1="6" y1="2" x2="6" y2="14"/><line x1="11" y1="2" x2="11" y2="14"/></svg>',
  link: '<svg viewBox="0 0 16 16"><path d="M6.5 9.5a3 3 0 0 0 4.2.3l2-2a3 3 0 0 0-4.2-4.3L7.3 4.7"/><path d="M9.5 6.5a3 3 0 0 0-4.2-.3l-2 2a3 3 0 0 0 4.2 4.3l1.2-1.2"/></svg>',
  eye: '<svg viewBox="0 0 16 16"><path d="M1 8s3-5.5 7-5.5S15 8 15 8s-3 5.5-7 5.5S1 8 1 8z"/><circle cx="8" cy="8" r="2.5"/></svg>',
};

// ── Toolbar definition ───────────────────────────────────────────────────

const TOOLBAR_ITEMS = [
  { type: "button", label: "H1", action: "h1", style: "font-size:0.95rem;font-weight:800", title: "Heading 1" },
  { type: "button", label: "H2", action: "h2", style: "font-size:0.85rem;font-weight:700", title: "Heading 2" },
  { type: "button", label: "H3", action: "h3", style: "font-size:0.75rem;font-weight:600", title: "Heading 3" },
  { type: "sep" },
  { type: "button", label: "<strong>B</strong>", action: "bold", title: "Bold" },
  { type: "button", label: "<em>I</em>", action: "italic", title: "Italic" },
  { type: "sep" },
  { type: "button", icon: "ul", action: "ul", title: "Unordered List" },
  { type: "button", icon: "ol", action: "ol", title: "Ordered List" },
  { type: "sep" },
  { type: "button", icon: "hr", action: "hr", title: "Horizontal Rule" },
  { type: "button", icon: "table", action: "table", title: "Table" },
  { type: "button", icon: "link", action: "link", title: "Link" },
  { type: "sep" },
  { type: "button", label: "@", action: "mention", title: "@ Mention", style: "color:var(--accent-2);font-weight:700" },
];

// ── Markdown insertion ───────────────────────────────────────────────────

function insertMarkdown(action, textarea) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const text = textarea.value;
  const selected = text.slice(start, end);
  let before = text.slice(0, start);
  let after = text.slice(end);
  let cursorOffset = 0;

  switch (action) {
    case "h1": case "h2": case "h3": {
      const prefix = "#".repeat(action === "h1" ? 1 : action === "h2" ? 2 : 3) + " ";
      // Find the start of the current line
      const lineStart = before.lastIndexOf("\n") + 1;
      const linePrefix = before.slice(lineStart);
      before = before.slice(0, lineStart) + prefix + linePrefix;
      cursorOffset = prefix.length;
      break;
    }
    case "bold": {
      before = before + "**";
      after = "**" + after;
      cursorOffset = selected.length ? selected.length + 4 : 2;
      break;
    }
    case "italic": {
      before = before + "*";
      after = "*" + after;
      cursorOffset = selected.length ? selected.length + 2 : 1;
      break;
    }
    case "ul": {
      if (selected) {
        const lines = selected.split("\n").map((l) => "- " + l).join("\n");
        textarea.value = before + lines + after;
        textarea.selectionStart = start;
        textarea.selectionEnd = start + lines.length;
      } else {
        before = before + "- ";
        textarea.value = before + after;
        textarea.selectionStart = textarea.selectionEnd = before.length;
      }
      syncState(textarea);
      return;
    }
    case "ol": {
      if (selected) {
        const lines = selected.split("\n").map((l, i) => `${i + 1}. ${l}`).join("\n");
        textarea.value = before + lines + after;
        textarea.selectionStart = start;
        textarea.selectionEnd = start + lines.length;
      } else {
        before = before + "1. ";
        textarea.value = before + after;
        textarea.selectionStart = textarea.selectionEnd = before.length;
      }
      syncState(textarea);
      return;
    }
    case "hr": {
      const nl = before.length && !before.endsWith("\n") ? "\n" : "";
      const insert = `${nl}\n---\n\n`;
      before = before + insert;
      cursorOffset = insert.length;
      break;
    }
    case "table": {
      const nl = before.length && !before.endsWith("\n") ? "\n" : "";
      const insert = `${nl}| Col 1 | Col 2 | Col 3 |\n|-------|-------|-------|\n|       |       |       |\n`;
      before = before + insert;
      cursorOffset = insert.length;
      break;
    }
    case "link": {
      if (selected) {
        before = before + "[" + selected + "](";
        after = ")" + after;
        cursorOffset = selected.length + 3; // cursor after (
      } else {
        before = before + "[link text](url)";
        cursorOffset = 1; // cursor after [
      }
      break;
    }
    case "mention": {
      before = before + "@";
      cursorOffset = 1;
      break;
    }
    default: return;
  }

  textarea.value = before + (action === "bold" || action === "italic" ? selected : "") + after;
  textarea.selectionStart = textarea.selectionEnd = start + cursorOffset;
  textarea.focus();
  syncState(textarea);
}

function syncState(textarea) {
  state.editor.notes = textarea.value;
  _markEditorChanged({ updateBuildList: true });
}

// ── Build toolbar DOM ────────────────────────────────────────────────────

function buildToolbar(textarea) {
  const toolbar = document.createElement("div");
  toolbar.className = "notes-toolbar";

  for (const item of TOOLBAR_ITEMS) {
    if (item.type === "sep") {
      const sep = document.createElement("div");
      sep.className = "notes-toolbar__sep";
      toolbar.append(sep);
      continue;
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "notes-toolbar__btn";
    btn.title = item.title;
    if (item.style) btn.style.cssText = item.style;
    if (item.icon) {
      btn.innerHTML = ICONS[item.icon];
    } else {
      btn.innerHTML = item.label;
    }

    btn.addEventListener("click", () => {
      if (_previewMode) return;
      insertMarkdown(item.action, textarea);
    });

    toolbar.append(btn);
  }

  // Right-aligned preview toggle
  const right = document.createElement("div");
  right.className = "notes-toolbar__right";

  const previewBtn = document.createElement("button");
  previewBtn.type = "button";
  previewBtn.className = "notes-toolbar__preview";
  previewBtn.innerHTML = ICONS.eye + " Preview";
  previewBtn.title = "Toggle Preview";

  right.append(previewBtn);
  toolbar.append(right);

  return { toolbar, previewBtn };
}

// ── Render ────────────────────────────────────────────────────────────────

export function renderNotesPanel() {
  if (!_el.notesPanel) return;
  _previewMode = false;

  const container = document.createElement("div");
  container.className = "notes-editor";

  const textarea = document.createElement("textarea");
  textarea.className = "notes-textarea";
  textarea.value = state.editor.notes || "";
  textarea.placeholder = "Combo priorities, matchup notes, rotation...\n\nTip: Type @ to reference skills, traits, and items.";

  if (_readOnly) {
    textarea.readOnly = true;
  } else {
    textarea.addEventListener("input", () => syncState(textarea));
  }

  const { toolbar, previewBtn } = buildToolbar(textarea);
  container.append(toolbar, textarea);

  // Preview toggle
  const previewDiv = document.createElement("div");
  previewDiv.className = "notes-preview";
  previewDiv.style.display = "none";

  container.append(previewDiv);

  previewBtn.addEventListener("click", () => {
    _previewMode = !_previewMode;
    previewBtn.classList.toggle("notes-toolbar__preview--active", _previewMode);

    // Disable/enable toolbar buttons
    toolbar.querySelectorAll(".notes-toolbar__btn").forEach((btn) => {
      btn.disabled = _previewMode;
    });

    if (_previewMode) {
      textarea.style.display = "none";
      previewDiv.style.display = "";
      renderPreview(textarea.value, previewDiv);
    } else {
      textarea.style.display = "";
      previewDiv.style.display = "none";
    }
  });

  // Read-only mode: show preview immediately
  if (_readOnly && state.editor.notes) {
    _previewMode = true;
    previewBtn.classList.add("notes-toolbar__preview--active");
    toolbar.querySelectorAll(".notes-toolbar__btn").forEach((btn) => { btn.disabled = true; });
    textarea.style.display = "none";
    previewDiv.style.display = "";
    renderPreview(state.editor.notes, previewDiv);
  }

  _el.notesPanel.innerHTML = "";
  _el.notesPanel.append(container);
}

// ── Catalog search (for @ mentions) ──────────────────────────────────────

function searchCatalog(query, maxResults = 8) {
  const results = [];
  const q = query.toLowerCase();

  const catalog = state.activeCatalog;
  if (catalog?.skills) {
    for (const skill of catalog.skills) {
      if (skill.name?.toLowerCase().includes(q)) {
        results.push({ id: skill.id, name: skill.name, icon: skill.icon, category: "Skill" });
        if (results.length >= maxResults) return results;
      }
    }
  }

  if (catalog?.traits) {
    for (const trait of catalog.traits) {
      if (trait.name?.toLowerCase().includes(q)) {
        results.push({ id: trait.id, name: trait.name, icon: trait.icon, category: "Trait" });
        if (results.length >= maxResults) return results;
      }
    }
  }

  const upgrades = state.upgradeCatalog;
  if (upgrades) {
    const categories = [
      { arr: upgrades.runes, label: "Rune" },
      { arr: upgrades.sigils, label: "Sigil" },
      { arr: upgrades.foods, label: "Food" },
      { arr: upgrades.utilities, label: "Utility" },
      { arr: upgrades.infusions, label: "Infusion" },
      { arr: upgrades.enrichments, label: "Enrichment" },
      { arr: upgrades.relics, label: "Relic" },
    ];
    for (const { arr, label } of categories) {
      if (!arr) continue;
      for (const item of arr) {
        if (item.name?.toLowerCase().includes(q)) {
          results.push({ id: item.id, name: item.name, icon: item.icon, category: label });
          if (results.length >= maxResults) return results;
        }
      }
    }
  }

  return results;
}

// ── Preview rendering ─────────────────────────────────────────────────

function renderPreview(markdown, container) {
  if (!markdown) {
    container.innerHTML = '<p style="color:var(--muted);font-style:italic">No notes yet.</p>';
    return;
  }
  const html = marked.parse(markdown, { breaks: true });
  container.innerHTML = html;
}
