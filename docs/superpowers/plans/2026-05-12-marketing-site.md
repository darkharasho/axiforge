# AxiForge Marketing Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-page static marketing site for AxiForge under `marketing/` and deploy it to GitHub Pages via Actions.

**Architecture:** Plain HTML + CSS + a small vanilla JS file. No build step, no framework. Deployed by a GitHub Actions workflow that uploads `marketing/` as a Pages artifact. Download CTAs resolve live from `api.github.com/repos/darkharasho/axiforge/releases/latest` with a graceful fallback to the releases page.

**Tech Stack:** HTML5, CSS3 (custom properties, IntersectionObserver-driven animation), vanilla JS, GitHub Actions, `actions/upload-pages-artifact@v3`, `actions/deploy-pages@v4`.

**Spec:** `docs/superpowers/specs/2026-05-12-marketing-site-design.md`

---

## File Structure

```
marketing/
├── index.html          # Page markup (top bar, hero, features, how-it-works, download, footer)
├── styles.css          # All styling, theme custom properties, responsive layout
├── main.js             # Release resolver, theme switcher, IntersectionObserver fade-in
└── assets/
    ├── favicon.svg
    ├── favicon-32.png
    ├── og.png                  # 1200x630 social preview
    ├── hero-editor.png         # Main editor screenshot
    ├── feature-wiki.png        # Wiki summary panel screenshot
    └── feature-publish.png     # Publish flow screenshot

.github/workflows/
└── marketing.yml       # Deploy marketing/ to GitHub Pages
```

Each file owns one concern: markup, presentation, behavior, CI. No shared helpers — the JS is small enough to live in one file.

---

## Task 1: Scaffold marketing folder and index.html shell

**Files:**
- Create: `marketing/index.html`
- Create: `marketing/styles.css` (empty for now)
- Create: `marketing/main.js` (empty for now)

- [ ] **Step 1: Create the directory and empty stylesheet/script**

```bash
mkdir -p marketing/assets
touch marketing/styles.css marketing/main.js
```

