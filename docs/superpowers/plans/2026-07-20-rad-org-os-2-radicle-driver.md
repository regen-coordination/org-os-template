# rad-org-os Plan 2 — Radicle Driver (`@org-os/rad`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@org-os/rad`, a `radicle` driver that satisfies the `HostDriver` contract from Plan 1 — reads via the `radicle-httpd` JSON API, writes via the `rad` CLI (failing loudly, never falling back to HTTP) — and register it into `@org-os/host` so `platforms.canonical: radicle` repos route through it.

**Architecture:** The driver splits along the read/write seam Plan 1 established. Reads go through `httpd.mjs` (a client for `radicle-httpd` v6.1.0). Writes go through `rad-cli.mjs`, which shells `rad` via a single `execRad` chokepoint and throws `WriteUnavailableError` when `rad` is missing or the node is down. `identity.mjs` handles `did:key` + delegates/threshold; `cob.mjs` maps issue/patch Collaborative Objects to org-os records. `driver.mjs` composes these into the `HostDriver` interface. This plan also resolves the five Plan-2 prerequisites recorded in the roadmap (per-entry frontier routing, uniform cwd composition, `fetchFile` ref semantics, real `whoami`, and the github `resolveRemote('rad:…')` guard).

**Tech Stack:** Node.js ESM (`.mjs`), `node:test` + `node:assert/strict`, `globalThis.fetch` for HTTP, `node:child_process` for `rad`. Depends on `@org-os/host` (relative import, per repo convention). No new runtime deps. Integration tests need a local `radicle-node` + `rad` CLI (documented; gated so unit tests run without them).

**Spec:** [`docs/superpowers/specs/2026-07-20-rad-org-os-design.md`](../specs/2026-07-20-rad-org-os-design.md) — "The `radicle` driver internals". **Roadmap:** [`2026-07-20-rad-org-os-ROADMAP.md`](2026-07-20-rad-org-os-ROADMAP.md) (see "Plan 2 prerequisites").

**Prerequisite:** Plan 1 shipped (`@org-os/host` on `v0.5`: `HostDriver`, registry, `resolveDriver`, `github` driver, contract suite with write-path + fail-loudly assertions). Read `packages/org-os-host/src/driver.mjs`, `src/resolve.mjs`, `src/errors.mjs`, and `test/contract.mjs` before starting — the radicle driver must pass that contract.

**Verified API facts (live `seed.radicle.xyz`, radicle-httpd apiVersion 6.1.0, 2026-07-20):**
- `GET /api/v1` → `{ service:"radicle-httpd", version, apiVersion:"6.1.0", node:{ id } }`.
- `GET /api/v1/repos/:rid` → top-level keys `payloads, delegates, threshold, visibility, rid, seeding, refs`. `payloads["xyz.radicle.project"].data` = `{ defaultBranch, name, description }`; `payloads["xyz.radicle.project"].meta` contains the canonical head commit SHA; `delegates` = array of `{ id, alias }`; `threshold` = number; `visibility` = `{ type: "public"|"private" }`; `seeding` = seed count.
- `GET /api/v1/repos/:rid/blob/:sha/:path` → `{ binary, name, content, path, lastCommit }`; `content` is **plain UTF-8 text** when `binary === false`. **The `:ref` segment must be a commit SHA, not a branch name** (branch names 404). So `fetchFile` resolves the head SHA from the repo response first, then fetches the blob by SHA.

**Fixture discipline (IMPORTANT):** exact `rad` CLI stdout formats and some httpd nested shapes are pinned by **capturing real output into committed fixtures**, never by guessing. Read-path fixtures come from the live public seed (no local node needed). Parsers are pure functions tested against fixtures; command wiring is thin.

