# Buzz Integration (agent lane) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire org-os sessions into a local Buzz relay as a signed comms lane — `/close` posts SHA-tagged session digests to `#org-os-dev`, `/initialize` reads the channel back — shipped as manifest-first module #3 `org-os-buzz`.

**Architecture:** A thin Node wrapper (`packages/buzz-integration/lib/buzz.mjs`) shells out to a pinned `buzz-cli` (JSON in/out); three root-invoked scripts (post-digest, read-since, doctor) sit on top; session skills gain optional, fail-open hooks. No Nostr code in-repo; all protocol work delegated to buzz-cli.

**Tech Stack:** Node ESM (`.mjs`), `node --test` (root glob `tests/**/*.test.mjs`), `gray-matter` n/a here, no new npm deps. External: block/buzz at a pinned release (relay via its compose stack; `buzz-cli` binary).

**Spec:** `docs/superpowers/specs/2026-08-28-buzz-integration-design.md`

## Global Constraints

- Never implement Nostr in-repo — every protocol interaction goes through `buzz-cli` (spec: Protocol stance).
- `/close` can **never** fail because of Buzz — every hook path exits 0 with a `buzz: … — skipped` line on any failure (spec: Error handling).
- Secrets only in `.env` (`BUZZ_NSEC`); npub is public and goes in TOOLS.md (spec: Identity).
- Local relay (`ws://localhost:3000`) only; pointing at any shared/hosted relay requires a redaction review first (spec: Safety gate).
- Buzz is a v0.4.x developer preview — the release pin recorded in Task 1 is the only version anything may assume.
- Tests live under root `tests/` (glob-covered) — no nested package test suite (multica-bridge gate-wiring precedent).
- Repo hygiene: `npx prettier . --check` green before every commit; stage explicit paths only.
- The module catalog is double-entry: `docs/MODULES.md` + `site/src/data/modules.yaml` (a site test fails on drift). `module.yaml` has NO status field (`additionalProperties: false`).

---

### Task 1: Pin buzz + verify the CLI against a live local relay

**Files:**
- Create: `packages/buzz-integration/VERIFIED.md`

**Interfaces:**
- Produces: the pinned release tag, the relay bring-up commands, and the **verified CLI invocation table** (keygen / post / read / channel-create / status) that Task 2's `CLI_MAP` must copy verbatim.

This is the spike-verify the spec deferred. Everything external lives OUTSIDE the repo (`~/tools/buzz`).

- [ ] **Step 1: Clone and pin.** `git clone https://github.com/block/buzz ~/tools/buzz && cd ~/tools/buzz && git tag --sort=-creatordate | head -5` — pick the newest release tag, `git switch --detach <tag>`, record the tag.
- [ ] **Step 2: Bring up the dev relay** per the repo README: `. ./bin/activate-hermit && just setup && just build && just dev` (requires Docker running). Confirm the relay answers on `ws://localhost:3000`.
- [ ] **Step 3: Mint the agent keypair** with buzz-cli (expected shape: `buzz-cli keygen` → JSON with `npub`/`nsec`). Record npub; keep nsec OUT of every file except your local `.env` later.
- [ ] **Step 4: Create/join `#org-os-dev`, post one hello event, read it back** with buzz-cli. Record every exact invocation and its JSON output shape.
- [ ] **Step 5: Write `packages/buzz-integration/VERIFIED.md`** — the pinned tag, relay bring-up, and a table: intent → exact verified command → output shape. If any command differs from the `CLI_MAP` defaults shown in Task 2, note the correction here; Task 2 copies from THIS file.
- [ ] **Step 6: Commit** — `git add packages/buzz-integration/VERIFIED.md && git commit -m "docs(buzz): pin block/buzz release and record verified buzz-cli surface"`

### Task 2: Wrapper library `lib/buzz.mjs` (TDD)

**Files:**
- Create: `packages/buzz-integration/lib/buzz.mjs`
- Test: `tests/packages/buzz-lib.test.mjs`

