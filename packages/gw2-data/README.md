# @axiapps/gw2-data

Data library for Guild Wars 2 — wiki scraping, GW2 API access, and stat computation engine. Used by [AxiForge](https://axiforge.com).

## Installation

```bash
npm install @axiapps/gw2-data
```

## Modules

The package exposes four subpath imports:

| Import | Description |
|--------|-------------|
| `@axiapps/gw2-data/wiki` | Wiki scraping and wikitext parsing |
| `@axiapps/gw2-data/api` | GW2 API client with batching and retries |
| `@axiapps/gw2-data/facts` | Fact merging for PvE/WvW balance splits |
| `@axiapps/gw2-data/engine` | Stat computation, tooltips, boon analysis |

## Wiki Client

Fetch and parse skill/trait data from the GW2 Wiki with built-in caching and rate limiting.

```js
const { WikiClient } = require("@axiapps/gw2-data/wiki");

const wiki = new WikiClient();

// Fetch wikitext for a single page
const wikitext = await wiki.getWikitext("Fireball");

// Batch-fetch multiple pages (up to 50 per request)
const pages = await wiki.getWikitextBatch(["Fireball", "Meteor Shower", "Lava Font"]);

// Parse skill/trait facts from wikitext
const { facts, hasPveOnly, splitGrouping } = wiki.parseFacts(wikitext);

// Search for pages by prefix
const matches = await wiki.prefixSearch("Fire", 10);

// Invalidate cache for recently changed pages
const changed = await wiki.refresh();
```

### Constructor Options

| Option | Default | Description |
|--------|---------|-------------|
| `cache` | `MemoryCache` | Cache adapter (MemoryCache or DiskCache) |
| `fetch` | `globalThis.fetch` | Fetch implementation |
| `wikiApiRoot` | `https://wiki.guildwars2.com/api.php` | Wiki API endpoint |
| `cacheTTL` | 4 hours | Cache TTL in milliseconds |

## GW2 API Client

Fetch data from the official GW2 API with automatic chunking, retries, and 429 handling.

```js
const { Gw2ApiClient } = require("@axiapps/gw2-data/api");

const api = new Gw2ApiClient();

// Fetch skills by ID (automatically chunked into 180-ID batches)
const skills = await api.fetchByIds("/v2/skills", [5489, 5536, 5501]);

// Fetch with caching
const data = await api.fetchCached("my-key", "https://api.guildwars2.com/v2/skills/5489", 3600000);
```

### Constructor Options

| Option | Default | Description |
|--------|---------|-------------|
| `cache` | `MemoryCache` | Cache adapter |
| `fetch` | `globalThis.fetch` | Fetch implementation |
| `apiRoot` | `https://api.guildwars2.com` | API root URL |
| `lang` | `"en"` | Language code |

## Fact Merging

Merge base (PvE) facts with WvW/PvP split facts, marking which values changed.

```js
const { mergeFacts } = require("@axiapps/gw2-data/facts");

const merged = mergeFacts(baseFacts, splitFacts);
// Changed facts have _splitFact: true
// New facts (WvW-only) have _newFact: true
```

## Engine

Compute final build stats, skill tooltips, boon uptime, and combo interactions.

```js
const {
  computeAttributes,
  collectModifiers,
  computeTooltip,
  analyzeBoons,
  analyzeCombos,
  STAT_COMBOS_BY_LABEL,
} = require("@axiapps/gw2-data/engine");

// Compute final attributes for a build
const attrs = computeAttributes({
  profession: "Elementalist",
  specializations: [...],
  equipment: { statPackage: "Berserker" },
}, catalogs);

// Collect all stat modifiers from traits, sigils, etc.
const modifiers = collectModifiers(ctx, catalogs, overrides);

// Compute a skill tooltip with modifiers applied
const tooltip = computeTooltip(attrs, skill, "Staff", modifiers);

// Analyze boon output across a skill set
const boons = analyzeBoons(skills, traits, overrides);

// Detect combo field/finisher interactions
const combos = analyzeCombos(skills, traits);
```

### StatEngine Class

For repeated computations, use the class to avoid re-loading overrides:

```js
const { StatEngine } = require("@axiapps/gw2-data/engine");

const engine = new StatEngine(catalogs);
const attrs = engine.computeAttributes(ctx);
const tooltip = engine.computeTooltip(ctx, skill, "Sword");
const boons = engine.analyzeBoons(skills, traits);
```

## Caching

Both clients accept a cache adapter. Two are included:

```js
const { MemoryCache, DiskCache } = require("@axiapps/gw2-data/wiki");

// In-memory (default)
const wiki = new WikiClient({ cache: new MemoryCache() });

// Disk-backed (persists across restarts)
const wiki = new WikiClient({ cache: new DiskCache("/tmp/gw2-wiki-cache") });
```

## License

MIT
