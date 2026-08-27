# multica-integration Implementation Plan

> **Release status (2026-08-28):** Deferred to v0.6+ — portfolio memo §4 row 8 (trigger: Multica stable self-hosted release). Convergence: [v0.5 release masterplan](2026-08-28-v0.5-release-masterplan.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `packages/multica-integration/` — a thin glue package that wires Multica (github.com/multica-ai/multica) into org-os as the primary agent runtime, with self-hosted server (docker-compose), slash commands, and a one-way `HEARTBEAT.md` → multica issues bridge that runs manually and on `/close`.

**Architecture:** Thin glue package mirroring the existing `hermes-integration` / `opencode-integration` pattern. No vendoring of multica. `install.sh` brings up a Postgres+pgvector + multica server stack via docker-compose, registers a workspace named after `IDENTITY.md`, and symlinks slash commands into the multica workspace. `bridge.mjs` parses `HEARTBEAT.md`, hashes each task `(category, normalized_text)`, and upserts/closes issues via `multica-client.mjs`. The `org-os-init` skill's CLOSE phase calls the bridge non-fatally.

**Tech Stack:** Node.js ≥22 (built-in `node:test`, ESM), Bash for install scripts, docker-compose v2, multica REST API + `multica` CLI as fallback. No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-04-25-multica-integration-design.md` (commit `fbc5b2e`).

---

## Pre-flight

> **Branch state:** the spec was committed on `release/v3.5-design` which has many unrelated uncommitted/untracked changes. Before starting Task 1, decide: (a) execute on this branch and accept that diffs will be mixed, (b) stash + create a fresh worktree off `main` rebased onto the spec commit, or (c) cherry-pick the spec commit onto a clean branch. The plan below assumes (b) — see superpowers:using-git-worktrees skill if needed. If (a), every commit message in this plan still works; just be aware of the noise.

### Conventions used in this plan

- All paths are relative to repo root unless noted.
- Tests use Node's built-in test runner: `node --test test/*.test.mjs` (no jest/vitest).
- Every task ends with a single-purpose commit. Commit message format: `feat(multica): <verb> <object>` for new code; `chore(multica): <verb> <object>` for config/docs.
- `MULTICA_E2E=1` gates any test that touches a real multica server. Default: off.

---

## File Structure

**Created:**
- `packages/multica-integration/README.md`
- `packages/multica-integration/SKILL.md`
- `packages/multica-integration/package.json`
- `packages/multica-integration/.gitignore`
- `packages/multica-integration/install.sh`
- `packages/multica-integration/uninstall.sh`
- `packages/multica-integration/docker/docker-compose.yml`
- `packages/multica-integration/docker/.env.example`
- `packages/multica-integration/commands/{initialize,close,dashboard,org-projects,org-decisions,org-this-week,scan-funding,process-meeting}.md` (8 files)
- `packages/multica-integration/src/heartbeat-parser.mjs`
- `packages/multica-integration/src/multica-client.mjs`
- `packages/multica-integration/src/bridge.mjs`
- `packages/multica-integration/test/heartbeat-parser.test.mjs`
- `packages/multica-integration/test/hash.test.mjs`
- `packages/multica-integration/test/multica-client.test.mjs`
- `packages/multica-integration/test/bridge.test.mjs`
- `packages/multica-integration/test/smoke.test.mjs`
- `packages/multica-integration/test/fixtures/heartbeat-sample.md`

**Modified:**
- `data/instances.yaml` — add multica entry, update openclaw note
- `data/packages-matrix.yaml` — add `lifecycle_status` field, backfill, add `multica-integration` entry
- `federation.yaml` — `integrations.agent_runtimes` reorder; `packages.multica_integration` toggle
- `scripts/initialize.mjs` — surface multica server status under `status.runtimes.multica`
- `skills/org-os-init/SKILL.md` — add bridge invocation in CLOSE phase
- `docs/agent-plans/QUEUE.md` — move multica-integration into Active

---

## Task 1: Package skeleton + workspace registration

**Files:**
- Create: `packages/multica-integration/package.json`
- Create: `packages/multica-integration/.gitignore`

- [ ] **Step 1: Create the package.json**

```json
{
  "name": "@org-os/multica-integration",
  "version": "0.1.0",
  "private": false,
  "type": "module",
  "description": "Wires Multica (github.com/multica-ai/multica) into org-os as primary agent runtime. Self-hosted server, slash commands, HEARTBEAT.md → multica issues bridge.",
  "keywords": ["multica", "org-os", "agent-runtime", "orchestration"],
  "scripts": {
    "test": "node --test test/*.test.mjs",
    "test:smoke": "MULTICA_E2E=1 node --test test/smoke.test.mjs",
    "bridge": "node src/bridge.mjs"
  },
  "engines": { "node": ">=22" }
}
```

Write to `packages/multica-integration/package.json`.

- [ ] **Step 2: Create the .gitignore**

```
docker/.env
node_modules/
.DS_Store
```

Write to `packages/multica-integration/.gitignore`.

- [ ] **Step 3: Verify the package resolves**

Run: `node -e "console.log(require('./packages/multica-integration/package.json').name)"`
Expected output: `@org-os/multica-integration`

- [ ] **Step 4: Add a root-level npm script alias**

Open `package.json` (repo root). In the `scripts` block, add after `"page"`:

```json
    "bridge:multica": "node packages/multica-integration/src/bridge.mjs",
```

(The script will fail until Task 8 — that's fine; we add the alias here so commits 8+ don't have to touch root package.json.)

- [ ] **Step 5: Commit**

```bash
git add packages/multica-integration/package.json packages/multica-integration/.gitignore package.json
git commit -m "feat(multica): add package skeleton and bridge npm alias"
```

---

## Task 2: HEARTBEAT.md test fixture

**Files:**
- Create: `packages/multica-integration/test/fixtures/heartbeat-sample.md`

- [ ] **Step 1: Read a real HEARTBEAT.md to model the fixture**

Run: `head -100 HEARTBEAT.md`

Note the structure used: `## <Category>` headings, `- [ ]` for open tasks, `- [x]` for closed, optional `**Due:** YYYY-MM-DD`, optional `**Assignee:** @handle`, plus `**Priority:** CRITICAL|URGENT` markers.

- [ ] **Step 2: Write the fixture**

Write to `packages/multica-integration/test/fixtures/heartbeat-sample.md`:

```markdown
# HEARTBEAT — fixture

## Technical

- [ ] Reconcile federation.yaml agent.skills with actual skills/ directory
- [ ] Push v3.0.0 tag to origin **Priority:** URGENT
- [x] Verify scripts/initialize.mjs emits valid JSON
- [ ] Resolve cloning mechanism open question **Due:** 2026-05-15 **Assignee:** @luiz **Priority:** CRITICAL

## Federation

- [ ] Run npm run analyze:instances and review drift report
- [ ] Sync regen-coordination-os locally

## Reminders

- [ ] After any data/ change, run npm run generate:schemas
- [ ] Log key decisions to DECISIONS.md
```

- [ ] **Step 3: Commit**

```bash
git add packages/multica-integration/test/fixtures/heartbeat-sample.md
git commit -m "test(multica): add heartbeat sample fixture"
```

---

## Task 3: heartbeat-parser — happy path (TDD)

**Files:**
- Create: `packages/multica-integration/test/heartbeat-parser.test.mjs`
- Create: `packages/multica-integration/src/heartbeat-parser.mjs`

- [ ] **Step 1: Write the failing test**

Write to `packages/multica-integration/test/heartbeat-parser.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse } from "../src/heartbeat-parser.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(
  join(__dirname, "fixtures/heartbeat-sample.md"),
  "utf-8"
);

test("parse: extracts open tasks across categories", () => {
  const tasks = parse(fixture);
  // 6 open + 0 closed (closed are filtered)
  assert.equal(tasks.length, 6);
});

test("parse: extracts category from heading", () => {
  const tasks = parse(fixture);
  assert.equal(tasks[0].category, "Technical");
  const federationTasks = tasks.filter((t) => t.category === "Federation");
  assert.equal(federationTasks.length, 2);
});

test("parse: extracts task text without checkbox or markers", () => {
  const tasks = parse(fixture);
  assert.equal(
    tasks[0].text,
    "Reconcile federation.yaml agent.skills with actual skills/ directory"
  );
});

test("parse: extracts priority", () => {
  const tasks = parse(fixture);
  const urgent = tasks.find((t) => t.text.startsWith("Push v3.0.0"));
  assert.equal(urgent.priority, "URGENT");
  const critical = tasks.find((t) => t.text.startsWith("Resolve cloning"));
  assert.equal(critical.priority, "CRITICAL");
});

test("parse: extracts due date and assignee when present", () => {
  const tasks = parse(fixture);
  const critical = tasks.find((t) => t.text.startsWith("Resolve cloning"));
  assert.equal(critical.due, "2026-05-15");
  assert.equal(critical.assignee, "@luiz");
});

test("parse: priority/due/assignee default to null when absent", () => {
  const tasks = parse(fixture);
  const t = tasks[0];
  assert.equal(t.priority, null);
  assert.equal(t.due, null);
  assert.equal(t.assignee, null);
});
```

- [ ] **Step 2: Run the tests (expect all to fail)**

Run: `cd packages/multica-integration && node --test test/heartbeat-parser.test.mjs`
Expected: all 6 fail with `Cannot find module '../src/heartbeat-parser.mjs'`.

- [ ] **Step 3: Implement the parser**

Write to `packages/multica-integration/src/heartbeat-parser.mjs`:

```javascript
const HEADING_RE = /^##\s+(.+?)\s*$/;
const OPEN_TASK_RE = /^- \[ \]\s+(.+?)\s*$/;
const CLOSED_TASK_RE = /^- \[x\]/i;
const PRIORITY_RE = /\*\*Priority:\*\*\s*(CRITICAL|URGENT)/;
const DUE_RE = /\*\*Due:\*\*\s*(\d{4}-\d{2}-\d{2})/;
const ASSIGNEE_RE = /\*\*Assignee:\*\*\s*(@\S+)/;

function stripMarkers(line) {
  return line
    .replace(PRIORITY_RE, "")
    .replace(DUE_RE, "")
    .replace(ASSIGNEE_RE, "")
    .trim();
}

export function parse(markdown) {
  const tasks = [];
  let category = null;
  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    const heading = HEADING_RE.exec(line);
    if (heading) {
      category = heading[1];
      continue;
    }
    if (CLOSED_TASK_RE.test(line)) continue;
    const open = OPEN_TASK_RE.exec(line);
    if (!open) continue;
    if (!category) continue;
    const body = open[1];
    tasks.push({
      category,
      text: stripMarkers(body),
      priority: (PRIORITY_RE.exec(body) || [])[1] ?? null,
      due: (DUE_RE.exec(body) || [])[1] ?? null,
      assignee: (ASSIGNEE_RE.exec(body) || [])[1] ?? null,
    });
  }
  return tasks;
}
```

- [ ] **Step 4: Run the tests (expect all to pass)**

Run: `cd packages/multica-integration && node --test test/heartbeat-parser.test.mjs`
Expected: 6 passed, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add packages/multica-integration/src/heartbeat-parser.mjs packages/multica-integration/test/heartbeat-parser.test.mjs
git commit -m "feat(multica): heartbeat parser with priority/due/assignee extraction"
```

---

## Task 4: heartbeat-parser — edge cases (TDD)

**Files:**
- Modify: `packages/multica-integration/test/heartbeat-parser.test.mjs`
- Modify: `packages/multica-integration/src/heartbeat-parser.mjs` (only if tests fail)

- [ ] **Step 1: Append edge-case tests**

Append to `packages/multica-integration/test/heartbeat-parser.test.mjs`:

```javascript
test("parse: empty input returns empty array", () => {
  assert.deepEqual(parse(""), []);
});

test("parse: tasks before any heading are ignored", () => {
  const md = "- [ ] orphan task\n## A\n- [ ] inside\n";
  const tasks = parse(md);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].text, "inside");
});

test("parse: handles CRLF line endings", () => {
  const md = "## A\r\n- [ ] one\r\n- [ ] two\r\n";
  assert.equal(parse(md).length, 2);
});

test("parse: malformed task lines are skipped, not thrown", () => {
  const md = "## A\n- [garbage] x\n- [ ] real\n";
  assert.equal(parse(md).length, 1);
});

test("parse: text with internal whitespace is preserved", () => {
  const md = "## A\n- [ ]   spaced    out  \n";
  assert.equal(parse(md)[0].text, "spaced    out");
});
```

- [ ] **Step 2: Run the tests**

Run: `cd packages/multica-integration && node --test test/heartbeat-parser.test.mjs`
Expected: 11 passed (6 from Task 3 + 5 new). If any fail, fix the parser to satisfy them. Most likely all pass with the Task 3 implementation; the "spaced out" test passes because `stripMarkers` only trims edges.

- [ ] **Step 3: Commit**

```bash
git add packages/multica-integration/test/heartbeat-parser.test.mjs packages/multica-integration/src/heartbeat-parser.mjs
git commit -m "test(multica): heartbeat parser edge cases (CRLF, orphans, malformed)"
```

---

## Task 5: hash + normalize (TDD)

**Files:**
- Create: `packages/multica-integration/test/hash.test.mjs`
- Modify: `packages/multica-integration/src/heartbeat-parser.mjs` (export `normalize`, add `hashTask`)

- [ ] **Step 1: Write the failing test**

Write to `packages/multica-integration/test/hash.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize, hashTask } from "../src/heartbeat-parser.mjs";

test("normalize: trims edges and collapses internal whitespace", () => {
  assert.equal(normalize("  hello   world  "), "hello world");
});

test("normalize: strips leading checkbox/list markers", () => {
  assert.equal(normalize("- [ ] do thing"), "do thing");
  assert.equal(normalize("* do thing"), "do thing");
  assert.equal(normalize("1. do thing"), "do thing");
});

test("normalize: preserves case", () => {
  assert.equal(normalize("Mixed CASE"), "Mixed CASE");
});

test("hashTask: same category+text yields identical hash", () => {
  const a = hashTask({ category: "Technical", text: "Push v3.0.0 tag" });
  const b = hashTask({ category: "Technical", text: "Push v3.0.0 tag" });
  assert.equal(a, b);
});

test("hashTask: different category changes hash", () => {
  const a = hashTask({ category: "Technical", text: "x" });
  const b = hashTask({ category: "Federation", text: "x" });
  assert.notEqual(a, b);
});

test("hashTask: whitespace differences in text do NOT change hash", () => {
  const a = hashTask({ category: "A", text: "do  thing" });
  const b = hashTask({ category: "A", text: "do thing  " });
  assert.equal(a, b);
});

test("hashTask: returns 40-char hex string (sha1)", () => {
  const h = hashTask({ category: "A", text: "x" });
  assert.match(h, /^[0-9a-f]{40}$/);
});
```

- [ ] **Step 2: Run the tests (expect all to fail)**

Run: `cd packages/multica-integration && node --test test/hash.test.mjs`
Expected: all fail with `normalize is not a function` / `hashTask is not a function`.

- [ ] **Step 3: Add `normalize` and `hashTask` exports to the parser**

Append to `packages/multica-integration/src/heartbeat-parser.mjs`:

```javascript
import { createHash } from "node:crypto";

const LIST_MARKER_RE = /^\s*(?:[-*]\s+\[[ xX]\]\s+|[-*]\s+|\d+\.\s+)/;

export function normalize(s) {
  return s.replace(LIST_MARKER_RE, "").replace(/\s+/g, " ").trim();
}

export function hashTask({ category, text }) {
  return createHash("sha1")
    .update(`${category}|${normalize(text)}`)
    .digest("hex");
}
```

- [ ] **Step 4: Run the tests (expect all to pass)**

Run: `cd packages/multica-integration && node --test test/hash.test.mjs`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/multica-integration/src/heartbeat-parser.mjs packages/multica-integration/test/hash.test.mjs
git commit -m "feat(multica): add normalize() and sha1 hashTask() for idempotency"
```

---

## Task 6: multica-client (TDD with mocked transport)

**Files:**
- Create: `packages/multica-integration/test/multica-client.test.mjs`
- Create: `packages/multica-integration/src/multica-client.mjs`

- [ ] **Step 1: Write the failing test**

Write to `packages/multica-integration/test/multica-client.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { MulticaClient } from "../src/multica-client.mjs";

function makeFakeTransport() {
  const calls = [];
  return {
    calls,
    rest: async (method, path, body) => {
      calls.push({ kind: "rest", method, path, body });
      if (method === "GET" && path === "/issues") {
        return { items: [] };
      }
      return { id: "issue-" + calls.length };
    },
    cli: async (args) => {
      calls.push({ kind: "cli", args });
      return { stdout: "", stderr: "", code: 0 };
    },
  };
}

test("MulticaClient: listIssues calls REST GET /issues", async () => {
  const fake = makeFakeTransport();
  const client = new MulticaClient({ transport: fake, workspace: "ws" });
  const result = await client.listIssues();
  assert.deepEqual(fake.calls[0], {
    kind: "rest",
    method: "GET",
    path: "/issues?workspace=ws",
    body: undefined,
  });
  assert.deepEqual(result, []);
});

test("MulticaClient: createIssue uses REST POST /issues", async () => {
  const fake = makeFakeTransport();
  const client = new MulticaClient({ transport: fake, workspace: "ws" });
  await client.createIssue({
    externalKey: "abc",
    title: "do thing",
    labels: ["Technical"],
    priority: "URGENT",
  });
  assert.equal(fake.calls[0].kind, "rest");
  assert.equal(fake.calls[0].method, "POST");
  assert.equal(fake.calls[0].path, "/issues");
  assert.deepEqual(fake.calls[0].body, {
    workspace: "ws",
    external_key: "abc",
    title: "do thing",
    labels: ["Technical"],
    priority: "URGENT",
  });
});

test("MulticaClient: updateIssue uses REST PATCH", async () => {
  const fake = makeFakeTransport();
  const client = new MulticaClient({ transport: fake, workspace: "ws" });
  await client.updateIssue("issue-1", { title: "new" });
  assert.equal(fake.calls[0].method, "PATCH");
  assert.equal(fake.calls[0].path, "/issues/issue-1");
});

test("MulticaClient: closeIssue uses REST POST /issues/:id/close with reason", async () => {
  const fake = makeFakeTransport();
  const client = new MulticaClient({ transport: fake, workspace: "ws" });
  await client.closeIssue("issue-1", "removed-from-heartbeat");
  assert.equal(fake.calls[0].method, "POST");
  assert.equal(fake.calls[0].path, "/issues/issue-1/close");
  assert.deepEqual(fake.calls[0].body, { reason: "removed-from-heartbeat" });
});

test("MulticaClient: actions in CLI_ONLY route to CLI transport", async () => {
  const fake = makeFakeTransport();
  const client = new MulticaClient({ transport: fake, workspace: "ws" });
  // setup is CLI-only at the moment of writing
  await client.setup();
  assert.equal(fake.calls[0].kind, "cli");
  assert.deepEqual(fake.calls[0].args, ["setup", "--workspace", "ws"]);
});
```

- [ ] **Step 2: Run the tests**

Run: `cd packages/multica-integration && node --test test/multica-client.test.mjs`
Expected: all fail with `Cannot find module '../src/multica-client.mjs'`.

- [ ] **Step 3: Implement the client**

Write to `packages/multica-integration/src/multica-client.mjs`:

```javascript
// Routing table: which actions go to REST vs CLI.
// Keep this small and explicit. To move an action between transports,
// edit ROUTES — no consumer code changes.
const ROUTES = {
  listIssues: "rest",
  createIssue: "rest",
  updateIssue: "rest",
  closeIssue: "rest",
  setup: "cli",
};

export class MulticaClient {
  constructor({ transport, workspace }) {
    if (!transport) throw new Error("MulticaClient: transport required");
    if (!workspace) throw new Error("MulticaClient: workspace required");
    this.transport = transport;
    this.workspace = workspace;
  }

  async listIssues() {
    const res = await this.transport.rest(
      "GET",
      `/issues?workspace=${encodeURIComponent(this.workspace)}`
    );
    return res.items ?? [];
  }

  async createIssue({ externalKey, title, labels = [], priority = null }) {
    return this.transport.rest("POST", "/issues", {
      workspace: this.workspace,
      external_key: externalKey,
      title,
      labels,
      priority,
    });
  }

  async updateIssue(id, patch) {
    return this.transport.rest("PATCH", `/issues/${id}`, patch);
  }

  async closeIssue(id, reason) {
    return this.transport.rest("POST", `/issues/${id}/close`, { reason });
  }

  async setup() {
    return this.transport.cli(["setup", "--workspace", this.workspace]);
  }
}

export { ROUTES };
```

- [ ] **Step 4: Run the tests (expect all to pass)**

Run: `cd packages/multica-integration && node --test test/multica-client.test.mjs`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/multica-integration/src/multica-client.mjs packages/multica-integration/test/multica-client.test.mjs
git commit -m "feat(multica): MulticaClient with explicit REST/CLI routing table"
```

---

## Task 7: bridge orchestration (TDD)

**Files:**
- Create: `packages/multica-integration/test/bridge.test.mjs`
- Create: `packages/multica-integration/src/bridge.mjs`

- [ ] **Step 1: Write the failing test**

Write to `packages/multica-integration/test/bridge.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { syncHeartbeatToMulticaIssues } from "../src/bridge.mjs";
import { hashTask } from "../src/heartbeat-parser.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureMarkdown = readFileSync(
  join(__dirname, "fixtures/heartbeat-sample.md"),
  "utf-8"
);

function makeFakeClient(existingIssues = []) {
  const created = [];
  const updated = [];
  const closed = [];
  return {
    created,
    updated,
    closed,
    listIssues: async () => existingIssues,
    createIssue: async (input) => {
      created.push(input);
      return { id: "new-" + created.length, ...input };
    },
    updateIssue: async (id, patch) => {
      updated.push({ id, patch });
      return { id, ...patch };
    },
    closeIssue: async (id, reason) => {
      closed.push({ id, reason });
    },
  };
}

test("bridge: creates issues for all open tasks when multica is empty", async () => {
  const client = makeFakeClient([]);
  const result = await syncHeartbeatToMulticaIssues({
    markdown: fixtureMarkdown,
    client,
  });
  assert.equal(client.created.length, 6);
  assert.equal(client.updated.length, 0);
  assert.equal(client.closed.length, 0);
  assert.equal(result.created, 6);
});

test("bridge: maps category to label and priority correctly", async () => {
  const client = makeFakeClient([]);
  await syncHeartbeatToMulticaIssues({ markdown: fixtureMarkdown, client });
  const urgent = client.created.find((c) =>
    c.title.startsWith("Push v3.0.0")
  );
  assert.deepEqual(urgent.labels, ["Technical"]);
  assert.equal(urgent.priority, "URGENT");
  const critical = client.created.find((c) =>
    c.title.startsWith("Resolve cloning")
  );
  assert.equal(critical.priority, "CRITICAL");
});

test("bridge: skips when issue with same external_key already exists and unchanged", async () => {
  // Pre-populate one issue matching the first task
  const firstHash = hashTask({
    category: "Technical",
    text: "Reconcile federation.yaml agent.skills with actual skills/ directory",
  });
  const client = makeFakeClient([
    {
      id: "ext-1",
      external_key: firstHash,
      title:
        "Reconcile federation.yaml agent.skills with actual skills/ directory",
      labels: ["Technical"],
      priority: null,
      status: "open",
    },
  ]);
  const result = await syncHeartbeatToMulticaIssues({
    markdown: fixtureMarkdown,
    client,
  });
  assert.equal(client.created.length, 5);
  assert.equal(client.updated.length, 0);
  assert.equal(result.skipped, 1);
});

test("bridge: updates issue when title or priority diverged", async () => {
  const firstHash = hashTask({
    category: "Technical",
    text: "Reconcile federation.yaml agent.skills with actual skills/ directory",
  });
  const client = makeFakeClient([
    {
      id: "ext-1",
      external_key: firstHash,
      title: "Old title",
      labels: ["Technical"],
      priority: null,
      status: "open",
    },
  ]);
  const result = await syncHeartbeatToMulticaIssues({
    markdown: fixtureMarkdown,
    client,
  });
  assert.equal(client.updated.length, 1);
  assert.equal(client.updated[0].id, "ext-1");
  assert.equal(result.updated, 1);
});

test("bridge: closes multica issues that are missing from HEARTBEAT", async () => {
  const orphan = {
    id: "ext-orphan",
    external_key: "deadbeef",
    title: "old task no longer in heartbeat",
    labels: ["Technical"],
    priority: null,
    status: "open",
  };
  const client = makeFakeClient([orphan]);
  const result = await syncHeartbeatToMulticaIssues({
    markdown: fixtureMarkdown,
    client,
  });
  assert.equal(client.closed.length, 1);
  assert.equal(client.closed[0].id, "ext-orphan");
  assert.equal(client.closed[0].reason, "removed-from-heartbeat");
  assert.equal(result.closed, 1);
});

test("bridge: ignores already-closed multica issues", async () => {
  const closed = {
    id: "ext-closed",
    external_key: "old",
    status: "closed",
  };
  const client = makeFakeClient([closed]);
  await syncHeartbeatToMulticaIssues({ markdown: fixtureMarkdown, client });
  assert.equal(client.closed.length, 0);
});
```

- [ ] **Step 2: Run the tests**

Run: `cd packages/multica-integration && node --test test/bridge.test.mjs`
Expected: all fail with `Cannot find module '../src/bridge.mjs'`.

- [ ] **Step 3: Implement the bridge**

Write to `packages/multica-integration/src/bridge.mjs`:

```javascript
import { parse, hashTask } from "./heartbeat-parser.mjs";

function shouldUpdate(existing, desired) {
  return (
    existing.title !== desired.title ||
    (existing.priority ?? null) !== (desired.priority ?? null) ||
    JSON.stringify(existing.labels ?? []) !== JSON.stringify(desired.labels)
  );
}

export async function syncHeartbeatToMulticaIssues({ markdown, client }) {
  const tasks = parse(markdown);
  const existing = await client.listIssues();
  const byKey = new Map();
  for (const issue of existing) {
    if (issue.status === "closed") continue;
    byKey.set(issue.external_key, issue);
  }

  const seenKeys = new Set();
  const result = { created: 0, updated: 0, skipped: 0, closed: 0 };

  for (const t of tasks) {
    const key = hashTask({ category: t.category, text: t.text });
    seenKeys.add(key);
    const desired = {
      externalKey: key,
      title: t.text,
      labels: [t.category],
      priority: t.priority,
    };
    const found = byKey.get(key);
    if (!found) {
      await client.createIssue(desired);
      result.created++;
      continue;
    }
    if (
      shouldUpdate(found, {
        title: desired.title,
        priority: desired.priority,
        labels: desired.labels,
      })
    ) {
      await client.updateIssue(found.id, {
        title: desired.title,
        priority: desired.priority,
        labels: desired.labels,
      });
      result.updated++;
    } else {
      result.skipped++;
    }
  }

  for (const issue of existing) {
    if (issue.status === "closed") continue;
    if (!seenKeys.has(issue.external_key)) {
      await client.closeIssue(issue.id, "removed-from-heartbeat");
      result.closed++;
    }
  }

  return result;
}
```

- [ ] **Step 4: Run the tests (expect all to pass)**

Run: `cd packages/multica-integration && node --test test/bridge.test.mjs`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/multica-integration/src/bridge.mjs packages/multica-integration/test/bridge.test.mjs
git commit -m "feat(multica): bridge orchestration with create/update/skip/close diff"
```

---

## Task 8: bridge CLI entrypoint

**Files:**
- Modify: `packages/multica-integration/src/bridge.mjs` (add CLI runner)
- Modify: `packages/multica-integration/src/multica-client.mjs` (add real HTTP/CLI transport factory)

- [ ] **Step 1: Add a real transport factory to multica-client.mjs**

Append to `packages/multica-integration/src/multica-client.mjs`:

```javascript
import { spawn } from "node:child_process";

export function createHttpCliTransport({ baseUrl, token }) {
  return {
    rest: async (method, path, body) => {
      const url = baseUrl.replace(/\/$/, "") + path;
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`multica REST ${method} ${path} -> ${res.status} ${text}`);
      }
      const ct = res.headers.get("content-type") || "";
      return ct.includes("application/json") ? res.json() : {};
    },
    cli: async (args) =>
      new Promise((resolve, reject) => {
        const proc = spawn("multica", args, { stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (b) => (stdout += b.toString()));
        proc.stderr.on("data", (b) => (stderr += b.toString()));
        proc.on("error", reject);
        proc.on("close", (code) => resolve({ stdout, stderr, code }));
      }),
  };
}
```

- [ ] **Step 2: Add CLI runner to bridge.mjs**

Append to `packages/multica-integration/src/bridge.mjs`:

```javascript
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MulticaClient,
  createHttpCliTransport,
} from "./multica-client.mjs";

function loadDotEnv(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  return out;
}

async function main() {
  const heartbeatPath = process.argv[2] || resolve(process.cwd(), "HEARTBEAT.md");
  const pkgDir = resolve(fileURLToPath(import.meta.url), "../..");
  const env = { ...process.env, ...loadDotEnv(resolve(pkgDir, "docker/.env")) };
  const baseUrl = env.MULTICA_API_URL || "http://localhost:8090";
  const token = env.MULTICA_API_TOKEN;
  const workspace = env.MULTICA_WORKSPACE;

  if (!token || !workspace) {
    console.warn(
      "[multica bridge] MULTICA_API_TOKEN or MULTICA_WORKSPACE missing; skipping."
    );
    process.exit(0);
  }
  if (!existsSync(heartbeatPath)) {
    console.warn(`[multica bridge] ${heartbeatPath} not found; skipping.`);
    process.exit(0);
  }

  const markdown = readFileSync(heartbeatPath, "utf-8");
  const client = new MulticaClient({
    transport: createHttpCliTransport({ baseUrl, token }),
    workspace,
  });

  try {
    const result = await syncHeartbeatToMulticaIssues({ markdown, client });
    console.log(
      `[multica bridge] created=${result.created} updated=${result.updated} skipped=${result.skipped} closed=${result.closed}`
    );
  } catch (err) {
    console.warn(`[multica bridge] ${err.message}`);
    // Non-fatal: bridge must never block /close.
    process.exit(0);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
```

- [ ] **Step 3: Verify the file still parses**

Run: `node --check packages/multica-integration/src/bridge.mjs && node --check packages/multica-integration/src/multica-client.mjs`
Expected: no output (success).

- [ ] **Step 4: Re-run all package tests to confirm no regression**

Run: `cd packages/multica-integration && node --test test/*.test.mjs`
Expected: all tests still pass (smoke.test.mjs does not exist yet — will be added in Task 15).

- [ ] **Step 5: Commit**

```bash
git add packages/multica-integration/src/bridge.mjs packages/multica-integration/src/multica-client.mjs
git commit -m "feat(multica): add CLI runner and real HTTP+CLI transport"
```

---

## Task 9: docker-compose stack

**Files:**
- Create: `packages/multica-integration/docker/docker-compose.yml`
- Create: `packages/multica-integration/docker/.env.example`

- [ ] **Step 1: Write `docker-compose.yml`**

Write to `packages/multica-integration/docker/docker-compose.yml`:

```yaml
# Self-hosted Multica server stack for org-os.
# Brought up by ../install.sh; not invoked directly by operators.
services:
  postgres:
    image: pgvector/pgvector:pg17
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-multica}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set in .env}
      POSTGRES_DB: ${POSTGRES_DB:-multica}
    volumes:
      - multica-pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-multica}"]
      interval: 5s
      timeout: 3s
      retries: 10

  multica:
    image: ghcr.io/multica-ai/multica-server:${MULTICA_VERSION:-latest}
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgres://${POSTGRES_USER:-multica}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-multica}?sslmode=disable
      MULTICA_BIND: 0.0.0.0:8090
      MULTICA_LOG_LEVEL: info
    ports:
      - "${MULTICA_PORT:-8090}:8090"
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:8090/health || exit 1"]
      interval: 5s
      timeout: 3s
      retries: 20

volumes:
  multica-pgdata:
```

> Note: the `ghcr.io/multica-ai/multica-server` image tag is the expected
> publication path for multica's server image. If multica publishes under a
> different name at install time (e.g. `multica-ai/multica` on Docker Hub),
> the implementer should update this single line and `MULTICA_IMAGE` in
> `.env.example`. Verify by running `docker pull` against the published
> name in multica's README before Task 10.

- [ ] **Step 2: Write `.env.example`**

Write to `packages/multica-integration/docker/.env.example`:

```bash
# Copy to .env (gitignored) and fill in. install.sh will do this for you.
POSTGRES_USER=multica
POSTGRES_PASSWORD=please-change-me
POSTGRES_DB=multica
MULTICA_VERSION=latest
MULTICA_PORT=8090

# Filled in by install.sh after `multica setup` completes:
MULTICA_API_URL=http://localhost:8090
MULTICA_API_TOKEN=
MULTICA_WORKSPACE=
```

- [ ] **Step 3: Lint the compose file**

Run: `docker compose -f packages/multica-integration/docker/docker-compose.yml config --quiet`
Expected: no output (config is valid). If `docker` is not installed locally during plan execution, skip this and document in the commit message.

- [ ] **Step 4: Commit**

```bash
git add packages/multica-integration/docker/docker-compose.yml packages/multica-integration/docker/.env.example
git commit -m "feat(multica): docker-compose stack (postgres+pgvector + multica server)"
```

---

## Task 10: install.sh

**Files:**
- Create: `packages/multica-integration/install.sh`

- [ ] **Step 1: Read multica's CLI surface to confirm command names**

Run: `multica --help 2>/dev/null || echo "multica CLI not installed"` — record what's available. If `multica` is not installed in the dev environment, default to the documented commands per multica's README: `multica setup`, `multica daemon start`, `multica login`. The script below uses these; if they differ, update inline.

- [ ] **Step 2: Write install.sh**

Write to `packages/multica-integration/install.sh`:

```bash
#!/usr/bin/env bash
# install.sh — bring up multica server stack and register a workspace for this org-os instance.
# Idempotent: re-running detects existing state and skips.

set -euo pipefail

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$PKG_DIR/../.." && pwd)"
DOCKER_DIR="$PKG_DIR/docker"
ENV_FILE="$DOCKER_DIR/.env"
COMPOSE_FILE="$DOCKER_DIR/docker-compose.yml"

bail() { echo "✗ $1" >&2; exit 1; }
note() { echo "→ $1"; }
done_() { echo "✓ $1"; }

# 1. prereqs
command -v docker >/dev/null 2>&1 || bail "docker not on PATH. Install: https://docs.docker.com/get-docker/"
docker compose version >/dev/null 2>&1 || bail "docker compose v2 required. Install: https://docs.docker.com/compose/install/"
command -v multica >/dev/null 2>&1 || bail "multica CLI not on PATH. Install: https://github.com/multica-ai/multica#install"
done_ "prereqs (docker, compose, multica) found"

# 2. .env
if [ ! -f "$ENV_FILE" ]; then
  cp "$DOCKER_DIR/.env.example" "$ENV_FILE"
  # Generate a random password for the local postgres
  random_pw="$(openssl rand -hex 16 2>/dev/null || head -c 16 /dev/urandom | xxd -p)"
  sed -i.bak "s|please-change-me|$random_pw|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
  done_ "wrote $ENV_FILE with generated POSTGRES_PASSWORD"
else
  note ".env already present — keeping existing values"
fi

# 3. start the stack
note "starting docker stack..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d
done_ "docker compose up -d issued"

# 4. wait for /health
note "waiting for multica /health (up to 60s)..."
port="$(grep -E '^MULTICA_PORT=' "$ENV_FILE" | cut -d= -f2)"
port="${port:-8090}"
for i in $(seq 1 60); do
  if curl -fs "http://localhost:${port}/health" >/dev/null 2>&1; then
    done_ "multica server healthy on :${port}"
    break
  fi
  if [ "$i" = "60" ]; then
    bail "multica server not healthy after 60s. Inspect: docker compose -f $COMPOSE_FILE logs multica"
  fi
  sleep 1
done

# 5. multica setup (idempotent — detects existing config)
if multica auth status >/dev/null 2>&1; then
  note "multica already authenticated — skipping setup"
else
  note "running multica setup..."
  multica setup --server "http://localhost:${port}"
  done_ "multica setup complete"
fi

# 6. determine workspace name from IDENTITY.md
ws_name="$(grep -E '^name:' "$REPO_ROOT/IDENTITY.md" 2>/dev/null | head -1 | sed -E 's/^name:\s*"?([^"]+)"?\s*$/\1/' || true)"
ws_name="${ws_name:-org-os}"
ws_name="$(echo "$ws_name" | tr -cd '[:alnum:]-_')"
note "workspace name: $ws_name"

# 7. create workspace if missing
if multica workspace list 2>/dev/null | grep -qE "^\s*${ws_name}\s"; then
  note "workspace '$ws_name' already exists"
else
  multica workspace create "$ws_name"
  done_ "created workspace '$ws_name'"
fi

# 8. capture API token + write back to .env
token="$(multica auth token 2>/dev/null || true)"
if [ -n "$token" ]; then
  if grep -qE '^MULTICA_API_TOKEN=' "$ENV_FILE"; then
    sed -i.bak "s|^MULTICA_API_TOKEN=.*$|MULTICA_API_TOKEN=${token}|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
  fi
  if grep -qE '^MULTICA_WORKSPACE=' "$ENV_FILE"; then
    sed -i.bak "s|^MULTICA_WORKSPACE=.*$|MULTICA_WORKSPACE=${ws_name}|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
  fi
  done_ "wrote MULTICA_API_TOKEN and MULTICA_WORKSPACE into .env"
else
  echo "⚠  could not capture multica API token automatically; bridge will skip until MULTICA_API_TOKEN is set in $ENV_FILE" >&2
fi

# 9. symlink slash commands into the multica workspace commands directory
ws_cmds="$HOME/.multica/workspaces/$ws_name/commands"
mkdir -p "$ws_cmds"
for f in "$PKG_DIR"/commands/*.md; do
  ln -sf "$f" "$ws_cmds/$(basename "$f")"
done
done_ "symlinked slash commands into $ws_cmds"

cat <<EOF

──────────────────────────────────────────────────────────────────────
multica-integration ready.

  Manual bridge:   npm run bridge:multica
  Auto bridge:     runs at /close (after the org-os-init skill change)
  Stop stack:      docker compose -f $COMPOSE_FILE down
  Tear down:       bash $PKG_DIR/uninstall.sh
──────────────────────────────────────────────────────────────────────
EOF
```

- [ ] **Step 3: Make it executable**

Run: `chmod +x packages/multica-integration/install.sh`

- [ ] **Step 4: Shellcheck (optional but recommended)**

Run: `shellcheck packages/multica-integration/install.sh 2>/dev/null || echo "shellcheck not installed — skipping"`
Expected: clean or no output. Fix any SC2xxx warnings inline.

- [ ] **Step 5: Commit**

```bash
git add packages/multica-integration/install.sh
git commit -m "feat(multica): install.sh — docker stack + multica setup + workspace + commands"
```

---

## Task 11: uninstall.sh

**Files:**
- Create: `packages/multica-integration/uninstall.sh`

- [ ] **Step 1: Write uninstall.sh**

Write to `packages/multica-integration/uninstall.sh`:

```bash
#!/usr/bin/env bash
# uninstall.sh — tear down the local multica stack and (optionally) the workspace.

set -euo pipefail

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$PKG_DIR/docker"
ENV_FILE="$DOCKER_DIR/.env"
COMPOSE_FILE="$DOCKER_DIR/docker-compose.yml"

read -r -p "Tear down multica stack and delete its postgres volume? [y/N] " confirm
case "$confirm" in
  y|Y|yes|YES)
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" down -v
    echo "✓ docker stack down"
    ;;
  *)
    echo "→ aborted (stack still running)"
    exit 0
    ;;
esac

if [ -f "$ENV_FILE" ]; then
  ws_name="$(grep -E '^MULTICA_WORKSPACE=' "$ENV_FILE" | cut -d= -f2)"
  if [ -n "${ws_name:-}" ] && command -v multica >/dev/null 2>&1; then
    read -r -p "Also delete multica workspace '$ws_name'? [y/N] " confirm
    case "$confirm" in
      y|Y|yes|YES)
        multica workspace delete "$ws_name" || true
        ;;
    esac
  fi
fi

read -r -p "Delete $ENV_FILE? [y/N] " confirm
case "$confirm" in y|Y|yes|YES) rm -f "$ENV_FILE";; esac

echo "✓ uninstall complete"
```

- [ ] **Step 2: Make executable + commit**

```bash
chmod +x packages/multica-integration/uninstall.sh
git add packages/multica-integration/uninstall.sh
git commit -m "feat(multica): uninstall.sh — tear down stack, workspace, env"
```

---

## Task 12: slash command markdowns

**Files:**
- Create: 8 files under `packages/multica-integration/commands/`

- [ ] **Step 1: Read opencode-integration command pattern for reference**

Run: `cat packages/opencode-integration/commands/initialize.md packages/opencode-integration/commands/dashboard.md`
Note the front-matter style and body conventions (description, usage, body that the agent executes).

- [ ] **Step 2: Write all 8 commands**

Each file follows the same shape — an opencode-style markdown command. Below are the exact bodies; write each verbatim.

`packages/multica-integration/commands/initialize.md`:

```markdown
---
description: Open an org-os session — sync, render dashboard, propose work.
---

You are opening an org-os session inside a multica workspace.

Run the org-os `/initialize` skill exactly as defined in `skills/initialize/` (or `skills/org-os-init/` for the full lifecycle skill). Steps:

1. `git pull --rebase --quiet || true`
2. `node scripts/initialize.mjs`
3. Read `dashboard.yaml`, render the dashboard sections in order, respecting `show:` toggles and per-section options.
4. End with the session prompt and 3 contextual suggestions, then transition to PLAN phase per the skill.
```

`packages/multica-integration/commands/close.md`:

```markdown
---
description: Wrap the org-os session — write memory, sync HEARTBEAT to multica, commit, push.
---

Run the org-os `/close` skill from `skills/org-os-init/` CLOSE phase. Steps:

1. Summarize the session.
2. Append to `memory/YYYY-MM-DD.md`.
3. Update `HEARTBEAT.md` (mark completed tasks done; add new ones).
4. Run `npm run bridge:multica` (non-fatal — warn and continue if it fails).
5. Stage `memory/`, `HEARTBEAT.md`, `MEMORY.md`, and any `data/` changes.
6. Commit with `session: <concise description>`.
7. `git push` (note locally if no remote).
```

`packages/multica-integration/commands/dashboard.md`:

```markdown
---
description: Render the org-os dashboard.
---

Run `node scripts/initialize.mjs` and render the dashboard per `dashboard.yaml`. Do not run the full /initialize flow — just produce the dashboard view.
```

`packages/multica-integration/commands/org-projects.md`:

```markdown
---
description: Show the org-os projects table from data/projects.yaml.
---

Read `data/projects.yaml` and render a compact table: name, IDEA stage, lead, start date. Group by stage if 8+ projects.
```

`packages/multica-integration/commands/org-decisions.md`:

```markdown
---
description: Show recent key decisions from MEMORY.md / DECISIONS.md.
---

Read `DECISIONS.md` if present, else the Key Decisions section of `MEMORY.md`. Show the 10 most recent entries.
```

`packages/multica-integration/commands/org-this-week.md`:

```markdown
---
description: Show this week's events and meetings.
---

Read `data/meetings.yaml` and `data/events.yaml`. Render Mon–Fri of the current ISO week with merged entries, sorted by datetime. Mark today.
```

`packages/multica-integration/commands/scan-funding.md`:

```markdown
---
description: Run the funding-scout skill — surface open opportunities and deadlines.
---

Invoke the org-os `funding-scout` skill against `data/funding-opportunities.yaml`. Report deadlines within 30 days first.
```

`packages/multica-integration/commands/process-meeting.md`:

```markdown
---
description: Run the meeting-processor skill on a transcript.
---

Invoke the org-os `meeting-processor` skill. The user will provide either a path to a transcript file or paste the transcript inline. Output structured meeting notes per the skill's spec and append to `data/meetings.yaml`.
```

- [ ] **Step 3: Verify all 8 files exist**

Run: `ls packages/multica-integration/commands/`
Expected: 8 .md files listed.

- [ ] **Step 4: Commit**

```bash
git add packages/multica-integration/commands/
git commit -m "feat(multica): 8 slash commands (initialize, close, dashboard, org-*, scan-funding, process-meeting)"
```

---

## Task 13: SKILL.md (multica-control)

**Files:**
- Create: `packages/multica-integration/SKILL.md`

- [ ] **Step 1: Write the skill**

Write to `packages/multica-integration/SKILL.md`:

```markdown
---
name: multica-control
description: Operate the multica orchestration platform from inside org-os — bring up/down the stack, run the heartbeat bridge, inspect issue sync state.
version: "0.1.0"
license: MIT
tier: integration
triggers:
  - bring up multica
  - tear down multica
  - sync heartbeat to multica
  - check multica issues
platforms:
  - claude-code
  - opencode
  - cursor
---

# multica-control

Lightweight skill for operating the multica integration in an org-os instance.

## Common operations

| Intent | Command |
|---|---|
| Install + start stack | `bash packages/multica-integration/install.sh` |
| Stop stack | `docker compose -f packages/multica-integration/docker/docker-compose.yml down` |
| Tear down stack + volume | `bash packages/multica-integration/uninstall.sh` |
| Manual heartbeat sync | `npm run bridge:multica` |
| List multica issues | `multica issue list --workspace "$(grep MULTICA_WORKSPACE packages/multica-integration/docker/.env \| cut -d= -f2)"` |
| Check stack health | `curl -fs http://localhost:8090/health` |

## When to invoke

- Operator says "sync HEARTBEAT" or "push tasks to multica" → run `npm run bridge:multica`.
- Operator says "is multica running" → curl `/health`; if not, suggest `install.sh`.
- Operator says "remove multica" → run `uninstall.sh` and offer to remove the package toggle in `federation.yaml`.

## What this skill is NOT

- Not a wrapper around multica's full CLI. For project-internal multica operations (assigning issues, dispatching agents), use the `multica` CLI directly or its web UI.
- Not bidirectional. The bridge writes HEARTBEAT.md → multica only. Phase b will add the reverse direction.
```

- [ ] **Step 2: Commit**

```bash
git add packages/multica-integration/SKILL.md
git commit -m "feat(multica): multica-control SKILL.md"
```

---

## Task 14: README.md

**Files:**
- Create: `packages/multica-integration/README.md`

- [ ] **Step 1: Write the README**

Write to `packages/multica-integration/README.md`:

```markdown
# @org-os/multica-integration

Wires [Multica](https://github.com/multica-ai/multica) into org-os as the **primary agent runtime**. Self-hosted via docker-compose, slash-command parity with `opencode-integration`, write-only `HEARTBEAT.md` → multica issues bridge.

## Status

Phase (a). See `docs/superpowers/specs/2026-04-25-multica-integration-design.md`.

- ✅ Local multica server (Postgres+pgvector + Go server)
- ✅ Slash commands: `/initialize`, `/close`, `/dashboard`, `/org-projects`, `/org-decisions`, `/org-this-week`, `/scan-funding`, `/process-meeting`
- ✅ One-way bridge: open HEARTBEAT.md tasks → multica issues
- ⏳ Bidirectional sync — phase (b)
- ⏳ org-os as a multica plugin — phase (c)

## Install

Prereqs: Docker (with Compose v2), Node ≥22, the [`multica` CLI](https://github.com/multica-ai/multica#install).

```bash
bash packages/multica-integration/install.sh
```

This brings up the docker stack, runs `multica setup` against the local server, creates a workspace named after `IDENTITY.md`, captures the API token into `docker/.env`, and symlinks the slash commands into the multica workspace.

## Use

```bash
# Manual heartbeat sync (run any time)
npm run bridge:multica

# At session close (automatic — wired into the org-os-init skill's CLOSE phase)
/close
```

## Bridge semantics

- Source of truth: `HEARTBEAT.md`. Multica is a derived view.
- Idempotency key: `sha1(category + "|" + normalize(text))`. Re-runs upsert; never duplicate.
- Categories → multica labels. `**Priority:** CRITICAL\|URGENT` → multica priority.
- Tasks present in multica but missing from HEARTBEAT.md are closed with reason `removed-from-heartbeat`.
- Bridge failure is non-fatal — `/close` warns and continues.

## Tear down

```bash
bash packages/multica-integration/uninstall.sh
```

## Tests

```bash
cd packages/multica-integration && npm test           # unit tests, always-on
MULTICA_E2E=1 npm run test:smoke                       # integration, requires running stack
```

## Files

- `install.sh` / `uninstall.sh` — operator entrypoints
- `docker/docker-compose.yml` — Postgres+pgvector + multica server
- `commands/` — slash commands (markdown)
- `src/heartbeat-parser.mjs` — pure parser + hash
- `src/multica-client.mjs` — REST + CLI transport
- `src/bridge.mjs` — orchestration + CLI runner
```

- [ ] **Step 2: Commit**

```bash
git add packages/multica-integration/README.md
git commit -m "docs(multica): README with install, usage, semantics"
```

---

## Task 15: smoke test (E2E-gated)

**Files:**
- Create: `packages/multica-integration/test/smoke.test.mjs`

- [ ] **Step 1: Write the smoke test**

Write to `packages/multica-integration/test/smoke.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, "..");
const envFile = resolve(pkgRoot, "docker/.env");

const skip = process.env.MULTICA_E2E !== "1";
const skipMsg = "set MULTICA_E2E=1 to run smoke tests against a live stack";

test("smoke: multica CLI on PATH", { skip: skip && skipMsg }, () => {
  const out = execSync("multica --version", { encoding: "utf-8" });
  assert.match(out, /\d+\.\d+\.\d+/);
});

test("smoke: docker/.env exists with token+workspace", { skip: skip && skipMsg }, () => {
  assert.ok(existsSync(envFile), `${envFile} missing — run install.sh first`);
  const env = readFileSync(envFile, "utf-8");
  assert.match(env, /MULTICA_API_TOKEN=\S+/);
  assert.match(env, /MULTICA_WORKSPACE=\S+/);
});

test("smoke: server /health is green", { skip: skip && skipMsg }, async () => {
  const env = readFileSync(envFile, "utf-8");
  const url =
    /MULTICA_API_URL=(\S+)/.exec(env)?.[1] || "http://localhost:8090";
  const res = await fetch(`${url}/health`);
  assert.equal(res.status, 200);
});

test("smoke: workspace exists in multica", { skip: skip && skipMsg }, () => {
  const env = readFileSync(envFile, "utf-8");
  const ws = /MULTICA_WORKSPACE=(\S+)/.exec(env)[1];
  const out = execSync("multica workspace list", { encoding: "utf-8" });
  assert.ok(out.includes(ws), `workspace ${ws} not found in multica`);
});
```

- [ ] **Step 2: Confirm it skips by default**

Run: `cd packages/multica-integration && node --test test/smoke.test.mjs`
Expected: 4 tests skipped.

- [ ] **Step 3: Commit**

```bash
git add packages/multica-integration/test/smoke.test.mjs
git commit -m "test(multica): E2E smoke gated by MULTICA_E2E=1"
```

---

## Task 16: data/instances.yaml — add multica entry, update openclaw note

**Files:**
- Modify: `data/instances.yaml`

- [ ] **Step 1: Inspect current entries**

Run: `grep -n -A 5 "openclaw" data/instances.yaml`
Note the exact indent and field set used.

- [ ] **Step 2: Add the multica entry**

Append to the instances list in `data/instances.yaml` (matching the existing entry indentation):

```yaml
  - id: multica
    name: Multica
    type: AgentRuntime
    maturity: production
    framework_version: null
    last_sync: null
    cloned: false
    note: "External orchestration platform — github.com/multica-ai/multica. Self-hosted via packages/multica-integration."
```

- [ ] **Step 3: Update the openclaw note**

In `data/instances.yaml`, replace the existing openclaw `note:` value with:

```yaml
    note: "Alternative agent runtime — see multica entry. Was primary pre-2026-04."
```

- [ ] **Step 4: Validate**

Run: `npm run validate:schemas`
Expected: passes (or no schema for instances.yaml — accept exit 0).

- [ ] **Step 5: Commit**

```bash
git add data/instances.yaml
git commit -m "chore(multica): register multica AgentRuntime; demote openclaw note"
```

---

## Task 17: data/packages-matrix.yaml — add lifecycle_status field, backfill

**Files:**
- Modify: `data/packages-matrix.yaml`

- [ ] **Step 1: Read current state**

Run: `cat data/packages-matrix.yaml`
Note: every entry currently has 6 fields (id, owner, instances_using, in_framework, promotion_status, notes). We are adding `lifecycle_status` to all of them.

- [ ] **Step 2: Add the schema-bump comment near the top**

Edit `data/packages-matrix.yaml`. After the `# Surfaces divergence...` comment block, add:

```yaml
# lifecycle_status: active | dormant | planned | retired
#   active   — in use or actively maintained
#   dormant  — present but no instances using and no near-term plan
#   planned  — referenced from federation but not yet built
#   retired  — kept for historical reference only
```

- [ ] **Step 3: Backfill `lifecycle_status` on every entry**

For each existing entry, insert `    lifecycle_status: <value>` immediately after the `instances_using:` line. Values:

| Entry id | lifecycle_status |
|---|---|
| agents-app | active |
| egregore-core | active |
| koi-bridge | active |
| koi-opal-bridge | active |
| opal-bridge | active |
| operations | active |
| paperclip-agents-app | active |
| regen-agents | active |
| webapps | active |
| dashboard | active |
| governance | active |
| coordination | active |
| connectors | active |
| core | active |

(Defaults to `active` for all existing entries; the audit in the parent `package-integration` plan will re-classify dormant/retired entries as part of its Phase 1.)

- [ ] **Step 4: Validate**

Run: `npm run validate:schemas`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add data/packages-matrix.yaml
git commit -m "chore(multica): add lifecycle_status to packages-matrix; backfill all entries"
```

---

## Task 18: data/packages-matrix.yaml — add multica-integration entry

**Files:**
- Modify: `data/packages-matrix.yaml`

- [ ] **Step 1: Append the new entry**

In `data/packages-matrix.yaml`, append at the end of the `packages:` list:

```yaml
  - id: multica-integration
    owner: framework
    instances_using: []
    lifecycle_status: active
    in_framework: true
    promotion_status: canonical
    notes: "Pilot for self-installing package pattern. Wires Multica orchestration platform as primary agent runtime."
```

- [ ] **Step 2: Validate + commit**

```bash
npm run validate:schemas
git add data/packages-matrix.yaml
git commit -m "chore(multica): register multica-integration package"
```

---

## Task 19: federation.yaml — agent_runtimes role swap

**Files:**
- Modify: `federation.yaml`

- [ ] **Step 1: Replace the `integrations.agent_runtimes` block**

In `federation.yaml`, replace the existing `agent_runtimes:` list under `integrations:` with:

```yaml
  agent_runtimes:
    - name: "multica"
      repo: "multica-ai/multica"
      url: "https://github.com/multica-ai/multica"
      role: "primary-runtime"
    - name: "openclaw"
      repo: "organizational-os/openclaw-source"
      url: "https://github.com/organizational-os/openclaw-source"
      role: "alternative-runtime"
    - name: "regen-eliza"
      repo: "regen-coordination/regen_eliza-refi_dao"
      url: "https://github.com/regen-coordination/regen_eliza-refi_dao"
      role: "alternative-runtime"
```

- [ ] **Step 2: Validate + commit**

```bash
npm run validate:structure
git add federation.yaml
git commit -m "chore(multica): promote multica to primary-runtime; demote openclaw"
```

---

## Task 20: federation.yaml — packages toggle

**Files:**
- Modify: `federation.yaml`

- [ ] **Step 1: Add the toggle**

In `federation.yaml`, add to the `packages:` block (alphabetically sorted, but since the existing block is not sorted, append at the end):

```yaml
  multica_integration: false
```

- [ ] **Step 2: Commit**

```bash
git add federation.yaml
git commit -m "chore(multica): add multica_integration toggle (default off)"
```

---

## Task 21: scripts/initialize.mjs — surface multica server status

**Files:**
- Modify: `scripts/initialize.mjs`

> The spec says: surface multica server status under `status.runtimes.multica`, populated only when `federation.yaml packages.multica_integration: true`. Three states: `running`, `unreachable`, `not-configured`.

- [ ] **Step 1: Locate the status object construction in `scripts/initialize.mjs`**

Run: `grep -n "runtime" scripts/initialize.mjs`
Note the line where `runtime:` is set in the status object — that's where we add `runtimes:`.

- [ ] **Step 2: Add a helper near the top of the file**

In `scripts/initialize.mjs`, after existing imports / helper functions, add:

```javascript
async function detectMulticaStatus(federation) {
  const enabled = federation?.packages?.multica_integration === true;
  if (!enabled) return null;
  const url = process.env.MULTICA_API_URL || "http://localhost:8090";
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`${url}/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    return { state: res.ok ? "running" : "unreachable", url };
  } catch {
    return { state: "unreachable", url };
  }
}
```

- [ ] **Step 3: Wire it into the status output**

Find the assembled `status` object. Add (after the existing `runtime:` field):

```javascript
    runtimes: {
      multica: await detectMulticaStatus(federation),
    },
```

If `await` is not already in scope at that callsite, hoist `detectMulticaStatus` higher in the function so the await is valid. The existing function should already be `async`.

- [ ] **Step 4: Run the script and verify JSON shape**

Run: `node scripts/initialize.mjs | head -50`
Expected: JSON output now contains `"runtimes": { "multica": null }` because the toggle is `false` by default.

- [ ] **Step 5: Toggle on temporarily and re-run**

Run:

```bash
sed -i.bak 's/multica_integration: false/multica_integration: true/' federation.yaml
node scripts/initialize.mjs | grep -A 4 '"runtimes"'
mv federation.yaml.bak federation.yaml
```

Expected: with toggle on, `runtimes.multica` is `{ state: "unreachable", url: "..." }` (no server running locally yet) — proves detection runs only when toggle is on.

- [ ] **Step 6: Commit**

```bash
git add scripts/initialize.mjs
git commit -m "feat(multica): surface server status under status.runtimes.multica when toggle on"
```

---

## Task 22: org-os-init SKILL.md — wire bridge into CLOSE phase

**Files:**
- Modify: `skills/org-os-init/SKILL.md`

- [ ] **Step 1: Locate the CLOSE Protocol section**

Run: `grep -n "Close Protocol\|## Phase 4" skills/org-os-init/SKILL.md`

- [ ] **Step 2: Insert a new step between "Update MEMORY.md" and "Commit"**

In the numbered Close Protocol list (currently steps 1–6), insert a new step between the existing step 4 (Update MEMORY.md) and step 5 (Commit):

```markdown
5. **Sync HEARTBEAT to multica** — if `federation.yaml packages.multica_integration: true`, run `npm run bridge:multica`. The bridge writes open HEARTBEAT.md tasks to multica issues, idempotently. **This step is non-fatal** — log a warning on failure (e.g. server unreachable, multica not installed) and continue. The bridge must never block the session close commit.
```

Renumber subsequent steps (Commit becomes 6, Push becomes 7).

- [ ] **Step 3: Commit**

```bash
git add skills/org-os-init/SKILL.md
git commit -m "feat(multica): wire heartbeat bridge into /close (non-fatal)"
```

---

## Task 23: docs/agent-plans/QUEUE.md — promote to Active

**Files:**
- Modify: `docs/agent-plans/QUEUE.md`

- [ ] **Step 1: Move the entry**

In `docs/agent-plans/QUEUE.md`, under `## Active`, replace `_(none)_` with:

```markdown
1. [multica-integration](../superpowers/plans/2026-04-25-multica-integration.md) — Wire Multica as primary agent runtime; self-hosted server, slash commands, write-only HEARTBEAT bridge. Spec at [`2026-04-25-multica-integration-design.md`](../superpowers/specs/2026-04-25-multica-integration-design.md). Pilots the self-installing package pattern for the queued `package-integration` plan. · workstream: package-integration
```

Update the date stamp at the top to today.

- [ ] **Step 2: Commit**

```bash
git add docs/agent-plans/QUEUE.md
git commit -m "chore(multica): promote multica-integration to active queue"
```

---

## Task 24: regenerate schemas + final structural validation

**Files:**
- Generated: `.well-known/*.json`

- [ ] **Step 1: Regenerate**

Run: `npm run generate:schemas`
Expected: outputs new/updated files under `.well-known/`. Diff is minimal — no `multica` content unless the generator reads `instances.yaml` / `packages-matrix.yaml` (most don't).

- [ ] **Step 2: Validate**

Run: `npm run validate:schemas && npm run validate:structure`
Expected: both pass.

- [ ] **Step 3: Commit (only if `.well-known/` changed)**

```bash
git status .well-known/
# if dirty:
git add .well-known/
git commit -m "chore(multica): regenerate .well-known/ schemas"
# if clean:
echo "no schema deltas — skipping commit"
```

---

## Task 25: end-to-end manual verification (operator-driven, no commit)

> This task is a **runbook** the operator follows after all code tasks land. It does not produce a commit.

- [ ] **Step 1: Fresh install**

Run:
```bash
bash packages/multica-integration/install.sh
```
Expected: stack comes up, `/health` is green, workspace created, slash commands symlinked, `.env` populated.

- [ ] **Step 2: Manual bridge run**

Run: `npm run bridge:multica`
Expected: stdout reports `created=N updated=0 skipped=0 closed=0` where N matches the count of open tasks in `HEARTBEAT.md`. Verify in the multica UI at `http://localhost:8090` — N issues exist with correct labels and priorities.

- [ ] **Step 3: Idempotency**

Run: `npm run bridge:multica` again, immediately.
Expected: `created=0 updated=0 skipped=N closed=0`.

- [ ] **Step 4: Update detection**

Edit one task's text in `HEARTBEAT.md` (small change, same hash boundary). Run: `npm run bridge:multica`.
Expected: `updated=1`.

- [ ] **Step 5: Removal closes issue**

Mark a HEARTBEAT.md task complete (`- [ ]` → `- [x]`). Run: `npm run bridge:multica`.
Expected: `closed=1` and the corresponding multica issue is closed with reason `removed-from-heartbeat`.

- [ ] **Step 6: /close auto-trigger**

Trigger the `/close` command in your agent runtime. Verify the bridge ran (logged in the close summary) and the close commit succeeded even if you stopped the multica stack first (failure must be non-fatal).

- [ ] **Step 7: Smoke test against live stack**

Run: `cd packages/multica-integration && MULTICA_E2E=1 node --test test/smoke.test.mjs`
Expected: 4 passed.

If all seven steps pass, the verification checklist in the spec (`§Verification`) is satisfied. Update `docs/agent-plans/QUEUE.md` to move multica-integration from Active to Completed.

---

## Self-Review

This plan was self-reviewed against the spec on creation. Every spec
requirement maps to at least one task:

| Spec section | Tasks |
|---|---|
| §Architecture (component layout) | 1, 9–14 |
| §Architecture (data flow) | 3, 5, 6, 7, 8 |
| §Server install flow | 9, 10, 11 |
| §Data Model — instances.yaml | 16 |
| §Data Model — packages-matrix.yaml (incl. `lifecycle_status` bump) | 17, 18 |
| §Data Model — federation.yaml (agent_runtimes + packages toggle) | 19, 20 |
| §Data Model — scripts/initialize.mjs | 21 |
| §Data Model — org-os-init close hook | 22 |
| §Error handling | 7, 8, 10, 22 (non-fatal close) |
| §Testing — bridge.test.mjs always-on | 7 |
| §Testing — smoke.test.mjs gated | 15 |
| §Verification | 25 |
| §Decisions D1–D13 | covered in tasks 1–24 |

No placeholders. No "TBD" or "implement later". All code blocks are
self-contained and runnable.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-25-multica-integration.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for a 25-task plan like this.

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints for review.

**Which approach?**
