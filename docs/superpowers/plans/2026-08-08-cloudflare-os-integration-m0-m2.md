# Cloudflare OS × org-os Integration — M0–M2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy Cloudflare OS for the org-os federation and build the `gatekeeper-org-os` read core + context bundle (M1) and the shared page core + org-dashboard gadget (M2), after an M0 platform probe that retires the gatekeeper-authoring unknown.

**Architecture:** All meaning lives in `packages/cloudflare-os-integration/` in the org-os repo: a pure, runtime-agnostic page core (file-contents in → view-model/markdown out), a substrate interface (`GitHubSubstrate` now; workerd/Radicle later), and read-only capabilities. The Cloudflare OS deployment (a `cloudflare-os-starter` fork) holds only thin adapter wiring, written against discoveries recorded in M0. Writes (M3) and federation view (M4) get a follow-up plan.

**Tech Stack:** Node ≥22 + `node --test` (house standard), `js-yaml` (pure JS, Workers-safe), GitHub REST API via injected `fetch`, Cloudflare Workers (adapter only). No new test framework, no TypeScript, no bundler in this repo.

**Spec:** `docs/superpowers/specs/2026-08-08-cloudflare-os-org-os-integration-design.md`
**Branch:** `autopoiesis-phase2-pilot` (current work branch) — repo `03 Libraries/org-os`

---

## Context primer (read first)

- **org-os instances** are git repos with `data/*.yaml` registries, `federation.yaml`, `HEARTBEAT.md` (checkbox tasks), `DECISIONS.md`, `memory/`, `.well-known/*.json`.
- **`scripts/initialize.mjs`** (1329 lines, fs-bound) builds a session state JSON (`node scripts/initialize.mjs` → JSON; `--format=markdown` → dashboard). **`scripts/page-shim.mjs`** renders 7 pages (`dashboard`, `projects`, `tasks`, `instances`, `decisions`, `plans`, `this-week`) from that JSON. There is **no `packages/tui-data`** yet — the shim IS the page surface.
- **Cloudflare OS** (github.com/cloudflare/cloudflare-os, pinned commit chosen in Task 1): kernel `packages/workshop-backend`, drivers `packages/gatekeeper-*`, shell `packages/workshop-frontend`. Gadgets = sandboxed apps; Blueprints = shareable app templates. Local dev: `pnpm run-local` → `http://localhost:8787`.
- **This plan's product** is mostly plain Node code in this repo, TDD'd with `node --test`. Only Tasks 1–3, 13, 18 touch the Cloudflare OS fork, and they are discovery/wiring checklists that write their findings into `docs/integrations/cloudflare-os.md`.

## File structure (target)

```
packages/cloudflare-os-integration/
├── package.json                     # name @org-os/cloudflare-os-integration, node --test
├── README.md
├── src/
│   ├── page-core/
│   │   ├── parse-helpers.mjs        # extractCheckboxes, daysUntil, getRelativeAge, parseFrontmatter (pure)
│   │   ├── build-state.mjs          # buildState(files, {now}) → state view-model (pure)
│   │   └── render-page.mjs          # renderPage(pageId, state) → markdown (pure; ports page-shim renderers)
│   ├── substrate/
│   │   ├── memory-substrate.mjs     # in-memory Substrate (tests, fixtures)
│   │   └── github-substrate.mjs     # GitHub API Substrate (injected fetch + cache)
│   ├── gatekeeper/
│   │   ├── instances.mjs            # instance registry validation
│   │   ├── context-bundle.mjs       # buildContextBundle(substrate, opts)
│   │   └── capabilities.mjs         # handleCapability(name, args, deps) — read caps
│   └── adapter/
│       └── README.md                # wiring instructions into the CF fork (written Task 13)
├── blueprints/
│   └── org-dashboard/
│       └── gadget.html              # M2 gadget source (canonical copy)
└── test/
    ├── fixtures/instance-a/…        # mini org-os instance (Task 6)
    ├── parse-helpers.test.mjs
    ├── build-state.test.mjs
    ├── render-page.test.mjs
    ├── memory-substrate.test.mjs
    ├── github-substrate.test.mjs
    ├── instances.test.mjs
    ├── context-bundle.test.mjs
    └── capabilities.test.mjs

Modified: scripts/page-shim.mjs (delegates renderers to page-core — Task 17)
Modified: package.json (adds test:cloudflare-os-integration script — Task 4)
Created:  docs/integrations/cloudflare-os.md (discovery doc — Tasks 2, 3, 13, 14, 18)
Modified: data/projects.yaml, DECISIONS.md, memory/2026-08-08.md (Task 19)
```

**Deliberate scope cuts (decisions, not TODOs):** `proposeChange` (writes) is M3 — `GitHubSubstrate` throws `Error("proposeChange: M3 — not implemented in read-only pilot")`. `funding` in state is always `{ upcoming: [] }` (renderer-compatible empty). `thisWeek` uses a rolling `[now, now+7d)` window — a documented simplification vs `initialize.mjs`'s calendar week. `npm run selftest` wiring lands with the M3–M4 follow-up plan.

---

## Milestone M0 — Platform probe

### Task 1: Deploy cloudflare-os-starter to the pilot Cloudflare account

**Files:** none in this repo (external fork + CF account). Findings → Task 2's doc.

- [ ] **Step 1:** Fork `https://github.com/cloudflare/cloudflare-os-starter` into the operator's GitHub account. Follow its README deploy path (or `https://os.cloudflare.app/deploy`) into the pilot Cloudflare account.
- [ ] **Step 2:** Verify: the deployed workspace URL loads, you can create a document, and the agent chat responds.
- [ ] **Step 3:** Connect the **stock GitHub gatekeeper** to the operator's GitHub (OAuth flow in workspace settings). Verify the workspace agent can read an issue from a known repo.
- [ ] **Step 4:** Record in a scratch note (becomes doc in Task 2): deployed URL, CF account used, starter fork URL, the `cloudflare-os` version/commit the starter pinned, any deploy surprises.

### Task 2: Local dev environment + discovery doc

**Files:**
- Create: `docs/integrations/cloudflare-os.md`

- [ ] **Step 1:** Clone and run locally:

```bash
git clone https://github.com/cloudflare/cloudflare-os ~/code/cloudflare-os
cd ~/code/cloudflare-os && git log -1 --format='%H %cs'   # record this pin
pnpm install && pnpm run-local                             # → http://localhost:8787
```

- [ ] **Step 2:** Read one small `packages/gatekeeper-*` package end-to-end (pick the smallest, e.g. Spotify or Email over GitHub). Read `packages/workshop-backend`'s gatekeeper registration path.
- [ ] **Step 3:** Create `docs/integrations/cloudflare-os.md` with this exact skeleton, and fill every section with findings (a section may conclude "not supported — fallback X", never be left empty):

