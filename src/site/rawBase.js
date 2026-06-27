// Resolve where the SPA fetches encrypted build/comp data.
// Pages serves the SPA shell; data is read from raw.githubusercontent.com so a
// fresh publish is live within seconds of the commit (no Pages workflow wait).
// Note: assumes the Pages branch is "main" (the app's default publish branch).
export function resolveDataBase(location, searchParams) {
  const explicit = searchParams.get("remoteBase");
  if (explicit) return explicit;
  const host = location.hostname || "";
  const m = host.match(/^([^.]+)\.github\.io$/);
  if (m) {
    const owner = m[1];
    const repo = (location.pathname || "/").split("/").filter(Boolean)[0] || "";
    if (repo) return `https://raw.githubusercontent.com/${owner}/${repo}/main/site/`;
  }
  return "";
}