- [ ] **Step 2: Create `marketing/index.html` with the full document skeleton**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>AxiForge — Forge Guild Wars 2 builds. Publish them with one click.</title>
    <meta
      name="description"
      content="A native desktop editor for Guild Wars 2 builds — professions, traits, skills, gear — that publishes your library to your own GitHub Pages site."
    />
    <meta property="og:title" content="AxiForge" />
    <meta
      property="og:description"
      content="Forge Guild Wars 2 builds. Publish them with one click."
    />
    <meta property="og:image" content="./assets/og.png" />
    <meta property="og:type" content="website" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="icon" type="image/svg+xml" href="./assets/favicon.svg" />
    <link rel="icon" type="image/png" sizes="32x32" href="./assets/favicon-32.png" />
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body data-theme="molten-core">
    <a class="skip-link" href="#main">Skip to content</a>

    <header class="topbar">
      <a class="wordmark" href="#top">AxiForge</a>
      <nav class="topbar-nav">
        <a href="https://github.com/darkharasho/axiforge" rel="noopener" aria-label="GitHub repository">GitHub</a>
        <a class="topbar-cta" href="#download">Download</a>
      </nav>
    </header>

    <main id="main">
      <section id="top" class="hero">
        <p class="eyebrow">Guild Wars 2 · Desktop build editor</p>
        <h1 class="headline">Forge Guild Wars 2 builds.<br />Publish them with one click.</h1>
        <p class="subhead">
          A native editor for professions, traits, skills, and gear — that publishes your build
          library to your own GitHub Pages site.
        </p>
        <div class="cta-row">
          <a class="cta cta-primary" data-download="win" href="https://github.com/darkharasho/axiforge/releases/latest">
            Download for Windows
          </a>
          <a class="cta cta-secondary" data-download="linux" href="https://github.com/darkharasho/axiforge/releases/latest">
            Linux (.AppImage)
          </a>
          <a class="cta cta-tertiary" href="https://github.com/darkharasho/axiforge">View on GitHub</a>
        </div>
        <div class="theme-chips" role="group" aria-label="Preview theme">
          <button type="button" class="theme-chip" data-theme="molten-core" aria-pressed="true" title="Molten Core"></button>
          <button type="button" class="theme-chip" data-theme="frostforge" aria-pressed="false" title="Frostforge"></button>
          <button type="button" class="theme-chip" data-theme="verdant-crucible" aria-pressed="false" title="Verdant Crucible"></button>
          <button type="button" class="theme-chip" data-theme="cinderfall" aria-pressed="false" title="Cinderfall"></button>
        </div>
        <figure class="hero-shot reveal">
          <img src="./assets/hero-editor.png" alt="AxiForge build editor showing a profession, specializations, and skills" />
        </figure>
      </section>

      <section class="features" aria-labelledby="features-title">
        <h2 id="features-title" class="section-title">What's in the box</h2>
        <ul class="feature-grid">
          <li class="feature reveal">
            <h3>Native build editor</h3>
            <p>Professions, three specialization lines with trait picks, heal / utility / elite skills.</p>
          </li>
          <li class="feature reveal">
            <h3>Live GW2 wiki lookups</h3>
            <p>Selected traits and skills resolve to a wiki summary panel without leaving the app.</p>
          </li>
          <li class="feature reveal">
            <h3>Publish to your GitHub Pages</h3>
            <p>First-time setup wires a dedicated <code>axiforge</code> repo and Pages workflow automatically.</p>
          </li>
          <li class="feature reveal">
            <h3>Equipment, tags, and notes</h3>
            <p>Annotate builds with the gear they need and how to play them.</p>
          </li>
          <li class="feature reveal">
            <h3>Theme variety</h3>
            <p>Molten Core, Frostforge, Verdant Crucible, Cinderfall, plus accent overrides.</p>
          </li>
          <li class="feature reveal">
            <h3>Free, open source, no telemetry</h3>
            <p>MIT licensed. GitHub device-flow auth only — nothing else leaves your machine.</p>
          </li>
        </ul>
      </section>

      <section class="how" aria-labelledby="how-title">
        <h2 id="how-title" class="section-title">How it works</h2>
        <ol class="how-steps">
          <li class="how-step reveal">
            <span class="how-num">1</span>
            <h3>Install &amp; sign in</h3>
            <p>Download for your OS, then sign in with GitHub via device flow.</p>
          </li>
          <li class="how-step reveal">
            <span class="how-num">2</span>
            <h3>Build</h3>
            <p>Pick a profession, dial in specs and skills, add equipment notes and tags.</p>
          </li>
          <li class="how-step reveal">
            <span class="how-num">3</span>
            <h3>Publish</h3>
            <p>One click pushes your library to <code>yourname.github.io/axiforge</code>.</p>
          </li>
        </ol>
      </section>

      <section id="download" class="download" aria-labelledby="download-title">
        <h2 id="download-title" class="section-title">Get AxiForge</h2>
        <p class="release-line" data-release-line>Latest release</p>
        <div class="cta-row">
          <a class="cta cta-primary" data-download="win" href="https://github.com/darkharasho/axiforge/releases/latest">
            Download for Windows (.exe)
          </a>
          <a class="cta cta-secondary" data-download="linux" href="https://github.com/darkharasho/axiforge/releases/latest">
            Download for Linux (.AppImage)
          </a>
        </div>
        <p class="release-meta">
          <a href="https://github.com/darkharasho/axiforge/releases">All releases →</a>
          · Source builds available — see <a href="https://github.com/darkharasho/axiforge#readme">README</a>.
        </p>
      </section>
    </main>

    <footer class="footer">
      <div class="footer-row">
        <span class="wordmark">AxiForge</span>
        <span class="footer-meta">MIT licensed · <span data-version>v0.0.0</span></span>
      </div>
      <div class="footer-row">
        <a href="https://github.com/darkharasho/axiforge">GitHub</a>
        <a href="https://github.com/darkharasho/axiforge/releases">Releases</a>
        <a href="https://github.com/darkharasho/axiforge/issues/new">Report an issue</a>
      </div>
      <p class="disclaimer">Not affiliated with ArenaNet, NCsoft, or Guild Wars 2.</p>
    </footer>

    <script src="./main.js" defer></script>
  </body>
</html>
```

- [ ] **Step 3: Open the file in a browser to verify markup loads**

```bash
xdg-open marketing/index.html >/dev/null 2>&1 || open marketing/index.html
```

Expected: page renders as an unstyled but readable outline with all section headings and links present. Images will be broken (no assets yet) — that's fine.

- [ ] **Step 4: Commit**

```bash
git add marketing/index.html marketing/styles.css marketing/main.js
git commit -m "feat(marketing): scaffold marketing/ with index.html shell"
```

---

## Task 2: Style sheet — tokens, base, top bar, hero

**Files:**
- Modify: `marketing/styles.css`

- [ ] **Step 1: Write the full stylesheet for tokens, base resets, top bar, and hero**

Replace the entire contents of `marketing/styles.css` with:

```css
/* ─────────────────────────────────────────────────────────────────────────
   AxiForge marketing site
   Palette tokens borrowed from the app's Molten Core theme.
   ───────────────────────────────────────────────────────────────────────── */