```markdown
# Cloudflare OS Integration — Platform Discovery & Runbook

**Pinned cloudflare-os commit:** <sha> (<date>) · **Starter fork:** <url> · **Deployed workspace:** <url>
**Status:** M0 discovery — answers below drive Tasks 13 and 18.

## D1. Gatekeeper authoring interface
What a gatekeeper Worker must export/implement; how capabilities are declared (names, schemas); template package copied from.
## D2. Gatekeeper registration & deployment
How a new gatekeeper is registered with workshop-backend, locally and in the deployed fork; where config/secrets live.
## D3. Capability invocation from agent chat
How the workspace agent discovers and calls gatekeeper capabilities; what the agent sees (names, descriptions, schemas).
## D4. Gadget → gatekeeper RPC
How gadget client code calls a gatekeeper capability (Cap'n Web RPC session details); exact code shape for a fetch-like call.
## D5. Context ingestion
Native mechanism (if any) for loading workspace/company context and skills; else: fallback = agent calls get_context_bundle at conversation start.
## D6. Blueprint file format
Whether a blueprint/gadget has a file representation a repo can hold verbatim; how to import blueprints/org-dashboard/gadget.html into the workspace.
## D7. Human-in-the-loop approval
How gatekeeper capability approval flows work (needed for M3 writes; record now while reading the code).
## M1 acceptance evidence
(filled by Task 14)
## Adapter wiring runbook
(filled by Task 13)
```

- [ ] **Step 4:** Commit:

```bash
git add docs/integrations/cloudflare-os.md
git commit -m "docs(cloudflare-os): M0 platform discovery — gatekeeper/gadget/context answers"
```

### Task 3: Hello-world gatekeeper

**Files:** external (in `~/code/cloudflare-os` or the starter fork, per D2). Findings → doc §D1–D3.