**Interfaces:**
- Produces: `loadConfig() → {relayUrl, channel, nsec, bin}` (reads root `.env` + env vars; env wins) · `postEvent({content, tags}, cfg?) → {ok, id?|error?}` · `readChannel({since}, cfg?) → {ok, events: [{id, created_at, pubkey, content}]}` · `status(cfg?) → {ok, checks: {bin, relay, key, channel}}`. All never throw; failures return `{ok: false, error}`.
- Consumes: `CLI_MAP` verified in Task 1's VERIFIED.md.

- [ ] **Step 1: Write the failing tests.** Tests spawn nothing real: a fixture fake CLI (a node script) echoes canned JSON and records its argv to a file.

```js
// tests/packages/buzz-lib.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const { postEvent, readChannel, status, loadConfig } = await import(
  "../../packages/buzz-integration/lib/buzz.mjs"
);

function fakeCli(dir, reply) {
  const bin = path.join(dir, "fake-buzz-cli.mjs");
  writeFileSync(
    bin,
    `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(path.join(dir, "argv.json"))}, JSON.stringify(process.argv.slice(2)));
console.log(${JSON.stringify(JSON.stringify(reply))});`,
  );
  chmodSync(bin, 0o755);
  return bin;
}
const cfg = (dir, reply) => ({
  bin: fakeCli(dir, reply), relayUrl: "ws://localhost:3000",
  channel: "org-os-dev", nsec: "nsec1fake",
});

test("postEvent invokes the CLI with channel + content and parses the reply", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-"));
  const r = postEvent({ content: "hello", tags: { sha: "abc123" } }, cfg(dir, { id: "evt1" }));
  assert.equal(r.ok, true);
  assert.equal(r.id, "evt1");
  const argv = JSON.parse(readFileSync(path.join(dir, "argv.json"), "utf8"));
  assert.ok(argv.includes("org-os-dev"));
  assert.ok(argv.some((a) => a.includes("hello")));
});

test("readChannel passes since and returns events", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-"));
  const r = readChannel({ since: 1756300000 }, cfg(dir, { events: [{ id: "e", created_at: 1, pubkey: "p", content: "c" }] }));
  assert.equal(r.ok, true);
  assert.equal(r.events.length, 1);
});

test("missing binary → ok:false, never throws", () => {
  const r = status({ bin: "/nonexistent/buzz-cli", relayUrl: "ws://x", channel: "c", nsec: "n" });
  assert.equal(r.ok, false);
});

test("loadConfig reads .env lines and env vars override", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-"));
  writeFileSync(path.join(dir, ".env"), "BUZZ_RELAY_URL=ws://from-file:3000\nBUZZ_CHANNEL=org-os-dev\n");
  const c = loadConfig({ root: dir, env: { BUZZ_RELAY_URL: "ws://from-env:3000" } });
  assert.equal(c.relayUrl, "ws://from-env:3000");
  assert.equal(c.channel, "org-os-dev");
});
```

- [ ] **Step 2: Run to verify failure.** `npm test 2>&1 | grep -A2 buzz-lib` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement `packages/buzz-integration/lib/buzz.mjs`.**

