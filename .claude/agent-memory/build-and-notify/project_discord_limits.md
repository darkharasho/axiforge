---
name: discord artifact upload size limit
description: AxiForge build artifacts exceed Discord's file upload limit — artifacts cannot be attached to webhook posts
type: project
---

AxiForge build artifacts consistently exceed Discord's maximum upload limits:
- AppImage: ~136 MB
- Windows EXE: ~115 MB

Discord maximum upload limits: 25 MB (standard), 50 MB (Level 2 boost), 100 MB (Level 3 boost). All artifact sizes exceed even the maximum boosted limit.

**Why:** Electron apps bundle the entire Chromium runtime, making artifact sizes inherently large (100+ MB).

**How to apply:** When posting to Discord webhook, post patch notes as text content only. Include a notice in the message that artifacts are too large to attach and must be distributed via GitHub Releases, Google Drive, or a CDN. Do NOT attempt to attach the files — the request will fail.
