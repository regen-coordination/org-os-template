---
id: github-pages-deploy
title: "Deploy org-os website via GitHub Pages"
status: queued
priority: 1
scope: framework
depends_on: [org-os-website]
created: 2026-08-02
started: null
completed: null
estimated_sessions: 1
tags: [deploy, github-pages, public-surfaces, website]
workstream: public-surfaces
---

## Goal

Publish the already-built org-os framework website (static Astro site at `site/`) to a
live, public URL via **GitHub Pages** — turning the aspirational `commons.org-os.dev`
config into a real, linkable address.

## Context (verified 2026-08-02)

- The `org-os-website` plan is **BUILT** (2026-06-17, branch `feat/org-os-website`): static
  Astro site at `site/`, `npm run build` green. It has never been deployed.
- **No live site exists anywhere today**: `org-os.dev` → NXDOMAIN; `commons.org-os.dev` →
  no server; no GitHub Pages enabled on `org-os-framework`, `org-os-template`, or
  `regen-coordination-os` (all 404); neither framework repo has a `homepageUrl` set.
- `site/astro.config.mjs` currently hard-codes `site: 'https://commons.org-os.dev'` and
  no `base` — correct only for a custom domain at the apex, **not** for a
  `github.io/<repo>` project path.
- This working tree (`03 Libraries/org-os`, branch `align-org-os-v3-upstream`) is a mixed
  instance: `package.json` name is `refi-bcn-os`, remote is `regen-coordination/org-os-template`.
  Deploy work should happen from a **clean checkout of the chosen target repo**, not from here.

## Open decisions (lock before executing)

1. **Target repo** — `regen-coordination/org-os-framework` (recommended; reads as the
   canonical framework home) vs `regen-coordination/org-os-template`.
2. **URL strategy** —
   - (a) Project Pages at `https://regen-coordination.github.io/<repo>/` → requires
     `base: '/<repo>'` and `site:` set to the github.io origin; **or**
   - (b) Custom domain (`org-os.dev` / `commons.org-os.dev`) → register domain, add DNS
     (`CNAME` / A records to GitHub Pages IPs), add `site/public/CNAME`, set `base: '/'`.
3. **Which `site/` content ships** — the built framework site from `feat/org-os-website`, or
   the current `align-org-os-v3-upstream` `site/` (which has drifted toward the commons build,
   `org-os-commons-site`). Reconcile which branch is source of truth first.
4. Carry-over from `org-os-website` spec §16: accent color + final docs allowlist.

## Plan

1. **Pick target repo + URL strategy** (open decisions 1–2). Reconcile which `site/` is
   canonical (decision 3) — likely merge/rebase `feat/org-os-website` to the repo default branch.
2. **Configure Astro for the chosen URL** — set `site` and `base` in `site/astro.config.mjs`
   accordingly; if custom domain, add `site/public/CNAME`. Confirm all internal links /
   asset paths respect `base` (Astro `import.meta.env.BASE_URL`).
3. **Add the Pages deploy workflow** — `.github/workflows/deploy-pages.yml` on push to the
   default branch: `actions/checkout` → `npm ci` (in `site/`) → `withastro/action` (or
   `npm run build`) → `actions/upload-pages-artifact` → `actions/deploy-pages`. Grant
   `permissions: { pages: write, id-token: write }`.
4. **Enable Pages** in repo Settings → Pages → Source: **GitHub Actions**.
5. **Build guardrails** — ensure `npm run build` passes in CI (note: `sync-wellknown.mjs`
   and `check-budgets.mjs` run in the build script; the KMS content warning about the
   quarantined `common-concerns.md` frontmatter is non-fatal but should be fixed).
6. **First deploy + verify** — push, watch the Action, confirm the live URL returns 200 and
   key routes render (`/`, `/registry`, `/graph`, `/federation`, topic hubs).
7. **Wire up discoverability** — set the repo `homepageUrl` to the live URL; add the link to
   the framework README and the `org-os-website` queue entry; mark that plan deploy-complete.

## Success criteria

- Public URL returns HTTP 200 and renders the framework site (not a 404 / docs dump).
- Deploy is automated: push to default branch → Pages updates with no manual steps.
- Repo `homepageUrl` + README point at the live link.

## Fast path (if just "get it live now")

If the answer to the open decisions is "simplest thing": target `org-os-framework`, project
Pages URL (no domain purchase), `base: '/org-os-framework'`, deploy the `feat/org-os-website`
build. Live at `https://regen-coordination.github.io/org-os-framework/` in one session.
