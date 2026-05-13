/* AxiForge marketing site — interactive bits */

const REPO = "darkharasho/axiforge";
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
