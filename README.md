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

## Dev

```bash
npm run dev
```

To reset dev profile data:

```bash
npm run dev:clean
```
