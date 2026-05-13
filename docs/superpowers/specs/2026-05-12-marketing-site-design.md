# AxiForge Marketing Site — Design

Single-page product marketing site for the AxiForge desktop app, deployed to GitHub Pages from this repo.

Tagline: **"Forge Guild Wars 2 builds. Publish them with one click."**

## Goals

- Communicate what AxiForge is in under 10 seconds.
- Drive downloads of the latest Windows `.exe` and Linux `.AppImage`.
- Showcase the app visually (screenshots, theme variety).
- Stay static, dependency-free, and trivial to maintain alongside the app.

## Non-Goals

- No carousel, no video, no analytics, no telemetry.
- No framework, no build step, no package install.
- No FAQ section (revisit later if support questions repeat).
- Not a docs site — README remains the source for setup details.

## Location & Deploy

- **Folder:** `marketing/` at repo root.
  - `marketing/index.html`
  - `marketing/styles.css`
  - `marketing/main.js` (download-link resolver + theme switcher)
  - `marketing/assets/` (screenshots, favicon, og image)
- **Pages source:** GitHub Actions.
- **Workflow:** `.github/workflows/marketing.yml`
  - Triggers on push to `main` when `marketing/**` or the workflow file itself changes; also `workflow_dispatch` for manual runs.
  - Uploads `marketing/` as a Pages artifact and deploys via `actions/deploy-pages@v4`.
  - Concurrency group `pages` with `cancel-in-progress: false`.
- **URL:** `https://darkharasho.github.io/axiforge/`.
- **Repo settings touched manually once:** Settings → Pages → Source = "GitHub Actions".

## Visual Language

Borrowed from the app's Molten Core theme.

- **Palette:**
  - `--bg: #0e0806`, `--bg-2: #120a08`, `--panel: #1a1210`
  - `--line: #2a1e1a`
  - Accent `#e87830` (primary), `#e6a537` (secondary highlight)
  - Body text `#f0e6dc` on near-black; muted text `#9a8a80`.
- **Type:**
  - Headlines: `Inter`, weight 800, `letter-spacing: -0.02em`. Fall back to system sans.
  - Body: system UI stack.
  - Wordmark + small labels: `ui-monospace, "SF Mono", "JetBrains Mono", monospace`.
- **Texture:**
  - Hero radial-gradient glow (accent → transparent) behind the headline.
  - 1px hairline dividers between sections using `--line`.
  - Panel gradient on feature cards matching the app's `--panel-gradient`.
- **Motion:**
  - IntersectionObserver-driven fade/translate-in on feature blocks (200ms, ease-out).
  - Hover-lift (2px translate, accent shadow) on primary CTAs.
  - No parallax, no autoplay.
- **Theme cameo:**
  - Chip-row near hero with 4 theme dots: Molten Core (default), Frostforge, Verdant Crucible, Cinderfall.
  - Selecting a chip rewrites CSS custom properties on `:root` (accent + glow color only — backgrounds stay dark to keep contrast).
  - State persists in `localStorage` under `axiforge-marketing-theme`.

## Page Structure

In order, top to bottom:

1. **Top bar** (sticky, translucent on scroll)
   - Wordmark "AxiForge" (monospace) on the left.
   - Right: GitHub icon link → `https://github.com/darkharasho/axiforge`; "Download" anchor → `#download`.

2. **Hero**
   - Eyebrow: "Guild Wars 2 · Desktop build editor"
   - H1: *Forge Guild Wars 2 builds. Publish them with one click.*
   - Subhead: "A native editor for professions, traits, skills, and gear — that publishes your build library to your own GitHub Pages site."
   - CTA row:
     - Primary: "Download for Windows" → resolved `.exe` asset URL (fallback: releases page).
     - Secondary: "Linux (.AppImage)" → resolved `.AppImage` URL.
     - Tertiary text link: "View on GitHub".
   - Theme chip-row (4 dots, labeled on hover).
   - Hero screenshot: large editor screenshot below CTAs, max-width ~1100px, soft accent glow under it.