```js
#!/usr/bin/env node
// buzz.mjs — thin wrapper around the pinned buzz-cli. ALL protocol work
// happens in the CLI; this file only builds argv, spawns, parses JSON.
// CLI_MAP mirrors packages/buzz-integration/VERIFIED.md — change it ONLY
// to match a re-verified pin.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

// intent → argv builder. Defaults are the Task-1-verified invocations.
const CLI_MAP = {
  post: (c, { content, tags }) => ["post", "--channel", c.channel, "--content", content,
    ...Object.entries(tags ?? {}).flatMap(([k, v]) => ["--tag", `${k}=${v}`]), "--json"],
  read: (c, { since }) => ["read", "--channel", c.channel,
    ...(since ? ["--since", String(since)] : []), "--json"],
  status: (c) => ["status", "--relay", c.relayUrl, "--json"],
};

export function loadConfig({ root = ROOT, env = process.env } = {}) {
  const fileVars = {};
  const envPath = path.join(root, ".env");
  if (existsSync(envPath))
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) fileVars[m[1]] = m[2];
    }
  const get = (k, dflt) => env[k] ?? fileVars[k] ?? dflt;
  return {
    relayUrl: get("BUZZ_RELAY_URL", "ws://localhost:3000"),
    channel: get("BUZZ_CHANNEL", "org-os-dev"),
    nsec: get("BUZZ_NSEC", ""),
    bin: get("BUZZ_CLI_BIN", "buzz-cli"),
  };
}

function invoke(intent, args, cfg) {
  const c = cfg ?? loadConfig();
  try {
    const r = spawnSync(c.bin, CLI_MAP[intent](c, args), {
      encoding: "utf8", timeout: 15000,
      env: { ...process.env, BUZZ_RELAY_URL: c.relayUrl, BUZZ_NSEC: c.nsec },
    });
    if (r.error || r.status !== 0)
      return { ok: false, error: r.error?.message ?? r.stderr?.trim() ?? `exit ${r.status}` };
    return { ok: true, ...JSON.parse(r.stdout) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export const postEvent = (args, cfg) => invoke("post", args, cfg);
export const readChannel = (args, cfg) => invoke("read", args, cfg);
export function status(cfg) {
  const c = cfg ?? loadConfig();
  const bin = !spawnSync(c.bin, ["--version"], { encoding: "utf8" }).error;
  if (!bin) return { ok: false, checks: { bin: false, relay: false, key: false, channel: false } };
  const relay = invoke("status", {}, c).ok;
  const checks = { bin, relay, key: Boolean(c.nsec), channel: Boolean(c.channel) };
  return { ok: Object.values(checks).every(Boolean), checks };
}
```

- [ ] **Step 4: Reconcile `CLI_MAP` with VERIFIED.md** — if Task 1 recorded different verbs/flags, change `CLI_MAP` (and the two argv assertions in the test) to the verified forms now.
- [ ] **Step 5: Run tests.** `npm test 2>&1 | grep -B1 -A3 buzz-lib` — Expected: PASS (4/4).
- [ ] **Step 6: Commit** — `git add packages/buzz-integration/lib/buzz.mjs tests/packages/buzz-lib.test.mjs && git commit -m "feat(buzz): wrapper lib over pinned buzz-cli (TDD)"`

### Task 3: `read-since` script + state marker

**Files:**
- Create: `packages/buzz-integration/scripts/read-since.mjs`
- Modify: `.gitignore` (append `.buzz-state.json`)
- Test: `tests/packages/buzz-read-since.test.mjs`

**Interfaces:**
- Consumes: `readChannel`, `loadConfig` from Task 2.
- Produces: CLI `node packages/buzz-integration/scripts/read-since.mjs [--state <path>] [--no-advance]` → prints a markdown block (or `buzz: relay unreachable — skipped`), always exit 0. Marker file `{lastRead: <unix seconds>}` at repo root `.buzz-state.json`.

- [ ] **Step 1: Write failing tests** — fake CLI via `BUZZ_CLI_BIN` (reuse the fixture pattern from Task 2 verbatim); cases: (a) prints event content and advances marker, (b) corrupt marker file → still works (24h window), (c) dead binary → exit 0 with `skipped` in stdout, (d) `--no-advance` leaves marker untouched.
- [ ] **Step 2: Run to verify failure.** Expected: FAIL.
- [ ] **Step 3: Implement.**

```js
#!/usr/bin/env node
// read-since.mjs — "what happened in #org-os-dev since my last session".
// Fail-open by design: any failure prints a skip line and exits 0.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readChannel, loadConfig } from "../lib/buzz.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const argv = process.argv.slice(2);
const flagValue = (n) => { const i = argv.indexOf(n); return i !== -1 ? argv[i + 1] : undefined; };
const STATE = flagValue("--state") ?? path.join(ROOT, ".buzz-state.json");
const DAY = 24 * 60 * 60;

let since = Math.floor(Date.now() / 1000) - DAY; // fallback window
try { since = JSON.parse(readFileSync(STATE, "utf8")).lastRead ?? since; } catch { /* fall back */ }

const cfg = loadConfig();
const r = readChannel({ since }, cfg);
if (!r.ok) {
  console.log(`buzz: relay unreachable — skipped (${r.error})`);
  process.exit(0);
}
if (r.events.length === 0) console.log(`buzz: #${cfg.channel} — no new messages since last session`);
else {
  console.log(`### Buzz #${cfg.channel} since last session\n`);
  for (const e of r.events)
    console.log(`- [${new Date(e.created_at * 1000).toISOString()}] ${e.content}`);
}
if (!argv.includes("--no-advance"))
  writeFileSync(STATE, JSON.stringify({ lastRead: Math.floor(Date.now() / 1000) }));