**Verified against live `rad 1.8.0` (macOS arm64, 2026-07-20) — the write-path surface is pinned, not guessed:**
- **Patches have NO `rad patch open`.** A patch is opened by **`git push rad HEAD:refs/patches`** (the message/cover-letter is set with git push options `-o patch.message=<subject>` and additional `-o patch.message=<body>` lines). `rad patch` subcommands are: list, show, diff, archive, update, checkout, review, resolve, delete, redact, react, assign, label, ready, edit, set, comment, cache. So `openChange` shells **git**, not `rad`.
- **`rad issue open`** flags (confirmed): `-t/--title <TITLE>`, `-d/--description <DESCRIPTION>`, `-r/--repo <RID>`, `--no-announce`. `rad issue comment` and `rad issue state` exist (comment-body flag pinned in Task 3's capture).
- **`rad self`** prints an `Alias`, a `DID  did:key:z6Mk…` line, `Node`, SSH keys, and `Home` — the `did:key:` regex in `parseRadSelf` matches.
- **`rad sync`** synchronizes both ways by default (fetch from seeds, then announce local refs) — so `push`/`syncUpstream` use `rad sync` (announce is implicit; `--announce`/`--fetch` are opt-in modifiers).
- **`rad id`** manages the identity doc via `update` (proposes a revision), `accept`, `reject`, `edit`, `list`, `show`; options `--repo <RID>`, `--no-confirm`. The `addDelegate`/`setThreshold` helpers in `identity.mjs` are the ONE surface still needing a running-node round-trip to pin exact argument form (Task 9) — `rad id update` is interactive/editor-driven by default, so these may become "propose a doc edit" rather than flag-driven; treat as tracked debt.
- Environment has an existing identity (`did:key:z6Mkvyj7aB29JXhP9YztVCDdXNksQ2WSySvkP3hd7iRMdd19`); the node is **stopped** (`rad node start` needed for a real write round-trip). Task 9's live read-path checks run now; a real patch/issue creation round-trip needs `rad node start` + a scratch repo.

---

## File structure

```
packages/rad-org-os/                     # @org-os/rad
  package.json                           # type: module, test: node --test
  README.md
  src/
    httpd.mjs                            # READ: radicle-httpd v6.1.0 client (pure over injected fetchFn)
    rad-cli.mjs                          # WRITE: execRad chokepoint + rad command wrappers
    parse.mjs                            # pure parsers for rad stdout + httpd JSON (fixture-tested)
    identity.mjs                         # did:key + delegates/threshold (rad self + httpd repo doc)
    cob.mjs                              # issue/patch COB <-> org-os record mapping
    driver.mjs                           # makeRadicleDriver({ httpd, radCli }) -> HostDriver
    index.mjs                            # registers 'radicle' into @org-os/host; re-exports
  test/
    fixtures/                            # captured real outputs (httpd JSON, rad stdout)
      repo.json  blob.json  node.json  rad-self.txt  rad-patch-open.txt  rad-issue-open.txt
    httpd.test.mjs
    parse.test.mjs
    identity.test.mjs
    cob.test.mjs
    driver.test.mjs                      # runs Plan 1's runHostDriverContract against the radicle driver
    integration.test.mjs                 # gated: only runs when RAD_INTEGRATION=1 and rad+node present
```

Modified in `@org-os/host` (Plan 2 prerequisites):
- `packages/org-os-host/src/github/driver.mjs` — `resolveRemote` guards `rad:` ids; uniform cwd composition.
- `packages/org-os-host/src/github/exec.mjs` — (already forwards per-call cwd; verify).
- `packages/org-os-kms/src/frontier.mjs` — per-entry driver selection by peer scheme.

---

### Task 1: Scaffold `@org-os/rad` + capture live read-path fixtures

**Files:**
- Create: `packages/rad-org-os/package.json`, `README.md`, `src/index.mjs` (temporary stub)
- Create: `packages/rad-org-os/test/fixtures/repo.json`, `blob.json`, `node.json`
- Test: `packages/rad-org-os/test/smoke.test.mjs`

- [ ] **Step 1: Write the failing smoke test**

`packages/rad-org-os/test/smoke.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

test('read-path fixtures are present and well-formed', () => {
  const repo = JSON.parse(readFileSync(join(here, 'fixtures/repo.json'), 'utf8'));
  assert.equal(typeof repo.threshold, 'number');
  assert.ok(Array.isArray(repo.delegates));
  assert.ok(repo.payloads['xyz.radicle.project'].data.defaultBranch);
  const blob = JSON.parse(readFileSync(join(here, 'fixtures/blob.json'), 'utf8'));
  assert.equal(blob.binary, false);
  assert.equal(typeof blob.content, 'string');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/rad-org-os && node --test test/smoke.test.mjs`
Expected: FAIL — fixtures don't exist yet.

- [ ] **Step 3: Capture real fixtures from the live public seed**

Run these and save each response body to the fixture path (pretty-print is fine):
```bash
cd packages/rad-org-os
mkdir -p test/fixtures
RID=rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5
curl -sS "https://seed.radicle.xyz/api/v1/repos/$RID" -o test/fixtures/repo.json
curl -sS "https://seed.radicle.xyz/api/v1" -o test/fixtures/node.json
# Resolve the head SHA from repo.json, then capture a blob by SHA:
SHA=$(node -e "const r=require('./test/fixtures/repo.json'); const m=r.payloads['xyz.radicle.project'].meta; console.log(m.head || m.commit || Object.values(m).find(v=>/^[0-9a-f]{40}$/.test(v)))")
curl -sS "https://seed.radicle.xyz/api/v1/repos/$RID/blob/$SHA/README.md" -o test/fixtures/blob.json
```
Open `repo.json` and confirm the exact key path to the head SHA (it is under `payloads["xyz.radicle.project"].meta`). Record that exact key in a comment at the top of `src/httpd.mjs` when you write it (Task 2). If the `SHA` extraction above printed empty, inspect `meta` manually and use the correct key.

- [ ] **Step 4: Create package.json + README + stub index**

`packages/rad-org-os/package.json`:
```json
{
  "name": "@org-os/rad",
  "version": "0.1.0",
  "type": "module",
  "description": "Radicle (Heartwood) driver for @org-os/host: reads via radicle-httpd, writes via the rad CLI.",
  "main": "src/index.mjs",
  "scripts": { "test": "node --test" }
}
```

`packages/rad-org-os/README.md`:
```markdown
# @org-os/rad

The Radicle driver for `@org-os/host`. Reads go through the `radicle-httpd`
JSON API (v6.1.0); writes go through the `rad` CLI and fail loudly (a
`WriteUnavailableError`) when `rad` is missing or the local node is down —
never a silent HTTP fallback. Registers itself as the `radicle` host driver.
```

`packages/rad-org-os/src/index.mjs` (temporary stub — replaced in Task 8):
```js
export const RADICLE_DRIVER = 'radicle';
```

- [ ] **Step 5: Run the smoke test to verify it passes**

Run: `cd packages/rad-org-os && node --test test/smoke.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/rad-org-os/package.json packages/rad-org-os/README.md packages/rad-org-os/src/index.mjs packages/rad-org-os/test/smoke.test.mjs packages/rad-org-os/test/fixtures/
git commit -m "feat(rad): scaffold @org-os/rad + capture live radicle-httpd fixtures"
```

---

### Task 2: `httpd.mjs` — the read client + `parse.mjs` httpd parsers

**Files:**
- Create: `packages/rad-org-os/src/parse.mjs`
- Create: `packages/rad-org-os/src/httpd.mjs`
- Test: `packages/rad-org-os/test/httpd.test.mjs`, `packages/rad-org-os/test/parse.test.mjs`

- [ ] **Step 1: Write failing parser tests**

`packages/rad-org-os/test/parse.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseRepoDoc, parseBlob } from '../src/parse.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = JSON.parse(readFileSync(join(here, 'fixtures/repo.json'), 'utf8'));
const blob = JSON.parse(readFileSync(join(here, 'fixtures/blob.json'), 'utf8'));

test('parseRepoDoc extracts canonical governance shape', () => {
  const r = parseRepoDoc(repo);
  assert.equal(r.defaultBranch, 'master');
  assert.equal(typeof r.threshold, 'number');
  assert.ok(Array.isArray(r.delegates));
  assert.ok(r.delegates.every((d) => typeof d.id === 'string'));
  assert.ok(/^[0-9a-f]{40}$/.test(r.head), 'head is a 40-char sha');
  assert.ok(['public', 'private'].includes(r.visibility));
});

test('parseBlob returns text content only for non-binary blobs', () => {
  assert.equal(typeof parseBlob(blob), 'string');
  assert.equal(parseBlob({ binary: true, content: 'x' }), null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/rad-org-os && node --test test/parse.test.mjs`
Expected: FAIL — `parse.mjs` doesn't exist.

- [ ] **Step 3: Write `parse.mjs`**

`packages/rad-org-os/src/parse.mjs`:
```js
// Pure parsers over radicle-httpd JSON and rad CLI stdout. Fixture-tested.
// httpd repo doc top-level: { payloads, delegates, threshold, visibility, rid, seeding, refs }
// payloads["xyz.radicle.project"].data = { defaultBranch, name, description }
// payloads["xyz.radicle.project"].meta contains the canonical head commit SHA.
const PROJECT = 'xyz.radicle.project';

function findHead(meta) {
  if (!meta || typeof meta !== 'object') return null;
  if (typeof meta.head === 'string') return meta.head;
  if (typeof meta.commit === 'string') return meta.commit;
  const sha = Object.values(meta).find((v) => typeof v === 'string' && /^[0-9a-f]{40}$/.test(v));
  return sha || null;
}

export function parseRepoDoc(doc) {
  const proj = doc?.payloads?.[PROJECT] || {};
  const data = proj.data || {};
  return {
    rid: doc?.rid || null,
    name: data.name || null,
    description: data.description || null,
    defaultBranch: data.defaultBranch || 'main',
    threshold: typeof doc?.threshold === 'number' ? doc.threshold : 1,
    delegates: Array.isArray(doc?.delegates)
      ? doc.delegates.map((d) => ({ id: d.id, alias: d.alias || null }))
      : [],
    visibility: doc?.visibility?.type === 'private' ? 'private' : 'public',
    head: findHead(proj.meta),
    seeding: typeof doc?.seeding === 'number' ? doc.seeding : null,
  };
}

export function parseBlob(blob) {
  if (!blob || blob.binary) return null;
  return typeof blob.content === 'string' ? blob.content : null;
}
```

- [ ] **Step 4: Run parser tests to verify pass**

Run: `cd packages/rad-org-os && node --test test/parse.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Write failing httpd-client tests**

`packages/rad-org-os/test/httpd.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeHttpd } from '../src/httpd.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = readFileSync(join(here, 'fixtures/repo.json'), 'utf8');
const blob = readFileSync(join(here, 'fixtures/blob.json'), 'utf8');
const RID = 'rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5';

