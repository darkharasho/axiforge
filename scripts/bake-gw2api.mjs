// Bakes the slices of the official GW2 API that the chat-link decoder
// (gw2buildlink, via src/main/buildChatLink.js) needs, so the web/Worker import
// path can decode a build WITHOUT any live api.guildwars2.com call — Cloudflare's
// shared egress IPs get 429'd there, and per-user browser calls are fragile.
//
// Output (git-ignored, served as static assets, refreshed each redeploy):
//   src/web/public/catalogs/gw2api/{professions,specializations,skills,traits,pets}.json
//
// Heavy display-only fields (description/facts/traited_facts/tooltip) are stripped
// — the decoder only needs ids, names, flags, palette maps, and structure.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, "..", "src/web/public/catalogs/gw2api");
const BASE = "https://api.guildwars2.com/v2";

async function getJson(url, attempt = 0) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "AxiForge-bake/1.0" } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } catch (err) {
    // The GW2 API intermittently 429s / 5xxs the big ids=all pulls. Back off + retry.
    if (attempt >= 5) throw new Error(`${url} -> ${err.message} (after ${attempt} retries)`);
    const wait = 1500 * Math.pow(2, attempt);
    console.log(`  retry ${attempt + 1}/5 in ${wait}ms (${url.split("/v2/")[1]}: ${err.message})`);
    await new Promise((r) => setTimeout(r, wait));
    return getJson(url, attempt + 1);
  }
}

// Drop the largest, decode-irrelevant fields to keep the baked assets small.
const stripSkill = ({ description, facts, traited_facts, tooltip, ...keep }) => keep;
const stripTrait = ({ description, facts, traited_facts, ...keep }) => keep;

async function main() {
  mkdirSync(outDir, { recursive: true });

  const write = (name, data) => {
    const json = JSON.stringify(data);
    writeFileSync(join(outDir, `${name}.json`), json);
    console.log(`baked gw2api/${name}.json (${Array.isArray(data) ? data.length : "?"} items, ${(json.length / 1024).toFixed(0)}KB)`);
  };

  write("professions", await getJson(`${BASE}/professions?ids=all&v=latest`));
  write("specializations", await getJson(`${BASE}/specializations?ids=all&v=latest`));
  write("pets", await getJson(`${BASE}/pets?ids=all&v=latest`));
  write("skills", (await getJson(`${BASE}/skills?ids=all&v=latest`)).map(stripSkill));
  write("traits", (await getJson(`${BASE}/traits?ids=all&v=latest`)).map(stripTrait));
}

main().catch((err) => {
  console.error("bake-gw2api failed:", err.message);
  process.exit(1);
});