```

- [ ] **Step 4: Run tests.** Expected: PASS. Also append `.buzz-state.json` to `.gitignore`.
- [ ] **Step 5: Commit** — `git add packages/buzz-integration/scripts/read-since.mjs tests/packages/buzz-read-since.test.mjs .gitignore && git commit -m "feat(buzz): read-since with fail-open marker window"`

### Task 4: `post-digest` script

**Files:**
- Create: `packages/buzz-integration/scripts/post-digest.mjs`
- Test: `tests/packages/buzz-post-digest.test.mjs`

**Interfaces:**
- Consumes: `postEvent`, `loadConfig` (Task 2).
- Produces: CLI `node packages/buzz-integration/scripts/post-digest.mjs [--file <path>]` (default: read stdin). Tags every event `sha=<git HEAD>` + `source=org-os-session`. Always exit 0.

- [ ] **Step 1: Write failing tests** — cases: (a) posts stdin content with `sha=` tag present in fake-CLI argv, (b) `--file` variant, (c) empty digest → skip line, exit 0, (d) dead binary → skip line, exit 0.
- [ ] **Step 2: Run to verify failure.** Expected: FAIL.
- [ ] **Step 3: Implement.**

```js
#!/usr/bin/env node
// post-digest.mjs — publish the /close session digest as a signed Buzz event,
// tagged with the commit SHA it describes. Fail-open: never blocks a close.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { postEvent, loadConfig } from "../lib/buzz.mjs";

const argv = process.argv.slice(2);
const flagValue = (n) => { const i = argv.indexOf(n); return i !== -1 ? argv[i + 1] : undefined; };

let content = "";
try {
  content = flagValue("--file")
    ? readFileSync(flagValue("--file"), "utf8")
    : readFileSync(0, "utf8"); // stdin
} catch { /* fall through to empty check */ }

if (!content.trim()) { console.log("buzz: empty digest — skipped"); process.exit(0); }

let sha = "unknown";
try { sha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim(); } catch { /* keep unknown */ }