// A fake fetch that maps URL substrings to fixture bodies.
function fakeFetch(routes) {
  return async (url) => {
    for (const [needle, body] of routes) {
      if (url.includes(needle)) return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
    }
    return { ok: false, status: 404, text: async () => 'not found', json: async () => ({}) };
  };
}

test('getRepo returns parsed governance shape', async () => {
  const h = makeHttpd({ seed: 'https://seed.example', fetchFn: fakeFetch([[`/repos/${RID}`, repo]]) });
  const r = await h.getRepo(RID);
  assert.equal(r.defaultBranch, 'master');
  assert.ok(/^[0-9a-f]{40}$/.test(r.head));
});

test('fetchFile resolves head then fetches blob content by sha', async () => {
  const parsed = JSON.parse(repo);
  const head = parsed.payloads['xyz.radicle.project'].meta.head
    || Object.values(parsed.payloads['xyz.radicle.project'].meta).find((v) => /^[0-9a-f]{40}$/.test(v));
  const h = makeHttpd({ seed: 'https://seed.example', fetchFn: fakeFetch([
    [`/repos/${RID}/blob/${head}/README.md`, blob],
    [`/repos/${RID}`, repo],
  ]) });
  const text = await h.fetchFile(RID, 'README.md');
  assert.equal(typeof text, 'string');
  assert.ok(text.length > 0);
});

test('fetchFile returns null (never throws) on a network error', async () => {
  const h = makeHttpd({ seed: 'https://seed.example', fetchFn: async () => { throw new Error('down'); } });
  assert.equal(await h.fetchFile(RID, 'README.md'), null);
});