:root {
  --bg: #0e0806;
  --bg-2: #120a08;
  --panel: #1a1210;
  --panel-2: #140e0c;
  --line: #2a1e1a;
  --line-soft: #201814;
  --text: #f0e6dc;
  --muted: #9a8a80;
  --accent: #e87830;
  --accent-2: #e6a537;
  --accent-rgb: 232, 120, 48;
  --panel-gradient: linear-gradient(180deg, rgba(26, 18, 16, 0.95), rgba(20, 14, 12, 0.95));
  --radius: 10px;
  --radius-sm: 6px;
  --max-w: 1180px;
}

[data-theme="frostforge"] {
  --accent: #5898d0;
  --accent-2: #88c8e8;
  --accent-rgb: 88, 152, 208;
}
[data-theme="verdant-crucible"] {
  --accent: #48b070;
  --accent-2: #60c888;
  --accent-rgb: 72, 176, 112;
}
[data-theme="cinderfall"] {
  --accent: #c0463c;
  --accent-2: #e07060;
  --accent-rgb: 192, 70, 60;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--text);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}

a { color: var(--accent-2); text-decoration: none; }
a:hover { color: var(--accent); }

img { max-width: 100%; height: auto; display: block; }

code {
  font-family: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
  font-size: 0.92em;
  background: rgba(255, 255, 255, 0.04);
  padding: 0.08em 0.35em;
  border-radius: 4px;
}

.skip-link {
  position: absolute;
  left: -9999px;
}
.skip-link:focus {
  left: 1rem;
  top: 1rem;
  background: var(--panel);
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius-sm);
  z-index: 100;
}

/* ── Top bar ──────────────────────────────────────────────────────────── */

.topbar {
  position: sticky;
  top: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.9rem 1.25rem;
  background: rgba(14, 8, 6, 0.78);
  backdrop-filter: saturate(140%) blur(10px);
  border-bottom: 1px solid var(--line);
}
.wordmark {
  font-family: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--text);
}
.topbar-nav { display: flex; gap: 1rem; align-items: center; }
.topbar-nav a { color: var(--text); }
.topbar-cta {
  background: linear-gradient(180deg, var(--accent), color-mix(in srgb, var(--accent) 70%, black));
  color: #1a0e08 !important;
  padding: 0.45rem 0.9rem;
  border-radius: var(--radius-sm);
  font-weight: 600;
}

/* ── Hero ─────────────────────────────────────────────────────────────── */

.hero {
  position: relative;
  max-width: var(--max-w);
  margin: 0 auto;
  padding: 6rem 1.25rem 4rem;
  text-align: center;
  overflow: hidden;
}
.hero::before {
  content: "";
  position: absolute;
  inset: -10% 10% auto 10%;
  height: 60%;
  background: radial-gradient(
    ellipse at center,
    rgba(var(--accent-rgb), 0.28),
    rgba(var(--accent-rgb), 0) 65%
  );
  filter: blur(10px);
  z-index: -1;
  pointer-events: none;
}
.eyebrow {
  font-family: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.14em;
  font-size: 0.78rem;
  margin: 0 0 1.25rem;
}
.headline {
  font-family: Inter, system-ui, sans-serif;
  font-weight: 800;
  letter-spacing: -0.02em;
  font-size: clamp(2rem, 5vw, 3.6rem);
  margin: 0 0 1rem;
  line-height: 1.08;
}
.subhead {
  color: var(--muted);
  max-width: 640px;
  margin: 0 auto 2rem;
  font-size: 1.05rem;
}

