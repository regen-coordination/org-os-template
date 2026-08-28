# test/fixtures/

Miniature org-os instances used as test doubles for the pure page-core code. A
helper walks each instance directory recursively and produces a flat
`{ "relative/path": "file contents" }` map (e.g. `federation.yaml`,
`data/projects.yaml`, `packages/operations/projects/alpha.md`); downstream code
looks up files by those exact relative paths, so directory nesting matters.

## NOW anchor

All dates in these fixtures are calibrated against `NOW = 2026-08-08T12:00:00Z`.
**Changing any date in a fixture will break assertions in the test files that
share this anchor. Change both or neither.**

For `instance-a`:

- `2026-08-01` (`HEARTBEAT.md`, "Overdue thing") — in the past relative to NOW → critical tier.
- `2026-08-12` (`HEARTBEAT.md`, "Soon thing") — within 7 days of NOW → urgent tier.
- No-due items — upcoming tier, unless their category name contains "fund" or
  "governance" (e.g. `## Funding`), in which case they're urgent regardless of date.
- `2026-08-11` / `2026-08-09` (`data/events.yaml` / `data/meetings.yaml`) — inside
  the rolling `[NOW, NOW+7d)` this-week window.
- `2026-12-01` / `2026-07-01` (`data/events.yaml` / `data/meetings.yaml`) — outside
  that window (future-future / past).

## What each fixture covers

- **`instance-a/`** — the full instance surface (federation, projects, members,
  instances, events, meetings, heartbeat, decisions, memory, identity, agents,
  queue, dao.json, a project markdown file). Uses the v3 **nested** `federation:`
  shape (`federation.peers` / `federation.upstream`). `DECISIONS.md` is clean:
  exactly three back-to-back dated `## ` entries, no boilerplate headings.
  `data/members.yaml` has 2 members, covering the `registries.members` path
  `context-bundle.mjs` shares with `registries.projects`.
- **`instance-b/`** — two files only, covering shapes `instance-a` doesn't:
  - `federation.yaml` — the real-world **root-level** shape (`peers:` and
    `upstream:` as top-level keys, `federation:` holding only `network`, peers
    carrying `trust:` rather than `role:`), with 2 peers.
  - `DECISIONS.md` — a realistic messy version: a leading non-dated `## Conventions`
    boilerplate section followed by exactly 2 dated `## 2026-…` entries, to exercise
    dated-entry filtering (as opposed to "count every `## ` section").