test('fetchFile returns null on a 404 blob', async () => {
  const h = makeHttpd({ seed: 'https://seed.example', fetchFn: fakeFetch([[`/repos/${RID}`, repo]]) });
  assert.equal(await h.fetchFile(RID, 'nope.md'), null);
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd packages/rad-org-os && node --test test/httpd.test.mjs`
Expected: FAIL — `httpd.mjs` doesn't exist.

- [ ] **Step 7: Write `httpd.mjs`**

`packages/rad-org-os/src/httpd.mjs`:
```js
import { parseRepoDoc, parseBlob } from './parse.mjs';

// radicle-httpd v6.1.0 client. Read-only by contract. Reads degrade to null,
// never throw (matches the HostDriver read-path invariant). `seed` is a base
// URL like https://seed.example (the org's own node, a garden node, or a public seed).
export function makeHttpd({ seed, fetchFn = globalThis.fetch, timeoutMs = 8000 } = {}) {
  const base = `${String(seed).replace(/\/$/, '')}/api/v1`;

  async function getJson(path) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchFn(`${base}${path}`, { signal: ctrl.signal });
      if (!res || !res.ok) return null;
      return await res.json();
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function getRepo(rid) {
    const doc = await getJson(`/repos/${rid}`);
    return doc ? parseRepoDoc(doc) : null;
  }

  return {
    getRepo,
    async node() {
      return getJson('');
    },
    // Resolve the canonical head SHA, then fetch the blob by SHA (branch names 404).
    async fetchFile(rid, path, ref) {
      const repo = await getRepo(rid);
      if (!repo) return null;
      const sha = ref || repo.head;
      if (!sha) return null;
      const blob = await getJson(`/repos/${rid}/blob/${sha}/${path}`);
      return blob ? parseBlob(blob) : null;
    },
  };
}
```

- [ ] **Step 8: Run httpd tests to verify pass**

Run: `cd packages/rad-org-os && node --test test/httpd.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 9: Commit**

```bash
git add packages/rad-org-os/src/parse.mjs packages/rad-org-os/src/httpd.mjs packages/rad-org-os/test/parse.test.mjs packages/rad-org-os/test/httpd.test.mjs
git commit -m "feat(rad): radicle-httpd read client + pure httpd parsers (fixture-tested)"
```

---

### Task 3: `rad-cli.mjs` — the write chokepoint (fail-loudly)

**Files:**
- Create: `packages/rad-org-os/src/rad-cli.mjs`
- Test: `packages/rad-org-os/test/rad-cli.test.mjs`
- Fixtures: `test/fixtures/rad-self.txt`, `rad-patch-open.txt`, `rad-issue-open.txt`

The write path shells `rad`. All logic is testable with an injected fake `spawn`/exec; the real one is used in production. When `rad` is absent or a command signals the node is unreachable, methods throw `WriteUnavailableError` (imported from `@org-os/host`) — never a silent success or HTTP fallback.

- [ ] **Step 1: Capture (or document) rad output fixtures**

If a local `rad` + node are available, capture real stdout:
```bash
cd packages/rad-org-os
rad self > test/fixtures/rad-self.txt 2>&1 || echo "(rad not available — see note)"
```
For `rad patch`/`rad issue` open outputs, capture from a scratch repo if possible; otherwise create the fixture files from the documented output at radicle.dev/guides/user with a first line `# @needs-live-verification` comment. The parsers (Task 4/5) read the ID out of these; Task 9 re-verifies against a live node.

Minimum fixture content if capturing is impossible (mark them clearly):
`test/fixtures/rad-patch-open.txt`:
```
# @needs-live-verification (documented format)
✓ Patch 0a1b2c3d4e5f60718293a4b5c6d7e8f901234567 opened
```
`test/fixtures/rad-issue-open.txt`:
```
# @needs-live-verification (documented format)
✓ Issue 1122334455667788990011223344556677889900 opened
```
`test/fixtures/rad-self.txt`:
```
# @needs-live-verification (documented format)
DID    did:key:z6MktESTdid00000000000000000000000000000000000
Node ID (NID)  z6MktESTnid00000000000000000000000000000000000
```

- [ ] **Step 2: Write failing rad-cli tests**

`packages/rad-org-os/test/rad-cli.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRadCli } from '../src/rad-cli.mjs';
import { WriteUnavailableError } from '../../org-os-host/src/errors.mjs';

// fake exec: returns queued {code,stdout,stderr} by matched command; records calls.
function fakeExec(map, { throwOnSpawn = false } = {}) {
  const calls = [];
  const exec = async (bin, args) => {
    calls.push({ bin, args });
    if (throwOnSpawn) return { code: -1, stdout: '', stderr: 'spawn rad ENOENT' };
    const key = `${bin} ${args.join(' ')}`;
    for (const [needle, res] of map) if (key.includes(needle)) return res;
    return { code: 0, stdout: '', stderr: '' };
  };
  exec.calls = calls;
  return exec;
}

test('run() returns stdout on success', async () => {
  const cli = makeRadCli({ exec: fakeExec([['self', { code: 0, stdout: 'DID did:key:z6Mkabc\n', stderr: '' }]]) });
  const out = await cli.run(['self']);
  assert.match(out, /did:key:z6Mkabc/);
});

test('run() throws WriteUnavailableError when rad is not installed', async () => {
  const cli = makeRadCli({ exec: fakeExec([], { throwOnSpawn: true }) });
  await assert.rejects(() => cli.run(['self']), (e) => {
    assert.ok(e instanceof WriteUnavailableError);
    assert.match(e.hint || '', /install rad|node/i);
    return true;
  });
});

test('run() throws WriteUnavailableError when the node is unreachable', async () => {
  const cli = makeRadCli({ exec: fakeExec([['sync', { code: 1, stdout: '', stderr: 'error: node is not running' }]]) });
  await assert.rejects(() => cli.run(['sync']), (e) => e instanceof WriteUnavailableError);
});

test('run() throws a plain Error on other non-zero exits', async () => {
  const cli = makeRadCli({ exec: fakeExec([['patch', { code: 1, stdout: '', stderr: 'error: bad usage' }]]) });
  await assert.rejects(() => cli.run(['patch']), (e) => !(e instanceof WriteUnavailableError) && e instanceof Error);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd packages/rad-org-os && node --test test/rad-cli.test.mjs`
Expected: FAIL — `rad-cli.mjs` doesn't exist.

- [ ] **Step 4: Write `rad-cli.mjs`**

`packages/rad-org-os/src/rad-cli.mjs`:
```js
import { spawn } from 'node:child_process';
import { WriteUnavailableError } from '../../org-os-host/src/errors.mjs';

// Detect the two "the operator's own node can't take this write" conditions the
// spec says must fail loudly with actionable guidance (never a silent HTTP fallback).
function nodeDown(stderr) {
  return /node is not running|connection refused|failed to connect|no such file|not running/i.test(stderr || '');
}
function radMissing(res) {
  return res.code === -1 || /ENOENT|command not found|not found/i.test(res.stderr || '');
}

export function makeRadCli({ exec = defaultExec(), cwd = '.' } = {}) {
  async function run(args, { input } = {}) {
    const res = await exec('rad', args, { input, cwd });
    if (radMissing(res)) {
      throw new WriteUnavailableError('rad CLI is not available', { hint: 'install rad: curl -sSf https://radicle.dev/install | sh' });
    }
    if (res.code !== 0 && nodeDown(res.stderr)) {
      throw new WriteUnavailableError('the local Radicle node is not reachable', { hint: 'start your node: rad node start' });
    }
    if (res.code !== 0) {
      throw new Error(`rad ${args.join(' ')} failed: ${res.stderr.trim() || `exit ${res.code}`}`);
    }
    return res.stdout;
  }
  return { run };
}

function defaultExec() {
  return (bin, args, { input, cwd = '.' } = {}) =>
    new Promise((resolve) => {
      const child = spawn(bin, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));
      child.on('close', (code) => resolve({ code, stdout, stderr }));
      child.on('error', (err) => resolve({ code: -1, stdout, stderr: String(err.message || err) }));
      child.stdin.end(input ?? '');
    });
}
```

- [ ] **Step 5: Run rad-cli tests to verify pass**

Run: `cd packages/rad-org-os && node --test test/rad-cli.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/rad-org-os/src/rad-cli.mjs packages/rad-org-os/test/rad-cli.test.mjs packages/rad-org-os/test/fixtures/rad-self.txt packages/rad-org-os/test/fixtures/rad-patch-open.txt packages/rad-org-os/test/fixtures/rad-issue-open.txt
git commit -m "feat(rad): rad CLI write chokepoint with fail-loudly node/missing detection"
```

---

### Task 4: `identity.mjs` — did:key, delegates, threshold

**Files:**
- Create: `packages/rad-org-os/src/identity.mjs`; extend `src/parse.mjs` with `parseRadSelf`
- Test: `packages/rad-org-os/test/identity.test.mjs`; extend `test/parse.test.mjs`

- [ ] **Step 1: Add a failing `parseRadSelf` test**

Append to `packages/rad-org-os/test/parse.test.mjs`:
```js
import { parseRadSelf } from '../src/parse.mjs';

test('parseRadSelf extracts the did:key from rad self output', () => {
  const out = 'DID    did:key:z6MkfuXgBSe5G8U6d5NuVbvrbuXRwzYjKJWPPddXgbVjqT9n\nNode ID (NID)   z6MkfuXg...\n';
  const id = parseRadSelf(out);
  assert.equal(id.did, 'did:key:z6MkfuXgBSe5G8U6d5NuVbvrbuXRwzYjKJWPPddXgbVjqT9n');
});

test('parseRadSelf returns null did when absent', () => {
  assert.equal(parseRadSelf('nothing here').did, null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/rad-org-os && node --test test/parse.test.mjs`
Expected: FAIL — `parseRadSelf` not exported.

- [ ] **Step 3: Add `parseRadSelf` to `parse.mjs`**

Append to `packages/rad-org-os/src/parse.mjs`:
```js
// `rad self` prints a "DID  did:key:z6Mk..." line among others.
export function parseRadSelf(stdout) {
  const m = /did:key:z6[1-9A-HJ-NP-Za-km-z]+/.exec(stdout || '');
  return { did: m ? m[0] : null };
}
```

- [ ] **Step 4: Run to verify parse tests pass**

Run: `cd packages/rad-org-os && node --test test/parse.test.mjs`
Expected: PASS.

- [ ] **Step 5: Write failing identity tests**

`packages/rad-org-os/test/identity.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeIdentity } from '../src/identity.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = JSON.parse(readFileSync(join(here, 'fixtures/repo.json'), 'utf8'));

test('whoami parses the local did from rad self', async () => {
  const radCli = { run: async (args) => (args[0] === 'self' ? 'DID did:key:z6MkLOCALxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n' : '') };
  const id = makeIdentity({ radCli });
  const me = await id.whoami();
  assert.match(me.id, /^did:key:z6Mk/);
  assert.equal(me.did, me.id);
});

test('delegatesOf reads delegates + threshold from the httpd repo doc', async () => {
  const httpd = { getRepo: async () => ({ delegates: repo.delegates.map((d) => ({ id: d.id, alias: d.alias })), threshold: repo.threshold }) };
  const id = makeIdentity({ httpd });
  const gov = await id.delegatesOf('rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5');
  assert.ok(Array.isArray(gov.delegates));
  assert.equal(typeof gov.threshold, 'number');
  assert.ok(gov.delegates.every((d) => d.id.startsWith('did:key:')));
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd packages/rad-org-os && node --test test/identity.test.mjs`
Expected: FAIL — `identity.mjs` doesn't exist.

- [ ] **Step 7: Write `identity.mjs`**

`packages/rad-org-os/src/identity.mjs`:
```js
import { parseRadSelf } from './parse.mjs';

// did:key identity + the delegate/threshold governance model. Reads come from httpd
// (the repo's identity doc); the local operator's own did comes from `rad self`.
export function makeIdentity({ radCli, httpd } = {}) {
  return {
    async whoami() {
      if (!radCli) return { id: null, did: null };
      const out = await radCli.run(['self']);
      const { did } = parseRadSelf(out);
      return { id: did, did };
    },
    async delegatesOf(rid) {
      const repo = await httpd.getRepo(rid);
      if (!repo) return { delegates: [], threshold: 1 };
      return { delegates: repo.delegates, threshold: repo.threshold };
    },
    // write ops (add a delegate / set threshold) go through rad id — fail loudly via radCli.
    async addDelegate(rid, did) {
      return radCli.run(['id', 'update', '--repo', rid, '--delegate', did]);
    },
    async setThreshold(rid, n) {
      return radCli.run(['id', 'update', '--repo', rid, '--threshold', String(n)]);
    },
  };
}
```
Note: `rad id update` flag names are pinned in Task 9 against a live `rad` (the read paths above are fully fixture-verified; these two write helpers are exercised by the integration task). If Task 9 finds different flags, correct them there.

- [ ] **Step 8: Run identity tests to verify pass**

Run: `cd packages/rad-org-os && node --test test/identity.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 9: Commit**

```bash
git add packages/rad-org-os/src/identity.mjs packages/rad-org-os/src/parse.mjs packages/rad-org-os/test/identity.test.mjs packages/rad-org-os/test/parse.test.mjs
git commit -m "feat(rad): did:key identity + delegate/threshold governance reads"
```

---

### Task 5: `cob.mjs` — issue/patch COB ↔ org-os record mapping

**Files:**
- Create: `packages/rad-org-os/src/cob.mjs`
- Test: `packages/rad-org-os/test/cob.test.mjs`

Maps `xyz.radicle.issue` / `xyz.radicle.patch` COBs to org-os records, preserving the COB OID in `source_lineage`. Reads list COBs via httpd; writes create them via `rad issue`/`rad patch`.

- [ ] **Step 1: Write failing cob tests**

`packages/rad-org-os/test/cob.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueCobToRecord, patchCobToRecord, parsePatchId, parseIssueId } from '../src/cob.mjs';

test('issueCobToRecord maps to an org-os record preserving the COB oid', () => {
  const cob = { id: 'aabbccddeeff00112233445566778899aabbccdd', title: 'Broken sync', state: { status: 'open' }, author: { id: 'did:key:z6Mkxxx' } };
  const rec = issueCobToRecord(cob);
  assert.equal(rec.kind, 'issue');
  assert.equal(rec.title, 'Broken sync');
  assert.equal(rec.status, 'open');
  assert.equal(rec.source_lineage.cob_oid, cob.id);
  assert.equal(rec.source_lineage.type, 'xyz.radicle.issue');
});

test('patchCobToRecord maps a patch COB to a change record', () => {
  const cob = { id: '0011223344556677889900112233445566778899', title: 'Add feature', state: { status: 'open' } };
  const rec = patchCobToRecord(cob);
  assert.equal(rec.kind, 'change');
  assert.equal(rec.source_lineage.type, 'xyz.radicle.patch');
});

test('parsePatchId / parseIssueId extract the COB oid from rad stdout', () => {
  assert.equal(parsePatchId('✓ Patch 0a1b2c3d4e5f60718293a4b5c6d7e8f901234567 opened'), '0a1b2c3d4e5f60718293a4b5c6d7e8f901234567');
  assert.equal(parseIssueId('✓ Issue 1122334455667788990011223344556677889900 opened'), '1122334455667788990011223344556677889900');
  assert.equal(parsePatchId('no id here'), null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/rad-org-os && node --test test/cob.test.mjs`
Expected: FAIL — `cob.mjs` doesn't exist.

- [ ] **Step 3: Write `cob.mjs`**

`packages/rad-org-os/src/cob.mjs`:
```js
// COB <-> org-os record mapping. Preserves the COB oid in source_lineage so
// provenance survives round-trips (spec). Distinct from the KMS ingestion connector.
const HEX40 = /[0-9a-f]{40}/;

export function issueCobToRecord(cob) {
  return {
    kind: 'issue',
    title: cob.title || '',
    status: cob.state?.status || 'open',
    author: cob.author?.id || null,
    source_lineage: { type: 'xyz.radicle.issue', cob_oid: cob.id },
  };
}

export function patchCobToRecord(cob) {
  return {
    kind: 'change',
    title: cob.title || '',
    status: cob.state?.status || 'open',
    source_lineage: { type: 'xyz.radicle.patch', cob_oid: cob.id },
  };
}

export function parsePatchId(stdout) {
  const m = HEX40.exec(stdout || '');
  return m ? m[0] : null;
}
export const parseIssueId = parsePatchId; // same shape: "✓ <Type> <oid> opened"
```

- [ ] **Step 4: Run cob tests to verify pass**

Run: `cd packages/rad-org-os && node --test test/cob.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/rad-org-os/src/cob.mjs packages/rad-org-os/test/cob.test.mjs
git commit -m "feat(rad): COB <-> org-os record mapping (issue/patch) with lineage"
```

---

### Task 6: `driver.mjs` — compose into the `HostDriver` contract

**Files:**
- Create: `packages/rad-org-os/src/driver.mjs`
- Test: `packages/rad-org-os/test/driver.test.mjs`

Composes `httpd` (reads), `radCli` (writes), `identity`, and `cob` into the 13-method `HostDriver`, and must pass Plan 1's `runHostDriverContract`.

- [ ] **Step 1: Write the failing driver + contract test**

`packages/rad-org-os/test/driver.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeRadicleDriver } from '../src/driver.mjs';
import { runHostDriverContract } from '../../org-os-host/test/contract.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = readFileSync(join(here, 'fixtures/repo.json'), 'utf8');
const blob = readFileSync(join(here, 'fixtures/blob.json'), 'utf8');
const RID = 'rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5';

function fakeFetch() {
  const parsed = JSON.parse(repo);
  const head = parsed.payloads['xyz.radicle.project'].meta.head
    || Object.values(parsed.payloads['xyz.radicle.project'].meta).find((v) => /^[0-9a-f]{40}$/.test(v));
  return async (url) => {
    if (url.includes(`/blob/${head}/README.md`)) return { ok: true, json: async () => JSON.parse(blob) };
    if (url.includes(`/repos/${RID}`)) return { ok: true, json: async () => parsed };
    return { ok: false, json: async () => ({}) };
  };
}
// fake exec: writes succeed with a parseable id line; reads not used here.
const fakeExec = async (bin, args) => {
  const key = args.join(' ');
  if (bin === 'git' && key.includes('refs/patches')) {
    // patch-open prints the new patch id on stderr in real rad
    return { code: 0, stdout: '', stderr: '✓ Patch 0a1b2c3d4e5f60718293a4b5c6d7e8f901234567 opened\n' };
  }
  if (key.includes('self')) return { code: 0, stdout: 'DID did:key:z6MkLOCALxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n', stderr: '' };
  if (key.includes('issue')) return { code: 0, stdout: '✓ Issue 1122334455667788990011223344556677889900 opened\n', stderr: '' };
  return { code: 0, stdout: '', stderr: '' };
};

function makeDriver() {
  return makeRadicleDriver({ seed: 'https://seed.example', fetchFn: fakeFetch(), exec: fakeExec });
}

test('radicle driver satisfies the HostDriver contract', async () => {
  await runHostDriverContract(makeDriver, { assert });
});

test('resolveRemote reports scheme radicle for a rad: id', () => {
  assert.equal(makeDriver().resolveRemote(RID).scheme, 'radicle');
});

test('getCanonical returns delegates + threshold from the repo doc', async () => {
  const c = await makeDriver().getCanonical(RID);
  assert.equal(c.defaultBranch, 'master');
  assert.ok(c.threshold >= 1);
  assert.ok(Array.isArray(c.delegates) && c.delegates.length > 0);
});

test('whoami returns the local did:key (real identity, not null)', async () => {
  const me = await makeDriver().whoami();
  assert.match(me.id, /^did:key:z6Mk/);
});

test('openChange returns the patch COB id', async () => {
  const ref = await makeDriver().openChange({ title: 'T', body: 'B', base: 'master' });
  assert.equal(ref.id, '0a1b2c3d4e5f60718293a4b5c6d7e8f901234567');
  assert.equal(ref.ok, true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/rad-org-os && node --test test/driver.test.mjs`
Expected: FAIL — `driver.mjs` doesn't exist.

- [ ] **Step 3: Write `driver.mjs`**

`packages/rad-org-os/src/driver.mjs`:
```js
import { makeHttpd } from './httpd.mjs';
import { makeRadCli } from './rad-cli.mjs';
import { makeIdentity } from './identity.mjs';
import { parsePatchId, parseIssueId } from './cob.mjs';
import { WriteUnavailableError } from '../../org-os-host/src/errors.mjs';

// The radicle HostDriver. Reads via httpd (degrade to null/[]), writes via rad CLI
// (fail loudly through radCli). Accepts injected fetchFn/exec for testing; in
// production makeHttpd/makeRadCli supply real fetch/spawn.
export function makeRadicleDriver({ seed, fetchFn, exec, cwd = '.' } = {}) {
  const httpd = makeHttpd({ seed, fetchFn });
  const radCli = makeRadCli({ exec, cwd });
  const identity = makeIdentity({ radCli, httpd });
  // Patches are git pushes to refs/patches (there is no `rad patch open`), so the
  // driver needs raw git access alongside the rad CLI. Reuse the same injected exec.
  const git = (args) => (exec || (() => ({ code: 0, stdout: '', stderr: '' })))('git', args, { cwd });

  return {
    resolveRemote(idOrUrl) {
      const isRad = typeof idOrUrl === 'string' && idOrUrl.startsWith('rad:');
      return { scheme: isRad ? 'radicle' : 'github', fetchUrl: idOrUrl, canonical: isRad };
    },
    whoami: () => identity.whoami(),

    // ---- read path (httpd; degrade, never throw) ----
    async clone(rid, dest) {
      const out = await radCli.run(['clone', ridOf(rid), dest]).catch((e) => ({ __err: e }));
      if (out && out.__err) return { ok: false, error: String(out.__err.message) };
      return { ok: true, error: null };
    },
    fetchFile: (rid, path, ref) => httpd.fetchFile(ridOf(rid), path, ref),
    async listPeers(rid) {
      const { delegates } = await identity.delegatesOf(ridOf(rid));
      return delegates;
    },
    async getCanonical(rid) {
      const repo = await httpd.getRepo(ridOf(rid));
      if (!repo) return { defaultBranch: 'main', threshold: 1, delegates: [] };
      return { defaultBranch: repo.defaultBranch, threshold: repo.threshold, delegates: repo.delegates };
    },
    async getDrift(rid) {
      // Local git drift vs the canonical branch; radicle repos are normal git repos.
      const repo = await httpd.getRepo(ridOf(rid));
      const canonicalRef = repo?.defaultBranch || 'main';
      return { behind: 0, ahead: 0, canonicalRef }; // refined against a working copy in Plan 4's /sync wiring
    },

    // ---- write path (rad CLI; fail loudly) ----
    async push({ branch } = {}) {
      await radCli.run(['sync', '--announce']);
      return { ok: true, error: null };
    },
    // A patch IS a git push to refs/patches (verified: rad 1.8.0 has no `rad patch open`).
    // The subject/body are carried as `-o patch.message=` push options; the new patch
    // id is printed on the push's stderr ("✓ Patch <oid> opened" / hint line).
    async openChange({ title, body = '', base = 'main' } = {}) {
      const opts = ['-o', `patch.message=${title}`, ...(body ? ['-o', `patch.message=${body}`] : [])];
      const res = await git(['push', 'rad', 'HEAD:refs/patches', ...opts]);
      if (res.code !== 0) {
        if (/node is not running|connection refused|not running/i.test(res.stderr || '')) {
          throw new WriteUnavailableError('the local Radicle node is not reachable', { hint: 'start your node: rad node start' });
        }
        return { id: null, ok: false, error: (res.stderr || '').trim() };
      }
      return { id: parsePatchId(`${res.stdout}\n${res.stderr}`), ok: true, error: null };
    },
    async createIssue({ title, body = '' } = {}) {
      const out = await radCli.run(['issue', 'open', '--title', title, '--description', body]);
      return { id: parseIssueId(out), ok: true, error: null };
    },
    async commentIssue({ id, body } = {}) {
      await radCli.run(['issue', 'comment', id, '--message', body]);
      return { ok: true, error: null };
    },
    async syncUpstream() {
      await radCli.run(['sync']);
      return { ok: true, error: null };
    },
    webUrl(rid, path, ref = '') {
      const r = ridOf(rid);
      return `https://app.radicle.xyz/nodes/seed.radicle.xyz/${r}/tree/${ref || 'HEAD'}/${path}`;
    },
  };
}

function ridOf(x) {
  if (typeof x === 'string') return x;
  return x?.rid || x?.repo || x?.id || '';
}
```
Note: patch-open (`git push rad HEAD:refs/patches -o patch.message=…`) and `rad issue open --title/--description` are **verified against live rad 1.8.0** (see the verified-facts block above). The only write surface still needing a running-node round-trip is `rad id update` (identity edits in `identity.mjs`), pinned in Task 9. The contract test's fake exec keys on `refs/patches`/`issue`/`self`, robust to exact flag details.

- [ ] **Step 4: Run driver tests to verify pass**

Run: `cd packages/rad-org-os && node --test test/driver.test.mjs`
Expected: PASS (5 tests, including the contract suite).

- [ ] **Step 5: Commit**

```bash
git add packages/rad-org-os/src/driver.mjs packages/rad-org-os/test/driver.test.mjs
git commit -m "feat(rad): radicle HostDriver composing httpd reads + rad-cli writes; passes contract"
```

---

### Task 7: Register the `radicle` driver into `@org-os/host`

**Files:**
- Modify: `packages/rad-org-os/src/index.mjs`
- Test: `packages/rad-org-os/test/register.test.mjs`

- [ ] **Step 1: Write the failing registration test**

`packages/rad-org-os/test/register.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './../src/index.mjs'; // side effect: registers 'radicle'
import { resolveDriver } from '../../org-os-host/src/index.mjs';

test('radicle driver resolves via platforms.canonical=radicle', () => {
  const d = resolveDriver({ platforms: { canonical: 'radicle' }, seed: 'https://seed.example' });
  assert.equal(typeof d.fetchFile, 'function');
  assert.equal(d.resolveRemote('rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5').scheme, 'radicle');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/rad-org-os && node --test test/register.test.mjs`
Expected: FAIL — index stub doesn't register anything.

- [ ] **Step 3: Replace `index.mjs` to register the driver**

`packages/rad-org-os/src/index.mjs`:
```js
import { registerDriver } from '../../org-os-host/src/index.mjs';
import { makeRadicleDriver } from './driver.mjs';

// Register the radicle driver. config carries platforms.seed_node (the org's httpd
// endpoint); fall back to a public seed for reads only. Writes still require a local rad.
registerDriver('radicle', (config = {}) =>
  makeRadicleDriver({
    seed: config.seed || config.platforms?.seed_node || 'https://seed.radicle.xyz',
    fetchFn: config.fetchFn,
    exec: config.exec,
    cwd: config.cwd || '.',
  }));

export { makeRadicleDriver };
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/rad-org-os && node --test test/register.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the full `@org-os/rad` suite**

Run: `cd packages/rad-org-os && npm test`
Expected: PASS — smoke, parse, httpd, rad-cli, identity, cob, driver, register (integration test is gated off by default; see Task 9).

- [ ] **Step 6: Commit**

```bash
git add packages/rad-org-os/src/index.mjs packages/rad-org-os/test/register.test.mjs
git commit -m "feat(rad): register radicle driver into @org-os/host"
```

---

### Task 8: Resolve the Plan-2 prerequisites in `@org-os/host` + frontier

**Files:**
- Modify: `packages/org-os-host/src/github/driver.mjs` (resolveRemote rad guard; uniform cwd)
- Modify: `packages/org-os-kms/src/frontier.mjs` (per-entry driver selection)
- Test: extend `packages/org-os-host/test/github-driver.test.mjs`, `packages/org-os-kms/test/frontier.test.mjs`

Addresses roadmap "Plan 2 prerequisites" items 1, 2, 5 (items 3 and 4 are satisfied by this plan's `fetchFile` ref handling and real `whoami`; add doc comments for them).

- [ ] **Step 1: Write failing tests for the github guard + per-entry routing**

Append to `packages/org-os-host/test/github-driver.test.mjs`:
```js
test('github resolveRemote flags a rad: id as not-mine (scheme radicle, no github URL)', () => {
  const d = makeGithubDriver({ exec: fakeExec([]) });
  const r = d.resolveRemote('rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5');
  assert.equal(r.scheme, 'radicle');
  assert.equal(r.canonical, false);
  assert.equal(r.fetchUrl, null);
});
```

Append to `packages/org-os-kms/test/frontier.test.mjs` (a peer addressed only by `rid` must route to the radicle driver, not silently degrade). This test registers a fake radicle driver:
```js
import { registerDriver } from '../../org-os-host/src/index.mjs';

test('frontier routes a rid-only peer to the radicle driver (per-entry scheme)', async () => {
  registerDriver('radicle', () => ({
    resolveRemote: (x) => ({ scheme: 'radicle', fetchUrl: x, canonical: true }),
    whoami: () => ({ id: null }), clone: async () => ({ ok: true }),
    fetchFile: async (_e, p) => (p === 'federation.yaml' ? 'name: rad-peer\npeers: []\n' : null),
    listPeers: async () => [], getCanonical: async () => ({ defaultBranch: 'main', threshold: 1, delegates: [] }),
    getDrift: async () => ({ behind: 0, ahead: 0, canonicalRef: 'main' }),
    push: async () => ({ ok: true }), openChange: async () => ({ id: 'x', ok: true }),
    createIssue: async () => ({ id: 'y', ok: true }), commentIssue: async () => ({ ok: true }),
    syncUpstream: async () => ({ ok: true }), webUrl: (_e, p) => `rad://${p}`,
  }));
  // scratch dir with a rid-only peer, github-canonical hub:
  const dir = mkdtempSync(join(tmpdir(), 'frontier-rad-'));
  writeFileSync(join(dir, 'federation.yaml'), 'platforms:\n  canonical: github\npeers:\n  - id: rad-peer\n    rid: rad:zAbC\n');
  const res = await fetchFrontier({ dir });
  assert.equal(res.ok, true);
  assert.ok(existsSync(join(dir, 'data', 'federation', 'frontier', 'rad-peer.json')));
});
```
(Reuse the existing top-of-file imports for `mkdtempSync`, `writeFileSync`, `existsSync`, `join`, `tmpdir`; add any missing.)

- [ ] **Step 2: Run to verify both fail**

Run: `cd packages/org-os-host && node --test test/github-driver.test.mjs` (the rad-guard test fails — current `resolveRemote` returns scheme github), and `cd packages/org-os-kms && node --test test/frontier.test.mjs` (the rid-only test fails — frontier picks the hub's github driver, whose `fetchFile` returns null for a rid-only entry → `unreached`).
Expected: both FAIL.

- [ ] **Step 3: Guard `rad:` in github `resolveRemote`**

In `packages/org-os-host/src/github/driver.mjs`, change `resolveRemote` to:
```js
    resolveRemote(idOrUrl) {
      if (typeof idOrUrl === 'string' && idOrUrl.startsWith('rad:')) {
        return { scheme: 'radicle', fetchUrl: null, canonical: false }; // not a github remote
      }
      const slug = repoSlug(idOrUrl);
      return { scheme: 'github', fetchUrl: slug ? `https://github.com/${slug}` : null, canonical: true };
    },
```

- [ ] **Step 4: Per-entry driver selection in frontier**

In `packages/org-os-kms/src/frontier.mjs`, replace `resolveDriver(fed, { fetchFn })` with per-entry selection by the peer's scheme. Add the import:
```js
import { resolveDriver, resolveRemoteScheme } from '../../org-os-host/src/index.mjs';
```
and in the remote branch:
```js
      } else if (entry.repo || entry.rid) {
        const scheme = resolveRemoteScheme(entry.rid || entry.repo);
        // select the driver for THIS peer's scheme, not the hub's canonical
        const driver = resolveDriver({ platforms: { canonical: scheme } }, { fetchFn, seed: fed?.platforms?.seed_node });
        const text = await driver.fetchFile(entry, 'federation.yaml');
        if (text != null) { manifest = yaml.load(text); source = scheme; }
      }
```
(`resolveRemoteScheme` returns `'radicle'` for `rad:` ids, else `'github'`.)

- [ ] **Step 5: Add doc comments for prerequisites 3 & 4**

In `packages/rad-org-os/src/httpd.mjs` `fetchFile`, add a comment: `// ref is a commit SHA; when omitted we use the canonical head. (Radicle has no working-tree ambiguity — httpd always serves a committed blob.)` — documenting that the radicle `fetchFile` always honors a ref (unlike the github driver's local_path shortcut). In `driver.mjs` `whoami`, confirm the comment notes it returns the node's real did:key.

- [ ] **Step 6: Run both suites to verify pass**

Run: `cd packages/org-os-host && npm test` (expect all pass, +1 test) and `cd packages/org-os-kms && npm test` (expect all pass, +1 test; the pre-existing github-peer frontier tests still green — the per-entry selection returns the same github driver for `repo`-addressed peers).
Expected: both PASS, no regressions.

- [ ] **Step 7: Commit**

```bash
git add packages/org-os-host/src/github/driver.mjs packages/org-os-host/test/github-driver.test.mjs packages/org-os-kms/src/frontier.mjs packages/org-os-kms/test/frontier.test.mjs packages/rad-org-os/src/httpd.mjs packages/rad-org-os/src/driver.mjs
git commit -m "feat(rad): per-entry frontier routing by peer scheme; github guards rad: ids"
```

---

### Task 9: Integration test against a live node + register in packages matrix

**Files:**
- Create: `packages/rad-org-os/test/integration.test.mjs`
- Modify: `data/packages-matrix.yaml`

- [ ] **Step 1: Write a gated integration test**

`packages/rad-org-os/test/integration.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHttpd } from '../src/httpd.mjs';

// Gated: only runs when RAD_INTEGRATION=1 (needs network / a reachable seed).
// Read-path integration hits the public seed; write-path pinning is a manual
// checklist below because it mutates a scratch repo.
const run = process.env.RAD_INTEGRATION === '1' ? test : test.skip;
const RID = 'rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5';

run('live: getRepo against the public seed returns heartwood governance', async () => {
  const h = makeHttpd({ seed: 'https://seed.radicle.xyz' });
  const r = await h.getRepo(RID);
  assert.equal(r.name, 'heartwood');
  assert.ok(r.delegates.length >= 1);
  assert.ok(/^[0-9a-f]{40}$/.test(r.head));
});

run('live: fetchFile reads README.md content over httpd', async () => {
  const h = makeHttpd({ seed: 'https://seed.radicle.xyz' });
  const text = await h.fetchFile(RID, 'README.md');
  assert.ok(typeof text === 'string' && text.length > 0);
});
```

Add a checklist comment at the bottom for write-path verification against a local `rad` (to pin flag names used in `driver.mjs`/`identity.mjs`): capture `rad patch open --help`, `rad issue open --help`, `rad id update --help`, and `rad self`; confirm `--message`/`--title`/`--description`/`--delegate`/`--threshold` and the "✓ Patch <oid> opened" stdout; correct `driver.mjs`/`identity.mjs` + the fixtures if reality differs, then remove the `@needs-live-verification` markers.

- [ ] **Step 2: Run gated test both ways**

Run (skipped path): `cd packages/rad-org-os && npm test` → integration tests report as skipped, everything else passes.
Run (live path, if network available): `RAD_INTEGRATION=1 node --test test/integration.test.mjs` → the two read tests pass against the public seed.

- [ ] **Step 3: Register `@org-os/rad` in the packages matrix**

Inspect the matrix schema first: `sed -n '1,40p' data/packages-matrix.yaml` (real fields are `id, owner, instances_using, in_framework, promotion_status, lifecycle_status, notes` — no `name/path/workstream`; allowed `lifecycle_status` ∈ `active, dormant, planned, retired`). Add:
```yaml
  - id: "rad-org-os"
    owner: "framework"
    instances_using: []
    in_framework: true
    promotion_status: "canonical"
    lifecycle_status: "active"
    notes: "@org-os/rad (packages/rad-org-os) — Radicle driver for @org-os/host: radicle-httpd reads + rad CLI writes (fail-loudly), did:key identity, COB issue/patch mapping. Passes the HostDriver contract. Write-flag pinning + bootstrap/seed-node in Plans 3-4."
```

- [ ] **Step 4: Validate structure + run everything**

Run: `cd "$(git rev-parse --show-toplevel)" && npm run validate:structure` → `0 failed`.
Run: `cd packages/rad-org-os && npm test` and `cd packages/org-os-host && npm test` and `cd packages/org-os-kms && npm test` → all green.

- [ ] **Step 5: Commit (structural file → operator trunk / PR to main per /commit)**

```bash
git add packages/rad-org-os/test/integration.test.mjs data/packages-matrix.yaml
git commit -m "test(rad): gated live integration + register @org-os/rad in packages matrix"
```

---

## Self-review

**Spec coverage:** spec "radicle driver internals" → `rad-cli.mjs` (Task 3), `httpd.mjs` (Task 2), `cob.mjs` (Task 5), `identity.mjs` (Task 4), composed driver passing the contract (Task 6), registration + fail-loudly writes (Tasks 3,7); "writes fail loudly, never HTTP fallback" → Task 3's `WriteUnavailableError` on rad-missing/node-down + the contract's fail-loudly assertion (Plan 1). Roadmap Plan-2 prerequisites → Task 8 (items 1,2,5) + Task 5/6 doc comments (items 3,4). Deferred correctly: `crefs` governance writes, command routing, bootstrap, seed-node → Plans 3-4.

**Placeholder scan:** read-path code is complete and pinned to the live API shapes; write-path flag names are the documented forms with an explicit Task-9 live-pinning step and `@needs-live-verification` fixture markers — a named verification step, not a vague TBD. Every test step has runnable commands + expected results.

**Type/name consistency:** `makeHttpd`, `makeRadCli`, `makeIdentity`, `makeRadicleDriver`, `parseRepoDoc`, `parseBlob`, `parseRadSelf`, `parsePatchId`, `parseIssueId`, `issueCobToRecord`, `patchCobToRecord` are used identically across tasks. The driver returns the same write-shapes the Plan 1 contract asserts (`{ok, error}` / `{id, ok, error}`), verified by `runHostDriverContract` in Task 6. `fetchFile(rid, path, ref)`, `getCanonical→{defaultBranch,threshold,delegates}`, `getDrift→{behind,ahead,canonicalRef}` match the interface and the github driver's shapes. `ridOf()` normalizes entry|string inputs consistently.

**Known live-verification debt (tracked, not hidden):** `rad` subcommand flag names in `driver.mjs`/`identity.mjs` and the exact `rad ... opened` stdout are pinned in Task 9 against a real `rad`; the head-SHA key under `payloads["xyz.radicle.project"].meta` is confirmed when capturing the fixture in Task 1. All are isolated behind pure parsers/fixtures so a correction is a one-line change, not a redesign.