- [ ] **Step 1:** Copy the template gatekeeper package chosen in Task 2 → `gatekeeper-helloworld` exposing one capability `hello(name)` returning `{"message": "hello <name> from org-os"}`.
- [ ] **Step 2:** Register it locally (per D2), restart `pnpm run-local`, and in workspace chat ask the agent to call `hello("org-os")`. Expected: the message comes back in chat.
- [ ] **Step 3:** Deploy the same to the pilot workspace (per D2's deployed-fork path). Verify in the deployed chat.
- [ ] **Step 4:** Update §D1–D3 with the *actual* steps that worked (commands, file paths, gotchas). Commit:

```bash
git add docs/integrations/cloudflare-os.md
git commit -m "docs(cloudflare-os): M0 gate passed — hello-world gatekeeper live locally and deployed"
```

**M0 GATE:** Do not start Task 13/18 until D1–D6 are filled. Tasks 4–12 (pure Node) may proceed in parallel with M0.

---

## Milestone M1 — Gatekeeper read core + context bundle

### Task 4: Package scaffold

**Files:**
- Create: `packages/cloudflare-os-integration/package.json`
- Create: `packages/cloudflare-os-integration/README.md`
- Modify: `package.json` (root — add script next to `"test:multica-bridge"`)

- [ ] **Step 1:** Create `packages/cloudflare-os-integration/package.json`:

```json
{
  "name": "@org-os/cloudflare-os-integration",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Cloudflare OS integration: gatekeeper-org-os core, substrate drivers, page core, blueprints",
  "scripts": {
    "test": "node --test \"test/*.test.mjs\""
  },
  "dependencies": {
    "js-yaml": "^4.1.0"
  }
}
```

- [ ] **Step 2:** Create `README.md` (3 short sections: What (spec link), Layout (tree from this plan), Test (`npm test`)).
- [ ] **Step 3:** In root `package.json`, next to `"test:multica-bridge"`, add:

```json
"test:cloudflare-os-integration": "npm test --prefix packages/cloudflare-os-integration",
```

- [ ] **Step 4:** `cd packages/cloudflare-os-integration && npm install && npm test` — expected: exit 0, "tests 0".
- [ ] **Step 5:** Commit: `git add packages/cloudflare-os-integration package.json && git commit -m "feat(cloudflare-os): scaffold integration package"`

### Task 5: `parse-helpers.mjs` (pure ports)

**Files:**
- Create: `src/page-core/parse-helpers.mjs`, `test/parse-helpers.test.mjs` (paths relative to the package from here on)

- [ ] **Step 1:** Write the failing test `test/parse-helpers.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractCheckboxes, daysUntil, getRelativeAge, parseFrontmatter } from "../src/page-core/parse-helpers.mjs";

const NOW = new Date("2026-08-08T12:00:00Z");

test("extractCheckboxes parses categories, due dates, assignees", () => {
  const md = "## Ops\n- [ ] Ship it (due: 2026-08-10) @luiz\n- [x] Done thing\n### Governance\n- [ ] Vote\n- [ ] _(placeholder)_\n";
  assert.deepEqual(extractCheckboxes(md), [
    { text: "Ship it", done: false, category: "Ops", due: "2026-08-10", assignee: "luiz" },
    { text: "Done thing", done: true, category: "Ops", due: null, assignee: null },
    { text: "Vote", done: false, category: "Governance", due: null, assignee: null },
  ]);
});

test("daysUntil is midnight-based and now-injected", () => {
  assert.equal(daysUntil("2026-08-10", NOW), 2);
  assert.equal(daysUntil("2026-08-08", NOW), 0);
  assert.equal(daysUntil(null, NOW), Infinity);
});

test("getRelativeAge buckets", () => {
  assert.equal(getRelativeAge("2026-08-08T11:30:00Z", NOW), "30m ago");
  assert.equal(getRelativeAge("2026-08-01T12:00:00Z", NOW), "1w ago");
  assert.equal(getRelativeAge(null, NOW), null);
});

test("parseFrontmatter splits yaml and body", () => {
  assert.deepEqual(parseFrontmatter("---\ntitle: X\nstatus: develop\n---\nBody"), {
    data: { title: "X", status: "develop" }, content: "Body",
  });
  assert.deepEqual(parseFrontmatter("no fm"), { data: {}, content: "no fm" });
});
```

- [ ] **Step 2:** Run `npm test` — expected FAIL: `Cannot find module .../parse-helpers.mjs`.
- [ ] **Step 3:** Implement `src/page-core/parse-helpers.mjs`. `extractCheckboxes` is a **verbatim copy** of `scripts/initialize.mjs:60-102`. `daysUntil(dateStr, now)` / `getRelativeAge(dateStr, now)` are copies of `initialize.mjs:128-135` / `104-117` with `now` as a parameter instead of `new Date()` (do not mutate the caller's `now`: `const n = new Date(now); n.setHours(0,0,0,0)`). Add:

```js
import yaml from "js-yaml";

export function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { data: {}, content: text };
  let data = {};
  try { data = yaml.load(m[1]) || {}; } catch { /* malformed fm → empty */ }
  return { data, content: m[2] };
}
```

- [ ] **Step 4:** Run `npm test` — expected: PASS (4 tests).
- [ ] **Step 5:** Commit: `git commit -am "feat(cloudflare-os): pure parse helpers ported from initialize.mjs"`

### Task 6: Fixture instance

**Files:** Create under `test/fixtures/instance-a/`:

- [ ] **Step 1:** `federation.yaml`:

```yaml
identity:
  name: instance-a
  type: LocalNode
federation:
  network: test-net
  role: instance
  peers:
    - name: org-os
      url: https://github.com/organizational-os/organizational-os-template
      role: hub
  upstream:
    - repository: https://github.com/organizational-os/organizational-os-template
      last_sync: "2026-08-01"
knowledge-commons:
  enabled: true
  published_domains: [regen]
```

- [ ] **Step 2:** `data/projects.yaml`:

```yaml
projects:
  - id: alpha
    title: Alpha Project
    status: develop
    lead: github:someone
    started: "2026-06-01"
  - id: beta
    title: Beta Project
    status: discovery
```

- [ ] **Step 3:** `HEARTBEAT.md`:

```markdown
# Heartbeat
## Operations
- [ ] Overdue thing (due: 2026-08-01)
- [ ] Soon thing (due: 2026-08-12)
- [ ] Someday thing
- [x] Finished thing
## Funding
- [ ] Grant application
```

- [ ] **Step 4:** `data/instances.yaml`:

```yaml
instances:
  - id: child-1
    name: Child One
    type: LocalNode
    maturity: production
    framework_version: "0.5"
    last_sync: "2026-08-01"
    cloned: true
    drift: [skills/foo]
```

- [ ] **Step 5:** `data/events.yaml` (one event inside `[now, now+7d)` for NOW=2026-08-08, one outside), `data/meetings.yaml` (same pattern):

```yaml
events:
  - title: Community Call
    date: "2026-08-11"
  - title: Far Future Fest
    date: "2026-12-01"
```

```yaml
meetings:
  - title: Weekly Sync
    date: "2026-08-09"
  - title: Old Retro
    date: "2026-07-01"
```

- [ ] **Step 6:** `DECISIONS.md` (three `## 2026-…` entries), `MEMORY.md` (a short index list), `IDENTITY.md` (2 lines), `AGENTS.md` (2 lines), `docs/agent-plans/QUEUE.md` (2-line queue), `.well-known/dao.json` (`{"@context":"test","name":"instance-a"}`), `packages/operations/projects/alpha.md`:

```markdown
---
title: Alpha Project
status: develop
---
- [ ] task one
- [ ] task two
```

- [ ] **Step 7:** Commit: `git add test/fixtures && git commit -m "test(cloudflare-os): fixture instance-a"`

### Task 7: `build-state.mjs`

**Files:** Create `src/page-core/build-state.mjs`, `test/build-state.test.mjs`. Test helper loads the fixture into a `{path: content}` object:

- [ ] **Step 1:** Failing test:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildState } from "../src/page-core/build-state.mjs";

const NOW = new Date("2026-08-08T12:00:00Z");
const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

// Walks a fixture instance into the flat { "relative/path": contents } map the page core consumes.
// See test/fixtures/README.md — fixture dates are calibrated to NOW below; change both or neither.
function loadFixture(name = "instance-a") {
  const walk = (dir, prefix = "") => {
    const files = {};
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) Object.assign(files, walk(p, `${prefix}${e.name}/`));
      else files[`${prefix}${e.name}`] = fs.readFileSync(p, "utf-8");
    }
    return files;
  };
  return walk(path.join(fixturesDir, name));
}
```

This helper is reused verbatim by Tasks 11, 12, 15, and 16 — copy it into each test file that needs it (four small copies beat a shared test-util module for something this size; revisit if it grows).

test("buildState builds the page view-model from raw files", () => {
  const state = buildState(loadFixture(), { now: NOW });
  assert.deepEqual(state.identity, { name: "instance-a", type: "LocalNode" });

  const alpha = state.projects.find((p) => p.name === "Alpha Project");
  assert.equal(alpha.stage, "develop");
  assert.equal(alpha.taskCount, 2);                     // merged from packages/operations/projects/alpha.md
  assert.equal(state.projects.length, 2);

  assert.deepEqual(state.tasks.critical.map((t) => t.text), ["Overdue thing"]);
  assert.deepEqual(state.tasks.urgent.map((t) => t.text).sort(), ["Grant application", "Soon thing"]);
  assert.deepEqual(state.tasks.upcoming.map((t) => t.text), ["Someday thing"]);
  assert.equal(state.tasks.completed.length, 1);

  assert.deepEqual(state.instances, [{ id: "child-1", name: "Child One", type: "LocalNode", maturity: "production",
    framework_version: "0.5", last_sync: "2026-08-01", cloned: true, drift_count: 1 }]);

  assert.equal(state.federation.network, "test-net");
  assert.equal(state.federation.peers.length, 1);
  assert.deepEqual(state.events.thisWeek.map((e) => e.title), ["Community Call"]);
  assert.deepEqual(state.meetings.thisWeek.map((m) => m.title), ["Weekly Sync"]);
  assert.ok(state.decisionsRaw.startsWith("# ") || state.decisionsRaw.startsWith("## "));
  assert.ok(state.plansRaw.length > 0);
  assert.deepEqual(state.funding, { upcoming: [] });
});
```

- [ ] **Step 2:** Run `npm test` — expected FAIL (module not found).
- [ ] **Step 3:** Implement `buildState(files, { now })`, porting from `initialize.mjs` with fs swapped for the `files` object:
  - `loadYaml(files, p)`: `try { return files[p] ? yaml.load(files[p]) : null } catch { return null }`.
  - **identity**: `federation.yaml` → `{ name: identity.name ?? null, type: identity.type ?? null }`.
  - **projects**: port `initialize.mjs:223-286` — registry mapping (`title||name||id`, `status||"idea"`, `lead`, `started||startDate`, `taskCount:0`), then merge docs from keys matching `/^packages\/operations\/projects\/[^/]+\.md$/` (skip `readme.md` case-insensitive and `_` prefix), `parseFrontmatter`, `taskCount = (content.match(/- \[ \]/g) || []).length`, same name-merge logic.
  - **tasks**: port `initialize.mjs:290-328` using `extractCheckboxes(files["HEARTBEAT.md"] || "")` and `daysUntil(item.due, now)` — identical tiering (`<=0` critical, `<=7` urgent, else upcoming; no-due: category containing `fund`/`governance` → urgent, else upcoming).
  - **instances**: port `initialize.mjs:472-484` verbatim mapping.
  - **federation**: port `initialize.mjs:580-612` verbatim (v3 + v1 shapes).
  - **events/meetings**: parse `data/events.yaml` / `data/meetings.yaml`; item `{ date, title: x.title || x.name || x.topic || x.id }`; `thisWeek` = date `d` with `now <= d < now+7d` (compare on `YYYY-MM-DD` string dates parsed as UTC); `upcoming` = `d >= now+7d`. *(Documented simplification: rolling window, not calendar week.)*
  - **decisionsRaw** = `files["DECISIONS.md"] ?? null`; **plansRaw** = `files["docs/agent-plans/QUEUE.md"] ?? null`; **funding** = `{ upcoming: [] }`.
