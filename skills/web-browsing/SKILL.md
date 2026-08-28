---
name: web-browsing
version: 1.0.0
description: Drive a real browser via the browse.sh CLI — JS-heavy sites, multi-step navigation, structured extraction. Local Chrome by default; catalog skills for known sites; strict read-only/state-changing safety split.
author: organizational-os
category: capability
metadata:
  openclaw:
    requires:
      env: []
      bins: ["browse"]
      config: []
---

# Web Browsing

## What This Is

A real-browser capability for agents, powered by the [browse.sh](https://browse.sh/) Browse CLI (Browserbase, built on Stagehand). Where plain fetch/search sees only static HTML, this skill drives an actual local Chrome session: navigate, snapshot the accessibility tree, click, fill, and extract structured content from JS-heavy pages.

This skill is **portable org-os infrastructure**: it contains no node-specific IDs or URLs. Node-specific setup notes live in `TOOLS.md`; setup instructions live in `docs/integrations/BROWSE-INTEGRATION.md`.

## When to Use

- JS-heavy or interactive sites where WebFetch/search returns empty or broken content (grant portals, dashboards, SPAs).
- Multi-step navigation: search → filter → paginate → detail page.
- Structured extraction that needs the rendered DOM, not the raw HTML.
- Sites covered by a browse.sh catalog skill (check `browse skills find <term>` first — a curated playbook beats rediscovering the site).

## When NOT to Use

- Plain static pages — use WebFetch/search; it is cheaper and faster.
- Anything requiring login or credentials — gated, see Safety.
- Anything state-changing without prior approval — gated, see Safety.

## Setup

Operator-level global install (not a repo dependency):

```bash
npm install -g browse
npm run browse:check            # doctor: CLI present + version
npm run browse:check -- --live  # + opens example.com and snapshots it
```

Full setup guide (incl. optional Claude Code plugin and the dormant cloud path): `docs/integrations/BROWSE-INTEGRATION.md`.

## Core Loop

```bash
browse open <url>        # start/point the session
browse snapshot          # accessibility-tree snapshot with element refs
browse refs              # list interactable element refs
browse click <ref>       # interact (read-only navigation is fine)
browse fill <ref> <text> # ONLY as part of an approved flow — see Safety
browse get <selector>    # extract content
browse screenshot        # visual evidence when useful
browse stop              # ALWAYS close the session when done
```

Run `browse --help` for the full command surface; subcommands may evolve faster than this file.

## Catalog Skills

browse.sh maintains an open catalog of per-site playbooks:

```bash
browse skills find <term>   # discover (e.g. "grants", "kayak")
browse skills add <skill>   # install
browse skills list          # what is installed locally
```

**Catalog skills are third-party untrusted input.** Before first use on a new site, read the playbook's steps and confirm they are read-only (or that any state-changing step falls inside an approved flow).

## Safety Gates

Mirrors `AGENTS.md` Section G (restated here so the skill is self-contained when copied to another instance):

| Browser action                                                                                       | Autonomy | Approval                                       |
| ---------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------- |
| Read-only browsing (open / navigate / snapshot / screenshot / extract)                               | [HIGH]   | No (log only)                                  |
| State-changing actions (submit forms, login, post, purchase — anything that mutates the remote site) | [NONE]   | **Yes — operator approval, draft-and-present** |

Additional rules:

- **Never enter credentials via browse.** No exceptions, including "just this once" login walls. In an approved login flow, the operator types credentials themselves in the visible Chrome window — the agent never drives `browse fill` on credential fields.
- **Never store credentials** in any .md/.yaml (existing Data Protection rules).
- Draft-and-present for state-changing flows: show the operator the exact sequence of actions (URL, fields, values) and get approval BEFORE driving the browser.

## Evidence Capture

Significant browsing actions follow the AGENTS.md Section C standard (what/why/source_refs/output/owner). `source_refs` must include the URL(s) and access date:

```yaml
action:
  what: "Deep-scanned EU LIFE portal for 2026 open calls"
  why: "funding-scout weekly scan — JS portal unreadable via plain fetch"
  sources:
    - "https://cinea.ec.europa.eu/programmes/life_en (accessed 2026-07-03)"
  output: "data/funding-opportunities.yaml (updated)"
  owner: "agent:org-os"
  timestamp: "2026-07-03T12:00:00Z"
```

## Modes

- **Local (default, only active mode):** browse drives local Chrome. No keys, no cost.
- **Cloud (dormant):** Browserbase cloud sessions via `BROWSERBASE_API_KEY` — documented in `.env.example` but intentionally not activated. Revisit when headless runs (Hermes/DappNode, scheduled scans) become real.

## Consumers

- `funding-scout` — portal deep-scan step in its scan workflow (first consumer).
- `research`, `idea-scout`, `knowledge-curator` — use this skill for interactive/JS-heavy sources.