const r = postEvent({ content: content.trim(), tags: { sha, source: "org-os-session" } }, loadConfig());
console.log(r.ok ? `buzz: digest posted (sha ${sha}, event ${r.id ?? "?"})` : `buzz: post failed — skipped (${r.error})`);
process.exit(0);
```

- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit** — `git add packages/buzz-integration/scripts/post-digest.mjs tests/packages/buzz-post-digest.test.mjs && git commit -m "feat(buzz): post-digest with SHA tag, fail-open"`

### Task 5: `doctor` script + npm scripts + env surface

**Files:**
- Create: `packages/buzz-integration/scripts/doctor.mjs`
- Modify: `package.json` (three scripts), `.env.example`
- Test: `tests/packages/buzz-doctor.test.mjs`

**Interfaces:**
- Consumes: `status`, `loadConfig` (Task 2).
- Produces: `npm run buzz:doctor` (exit 0 all green; exit 2 unconfigured/unreachable — WARN, matches selftest semantics; never exit 1), `npm run buzz:post`, `npm run buzz:read`.

- [ ] **Step 1: Write failing tests** — (a) all-green fake → exit 0 with four ✓ lines, (b) dead binary → exit 2 and `✗ buzz-cli`, (c) output names each check (`bin`, `relay`, `key`, `channel`).
- [ ] **Step 2: Run to verify failure.** Expected: FAIL.
- [ ] **Step 3: Implement.**

```js
#!/usr/bin/env node
// doctor.mjs — is the Buzz lane ready? Exit 0 green, 2 not-ready (warn).
import { status, loadConfig } from "../lib/buzz.mjs";
const cfg = loadConfig();
const s = status(cfg);
const label = { bin: "buzz-cli on PATH (pinned)", relay: `relay ${cfg.relayUrl}`, key: "agent key (BUZZ_NSEC)", channel: `channel #${cfg.channel}` };
for (const [k, ok] of Object.entries(s.checks)) console.log(` ${ok ? "✓" : "✗"} ${label[k]}`);
console.log(s.ok ? "buzz: lane ready" : "buzz: lane not ready — hooks will skip");
process.exit(s.ok ? 0 : 2);
```

- [ ] **Step 4: Add npm scripts** to root `package.json` (alphabetical near other groups):

```json
"buzz:doctor": "node packages/buzz-integration/scripts/doctor.mjs",
"buzz:post": "node packages/buzz-integration/scripts/post-digest.mjs",
"buzz:read": "node packages/buzz-integration/scripts/read-since.mjs",
```

- [ ] **Step 5: Extend `.env.example`** (keep the file's comment style):

```bash
# Buzz agent lane (local dev relay only — see docs/superpowers/specs/2026-08-28-buzz-integration-design.md)
# Mint the keypair with the pinned buzz-cli (packages/buzz-integration/VERIFIED.md); npub goes in TOOLS.md
BUZZ_RELAY_URL=ws://localhost:3000
BUZZ_CHANNEL=org-os-dev
BUZZ_NSEC=
```

- [ ] **Step 6: Run tests + prettier.** `npm test` and `npx prettier . --check` — Expected: PASS / green.
- [ ] **Step 7: Commit** — `git add packages/buzz-integration/scripts/doctor.mjs tests/packages/buzz-doctor.test.mjs package.json .env.example && git commit -m "feat(buzz): doctor + npm scripts + env surface"`

### Task 6: Module #3 manifest + catalog entries

**Files:**
- Create: `modules/org-os-buzz/module.yaml`
- Modify: `docs/MODULES.md`, `site/src/data/modules.yaml`, `TOOLS.md`

**Interfaces:**
- Consumes: everything above at its canonical path (in-place module).
- Produces: module #3 visible to `tests/scripts/module-manifests.test.mjs` and the site catalog test.

- [ ] **Step 1: Write `modules/org-os-buzz/module.yaml`** (schema has NO status field — status lives in docs/MODULES.md):

```yaml
# org-os-buzz — the Buzz agent-lane integration (module #3).
#
# An IN-PLACE module: everything it owns already sits at its canonical path.
# The external dependency (block/buzz at the pinned release) is recorded in
# packages/buzz-integration/VERIFIED.md, not here — the v5 schema models
# module-to-module deps only.
id: org-os-buzz
version: 0.1.0
type: integration
description: >-
  Buzz agent lane — org-os sessions post SHA-tagged signed digests to a local
  Buzz relay channel on /close and read it back on /initialize, via a thin
  wrapper over the pinned buzz-cli. Fail-open everywhere; local relay only.
dependencies:
  - org-os-standards
files:
  packages/buzz-integration: packages/buzz-integration
checks:
  - file-exists: packages/buzz-integration/lib/buzz.mjs
  - file-exists: packages/buzz-integration/VERIFIED.md
```

- [ ] **Step 2: Run manifest + structure gates.** `npm test 2>&1 | grep -i manifest` and `npm run validate:structure` — Expected: PASS.
- [ ] **Step 3: Add the catalog entry** to `docs/MODULES.md` under "Tracked modules" (status **in-dev**; flip to **live** only after the acceptance task), and mirror the same entry into `site/src/data/modules.yaml`. Run the drift gate: `cd site && npm test` (or the root site test script) — Expected: PASS.
- [ ] **Step 4: Add `### Buzz` to TOOLS.md** under Communication Channels: relay URL, `#org-os-dev`, agent npub (from Task 1), pointer to VERIFIED.md. No secrets.
- [ ] **Step 5: Commit** — `git add modules/org-os-buzz/module.yaml docs/MODULES.md site/src/data/modules.yaml TOOLS.md && git commit -m "feat(buzz): register org-os-buzz as module #3 (in-dev)"`