- [ ] **Step 4:** `npm test` — expected: PASS.

- [ ] **Step 5 (added after Task 6 review):** Add coverage the Task 5/6 reviews flagged as missing. Append to `test/build-state.test.mjs`:

```js
test("federation: root-level peers/upstream shape (what real instances actually use)", () => {
  const s = buildState(loadFixture("instance-b"), { now: NOW });
  assert.equal(s.federation.network, "test-net");
  assert.deepEqual(s.federation.peers.map((p) => p.name), ["peer-one", "peer-two"]);
  assert.equal(s.federation.upstream.length, 1);
});
```

`instance-a` nests `peers`/`upstream` under `federation:`; `instance-b` puts them at root — the shape every real org-os instance uses. `loadFederation` supports both (`fedSection.peers || federation.peers`); without this test only the nested branch is covered. Note `loadFederation` maps `p.role || null`, so real peers' `trust:` field is not surfaced — that is existing upstream behavior, not a bug to fix here.

Append to `test/parse-helpers.test.mjs` (three untested branches the Task 5 review flagged):

```js
test("getRelativeAge hour and day buckets", () => {
  assert.equal(getRelativeAge("2026-08-08T09:00:00Z", NOW), "3h ago");
  assert.equal(getRelativeAge("2026-08-05T12:00:00Z", NOW), "3d ago");
});

test("daysUntil handles past dates", () => {
  assert.equal(daysUntil("2026-08-01", NOW), -7);
});

test("parseFrontmatter returns empty data for malformed yaml", () => {
  assert.deepEqual(parseFrontmatter("---\n: : bad\n---\nBody"), { data: {}, content: "Body" });
});
```

- [ ] **Step 6:** `npm test` — expected: PASS. Commit: `git commit -am "feat(cloudflare-os): pure buildState page-core"`

### Task 8: `memory-substrate.mjs`

**Files:** Create `src/substrate/memory-substrate.mjs`, `test/memory-substrate.test.mjs`.

The Substrate contract (document it in a header comment — all methods async):
`readFile(path) → string` (throws `SubstrateError("NOT_FOUND")`), `listDir(path) → [{name, type: "file"|"dir"}]`, `head() → { sha, date }`, `proposeChange() → throws "M3 — not implemented"`.

- [ ] **Step 1:** Failing test:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { MemorySubstrate, SubstrateError } from "../src/substrate/memory-substrate.mjs";

const sub = new MemorySubstrate(
  { "data/projects.yaml": "projects: []", "data/members.yaml": "members: []", "IDENTITY.md": "# I" },
  { sha: "abc123", date: "2026-08-08" },
);

test("readFile returns content, NOT_FOUND otherwise", async () => {
  assert.equal(await sub.readFile("IDENTITY.md"), "# I");
  await assert.rejects(() => sub.readFile("nope.md"), (e) => e instanceof SubstrateError && e.code === "NOT_FOUND");
});

test("listDir lists direct children", async () => {
  assert.deepEqual(await sub.listDir("data"), [
    { name: "members.yaml", type: "file" },
    { name: "projects.yaml", type: "file" },
  ]);
});

test("head + proposeChange", async () => {
  assert.deepEqual(await sub.head(), { sha: "abc123", date: "2026-08-08" });
  await assert.rejects(() => sub.proposeChange({}), /M3/);
});
```

- [ ] **Step 2:** Run — expected FAIL. **Step 3:** Implement (`SubstrateError extends Error` with `.code`; `listDir` derives sorted direct children from key prefixes, deduping subdirs as `type:"dir"`). **Step 4:** Run — PASS. **Step 5:** Commit `feat(cloudflare-os): substrate contract + MemorySubstrate`.

### Task 9: `github-substrate.mjs`

**Files:** Create `src/substrate/github-substrate.mjs`, `test/github-substrate.test.mjs`.

Constructor: `new GitHubSubstrate({ owner, repo, ref, token, fetchImpl, cache, ttlMs = 60_000, now = () => Date.now() })`. `cache` is Map-like (`get`/`set`), storing `{ etag, body, fetchedAt }` per URL.

- [ ] **Step 1:** Failing test with a scripted fake fetch:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { GitHubSubstrate } from "../src/substrate/github-substrate.mjs";

function fakeFetch(script) {           // script: [{status, headers, body}] consumed in order
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url: String(url), opts });
    const r = script.shift();
    return { status: r.status, ok: r.status < 300, headers: new Map(Object.entries(r.headers || {})),
      text: async () => r.body ?? "", json: async () => JSON.parse(r.body ?? "null") };
  };
  fn.calls = calls;
  return fn;
}

const base = { owner: "o", repo: "r", ref: "main", token: "tok" };

test("readFile fetches raw content with auth and caches by ETag", async () => {
  const f = fakeFetch([{ status: 200, headers: { etag: 'W/"e1"' }, body: "projects: []" }]);
  let t = 0;
  const sub = new GitHubSubstrate({ ...base, fetchImpl: f, cache: new Map(), now: () => t });
  assert.equal(await sub.readFile("data/projects.yaml"), "projects: []");
  assert.match(f.calls[0].url, /\/repos\/o\/r\/contents\/data\/projects\.yaml\?ref=main/);
  assert.equal(f.calls[0].opts.headers.Authorization, "Bearer tok");
  assert.equal(f.calls[0].opts.headers.Accept, "application/vnd.github.raw+json");
  assert.equal(await sub.readFile("data/projects.yaml"), "projects: []"); // within TTL → no 2nd call
  assert.equal(f.calls.length, 1);
});

test("after TTL, revalidates with If-None-Match; 304 serves cache", async () => {
  const f = fakeFetch([
    { status: 200, headers: { etag: 'W/"e1"' }, body: "v1" },
    { status: 304, headers: {} },
  ]);
  let t = 0;
  const sub = new GitHubSubstrate({ ...base, fetchImpl: f, cache: new Map(), ttlMs: 1000, now: () => t });
  assert.equal(await sub.readFile("x.md"), "v1");
  t = 5000;
  assert.equal(await sub.readFile("x.md"), "v1");
  assert.equal(f.calls[1].opts.headers["If-None-Match"], 'W/"e1"');
});

test("rate-limited refresh serves stale cache, marks staleness", async () => {
  const f = fakeFetch([
    { status: 200, headers: { etag: 'W/"e1"' }, body: "v1" },
    { status: 403, headers: {}, body: '{"message":"rate limit"}' },
  ]);
  let t = 0;
  const sub = new GitHubSubstrate({ ...base, fetchImpl: f, cache: new Map(), ttlMs: 1000, now: () => t });
  await sub.readFile("x.md");
  t = 5000;
  assert.equal(await sub.readFile("x.md"), "v1");
  assert.equal(sub.lastReadStale, true);
});

test("404 → SubstrateError NOT_FOUND; head() hits branches API; listDir maps contents array", async () => {
  const f = fakeFetch([
    { status: 404, headers: {}, body: '{"message":"Not Found"}' },
    { status: 200, headers: {}, body: '{"commit":{"sha":"abc","commit":{"committer":{"date":"2026-08-08T00:00:00Z"}}}}' },
    { status: 200, headers: {}, body: '[{"name":"projects.yaml","type":"file"},{"name":"sub","type":"dir"}]' },
  ]);
  const sub = new GitHubSubstrate({ ...base, fetchImpl: f, cache: new Map() });
  await assert.rejects(() => sub.readFile("gone.md"), (e) => e.code === "NOT_FOUND");
  assert.deepEqual(await sub.head(), { sha: "abc", date: "2026-08-08T00:00:00Z" });
  assert.deepEqual(await sub.listDir("data"), [{ name: "projects.yaml", type: "file" }, { name: "sub", type: "dir" }]);
});
```

- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement: base URL `https://api.github.com`; `readFile` = cached GET `/repos/{owner}/{repo}/contents/{path}?ref={ref}` with `Accept: application/vnd.github.raw+json`; cache flow: fresh-within-TTL → cached body, else revalidate with `If-None-Match` (304 → refresh `fetchedAt`, return cached), non-ok with cache present → return cached + `this.lastReadStale = true`, non-ok without cache → `SubstrateError` (`NOT_FOUND` on 404, `UPSTREAM` otherwise); `head()` = GET `/repos/{owner}/{repo}/branches/{ref}` → `{ sha: commit.sha, date: commit.commit.committer.date }` (same cache flow); `listDir(path)` = GET contents on the dir (default Accept) mapping `[{name, type}]`; `proposeChange()` throws `M3` error. Reset `lastReadStale = false` at the start of each successful fresh read.
- [ ] **Step 4:** Run — PASS. **Step 5:** Commit `feat(cloudflare-os): GitHubSubstrate with ETag/TTL cache and stale-while-revalidate`.

### Task 10: `instances.mjs`

**Files:** Create `src/gatekeeper/instances.mjs`, `test/instances.test.mjs`.

- [ ] **Step 1:** Failing test:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateInstances } from "../src/gatekeeper/instances.mjs";

test("accepts valid config, applies defaults", () => {
  const out = validateInstances([{ id: "org-os", owner: "organizational-os", repo: "organizational-os-template" }]);
  assert.deepEqual(out, [{ id: "org-os", owner: "organizational-os", repo: "organizational-os-template", ref: "main", trust: "read" }]);
});

test("rejects duplicates, bad ids, missing fields", () => {
  assert.throws(() => validateInstances([{ id: "a b", owner: "x", repo: "y" }]), /id/);
  assert.throws(() => validateInstances([{ id: "a", owner: "x" }]), /repo/);
  assert.throws(() => validateInstances([{ id: "a", owner: "x", repo: "y" }, { id: "a", owner: "x", repo: "z" }]), /duplicate/);
});
```

- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement (`id` must match `/^[a-z0-9][a-z0-9-]*$/`; `owner`/`repo` non-empty strings; defaults `ref: "main"`, `trust: "read"`; throw on duplicate ids). **Step 4:** PASS. **Step 5:** Commit `feat(cloudflare-os): instance registry validation`.

### Task 11: `context-bundle.mjs`

**Files:** Create `src/gatekeeper/context-bundle.mjs`, `test/context-bundle.test.mjs`.

- [ ] **Step 1:** Failing test (uses `MemorySubstrate` over the fixture loader from Task 7):

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildContextBundle } from "../src/gatekeeper/context-bundle.mjs";
import { MemorySubstrate } from "../src/substrate/memory-substrate.mjs";
// reuse loadFixture() helper (copy from build-state.test.mjs)

test("bundle: identity, agent rules, memory index, recent decisions, registry snapshots, provenance", async () => {
  const sub = new MemorySubstrate(loadFixture(), { sha: "abc123", date: "2026-08-08" });
  const b = await buildContextBundle(sub, { maxBytesPerSection: 64_000 });
  assert.ok(b.identity.includes("#"));
  assert.ok(b.agentRules.length > 0);
  assert.ok(b.memoryIndex.length > 0);
  assert.equal(b.recentDecisions.length, 3);            // instance-a has 3 dated "## " entries
  assert.ok(b.registries.projects.projects.length === 2);
  assert.deepEqual(b.provenance, { sha: "abc123", date: "2026-08-08" });
});

test("missing files degrade to null, never throw; oversize sections truncate with flag", async () => {
  const sub = new MemorySubstrate({ "IDENTITY.md": "# I\n" + "x".repeat(100) }, { sha: "s", date: "d" });
  const b = await buildContextBundle(sub, { maxBytesPerSection: 10 });
  assert.equal(b.identity.length, 10);
  assert.equal(b.truncated.includes("identity"), true);
  assert.equal(b.agentRules, null);
  assert.deepEqual(b.registries.projects, null);
});
```

Plus this test (added after the Task 6 review — real `DECISIONS.md` files carry non-dated boilerplate headings like `## Conventions` / `## How to Use This File`, which must not reach the agent as "recent decisions"):

```js
test("recentDecisions takes dated entries only, skipping boilerplate headings", async () => {
  const sub = new MemorySubstrate(loadFixture("instance-b"), { sha: "s", date: "d" });
  const b = await buildContextBundle(sub, {});
  assert.equal(b.recentDecisions.length, 2);                       // "## Conventions" excluded
  assert.ok(b.recentDecisions.every((d) => /^## \d{4}-\d{2}-\d{2}/.test(d)));
});
```

- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement: read `IDENTITY.md`→`identity`, `AGENTS.md`→`agentRules`, `MEMORY.md`→`memoryIndex`; `recentDecisions` = the last 5 **dated** `## `-delimited sections of `DECISIONS.md` — a section counts only when its heading matches `/^## \d{4}-\d{2}-\d{2}/`, so non-dated boilerplate sections are skipped (newest-first as they appear); `registries` = `{ projects, members }` via `js-yaml` (each `null` when missing/unparseable); every string section sliced to `maxBytesPerSection` (default 64 000) with section names pushed to `truncated: []`; `provenance = await substrate.head()`; individual `NOT_FOUND` → `null`. **Step 4:** PASS. **Step 5:** Commit `feat(cloudflare-os): context bundle builder`.