3. **Feature grid** (3 columns desktop, 2 tablet, 1 mobile)
   - Native build editor — professions, three specialization lines + trait picks, heal/utility/elite skills.
   - Live GW2 wiki lookups — selected traits and skills resolve to the wiki summary panel.
   - Publish to your own GitHub Pages — first-time setup wires the `axiforge` repo and Pages workflow automatically.
   - Equipment, tags, and notes — annotate builds with what they need and how to play them.
   - Theme variety — Molten Core, Frostforge, Verdant Crucible, Cinderfall, and accent overrides.
   - Free, open source, no telemetry — MIT licensed, GitHub device-flow auth only.

4. **How it works** (3 numbered cards)
   1. **Install & sign in** — download for your OS, sign in with GitHub via device flow.
   2. **Build** — pick a profession, dial in specs and skills, add equipment notes and tags.
   3. **Publish** — one click pushes your library to `yourname.github.io/axiforge`.

5. **Download** (anchor `#download`)
   - H2: "Get AxiForge"
   - Live version line: "Latest: v0.6.24 · released 2 days ago" (populated by `main.js`).
   - OS-detected primary CTA (Windows or Linux based on `navigator.userAgent`).
   - Asset list below: Windows `.exe`, Linux `.AppImage`, "All releases →".
   - Note: "Source builds available — see README."

6. **Footer**
   - Left: small wordmark + "MIT licensed · v0.6.24".
   - Right: GitHub link, "Releases", "Report an issue".
   - Bottom line: "Not affiliated with ArenaNet, NCsoft, or Guild Wars 2."

## Download Link Resolution

`main.js` runs on `DOMContentLoaded`:

1. `fetch('https://api.github.com/repos/darkharasho/axiforge/releases/latest')` (no auth).
2. On success:
   - Find the asset whose `name` ends with `.exe` → set href on Windows CTAs.
   - Find the asset whose `name` ends with `.AppImage` → set href on Linux CTAs.
   - Render version + relative release date in the download section.
3. On failure (rate limit, offline):
   - Leave default `href="https://github.com/darkharasho/axiforge/releases/latest"` on all CTAs.
   - Hide the version line (or show "Latest release").
4. OS detection picks which CTA gets the primary style; both remain visible.

No retries, no caching layer — the page is cheap to reload and the API has generous unauthenticated limits for this traffic shape.

## Assets

- `marketing/assets/hero-editor.png` — main editor view (Molten Core theme).
- `marketing/assets/feature-wiki.png` — wiki summary panel.
- `marketing/assets/feature-publish.png` — publish flow / Pages status.
- `marketing/assets/favicon.svg` and `favicon-32.png`.
- `marketing/assets/og.png` — 1200×630 social preview (hero crop + wordmark).

Screenshots captured from the running app at 1440×900 logical size (DPR 2 for crisp PNGs). The `readme-screenshots` skill can drive this if existing screenshots are stale.

## Accessibility

- Color contrast checked for body text and CTAs against `--bg`.
- All images have meaningful `alt` text.
- Theme chips are real `<button>` elements with `aria-pressed`.
- Focus rings visible (2px accent outline, offset 2px).
- `prefers-reduced-motion` disables fade-in transforms.

## Testing

Manual checklist:

- Renders correctly at 360px, 768px, 1280px, 1920px.
- Download CTAs populate with live release assets; fallback works when API blocked (test by setting offline).
- Theme chips update accent and persist across reload.
- Lighthouse: Performance ≥ 95, Accessibility ≥ 95, Best Practices ≥ 95, SEO ≥ 90.
- Deploys to Pages on push to `main` touching `marketing/**`.

## Out of Scope (Explicit)

- No A/B testing, analytics, or tracking pixels.
- No newsletter signup, no contact form.
- No internationalization in v1.
- No carousel or video embed.
- No separate docs site — README stays canonical.
