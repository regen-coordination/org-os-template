# browse.sh Integration — Setup Guide

**Status:** Active (local mode) · **Since:** 2026-07-03 · **Spec:** approved 2026-07-03 (browse.sh integration design)
**Capability contract:** [`skills/web-browsing/SKILL.md`](../../skills/web-browsing/SKILL.md)

## What this is

[browse.sh](https://browse.sh/) is Browserbase's Browse CLI + open catalog of per-site browser skills. It gives agents a real local Chrome session: navigate, snapshot, click, fill, extract. Built on [Stagehand](https://docs.browserbase.com/integrations/skills/browse-cli).

## Operator setup (once per machine)

```bash
npm install -g browse             # the CLI is operator-level, NOT a repo dependency
npm run browse:check              # doctor: CLI present + version
npm run browse:check -- --live    # + opens example.com, snapshots, stops
```

Requirements: Node 22+, Chrome or Chromium installed locally.

### Optional: Claude Code plugin

```bash
claude plugin install browse@browserbase --scope local
```

Per-operator sugar only. The global CLI is the common denominator across Claude Code, Cursor, and Hermes — nothing in this repo depends on the plugin.

## Modes

| Mode              | Status      | Needs                                                     |
| ----------------- | ----------- | --------------------------------------------------------- |
| Local Chrome      | **default** | nothing (no keys, no cost)                                |
| Browserbase cloud | dormant     | `BROWSERBASE_API_KEY` (see `.env.example`) + org decision |

Cloud becomes relevant when headless runs are real (Hermes on DappNode, scheduled funding scans). Until then, do not provision an account.

## Safety (summary — full rules in the skill + AGENTS.md §G)

- Read-only browsing (open/navigate/snapshot/screenshot/extract): autonomous, evidence-logged.
- State-changing actions (submit, login, post, purchase — anything that mutates the remote site): **draft-and-present, operator approval (see this node's AGENTS.md §G)** — same class as external comms.
- Never enter or store credentials via browse.
- Catalog skills (`browse skills add …`) are third-party playbooks: review before first use on a new site.

## Consumers

- `skills/funding-scout` — portal deep-scan step (JS-heavy grant portals).
- `skills/research`, `skills/idea-scout`, `skills/knowledge-curator` — interactive/JS-heavy sources.

## Portability

`skills/web-browsing/` + this file are self-contained and node-agnostic: instances receive them via framework sync (`npm run sync:upstream`) or can copy them as-is. Node-specific notes stay in each instance's `TOOLS.md`.

## Troubleshooting

| Symptom                           | Fix                                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------------------- |
| `browse: command not found`       | `npm install -g browse`; ensure `$(npm prefix -g)/bin` is on PATH                                  |
| `browse open` hangs / no browser  | Install Chrome/Chromium; retry `browse open https://example.com`                                   |
| Snapshot empty on a real site     | Site may need `browse wait` after open; try `browse skills find <site>`                            |
| Subcommand names differ from docs | `browse --help` is the source of truth; update `scripts/browse-check.mjs` live-mode args if needed |