### Task 12: `capabilities.mjs` (read caps + dispatch)

**Files:** Create `src/gatekeeper/capabilities.mjs`, `test/capabilities.test.mjs`.

Result envelope (all capabilities): success `{ ok: true, data, provenance: { instance, sha, date, stale } }`; failure `{ ok: false, error: { code, message } }` — codes: `UNKNOWN_CAPABILITY`, `UNKNOWN_INSTANCE`, `BAD_ARGS`, `NOT_FOUND`, `UPSTREAM`.

- [ ] **Step 1:** Failing test:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGatekeeper, READ_CAPABILITIES } from "../src/gatekeeper/capabilities.mjs";
import { MemorySubstrate } from "../src/substrate/memory-substrate.mjs";
// reuse loadFixture()

const gk = createGatekeeper({
  instances: [{ id: "instance-a", owner: "o", repo: "r", ref: "main", trust: "read" }],
  substrateFor: () => new MemorySubstrate(loadFixture(), { sha: "abc123", date: "2026-08-08" }),
  now: () => new Date("2026-08-08T12:00:00Z"),
});

test("capability catalog", () => {
  assert.deepEqual(READ_CAPABILITIES, ["get_registry", "get_federation", "get_schema", "get_context_bundle"]);
});

test("get_registry parses a data/ registry with provenance", async () => {
  const r = await gk.handle("get_registry", { instance: "instance-a", name: "projects" });
  assert.equal(r.ok, true);
  assert.equal(r.data.projects.length, 2);
  assert.deepEqual(r.provenance, { instance: "instance-a", sha: "abc123", date: "2026-08-08", stale: false });
});

test("get_registry rejects path-ish names", async () => {
  const r = await gk.handle("get_registry", { instance: "instance-a", name: "../SOUL" });
  assert.deepEqual(r.error.code, "BAD_ARGS");
});

test("get_federation, get_schema, get_context_bundle", async () => {
  assert.equal((await gk.handle("get_federation", { instance: "instance-a" })).data.network, "test-net");
  assert.equal((await gk.handle("get_schema", { instance: "instance-a", name: "dao" })).data.name, "instance-a");
  assert.ok((await gk.handle("get_context_bundle", { instance: "instance-a" })).data.identity);
});

test("unknown instance / capability / registry", async () => {
  assert.equal((await gk.handle("get_registry", { instance: "nope", name: "projects" })).error.code, "UNKNOWN_INSTANCE");
  assert.equal((await gk.handle("write_stuff", {})).error.code, "UNKNOWN_CAPABILITY");
  assert.equal((await gk.handle("get_registry", { instance: "instance-a", name: "zzz" })).error.code, "NOT_FOUND");
});
```

- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement `createGatekeeper({ instances, substrateFor, now })` (instances validated via `validateInstances`; `substrateFor(instance)` returns/creates its substrate — memoize per id). `handle(name, args)`: resolve capability → resolve instance → run → wrap envelope; provenance `sha`/`date` from `substrate.head()`, `stale` from `substrate.lastReadStale === true`. `get_registry`: `name` must match `/^[a-z0-9-]+$/` else `BAD_ARGS`; reads `data/${name}.yaml`, parses with `js-yaml` (parse error → `UPSTREAM` with message "registry parse failed: <name>"). `get_federation`: reads + parses `federation.yaml` through the same `loadFederation` port used in `build-state.mjs` — **export that function from `build-state.mjs`** and reuse (DRY). `get_schema`: `name` validated the same way; reads `.well-known/${name}.json`, `JSON.parse`. `get_context_bundle`: delegates to `buildContextBundle`. Catch `SubstrateError` → its code; anything else → `UPSTREAM`. **Step 4:** PASS. **Step 5:** Commit `feat(cloudflare-os): read capabilities + dispatch envelope`.

### Task 13: Adapter wiring into the Cloudflare OS fork

**Files:**
- Create: `src/adapter/README.md` (this repo) — the wiring runbook, mirrored into doc §"Adapter wiring runbook"
- External: `gatekeeper-org-os` package in the CF fork (structure per §D1/D2)

**Precondition:** M0 GATE passed (Tasks 1–3).

- [ ] **Step 1:** In the CF fork, copy the hello-world gatekeeper → `gatekeeper-org-os`. Its Worker imports the core **from this repo's package** (per §D2's dependency mechanism; if the fork can't depend on the org-os repo directly, vendor `src/` by copy and record the sync command in the runbook — the org-os repo copy remains canonical).
- [ ] **Step 2:** Wire capability declarations (per §D1) for the 4 read capabilities, descriptions the agent will see:
  - `get_registry` — "Read a structured org-os data registry (projects, members, meetings, …) from the org repo."
  - `get_federation` — "Read the org's federation topology (peers, upstream, network)."
  - `get_schema` — "Read a .well-known EIP-4824 descriptor."
  - `get_context_bundle` — "Load org identity, agent rules, memory index, recent decisions, and registry snapshots — call at conversation start."
- [ ] **Step 3:** Configure instances + secrets (per §D2): instances `[{ id: "org-os", owner: "organizational-os", repo: "organizational-os-template" }, { id: "refi-bcn-os", owner: "refibcn", repo: "refi-bcn-os" }]` — **verify both repos are reachable and current first** (the org-os hub work branch must be pushed; adjust `ref` to the pushed branch if not `main`); one fine-grained GitHub token, `contents:read` on exactly those two repos, stored as the gatekeeper secret (never in either repo). `substrateFor` = `new GitHubSubstrate({ …instance, token, fetchImpl: globalThis.fetch, cache })` with `cache` backed per §D1's storage idiom (Durable Object storage if the template provides it; else in-memory Map per isolate — record which in the runbook).
- [ ] **Step 4:** Local verify: `pnpm run-local`, ask the workspace agent *"Call get_registry for instance org-os, registry projects"*. Expected: project list matching `data/projects.yaml` with a provenance sha.
- [ ] **Step 5:** Deploy to the pilot workspace; repeat the verify there.
- [ ] **Step 6:** Write `src/adapter/README.md` recording exactly what was done (file paths in the fork, registration, secret name, cache backing, vendor/sync mechanism if used); mirror into doc §"Adapter wiring runbook". Commit: `git add packages/cloudflare-os-integration/src/adapter docs/integrations/cloudflare-os.md && git commit -m "docs(cloudflare-os): adapter wiring runbook — gatekeeper-org-os live"`

### Task 14: M1 acceptance — org chat with real context

- [ ] **Step 1:** In the deployed workspace chat, with context loading per §D5 (native or `get_context_bundle` fallback), ask and verify each against the repos:
  1. "What are the active projects in org-os?" → matches `data/projects.yaml`
  2. "What were the last three decisions?" → matches `DECISIONS.md` recent entries
  3. "What's in refi-bcn-os's federation — who are its peers?" → matches its `federation.yaml`
  4. "What tasks are urgent right now?" → consistent with `HEARTBEAT.md` due dates
- [ ] **Step 2:** Each answer must be traceable: ask "which commit is this from?" — the agent reports the provenance sha from the envelope.
- [ ] **Step 3:** Record the four Q/A pairs + shas in doc §"M1 acceptance evidence". Commit: `git commit -am "docs(cloudflare-os): M1 acceptance — org chat grounded in repo state"`

---

## Milestone M2 — Shared page core + org-dashboard gadget

### Task 15: `render-page.mjs`

**Files:** Create `src/page-core/render-page.mjs`, `test/render-page.test.mjs`.

- [ ] **Step 1:** Failing test:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPage, SUPPORTED_PAGES } from "../src/page-core/render-page.mjs";
import { buildState } from "../src/page-core/build-state.mjs";
// reuse loadFixture()

const state = buildState(loadFixture(), { now: new Date("2026-08-08T12:00:00Z") });

test("catalog", () => {
  assert.deepEqual(SUPPORTED_PAGES, ["dashboard", "projects", "tasks", "instances", "decisions", "plans", "this-week"]);
});

test("projects page renders the shim table shape", () => {
  const md = renderPage("projects", state);
  assert.ok(md.startsWith("# Projects\n\n2 workstreams.\n"));
  assert.ok(md.includes("| Alpha Project | develop |"));
});

test("tasks page renders tiers with checkboxes", () => {
  const md = renderPage("tasks", state);
  assert.ok(md.includes("## Critical (1)"));
  assert.ok(md.includes("- [ ] Overdue thing"));
  assert.ok(md.includes("## Completed (1)"));
});

test("instances / decisions / plans / this-week", () => {
  assert.ok(renderPage("instances", state).includes("| child-1 | Child One |"));
  assert.equal(renderPage("decisions", state), state.decisionsRaw);
  assert.equal(renderPage("plans", state), state.plansRaw);
  const tw = renderPage("this-week", state);
  assert.ok(tw.includes("## Meetings") && tw.includes("Weekly Sync"));
});

test("dashboard composes sections; unknown page throws", () => {
  const md = renderPage("dashboard", state);
  assert.ok(md.includes("# instance-a") && md.includes("## Projects") && md.includes("## This Week"));
  assert.throws(() => renderPage("nope", state), /Unknown page/);
});
```

- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement: port the four renderer bodies **verbatim** from `scripts/page-shim.mjs` (`projects` :64-75, `tasks` :77-99, `instances` :101-110, `this-week` :124-165) as pure functions of `state`; `decisions` → `state.decisionsRaw ?? "# Decisions\n\nDECISIONS.md not found.\n"`; `plans` → `state.plansRaw ?? "# Plans\n\nQUEUE.md not found.\n"`; `dashboard` (new composite, not initialize.mjs parity): `# ${state.identity.name}` + type line, then `## Projects` (projects table), `## Tasks` (`N critical · N urgent · N upcoming`), `## This Week` (reuse this-week body), `## Federation` (`network · N peers`). **Step 4:** PASS. **Step 5:** Commit `feat(cloudflare-os): pure renderPage ported from page-shim`.

### Task 16: `get_page` capability

**Files:** Modify `src/gatekeeper/capabilities.mjs`, `test/capabilities.test.mjs`.

- [ ] **Step 1:** Add failing tests:

```js
test("get_page renders markdown for supported pages", async () => {
  const r = await gk.handle("get_page", { instance: "instance-a", page_id: "projects" });
  assert.equal(r.ok, true);
  assert.ok(r.data.markdown.startsWith("# Projects"));
  assert.equal(r.data.page_id, "projects");
  assert.equal(r.provenance.sha, "abc123");
});

test("get_page rejects unknown page ids", async () => {
  assert.equal((await gk.handle("get_page", { instance: "instance-a", page_id: "nope" })).error.code, "BAD_ARGS");
});
```

- [ ] **Step 2:** Run — FAIL (also update the catalog test: `READ_CAPABILITIES` now ends with `"get_page"`). **Step 3:** Implement: `get_page` reads via substrate the fixed input set — `federation.yaml`, `HEARTBEAT.md`, `DECISIONS.md`, `docs/agent-plans/QUEUE.md`, `data/{projects,instances,events,meetings}.yaml`, plus `listDir("packages/operations/projects")` → read each `.md` (each read individually tolerant: `NOT_FOUND` → key absent) — assembles the `files` object, `buildState(files, { now: now() })`, `renderPage`. Capability declaration for Task 18: `get_page` — "Render an org-os page (dashboard, projects, tasks, instances, decisions, plans, this-week) as markdown." **Step 4:** PASS. **Step 5:** Commit `feat(cloudflare-os): get_page capability`.

### Task 17: Rewire `scripts/page-shim.mjs` onto the shared core (parity-gated)

**Files:** Modify `scripts/page-shim.mjs`.

- [ ] **Step 1:** Capture BEFORE outputs (repo root):

```bash
for p in projects tasks instances decisions plans this-week; do node scripts/page-shim.mjs $p > /tmp/before-$p.md; done
```

- [ ] **Step 2:** Edit `scripts/page-shim.mjs`: delete the `renderers` object (lines 62–166); import `{ renderPage } from "../packages/cloudflare-os-integration/src/page-core/render-page.mjs"`; after loading `state` from `initialize.mjs` JSON, attach the raw docs the core renderers expect and delegate:

```js
state.decisionsRaw = fs.existsSync(path.join(rootDir, "DECISIONS.md"))
  ? fs.readFileSync(path.join(rootDir, "DECISIONS.md"), "utf-8") : null;
const queuePath = path.join(rootDir, "docs/agent-plans/QUEUE.md");
state.plansRaw = fs.existsSync(queuePath) ? fs.readFileSync(queuePath, "utf-8") : null;

let out;
try {
  out = renderPage(pageId, state);
} catch {
  process.stderr.write(`page-shim: page "${pageId}" is not yet available in shim mode.\nAvailable pages: ${SUPPORTED.join(", ")}\n`);
  process.exit(2);
}
process.stdout.write(out);
```

Keep the `dashboard` early-exit delegation to `initialize.mjs --format=markdown` exactly as-is (shim's dashboard stays the rich one; the core's composite dashboard serves the gadget).

- [ ] **Step 3:** Parity check — must be silent:

```bash
for p in projects tasks instances decisions plans this-week; do node scripts/page-shim.mjs $p > /tmp/after-$p.md; diff /tmp/before-$p.md /tmp/after-$p.md || echo "PARITY FAIL: $p"; done
```