.cta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  justify-content: center;
  align-items: center;
}
.cta {
  display: inline-flex;
  align-items: center;
  padding: 0.7rem 1.1rem;
  border-radius: var(--radius-sm);
  font-weight: 600;
  border: 1px solid transparent;
  transition: transform 120ms ease, box-shadow 120ms ease, background 120ms ease;
}
.cta-primary {
  background: linear-gradient(180deg, var(--accent), color-mix(in srgb, var(--accent) 70%, black));
  color: #1a0e08;
}
.cta-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(var(--accent-rgb), 0.35);
  color: #1a0e08;
}
.cta-secondary {
  background: var(--panel);
  color: var(--text);
  border-color: var(--line);
}
.cta-secondary:hover {
  border-color: var(--accent);
  color: var(--text);
}
.cta-tertiary {
  color: var(--muted);
  padding: 0.7rem 0.5rem;
}
.cta-tertiary:hover { color: var(--accent-2); }

.theme-chips {
  display: flex;
  gap: 0.5rem;
  justify-content: center;
  margin: 1.5rem 0 2.25rem;
}
.theme-chip {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px solid var(--line);
  background: var(--accent);
  cursor: pointer;
  padding: 0;
  transition: transform 120ms ease, box-shadow 120ms ease;
}
.theme-chip[data-theme="molten-core"]      { background: #e87830; }
.theme-chip[data-theme="frostforge"]       { background: #5898d0; }
.theme-chip[data-theme="verdant-crucible"] { background: #48b070; }
.theme-chip[data-theme="cinderfall"]       { background: #c0463c; }
.theme-chip[aria-pressed="true"] {
  transform: scale(1.18);
  box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px currentColor;
}
.theme-chip:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.hero-shot {
  margin: 0;
  border-radius: var(--radius);
  overflow: hidden;
  border: 1px solid var(--line);
  background: var(--panel);
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.5), 0 0 80px rgba(var(--accent-rgb), 0.12);
}
```

- [ ] **Step 2: Reload `marketing/index.html` in the browser**

Expected: dark background, orange-tinted hero glow, monospace wordmark, primary CTA is filled orange and lifts on hover, theme chips show 4 colored dots with the first scaled up.

- [ ] **Step 3: Commit**

```bash
git add marketing/styles.css
git commit -m "feat(marketing): hero, top bar, and theme tokens"
```

---

## Task 3: Style sheet — features, how-it-works, download, footer, responsive, motion

**Files:**
- Modify: `marketing/styles.css`

- [ ] **Step 1: Append the remaining styles to `marketing/styles.css`**

Append (do not replace) to the end of the file:

```css

/* ── Section headings ─────────────────────────────────────────────────── */

.section-title {
  font-family: Inter, system-ui, sans-serif;
  font-weight: 800;
  letter-spacing: -0.01em;
  font-size: clamp(1.5rem, 2.6vw, 2rem);
  text-align: center;
  margin: 0 0 2rem;
}

section.features,
section.how,
section.download {
  max-width: var(--max-w);
  margin: 0 auto;
  padding: 4rem 1.25rem;
  border-top: 1px solid var(--line);
}

/* ── Features grid ────────────────────────────────────────────────────── */

.feature-grid {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
}
.feature {
  background: var(--panel-gradient);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 1.25rem 1.25rem 1.1rem;
}
.feature h3 {
  margin: 0 0 0.4rem;
  font-size: 1.05rem;
  font-weight: 700;
}
.feature p {
  color: var(--muted);
  margin: 0;
  font-size: 0.95rem;
}

/* ── How it works ─────────────────────────────────────────────────────── */

.how-steps {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
  counter-reset: how;
}
.how-step {
  position: relative;
  background: var(--panel-gradient);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 1.5rem 1.25rem 1.25rem;
}
.how-num {
  font-family: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
  color: var(--accent);
  font-size: 0.85rem;
  letter-spacing: 0.18em;
  display: inline-block;
  margin-bottom: 0.6rem;
}
.how-step h3 {
  margin: 0 0 0.4rem;
  font-size: 1.05rem;
  font-weight: 700;
}
.how-step p {
  color: var(--muted);
  margin: 0;
  font-size: 0.95rem;
}

/* ── Download ─────────────────────────────────────────────────────────── */

.download { text-align: center; }
.release-line {
  font-family: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
  color: var(--muted);
  margin: 0 0 1.5rem;
  font-size: 0.9rem;
}
.release-meta {
  color: var(--muted);
  margin-top: 1.25rem;
  font-size: 0.9rem;
}

/* ── Footer ───────────────────────────────────────────────────────────── */

.footer {
  border-top: 1px solid var(--line);
  padding: 2rem 1.25rem 3rem;
  max-width: var(--max-w);
  margin: 0 auto;
  color: var(--muted);
  font-size: 0.9rem;
}
.footer-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
  padding: 0.5rem 0;
}
.footer-row a { color: var(--text); }
.footer-row a:hover { color: var(--accent-2); }
.disclaimer {
  margin: 1rem 0 0;
  font-size: 0.8rem;
  color: var(--muted);
}

/* ── Motion / reveal ──────────────────────────────────────────────────── */

.reveal {
  opacity: 0;
  transform: translateY(12px);
  transition: opacity 280ms ease-out, transform 280ms ease-out;
}
.reveal.is-visible {
  opacity: 1;
  transform: translateY(0);
}

@media (prefers-reduced-motion: reduce) {
  .reveal {
    opacity: 1;
    transform: none;
    transition: none;
  }
  .cta-primary:hover { transform: none; }
}

/* ── Responsive ───────────────────────────────────────────────────────── */

@media (max-width: 900px) {
  .feature-grid,
  .how-steps {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 600px) {
  .feature-grid,
  .how-steps {
    grid-template-columns: 1fr;
  }
  .hero { padding-top: 4rem; }
  .topbar-nav { gap: 0.6rem; }
}

/* ── Focus ────────────────────────────────────────────────────────────── */

a:focus-visible,
button:focus-visible,
.cta:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}
```

- [ ] **Step 2: Reload the page in the browser**

Expected: feature grid renders as 3 columns (collapsing to 2, then 1 at smaller widths), numbered cards under "How it works", footer with two rows + disclaimer. Feature/how cards are still invisible because `.reveal` defaults to `opacity: 0` — they'll un-hide once Task 4 wires the observer. Confirm by temporarily adding `class="is-visible"` to one card; remove the test class before committing.

- [ ] **Step 3: Commit**

```bash
git add marketing/styles.css
git commit -m "feat(marketing): features, how-it-works, download, footer styles"
```

---

## Task 4: Behavior — theme switcher, release resolver, reveal-on-scroll

**Files:**
- Modify: `marketing/main.js`

- [ ] **Step 1: Replace `marketing/main.js` with the full script**

```js
/* AxiForge marketing site — interactive bits */

const REPO = "darkharasho/axiforge";
const RELEASES_URL = `https://github.com/${REPO}/releases`;
const LATEST_URL = `${RELEASES_URL}/latest`;
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const THEME_KEY = "axiforge-marketing-theme";

document.addEventListener("DOMContentLoaded", () => {
  initThemeSwitcher();
  initReveal();
  detectOs();
  resolveLatestRelease().catch(() => {
    /* fallback links already in place */
  });
});

/* ── Theme switcher ────────────────────────────────────────────────── */

function initThemeSwitcher() {
  const chips = document.querySelectorAll(".theme-chip");
  const saved = safeStorageGet(THEME_KEY);
  if (saved) applyTheme(saved);

  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      const theme = chip.dataset.theme;
      applyTheme(theme);
      safeStorageSet(THEME_KEY, theme);
    });
  });
}

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  document.querySelectorAll(".theme-chip").forEach((chip) => {
    chip.setAttribute("aria-pressed", String(chip.dataset.theme === theme));
  });
}

function safeStorageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeStorageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

/* ── Reveal-on-scroll ──────────────────────────────────────────────── */

function initReveal() {
  const targets = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window)) {
    targets.forEach((el) => el.classList.add("is-visible"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      });
    },
    { rootMargin: "0px 0px -10% 0px", threshold: 0.1 }
  );
  targets.forEach((el) => io.observe(el));
}

/* ── OS detection ──────────────────────────────────────────────────── */

function detectOs() {
  const ua = navigator.userAgent || "";
  const isLinux = /Linux|X11/.test(ua) && !/Android/.test(ua);
  if (!isLinux) return;

  document.querySelectorAll('[data-download="win"]').forEach((el) => {
    el.classList.remove("cta-primary");
    el.classList.add("cta-secondary");
  });
  document.querySelectorAll('[data-download="linux"]').forEach((el) => {
    el.classList.remove("cta-secondary");
    el.classList.add("cta-primary");
  });
}

/* ── Release resolver ──────────────────────────────────────────────── */

async function resolveLatestRelease() {
  const res = await fetch(API_URL, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const data = await res.json();

  const winAsset = (data.assets || []).find((a) => /\.exe$/i.test(a.name));
  const linuxAsset = (data.assets || []).find((a) => /\.AppImage$/i.test(a.name));

  if (winAsset) {
    document.querySelectorAll('[data-download="win"]').forEach((el) => {
      el.href = winAsset.browser_download_url;
    });
  }
  if (linuxAsset) {
    document.querySelectorAll('[data-download="linux"]').forEach((el) => {
      el.href = linuxAsset.browser_download_url;
    });
  }

  const version = (data.tag_name || data.name || "").trim();
  if (version) {
    document.querySelectorAll("[data-version]").forEach((el) => {
      el.textContent = version;
    });
    const line = document.querySelector("[data-release-line]");
    if (line) {
      line.textContent = `Latest: ${version} · released ${formatRelative(data.published_at)}`;
    }
  }
}

function formatRelative(iso) {
  if (!iso) return "recently";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "recently";
  const diffMs = Date.now() - then;
  const day = 24 * 60 * 60 * 1000;
  const days = Math.round(diffMs / day);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.round(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}
```

- [ ] **Step 2: Reload the page in the browser**

Expected:
- Hero text fades up shortly after load.
- Clicking each theme chip recolors the accent (primary CTA, hero glow, chip ring) and persists across reload.
- "Latest: vX.Y.Z · released N days ago" populates the download section after a brief network round-trip.
- Footer version replaces `v0.0.0` with the live tag.
- On Linux UA, the Linux CTA becomes the primary (orange) and Windows becomes secondary; on Windows, the reverse.

Verify the API path manually in DevTools network panel: there should be exactly one request to `api.github.com/repos/darkharasho/axiforge/releases/latest`.

- [ ] **Step 3: Verify graceful fallback**

In DevTools, switch to "Offline" and reload. The download CTAs must still link to `https://github.com/darkharasho/axiforge/releases/latest`. The version line will remain "Latest release"; no error is shown to the user. Return to "Online" before continuing.

- [ ] **Step 4: Commit**

```bash
git add marketing/main.js
git commit -m "feat(marketing): theme switcher, reveal-on-scroll, release resolver"
```

---

## Task 5: Capture and commit screenshots + favicon

**Files:**
- Create: `marketing/assets/hero-editor.png`
- Create: `marketing/assets/feature-wiki.png` (optional inline use later — capture even if unused now)
- Create: `marketing/assets/feature-publish.png` (optional — capture even if unused now)
- Create: `marketing/assets/favicon.svg`
- Create: `marketing/assets/favicon-32.png`
- Create: `marketing/assets/og.png`

- [ ] **Step 1: Create `marketing/assets/favicon.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#0e0806"/>
  <path
    d="M16 46 L32 14 L48 46 Z M24 42 L32 26 L40 42 Z"
    fill="#e87830"
    fill-rule="evenodd"
  />
</svg>
```

- [ ] **Step 2: Generate `favicon-32.png` from the SVG**

Use ImageMagick (or any PNG renderer):

```bash
magick -background none -density 384 marketing/assets/favicon.svg -resize 32x32 marketing/assets/favicon-32.png
```

If `magick` is unavailable, open `favicon.svg` in a browser, resize the viewport, and export — or use `rsvg-convert -w 32 -h 32 marketing/assets/favicon.svg -o marketing/assets/favicon-32.png`.

- [ ] **Step 3: Capture the hero editor screenshot from the running app**

```bash
npm start &
APP_PID=$!
sleep 8  # wait for the editor window to mount
# Use the readme-screenshots skill, or take a manual screenshot of the
# build editor view (Molten Core theme) at 1440x900 logical resolution.
# Save the resulting PNG to marketing/assets/hero-editor.png.
kill $APP_PID
```

Target the build editor view with a representative profession loaded (e.g. Guardian or Engineer), three specialization lines selected, skills filled in. Crop to 1440×900, save as PNG, target file size under 400 KB (use `pngquant marketing/assets/hero-editor.png --output marketing/assets/hero-editor.png --force` if larger).

- [ ] **Step 4: Capture two supporting screenshots**

Capture:
- `marketing/assets/feature-wiki.png` — wiki summary modal open with a trait selected.
- `marketing/assets/feature-publish.png` — settings or publish screen showing the Pages workflow status.

Same dimensions/compression as the hero shot. (These aren't referenced by the current markup but commit them so a future iteration can drop them in without re-capturing.)

- [ ] **Step 5: Create `marketing/assets/og.png`**

1200×630 social preview. Either:
- Composite the wordmark + tagline + hero crop in your editor of choice, OR
- Use ImageMagick to stack title text over a darkened hero crop:

```bash
magick -size 1200x630 xc:'#0e0806' \
  -gravity center -fill '#f0e6dc' -font 'DejaVu-Sans-Bold' -pointsize 64 \
  -annotate +0-40 'AxiForge' \
  -fill '#9a8a80' -pointsize 28 \
  -annotate +0+40 'Forge Guild Wars 2 builds. Publish them with one click.' \
  marketing/assets/og.png
```

- [ ] **Step 6: Reload the page in the browser**

Expected: favicon shows in the tab; hero screenshot renders below the CTAs with a soft accent glow.

- [ ] **Step 7: Commit**

```bash
git add marketing/assets/
git commit -m "feat(marketing): hero screenshot, favicon, og image"
```

---

## Task 6: GitHub Actions workflow for Pages deploy

**Files:**
- Create: `.github/workflows/marketing.yml`

- [ ] **Step 1: Create the workflow file**

```yaml
name: Deploy marketing site

on:
  push:
    branches: [main]
    paths:
      - "marketing/**"
      - ".github/workflows/marketing.yml"
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4

      - uses: actions/configure-pages@v5

      - name: Upload marketing/ as Pages artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: marketing

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Validate the YAML locally**

```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/marketing.yml')); print('ok')"
```

Expected: prints `ok`. If `python3` is unavailable, use any YAML linter.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/marketing.yml
git commit -m "ci(marketing): deploy marketing/ to GitHub Pages"
```

- [ ] **Step 4: One-time manual repo configuration (do NOT skip)**

Before merging to `main`, go to **Settings → Pages → Source** and set it to **"GitHub Actions"**. This step cannot be automated and must be done once by the repo owner. Confirm in the plan execution log that this has been done.

---

## Task 7: Verification pass

**Files:**
- None modified; this task only runs checks.

- [ ] **Step 1: Final local render check**

Open `marketing/index.html` in a browser and walk through:

- Top bar sticks on scroll, blurs background behind it.
- Hero headline, subhead, CTAs, theme chips, and hero shot all render.
- Each theme chip changes the accent color and ring; reload preserves the choice.
- Feature cards and how-steps fade up as they scroll into view.
- Download section shows live version + dates after the API call resolves.
- Footer renders both rows + disclaimer.
- Layout collapses cleanly at 900px and 600px widths (use DevTools device toolbar).

- [ ] **Step 2: Reduced-motion check**

In DevTools → Rendering → "Emulate CSS media feature `prefers-reduced-motion`" set to `reduce`. Reload. All `.reveal` elements should be immediately visible; CTA hover should not translate.

- [ ] **Step 3: Lighthouse audit**

Run a Lighthouse audit (DevTools → Lighthouse → Desktop → all categories). Targets per spec:

- Performance ≥ 95
- Accessibility ≥ 95
- Best Practices ≥ 95
- SEO ≥ 90

If any score is below target, address the specific finding (most likely candidates: missing `alt` on an image, `<a>` without discernible name on the GitHub icon link, color contrast on `--muted` text — bump `--muted` lighter if so).

- [ ] **Step 4: Confirm the workflow runs after merge**

After merging to `main`, watch the Actions tab. The "Deploy marketing site" run should complete green and publish to `https://darkharasho.github.io/axiforge/`. Open the URL and confirm the live page matches local.

- [ ] **Step 5: Commit any verification fixes (if needed)**

```bash
git add -A
git commit -m "fix(marketing): address Lighthouse findings"
```

(Skip if no fixes were needed.)

---

## Self-Review Notes

- **Spec coverage:** every section in the spec maps to a task — folder structure (T1), visual language tokens (T2), section styles (T3), behavior incl. release resolver + theme switcher + reduced-motion (T4), assets (T5), deploy workflow (T6), accessibility + Lighthouse + cross-width testing (T7).
- **Placeholders:** none — every step has either the full code, the full command, or the exact UI assertion to verify.
- **Type consistency:** `data-download="win"` / `data-download="linux"` and `data-version` / `data-release-line` are used consistently across `index.html` (T1) and `main.js` (T4). `data-theme` attribute names match between the chips and the `:root` selectors in `styles.css`.
- **Repo settings caveat:** Task 6 step 4 explicitly calls out the one-time "Pages source = GitHub Actions" toggle that cannot be automated.