### Task 7: Session skill hooks (fail-open, three touchpoints)

**Files:**
- Modify: `.claude/commands/initialize.md`, `.claude/commands/close.md` (repo canon), then `npm run sync:commands`
- Machine-local mirror (not committed): `~/.claude/skills/initialize/SKILL.md`, `~/.claude/skills/close/SKILL.md`

**Interfaces:**
- Consumes: `npm run buzz:read`, `npm run buzz:post`, `npm run buzz:doctor` (Task 5).

- [ ] **Step 1: Add to the initialize command/skill**, as a new step between sync and dashboard render, this exact text:

```markdown
## Step 2b: Buzz channel read-back (optional, fail-open)

If the workspace has the Buzz lane configured (`npm run buzz:doctor` exits 0), run
`npm run buzz:read` and include its output block in the session context under
"Since last session". If the doctor is not green, skip silently — one line at most.
```

- [ ] **Step 2: Add to the close command/skill**, AFTER the memory-write-and-commit step, this exact text:

```markdown
## Step Nb: Post session digest to Buzz (optional, fail-open)

After the close commit exists, pipe the session digest through the Buzz lane:
`npm run buzz:post <<< "<digest text>"`. The script tags the event with the
commit SHA automatically. Any failure prints a skip line — never block the close.
```

- [ ] **Step 3: Regenerate + mirror.** `npm run sync:commands`, then apply the same two edits to `~/.claude/skills/initialize/SKILL.md` and `~/.claude/skills/close/SKILL.md` (machine-local; the repo copy is canon).
- [ ] **Step 4: Verify fail-open by running the hooks with no relay up:** `npm run buzz:doctor; npm run buzz:read` — Expected: warn/skip lines, exit codes 2/0, nothing blocks.
- [ ] **Step 5: Commit** — `git add .claude/commands/initialize.md .claude/commands/close.md skills/commands && git commit -m "feat(buzz): fail-open session hooks in initialize/close"`

### Task 8: Live integration pass + acceptance tracking

**Files:**
- Modify: `HEARTBEAT.md`, `packages/buzz-integration/VERIFIED.md`

- [ ] **Step 1: Live round-trip** (relay from Task 1 up, `.env` filled): `npm run buzz:doctor` → all ✓; `echo "integration test $(date -u +%F)" | npm run buzz:post` → posted line with SHA; `npm run buzz:read` → the message appears. Append the transcript to VERIFIED.md.
- [ ] **Step 2: Add the acceptance tracker to HEARTBEAT.md** under Active Tasks:

```markdown
### Buzz lane dogfood acceptance (module #3 → live)

- [ ] 5 consecutive real sessions where /close posts and /initialize reads with zero
      manual intervention: ☐ ☐ ☐ ☐ ☐  (tick per session; on the 5th, flip
      docs/MODULES.md org-os-buzz to **live** + update site mirror + QUEUE entry)
```

- [ ] **Step 3: Full gates.** `npm test && npm run validate:structure && npm run selftest && npx prettier . --check` — Expected: all green.
- [ ] **Step 4: Commit** — `git add HEARTBEAT.md packages/buzz-integration/VERIFIED.md && git commit -m "feat(buzz): live round-trip verified; acceptance tracker armed"`

---

## Self-review checklist (ran at authoring)

- Spec coverage: every spec section maps to a task (goal/loop→3,4,7; components→2–5; module→6; config/keys→5,6; error table→2–5 fail-open steps + 7 Step 4; testing→per-task TDD + 8; sequencing→task order; safety gate→Global Constraints; v2 items deliberately absent — YAGNI).
- No placeholders; `CLI_MAP` defaults are explicit best-guesses with Task 1/Task 2 Step 4 as the verbatim reconciliation loop.
- Type consistency: `{ok, error}` shape, `loadConfig` keys, and script paths named identically across Tasks 2–7.