Expected: no output. The core renderers were ported verbatim, so any diff is a porting bug — fix the core, not the shim.

- [ ] **Step 4:** `npm run page dashboard | head -5` still renders the banner. `npm test --prefix packages/cloudflare-os-integration` still green.
- [ ] **Step 5:** Commit: `git add scripts/page-shim.mjs && git commit -m "refactor(page-shim): delegate renderers to shared page-core (parity verified)"`

### Task 18: `org-dashboard` gadget

**Files:** Create `blueprints/org-dashboard/gadget.html` (canonical copy; installed into the workspace per §D6).

- [ ] **Step 1:** Write `blueprints/org-dashboard/gadget.html` — complete source; the only deployment-specific seam is `callCapability`, whose body comes from doc §D4:

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>org-os dashboard</title>
<style>
  body { font: 14px/1.5 ui-monospace, monospace; margin: 1.5rem; max-width: 60rem; }
  nav { margin-bottom: 1rem; } nav button, select { font: inherit; margin-right: .4rem; }
  nav button[aria-pressed="true"] { font-weight: 700; text-decoration: underline; }
  pre { white-space: pre-wrap; } footer { margin-top: 1rem; color: #666; font-size: 12px; }
  .stale { color: #b45309; font-weight: 700; }
</style></head>
<body>
<nav>
  <select id="instance">
    <option value="org-os">org-os (hub)</option>
    <option value="refi-bcn-os">refi-bcn-os</option>
  </select>
  <span id="pages"></span>
  <button id="refresh">↻</button>
</nav>
<pre id="out">loading…</pre>
<footer id="prov"></footer>
<script type="module">
  // SEAM (§D4 of docs/integrations/cloudflare-os.md): wire to the workshop RPC session.
  // Contract: callCapability(name, args) → the gatekeeper envelope {ok, data, provenance}|{ok:false, error}.
  import { callCapability } from "./rpc.mjs"; // rpc.mjs is written during install per §D4

  const PAGES = ["dashboard", "projects", "tasks", "instances", "decisions", "plans", "this-week"];
  const $ = (id) => document.getElementById(id);
  $("pages").innerHTML = PAGES.map((p) => `<button data-p="${p}" aria-pressed="${p === "dashboard"}">${p}</button>`).join("");
  let page = "dashboard";

  async function load() {
    $("out").textContent = "loading…";
    const r = await callCapability("get_page", { instance: $("instance").value, page_id: page });
    if (!r.ok) { $("out").textContent = `error [${r.error.code}]: ${r.error.message}`; $("prov").textContent = ""; return; }
    $("out").textContent = r.data.markdown;
    const { sha, date, stale } = r.provenance;
    $("prov").innerHTML = `as of <code>${(sha || "").slice(0, 7)}</code> · ${date || "?"}` +
      (stale ? ` · <span class="stale">STALE — refresh failed, showing cache</span>` : "");
  }
  $("pages").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-p]"); if (!b) return;
    page = b.dataset.p;
    for (const x of $("pages").querySelectorAll("button")) x.setAttribute("aria-pressed", String(x === b));
    load();
  });
  $("instance").addEventListener("change", load);
  $("refresh").addEventListener("click", load);
  load();
</script>
</body></html>
```

- [ ] **Step 2:** Install into the pilot workspace per §D6 (create gadget, paste/import source, write `rpc.mjs` from the §D4 recipe — typically a few lines binding the workspace RPC session to the gatekeeper). Record the exact install steps in §D6.
- [ ] **Step 3:** Acceptance: dashboard renders for `org-os`; switching to `refi-bcn-os` re-renders; each of the 7 pages loads; provenance footer shows a real sha; disconnecting the GitHub token (or exhausting cache TTL offline) shows the STALE badge rather than an error.
- [ ] **Step 4:** Commit: `git add packages/cloudflare-os-integration/blueprints docs/integrations/cloudflare-os.md && git commit -m "feat(cloudflare-os): org-dashboard gadget blueprint (M2)"`

### Task 19: Process wiring

**Files:**
- Modify: `data/projects.yaml`, `DECISIONS.md`
- Create/append: `memory/2026-08-08.md`

- [ ] **Step 1:** Read the last existing entry in `data/projects.yaml` and append a new project **matching its exact field style** (canonical fields; adjust only if neighbors differ):

```yaml
  - id: cloudflare-os-integration
    title: Cloudflare OS Integration
    status: develop
    lead: github:luizfernandosg
    started: "2026-08-08"
```

- [ ] **Step 2:** Run `npm run generate:schemas && npm run validate:schemas && npm run generate:quilt` — all green.
- [ ] **Step 3:** Append to `DECISIONS.md` (matching its entry format): date 2026-08-08, decision = Architecture B (dedicated `gatekeeper-org-os` with substrate interface; GitHub substrate now, workerd/Radicle later; PR-only writes deferred to M3), spec link, alternatives A (stock GitHub gatekeeper) and C (hosted API) rejected — reasons per spec.
- [ ] **Step 4:** Append a session note to `memory/2026-08-08.md` (never overwrite): pilot deployed, M-milestones landed, discovery-doc location, follow-up = M3–M4 plan.
- [ ] **Step 5:** Full check: `npm test && npm run test:cloudflare-os-integration && npm run validate:structure` — green.
- [ ] **Step 6:** Commit: `git add data/ .well-known/ docs/ DECISIONS.md memory/ && git commit -m "chore(cloudflare-os): project registry + decision log + session memory (M0–M2 complete)"`

---

## Self-review (done at plan time)

- **Spec coverage:** M0 probe → Tasks 1–3; substrate interface + GitHubSubstrate + DO-cache behavior → Tasks 8–9; read caps + envelope + provenance → Task 12; context bundle → Task 11; shared page core + parity → Tasks 5–7, 15, 17; dashboard gadget + staleness UI → Task 18; instance config (hub + refi-bcn) + token scope → Task 13; process wiring → Task 19. Out of scope by design: writes/`proposeChange`, `org-inbox`, federation-map gadget, webhook invalidation, selftest hook, workerd port (M3+/Phase 2 follow-up plan).
- **Placeholder scan:** the only deployment-dependent items (`rpc.mjs` body, fork file paths) are explicit M0 *discovery outputs* with a fixed home (`docs/integrations/cloudflare-os.md` §D1–D7) and gate (M0 GATE) — no unbounded "TBD"s.
- **Type consistency:** `files` = `{path: string}` everywhere; envelope `{ok, data, provenance:{instance, sha, date, stale}}` in Tasks 12/16/18; state keys (`projects`, `tasks.{critical,urgent,upcoming,completed}`, `instances`, `federation`, `events.thisWeek`, `meetings.thisWeek`, `decisionsRaw`, `plansRaw`, `funding.upcoming`) consistent across Tasks 7/15/17; `SubstrateError.code` values consistent across Tasks 8/9/12.
