// Pure descriptors for the library/editor sync badges. Kept free of DOM so the
// status → visual mapping is unit-testable and used by every badge site.
const SPIN = `<svg class="sync-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 2a10 10 0 0 1 10 10"/></svg>`;
const CHECK = `<svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clip-rule="evenodd"/></svg>`;
const CLOCK = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;
const WARN = `<svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.346 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clip-rule="evenodd"/></svg>`;
const BOLT = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>`;

const DESCRIPTORS = {
  syncing:  { svg: SPIN,  title: "Syncing…" },
  synced:   { svg: CHECK, title: "Synced" },
  pending:  { svg: CLOCK, title: "Waiting to sync" },
  conflict: { svg: BOLT,  title: "Sync conflict — click to resolve" },
  error:    { svg: WARN,  title: "Sync failed" },
};

export const SYNC_STATUSES = Object.keys(DESCRIPTORS);

/** @returns {{ className: string, svg: string, title: string }|null} */
export function describeSyncStatus(status) {
  const d = DESCRIPTORS[status];
  return d ? { className: `--${status}`, svg: d.svg, title: d.title } : null;
}
