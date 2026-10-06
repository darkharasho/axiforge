# AxiForge Desktop

Electron app for creating Guild Wars 2 builds, publishing a static build site, and syncing it to GitHub Pages.

## What It Does

- GitHub device-flow auth
- First-time setup for a dedicated `axiforge` repository
- Automatic Pages workflow setup + status polling
- Native build editor for:
  - profession
  - three specialization lines + trait picks
  - heal / utility / elite skills
  - optional equipment notes + tags
- Data-driven editor catalog from Guild Wars 2 API
- Wiki summary panel for selected traits/skills
- Static site publish to `site/*` in your `axiforge` repo
- **Team Sync** — share folders with teammates and sync edits in real time. See [`workers/sync/README.md`](workers/sync/README.md) for the backend architecture.

## Setup

1. Create a GitHub OAuth App and copy its Client ID.
2. Create `.env` and set the client ID:

```bash
cp .env.example .env
```

3. Install dependencies:

```bash
npm install
```

4. Start app:

```bash
npm start
```

## Access

AxiForge checks a public access list when it starts and every few hours, by downloading `https://config.axi.link/v1/manifest`. Access to the Axi apps can be revoked for accounts, guilds or Discord servers that violate the terms of use. The list holds only one-way SHA-256 hashes, and the comparison happens on your device: AxiForge compares your GitHub user ID and the Discord servers your webhooks post to against it and never sends them, or anything else about you, anywhere. To find a webhook's server, AxiForge sends an unauthenticated GET request to the webhook URL on discord.com; that is the only other request the check makes. If the list can't be reached, AxiForge keeps working. If you believe your access was revoked by mistake, use the contact link on the block screen, or reach the author through https://github.com/darkharasho.

## Dev

```bash
npm run dev
```

To reset dev profile data:

```bash
npm run dev:clean
```
