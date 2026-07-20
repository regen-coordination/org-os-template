# rad-org-os Plan 1 — Host Abstraction Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a `@org-os/host` package with a `HostDriver` interface, a driver registry + resolver keyed on `federation.yaml → platforms.canonical`, a behavior-preserving `github` driver, a reusable driver-contract test suite, and route `frontier.mjs` through the seam — with the GitHub cohort's behavior unchanged.

**Architecture:** One new package defines an interface that every git/gh/raw-GitHub call site will eventually call. Two drivers implement it (this plan builds `github`; Plan 2 builds `radicle`). A resolver picks the driver from `platforms.canonical` (default `github`). The interface bakes in the read/write split the Radicle research forces (reads may degrade; writes go through a single injected executor). A reusable contract suite lets both drivers be tested against the same behavioral spec.

**Tech Stack:** Node.js ESM (`.mjs`), built-in `node:test` + `node:assert/strict`, `js-yaml` (already a dependency), `child_process` for git/gh, `globalThis.fetch` for HTTP. No new runtime dependencies.

**Spec:** [`docs/superpowers/specs/2026-07-20-rad-org-os-design.md`](../specs/2026-07-20-rad-org-os-design.md) — see "Architecture → The host-provider seam" and the `HostDriver` interface.

**Conventions (verified in-repo):** packages live under `packages/<name>/`; `package.json` has `"type": "module"` and `"scripts": { "test": "node --test" }`; tests live in `packages/<name>/test/*.test.mjs` and import from `../src/*.mjs`; assertions use `node:assert/strict`.

---

## File structure

```
packages/org-os-host/
  package.json                 # @org-os/host — type: module, test: node --test
  README.md                    # one-paragraph purpose
  src/
    driver.mjs                 # HostDriver method list + registry + assertDriver()
    resolve.mjs                # resolveDriver(config) + resolveRemoteScheme(idOrUrl)
    errors.mjs                 # WriteUnavailableError + NotImplementedError typed errors
    github/
      exec.mjs                 # execGit()/execGh() — the single shell chokepoint (injectable)
      driver.mjs               # makeGithubDriver({ exec, fetchFn }) — implements HostDriver
    index.mjs                  # registers 'github'; re-exports resolveDriver, registry
  test/
    driver.test.mjs            # registry + assertDriver
    resolve.test.mjs           # driver selection + scheme detection
    contract.mjs               # runHostDriverContract(makeDriver) — reusable, driver-agnostic
    github-driver.test.mjs     # github read+write methods (mock exec/fetch) + runs contract
```

Modified outside the package:
- `packages/org-os-kms/src/frontier.mjs` — route the remote federation.yaml fetch through `resolveDriver(...).fetchFile()`.
- `data/packages-matrix.yaml` — add the `@org-os/host` entry (structural file; PR-gated).

---

### Task 1: Scaffold the `@org-os/host` package

**Files:**
- Create: `packages/org-os-host/package.json`
- Create: `packages/org-os-host/README.md`
- Create: `packages/org-os-host/src/index.mjs`
- Test: `packages/org-os-host/test/smoke.test.mjs`

- [ ] **Step 1: Write the failing test**

`packages/org-os-host/test/smoke.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as host from '../src/index.mjs';

test('package exposes resolveDriver and getDriver', () => {
  assert.equal(typeof host.resolveDriver, 'function');
  assert.equal(typeof host.getDriver, 'function');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/org-os-host && node --test test/smoke.test.mjs`
Expected: FAIL — `Cannot find module '../src/index.mjs'`.

- [ ] **Step 3: Create package.json**

`packages/org-os-host/package.json`:
```json
{
  "name": "@org-os/host",
  "version": "0.1.0",
  "type": "module",
  "description": "Host-provider abstraction for org-os: one HostDriver interface, pluggable github/radicle drivers.",
  "main": "src/index.mjs",
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 4: Create README.md**

`packages/org-os-host/README.md`:
```markdown
# @org-os/host

The host-provider seam for org-os. Defines one `HostDriver` interface; every
script/command that touches `git`, `gh`, or `raw.githubusercontent` calls it
instead. Drivers: `github` (this package) and `radicle` (`@org-os/rad`).
`resolveDriver(config)` picks the driver from `federation.yaml → platforms.canonical`.

Reads may degrade (public seed / cache); writes go through a single injected
executor and fail loudly rather than silently — see the spec.
```

- [ ] **Step 5: Create a minimal index.mjs that re-exports the (not-yet-written) registry**

`packages/org-os-host/src/index.mjs`:
```js
export { getDriver, registerDriver, assertDriver, HOST_DRIVER_METHODS } from './driver.mjs';
export { resolveDriver, resolveRemoteScheme } from './resolve.mjs';
```

Note: this import will fail until Tasks 2 and 4 create those modules. That is expected; the smoke test is re-run at the end of Task 4. For now, create empty stubs so the module resolves:

`packages/org-os-host/src/driver.mjs` (temporary stub — replaced in Task 2):
```js
export const HOST_DRIVER_METHODS = [];
export function registerDriver() {}
export function getDriver() {}
export function assertDriver() {}
```

`packages/org-os-host/src/resolve.mjs` (temporary stub — replaced in Task 4):
```js
export function resolveDriver() {}
export function resolveRemoteScheme() {}
```

- [ ] **Step 6: Run the smoke test to verify it passes**

Run: `cd packages/org-os-host && node --test test/smoke.test.mjs`
Expected: PASS (1 test).

- [ ] **Step 7: Commit**

```bash
git add packages/org-os-host/package.json packages/org-os-host/README.md packages/org-os-host/src/index.mjs packages/org-os-host/src/driver.mjs packages/org-os-host/src/resolve.mjs packages/org-os-host/test/smoke.test.mjs
git commit -m "feat(host): scaffold @org-os/host package"
```

---

### Task 2: `HostDriver` method list + driver registry + `assertDriver`

**Files:**
- Modify (replace stub): `packages/org-os-host/src/driver.mjs`
- Create: `packages/org-os-host/src/errors.mjs`
- Test: `packages/org-os-host/test/driver.test.mjs`

- [ ] **Step 1: Write the failing test**

`packages/org-os-host/test/driver.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOST_DRIVER_METHODS, registerDriver, getDriver, assertDriver } from '../src/driver.mjs';

const REQUIRED = [
  'resolveRemote', 'whoami',
  'clone', 'fetchFile', 'listPeers', 'getCanonical', 'getDrift',
  'push', 'openChange', 'createIssue', 'commentIssue', 'syncUpstream', 'webUrl',
];

test('HOST_DRIVER_METHODS lists every contract method', () => {
  assert.deepEqual([...HOST_DRIVER_METHODS].sort(), [...REQUIRED].sort());
});

test('assertDriver passes for a complete driver', () => {
  const complete = Object.fromEntries(REQUIRED.map((m) => [m, () => {}]));
  assert.doesNotThrow(() => assertDriver(complete, 'complete'));
});

test('assertDriver throws listing every missing method', () => {
  const partial = { resolveRemote: () => {}, fetchFile: () => {} };
  assert.throws(() => assertDriver(partial, 'partial'), (err) => {
    assert.match(err.message, /partial/);
    assert.match(err.message, /push/);
    assert.match(err.message, /getCanonical/);
    return true;
  });
});

test('register then get returns the same driver factory result', () => {
  const fake = Object.fromEntries(REQUIRED.map((m) => [m, () => {}]));
  registerDriver('fake', () => fake);
  assert.equal(getDriver('fake', {}), fake);
});

test('getDriver throws for an unknown driver name', () => {
  assert.throws(() => getDriver('nope', {}), /unknown host driver: nope/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/org-os-host && node --test test/driver.test.mjs`
Expected: FAIL — stub `HOST_DRIVER_METHODS` is `[]`, `assertDriver` is a no-op.

- [ ] **Step 3: Create the typed errors module**

`packages/org-os-host/src/errors.mjs`:
```js
// Typed errors so callers can distinguish "the host can't do this write right now"
// (actionable, e.g. start your node) from a generic failure.
export class WriteUnavailableError extends Error {
  constructor(message, { hint } = {}) {
    super(message);
    this.name = 'WriteUnavailableError';
    this.hint = hint || null;
  }
}

export class NotImplementedError extends Error {
  constructor(method) {
    super(`not implemented: ${method}`);
    this.name = 'NotImplementedError';
    this.method = method;
  }
}
```

- [ ] **Step 4: Replace the driver.mjs stub with the real registry**

`packages/org-os-host/src/driver.mjs`:
```js
// The HostDriver contract: the methods every driver must implement. The read/write
// split is intentional — reads (top group) may degrade; writes (bottom group) go
// through the driver's own executor and fail loudly (see the radicle driver, Plan 2).
export const HOST_DRIVER_METHODS = Object.freeze([
  // identity & addressing
  'resolveRemote', 'whoami',
  // read path
  'clone', 'fetchFile', 'listPeers', 'getCanonical', 'getDrift',
  // write path
  'push', 'openChange', 'createIssue', 'commentIssue', 'syncUpstream', 'webUrl',
]);

const REGISTRY = new Map(); // name -> factory(config) -> driver

export function registerDriver(name, factory) {
  if (typeof factory !== 'function') throw new TypeError(`driver factory for "${name}" must be a function`);
  REGISTRY.set(name, factory);
}

export function getDriver(name, config = {}) {
  const factory = REGISTRY.get(name);
  if (!factory) throw new Error(`unknown host driver: ${name}`);
  const driver = factory(config);
  assertDriver(driver, name);
  return driver;
}

export function assertDriver(driver, name = 'driver') {
  const missing = HOST_DRIVER_METHODS.filter((m) => typeof driver?.[m] !== 'function');
  if (missing.length) throw new Error(`host driver "${name}" is missing methods: ${missing.join(', ')}`);
  return driver;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd packages/org-os-host && node --test test/driver.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/org-os-host/src/driver.mjs packages/org-os-host/src/errors.mjs packages/org-os-host/test/driver.test.mjs
git commit -m "feat(host): HostDriver method list, registry, assertDriver, typed errors"
```

---

### Task 3: Driver resolver + remote-scheme detection

**Files:**
- Modify (replace stub): `packages/org-os-host/src/resolve.mjs`
- Test: `packages/org-os-host/test/resolve.test.mjs`

- [ ] **Step 1: Write the failing test**

`packages/org-os-host/test/resolve.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerDriver } from '../src/driver.mjs';
import { resolveDriver, resolveRemoteScheme } from '../src/resolve.mjs';

const REQUIRED = ['resolveRemote','whoami','clone','fetchFile','listPeers','getCanonical','getDrift','push','openChange','createIssue','commentIssue','syncUpstream','webUrl'];
const fakeDriver = (tag) => Object.fromEntries([...REQUIRED.map((m) => [m, () => {}]), ['_tag', () => tag]]);
registerDriver('github', () => fakeDriver('github'));
registerDriver('radicle', () => fakeDriver('radicle'));

test('resolveDriver defaults to github when platforms.canonical is absent', () => {
  const d = resolveDriver({});
  assert.equal(d._tag(), 'github');
});

test('resolveDriver honors platforms.canonical', () => {
  assert.equal(resolveDriver({ platforms: { canonical: 'radicle' } })._tag(), 'radicle');
  assert.equal(resolveDriver({ platforms: { canonical: 'github' } })._tag(), 'github');
});

test('resolveRemoteScheme detects rad: vs github', () => {
  assert.equal(resolveRemoteScheme('rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5'), 'radicle');
  assert.equal(resolveRemoteScheme('https://github.com/regen-coordination/org-os'), 'github');
  assert.equal(resolveRemoteScheme('regen-coordination/org-os'), 'github');
  assert.equal(resolveRemoteScheme(''), 'github'); // default
  assert.equal(resolveRemoteScheme(null), 'github');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/org-os-host && node --test test/resolve.test.mjs`
Expected: FAIL — stub `resolveDriver` returns `undefined`.

- [ ] **Step 3: Replace resolve.mjs with the real resolver**

`packages/org-os-host/src/resolve.mjs`:
```js
import { getDriver } from './driver.mjs';

// Pick the driver for a repo/instance config. `config` is a parsed federation.yaml
// (or any object with an optional platforms.canonical). Defaults to github so every
// existing repo keeps working with no config change.
export function resolveDriver(config = {}, overrides = {}) {
  const canonical = config?.platforms?.canonical || 'github';
  return getDriver(canonical, { ...config, ...overrides });
}

// Detect the addressing scheme of a single remote/id. Radicle RIDs start with "rad:".
export function resolveRemoteScheme(idOrUrl) {
  if (typeof idOrUrl === 'string' && idOrUrl.startsWith('rad:')) return 'radicle';
  return 'github';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/org-os-host && node --test test/resolve.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/org-os-host/src/resolve.mjs packages/org-os-host/test/resolve.test.mjs
git commit -m "feat(host): resolveDriver (by platforms.canonical) + resolveRemoteScheme"
```

---

### Task 4: Reusable driver-contract test suite

**Files:**
- Create: `packages/org-os-host/test/contract.mjs`
- Test (self-check): `packages/org-os-host/test/contract-selfcheck.test.mjs`

This suite is exported (not a `.test.mjs`) so both the `github` driver here and the `radicle` driver in Plan 2 can run the same behavioral contract.

- [ ] **Step 1: Write the failing self-check test**

`packages/org-os-host/test/contract-selfcheck.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runHostDriverContract } from './contract.mjs';
import { assertDriver } from '../src/driver.mjs';

// A minimal in-memory driver that satisfies the contract, used to prove the suite
// itself is correct (green on a compliant driver).
function makeMemoryDriver() {
  return {
    resolveRemote: (id) => ({ scheme: id?.startsWith('rad:') ? 'radicle' : 'github', fetchUrl: id, canonical: true }),
    whoami: () => ({ id: 'github:tester' }),
    clone: async () => ({ ok: true }),
    fetchFile: async (_remote, path) => (path === 'federation.yaml' ? 'name: x' : null),
    listPeers: async () => [],
    getCanonical: async () => ({ defaultBranch: 'main', threshold: 1, delegates: [] }),
    getDrift: async () => ({ behind: 0, ahead: 0, canonicalRef: 'main' }),
    push: async () => ({ ok: true }),
    openChange: async () => ({ id: 'change-1' }),
    createIssue: async () => ({ id: 'issue-1' }),
    commentIssue: async () => ({ ok: true }),
    syncUpstream: async () => ({ ok: true }),
    webUrl: (_remote, path) => `https://example/${path}`,
  };
}

test('contract suite passes for a compliant in-memory driver', async () => {
  assertDriver(makeMemoryDriver(), 'memory');
  await runHostDriverContract(makeMemoryDriver, { assert, test: null });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/org-os-host && node --test test/contract-selfcheck.test.mjs`
Expected: FAIL — `Cannot find module './contract.mjs'`.

- [ ] **Step 3: Write the contract suite**

`packages/org-os-host/test/contract.mjs`:
```js
import { assertDriver, HOST_DRIVER_METHODS } from '../src/driver.mjs';

// Behavioral contract every HostDriver must satisfy. Call with a factory that
// returns a fresh driver. Pass { assert } (node:assert/strict). Driver-agnostic:
// asserts shape + the read/write invariants, not driver-specific command strings.
export async function runHostDriverContract(makeDriver, { assert } = {}) {
  if (!assert) throw new Error('runHostDriverContract requires { assert }');
  const driver = makeDriver();

  // 1. Shape: every contract method is present.
  assertDriver(driver, 'contract');
  for (const m of HOST_DRIVER_METHODS) assert.equal(typeof driver[m], 'function', `missing ${m}`);

  // 2. resolveRemote returns a scheme + canonical flag.
  const r = driver.resolveRemote('rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5');
  assert.ok(r && typeof r === 'object', 'resolveRemote returns an object');
  assert.ok(['github', 'radicle'].includes(r.scheme), 'resolveRemote.scheme is github|radicle');

  // 3. getCanonical shape: { defaultBranch, threshold, delegates }.
  const c = await driver.getCanonical('rad:z');
  assert.equal(typeof c.defaultBranch, 'string');
  assert.equal(typeof c.threshold, 'number');
  assert.ok(Array.isArray(c.delegates));

  // 4. getDrift shape: { behind, ahead, canonicalRef }.
  const d = await driver.getDrift('rad:z');
  assert.equal(typeof d.behind, 'number');
  assert.equal(typeof d.ahead, 'number');
  assert.equal(typeof d.canonicalRef, 'string');

  // 5. fetchFile returns a string or null (never throws for a missing file).
  const f = await driver.fetchFile('rad:z', 'does-not-exist.txt');
  assert.ok(f === null || typeof f === 'string', 'fetchFile returns string|null');

  // 6. webUrl returns a string URL containing the path.
  const url = driver.webUrl('rad:z', 'BOOTSTRAP.md');
  assert.equal(typeof url, 'string');
  assert.match(url, /BOOTSTRAP\.md/);
}
```

- [ ] **Step 4: Run the self-check to verify it passes**

Run: `cd packages/org-os-host && node --test test/contract-selfcheck.test.mjs`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/org-os-host/test/contract.mjs packages/org-os-host/test/contract-selfcheck.test.mjs
git commit -m "test(host): reusable HostDriver contract suite + self-check"
```

---

### Task 5: The git/gh exec chokepoint

**Files:**
- Create: `packages/org-os-host/src/github/exec.mjs`
- Test: covered indirectly in Task 6 (this is thin I/O glue; the driver tests inject a mock in its place). No dedicated test file — see note.

Note: `exec.mjs` is the one place that actually spawns a process. Everything above it is pure and tested with a mock. We do not unit-test the real spawn (it would require git/gh on the runner); instead the driver (Task 6) takes `exec` as an injected dependency, so all logic is tested with a fake.

- [ ] **Step 1: Write the exec chokepoint**

`packages/org-os-host/src/github/exec.mjs`:
```js
import { spawn } from 'node:child_process';

// The single place github logic touches a subprocess. Returns { code, stdout, stderr }.
// Never throws on non-zero exit — callers decide what a non-zero code means.
export function makeExec({ cwd = '.' } = {}) {
  return function exec(bin, args, { input } = {}) {
    return new Promise((resolve) => {
      const child = spawn(bin, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));
      child.on('close', (code) => resolve({ code, stdout, stderr }));
      child.on('error', (err) => resolve({ code: -1, stdout, stderr: String(err.message || err) }));
      if (input != null) child.stdin.end(input);
      else child.stdin.end();
    });
  };
}
```

- [ ] **Step 2: Sanity-check it loads**

Run: `cd packages/org-os-host && node -e "import('./src/github/exec.mjs').then(m => console.log(typeof m.makeExec))"`
Expected: prints `function`.

- [ ] **Step 3: Commit**

```bash
git add packages/org-os-host/src/github/exec.mjs
git commit -m "feat(host): git/gh subprocess chokepoint (injectable)"
```

---

### Task 6: The `github` driver — read path

**Files:**
- Create: `packages/org-os-host/src/github/driver.mjs`
- Test: `packages/org-os-host/test/github-driver.test.mjs`

The driver takes `{ exec, fetchFn, cwd }` so tests inject fakes. This task implements the read methods; Task 7 adds writes.

- [ ] **Step 1: Write the failing read-path test**

`packages/org-os-host/test/github-driver.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGithubDriver } from '../src/github/driver.mjs';

// A recording fake exec: returns queued responses by matched command.
function fakeExec(responses) {
  const calls = [];
  const exec = async (bin, args) => {
    calls.push({ bin, args });
    const key = `${bin} ${args.join(' ')}`;
    for (const [pattern, res] of responses) if (key.includes(pattern)) return res;
    return { code: 0, stdout: '', stderr: '' };
  };
  exec.calls = calls;
  return exec;
}

test('resolveRemote: github slug → scheme github', () => {
  const d = makeGithubDriver({ exec: fakeExec([]) });
  const r = d.resolveRemote('regen-coordination/org-os');
  assert.equal(r.scheme, 'github');
  assert.match(r.fetchUrl, /github\.com\/regen-coordination\/org-os/);
});

test('fetchFile: prefers a local clone when local_path exists', async () => {
  // entry with local_path pointing at a dir we control via a fake reader.
  const d = makeGithubDriver({
    exec: fakeExec([]),
    readLocal: (p) => (p.endsWith('federation.yaml') ? 'name: local-org' : null),
  });
  const out = await d.fetchFile({ local_path: '../refi-bcn-os' }, 'federation.yaml');
  assert.equal(out, 'name: local-org');
});

test('fetchFile: falls back to raw.githubusercontent when no local_path', async () => {
  const fetchFn = async (url) => {
    assert.match(url, /raw\.githubusercontent\.com\/regen-coordination\/org-os\/HEAD\/federation\.yaml/);
    return { ok: true, text: async () => 'name: remote-org' };
  };
  const d = makeGithubDriver({ exec: fakeExec([]), fetchFn });
  const out = await d.fetchFile({ repo: 'regen-coordination/org-os' }, 'federation.yaml');
  assert.equal(out, 'name: remote-org');
});

test('fetchFile: returns null (never throws) when unreachable', async () => {
  const fetchFn = async () => { throw new Error('network down'); };
  const d = makeGithubDriver({ exec: fakeExec([]), fetchFn });
  const out = await d.fetchFile({ repo: 'x/y' }, 'federation.yaml');
  assert.equal(out, null);
});

test('getCanonical: reads default branch from git', async () => {
  const exec = fakeExec([
    ['symbolic-ref', { code: 0, stdout: 'refs/remotes/origin/main\n', stderr: '' }],
  ]);
  const d = makeGithubDriver({ exec });
  const c = await d.getCanonical({ local_path: '.' });
  assert.equal(c.defaultBranch, 'main');
  assert.equal(c.threshold, 1);         // github has no quorum → threshold 1
  assert.deepEqual(c.delegates, []);
});

test('getDrift: parses ahead/behind from rev-list --left-right --count', async () => {
  const exec = fakeExec([
    ['rev-parse --abbrev-ref', { code: 0, stdout: 'main\n', stderr: '' }],
    ['rev-list --left-right --count', { code: 0, stdout: '2\t3\n', stderr: '' }],
  ]);
  const d = makeGithubDriver({ exec });
  const drift = await d.getDrift({ local_path: '.' });
  assert.equal(drift.behind, 3);
  assert.equal(drift.ahead, 2);
  assert.equal(drift.canonicalRef, 'main');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/org-os-host && node --test test/github-driver.test.mjs`
Expected: FAIL — `Cannot find module '../src/github/driver.mjs'`.

- [ ] **Step 3: Implement the read path**

`packages/org-os-host/src/github/driver.mjs`:
```js
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// makeGithubDriver: behavior-preserving wrapper of org-os's current git/gh usage.
// Dependencies are injected so every method is unit-testable without git/gh/network:
//   exec(bin,args,{input}) -> { code, stdout, stderr }   (Task 5 chokepoint)
//   fetchFn(url,opts) -> Response-like                    (defaults to global fetch)
//   readLocal(path) -> string|null                        (defaults to fs read)
export function makeGithubDriver({ exec, fetchFn = globalThis.fetch, readLocal, cwd = '.' } = {}) {
  const readFile = readLocal || ((p) => (existsSync(p) ? readFileSync(p, 'utf8') : null));
  const git = (args, opts) => exec('git', args, opts);

  function repoSlug(entry) {
    if (typeof entry === 'string') return entry.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
    return (entry?.repo) || (entry?.url ? entry.url.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '') : null);
  }

  return {
    resolveRemote(idOrUrl) {
      const slug = repoSlug(idOrUrl);
      return { scheme: 'github', fetchUrl: slug ? `https://github.com/${slug}` : null, canonical: true };
    },

    whoami() {
      // org-os identities are github handles today; the driver does not shell out for this.
      return { id: null, handle: null };
    },

    async clone(entry, dest) {
      const slug = repoSlug(entry);
      const { code, stderr } = await git(['clone', `https://github.com/${slug}.git`, dest]);
      return { ok: code === 0, error: code === 0 ? null : stderr };
    },

    // Local clone first (offline, authoritative), then raw.githubusercontent. Never throws.
    async fetchFile(entry, path, ref = 'HEAD') {
      const localBase = entry?.local_path ? join(cwd, entry.local_path, path) : null;
      if (localBase) {
        const local = readFile(localBase);
        if (local != null) return local;
      }
      const slug = repoSlug(entry);
      if (!slug) return null;
      const url = `https://raw.githubusercontent.com/${slug}/${ref}/${path}`;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        try {
          const res = await fetchFn(url, { signal: ctrl.signal });
          if (res && res.ok) return await res.text();
          return null;
        } finally { clearTimeout(timer); }
      } catch {
        return null; // unreachable/timeout → null, matches frontier's "stale beats broken"
      }
    },

    async listPeers(entry) {
      // github has no delegate/seed concept; peers come from config, not the host.
      return Array.isArray(entry?.peers) ? entry.peers : [];
    },

    async getCanonical(entry) {
      const opts = entry?.local_path ? { cwd: entry.local_path } : undefined;
      const { code, stdout } = await exec('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], opts);
      let defaultBranch = 'main';
      if (code === 0 && stdout.trim()) defaultBranch = stdout.trim().split('/').pop();
      return { defaultBranch, threshold: 1, delegates: [] };
    },

    async getDrift(entry) {
      const opts = entry?.local_path ? { cwd: entry.local_path } : undefined;
      const br = await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], opts);
      const canonicalRef = br.code === 0 ? br.stdout.trim() : 'main';
      const rl = await exec('git', ['rev-list', '--left-right', '--count', `HEAD...@{u}`], opts);
      let ahead = 0, behind = 0;
      if (rl.code === 0) {
        const [a, b] = rl.stdout.trim().split(/\s+/).map((n) => parseInt(n, 10) || 0);
        ahead = a; behind = b;
      }
      return { behind, ahead, canonicalRef };
    },

    // ---- write path added in Task 7 ----
  };
}
```

- [ ] **Step 4: Run the read-path tests to verify they pass**

Run: `cd packages/org-os-host && node --test test/github-driver.test.mjs`
Expected: the 6 read-path tests PASS. (The file has no write tests yet.)

- [ ] **Step 5: Commit**

```bash
git add packages/org-os-host/src/github/driver.mjs packages/org-os-host/test/github-driver.test.mjs
git commit -m "feat(host): github driver read path (resolveRemote/fetchFile/getCanonical/getDrift/clone/listPeers)"
```

---

### Task 7: The `github` driver — write path + contract run

**Files:**
- Modify: `packages/org-os-host/src/github/driver.mjs` (add write methods before the closing `};`)
- Modify: `packages/org-os-host/test/github-driver.test.mjs` (append write tests + contract run)

- [ ] **Step 1: Append the failing write tests**

Append to `packages/org-os-host/test/github-driver.test.mjs`:
```js
import { runHostDriverContract } from './contract.mjs';

test('push: runs git push origin <branch>', async () => {
  const exec = fakeExec([['push origin', { code: 0, stdout: '', stderr: '' }]]);
  const d = makeGithubDriver({ exec });
  const res = await d.push({ branch: 'luizfernando' });
  assert.equal(res.ok, true);
  assert.ok(exec.calls.some((c) => c.args.join(' ') === 'push origin luizfernando'));
});

test('openChange: calls gh pr create with title and base', async () => {
  const exec = fakeExec([['pr create', { code: 0, stdout: 'https://github.com/x/y/pull/7\n', stderr: '' }]]);
  const d = makeGithubDriver({ exec });
  const ref = await d.openChange({ title: 'T', body: 'B', base: 'main' });
  assert.match(ref.id, /pull\/7/);
  const call = exec.calls.find((c) => c.bin === 'gh');
  assert.ok(call.args.includes('--title') && call.args.includes('T'));
  assert.ok(call.args.includes('--base') && call.args.includes('main'));
});

test('createIssue: calls gh issue create with title', async () => {
  const exec = fakeExec([['issue create', { code: 0, stdout: 'https://github.com/x/y/issues/3\n', stderr: '' }]]);
  const d = makeGithubDriver({ exec });
  const issue = await d.createIssue({ title: 'Bug', body: 'desc' });
  assert.match(issue.id, /issues\/3/);
});

test('webUrl: builds github blob URL from repo + path', () => {
  const d = makeGithubDriver({ exec: fakeExec([]) });
  const url = d.webUrl({ repo: 'regen-coordination/org-os' }, 'BOOTSTRAP.md');
  assert.equal(url, 'https://github.com/regen-coordination/org-os/blob/main/BOOTSTRAP.md');
});

test('github driver satisfies the HostDriver contract suite', async () => {
  // Provide fakes that make read calls return contract-valid shapes.
  const exec = fakeExec([
    ['symbolic-ref', { code: 0, stdout: 'refs/remotes/origin/main\n', stderr: '' }],
    ['rev-parse --abbrev-ref', { code: 0, stdout: 'main\n', stderr: '' }],
    ['rev-list', { code: 0, stdout: '0\t0\n', stderr: '' }],
  ]);
  const fetchFn = async () => { throw new Error('offline'); }; // fetchFile → null, allowed
  await runHostDriverContract(() => makeGithubDriver({ exec, fetchFn }), { assert });
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd packages/org-os-host && node --test test/github-driver.test.mjs`
Expected: FAIL — `push`/`openChange`/`createIssue`/`commentIssue`/`syncUpstream`/`webUrl` are undefined.

- [ ] **Step 3: Add the write methods**

In `packages/org-os-host/src/github/driver.mjs`, replace the `// ---- write path added in Task 7 ----` comment with:
```js
    async push({ branch, remote = 'origin' } = {}) {
      const { code, stderr } = await git(['push', remote, branch]);
      return { ok: code === 0, error: code === 0 ? null : stderr };
    },

    async openChange({ title, body = '', base = 'main' } = {}) {
      const { code, stdout, stderr } = await exec('gh', ['pr', 'create', '--title', title, '--body', body, '--base', base]);
      return { id: code === 0 ? stdout.trim() : null, ok: code === 0, error: code === 0 ? null : stderr };
    },

    async createIssue({ title, body = '' } = {}) {
      const { code, stdout, stderr } = await exec('gh', ['issue', 'create', '--title', title, '--body', body]);
      return { id: code === 0 ? stdout.trim() : null, ok: code === 0, error: code === 0 ? null : stderr };
    },

    async commentIssue({ id, body } = {}) {
      const { code, stderr } = await exec('gh', ['issue', 'comment', id, '--body', body]);
      return { ok: code === 0, error: code === 0 ? null : stderr };
    },

    async syncUpstream({ remote = 'upstream', branch = 'main' } = {}) {
      const fetch = await git(['fetch', remote]);
      if (fetch.code !== 0) return { ok: false, error: fetch.stderr };
      const pull = await git(['pull', '--rebase', remote, branch]);
      return { ok: pull.code === 0, error: pull.code === 0 ? null : pull.stderr };
    },

    webUrl(entry, path, ref = 'main') {
      const slug = repoSlug(entry);
      return `https://github.com/${slug}/blob/${ref}/${path}`;
    },
```

- [ ] **Step 4: Run all github-driver tests to verify they pass**

Run: `cd packages/org-os-host && node --test test/github-driver.test.mjs`
Expected: PASS (all read + write + contract tests).

- [ ] **Step 5: Commit**

```bash
git add packages/org-os-host/src/github/driver.mjs packages/org-os-host/test/github-driver.test.mjs
git commit -m "feat(host): github driver write path + passes HostDriver contract"
```

---

### Task 8: Register the `github` driver + finalize the package index

**Files:**
- Modify: `packages/org-os-host/src/index.mjs`
- Test: `packages/org-os-host/test/smoke.test.mjs` (extend)

- [ ] **Step 1: Extend the smoke test to require github registration**

Replace `packages/org-os-host/test/smoke.test.mjs` with:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as host from '../src/index.mjs';

test('package exposes resolveDriver and getDriver', () => {
  assert.equal(typeof host.resolveDriver, 'function');
  assert.equal(typeof host.getDriver, 'function');
});

test('github driver is registered and resolvable by default', () => {
  const d = host.resolveDriver({}); // no platforms.canonical → github
  assert.equal(typeof d.fetchFile, 'function');
  assert.equal(d.resolveRemote('a/b').scheme, 'github');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/org-os-host && node --test test/smoke.test.mjs`
Expected: FAIL — `unknown host driver: github` (index doesn't register it yet).

- [ ] **Step 3: Register github in index.mjs**

Replace `packages/org-os-host/src/index.mjs`:
```js
import { registerDriver, getDriver, assertDriver, HOST_DRIVER_METHODS } from './driver.mjs';
import { resolveDriver, resolveRemoteScheme } from './resolve.mjs';
import { makeGithubDriver } from './github/driver.mjs';
import { makeExec } from './github/exec.mjs';

// Register the github driver with a real exec by default; callers/tests can override
// via getDriver('github', { exec }) since makeGithubDriver takes injected deps.
registerDriver('github', (config = {}) =>
  makeGithubDriver({ exec: config.exec || makeExec({ cwd: config.cwd || '.' }), cwd: config.cwd || '.', fetchFn: config.fetchFn }));

export { registerDriver, getDriver, assertDriver, HOST_DRIVER_METHODS, resolveDriver, resolveRemoteScheme };
```

- [ ] **Step 4: Run the full package test suite**

Run: `cd packages/org-os-host && npm test`
Expected: PASS — all files (smoke, driver, resolve, contract-selfcheck, github-driver).

- [ ] **Step 5: Commit**

```bash
git add packages/org-os-host/src/index.mjs packages/org-os-host/test/smoke.test.mjs
git commit -m "feat(host): register github driver; @org-os/host resolves by default"
```

---

### Task 9: Route `frontier.mjs` through the driver seam (first real consumer)

**Files:**
- Modify: `packages/org-os-kms/src/frontier.mjs`
- Test: `packages/org-os-kms/test/frontier.test.mjs` (create if absent)

This proves the seam works end-to-end against a real call site, behavior-preserving: local clone first, then remote federation.yaml. The remote fetch now goes through `driver.fetchFile` instead of a hardcoded `raw.githubusercontent.com` URL.

- [ ] **Step 1: Write a behavior-preserving golden test**

`packages/org-os-kms/test/frontier.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fetchFrontier } from '../src/frontier.mjs';

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'frontier-'));
  writeFileSync(join(dir, 'federation.yaml'),
    'peers:\n  - id: remote-peer\n    repo: acme/remote-os\n  - id: local-peer\n    local_path: ../local-os\n');
  // local peer clone
  mkdirSync(join(dir, '..', 'local-os'), { recursive: true });
  writeFileSync(join(dir, '..', 'local-os', 'federation.yaml'), 'name: local-os\npeers: []\n');
  return dir;
}

test('frontier: local peer read from local_path, remote peer via driver.fetchFile', async () => {
  const dir = scratch();
  const fetchFn = async (url) => {
    assert.match(url, /raw\.githubusercontent\.com\/acme\/remote-os\/HEAD\/federation\.yaml/);
    return { ok: true, text: async () => 'name: remote-os\npeers: []\n' };
  };
  const res = await fetchFrontier({ dir, fetchFn });
  assert.equal(res.ok, true);
  assert.ok(existsSync(join(dir, 'data', 'federation', 'frontier', 'remote-peer.json')));
  assert.ok(existsSync(join(dir, 'data', 'federation', 'frontier', 'local-peer.json')));
  const remoteSnap = JSON.parse(readFileSync(join(dir, 'data', 'federation', 'frontier', 'remote-peer.json'), 'utf8'));
  assert.equal(remoteSnap.source.includes('raw.githubusercontent.com') || remoteSnap.source === 'github', true);
});
```

- [ ] **Step 2: Run to verify current behavior (baseline)**

Run: `cd packages/org-os-kms && node --test test/frontier.test.mjs`
Expected: PASS against the *current* frontier (it already does local-first + raw-GitHub). This is the golden baseline; the refactor must keep it green.

- [ ] **Step 3: Refactor frontier.mjs to use the driver**

In `packages/org-os-kms/src/frontier.mjs`:

Add the import at the top (after the existing imports):
```js
import { resolveDriver } from '@org-os/host';
```

Replace the remote-fetch branch (the `else if (entry.repo) { ... }` block, lines ~37-46) with a driver call. The new loop body's fetch section becomes:
```js
      let manifest = null, source = null;
      const localFed = entry.local_path ? join(dir, entry.local_path, 'federation.yaml') : null;
      if (localFed && existsSync(localFed)) {
        manifest = yaml.load(readFileSync(localFed, 'utf8'));
        source = 'local';
      } else if (entry.repo || entry.rid) {
        // Route through the host driver: github → raw.githubusercontent, radicle → httpd.
        const driver = resolveDriver(fed, { fetchFn });
        const text = await driver.fetchFile(entry, 'federation.yaml');
        if (text != null) { manifest = yaml.load(text); source = entry.rid ? 'radicle' : 'github'; }
      } else {
        report.push({ id, skipped: 'no local_path or repo' });
        continue;
      }
```

Because the driver owns the timeout/abort now, delete the local `AbortController`/`setTimeout` block that was in the old `else if`. Keep the rest of the loop (`if (!manifest) …`, snapshot write, catch) unchanged.

- [ ] **Step 4: Make `@org-os/host` resolvable from `@org-os/kms`**

org-os packages are not npm-workspaces (verified: root `workspaces: none`). Add a local dependency link so the bare import resolves. In `packages/org-os-kms/package.json`, add:
```json
  "dependencies": {
    "@org-os/host": "file:../org-os-host"
  }
```
Then run: `cd packages/org-os-kms && npm install`
Expected: creates `node_modules/@org-os/host` symlink; no errors.

If the repo does not use per-package `node_modules` (check whether other packages have a `dependencies` block with `file:` links first — grep `"file:\.\./"` under `packages/*/package.json`), instead import by relative path: replace the import with `import { resolveDriver } from '../../org-os-host/src/index.mjs';` and skip the package.json edit. Pick whichever matches the existing convention in the repo.

- [ ] **Step 5: Run the golden test to verify behavior is preserved**

Run: `cd packages/org-os-kms && node --test test/frontier.test.mjs`
Expected: PASS — same output as the Step 2 baseline (local + remote snapshots written).

- [ ] **Step 6: Run the KMS package's full suite to catch regressions**

Run: `cd packages/org-os-kms && npm test`
Expected: PASS (44/44 baseline + the new frontier test = 45; no regressions).

- [ ] **Step 7: Commit**

```bash
git add packages/org-os-kms/src/frontier.mjs packages/org-os-kms/test/frontier.test.mjs packages/org-os-kms/package.json
git commit -m "refactor(kms): route frontier federation.yaml fetch through @org-os/host driver"
```

---

### Task 10: Register the package in the packages matrix + final verification

**Files:**
- Modify: `data/packages-matrix.yaml` (structural file — PR-gated per `/commit`)
- Verify: whole-repo structure + schema validation

- [ ] **Step 1: Inspect the matrix format**

Run: `cd "$(git rev-parse --show-toplevel)" && sed -n '1,30p' data/packages-matrix.yaml`
Expected: a list of entries each with fields like `name`, `lifecycle_status`, etc. Note the exact field names and an allowed `lifecycle_status` value (the pre-commit validator checks these — see the "Matrix Files" section of `npm run validate:structure`).

- [ ] **Step 2: Add the `@org-os/host` entry**

Append an entry to `data/packages-matrix.yaml` matching the observed schema. Using the fields other entries use (adjust names to match Step 1 exactly):
```yaml
  - name: "@org-os/host"
    path: packages/org-os-host
    lifecycle_status: experimental   # use an allowed value observed in Step 1
    description: "Host-provider abstraction — one HostDriver interface, github/radicle drivers, selected by platforms.canonical."
    workstream: federation-protocol
```

- [ ] **Step 3: Run structure validation**

Run: `cd "$(git rev-parse --show-toplevel)" && npm run validate:structure`
Expected: `Results: N passed, 0 failed` including "packages-matrix: all entries have valid lifecycle_status".

- [ ] **Step 4: Run the new package's tests once more from repo root**

Run: `cd "$(git rev-parse --show-toplevel)/packages/org-os-host" && npm test`
Expected: PASS — all test files green.

- [ ] **Step 5: Commit (structural file → operator trunk, then PR to main per /commit)**

```bash
git add data/packages-matrix.yaml
git commit -m "chore(host): register @org-os/host in packages matrix"
```

Note: `data/packages-matrix.yaml` is a shared structural file. Per the `/commit` skill, commit to your operator trunk and open a PR to `main` rather than pushing to `main` directly.

---

## Self-review

**Spec coverage (Plan 1 slice):** the spec's "host-provider seam" (interface + registry + resolver + github driver + read/write split) → Tasks 2,3,6,7,8; the reusable contract suite that Plan 2's radicle driver must pass → Task 4; "replaces frontier.mjs raw-GitHub fetch" → Task 9; behavior-preserving github wrapper → Tasks 6,7 + golden test in Task 9. Deferred to later plans (correctly out of Plan 1 scope): rad-cli/httpd/cob/identity (Plan 2), bootstrap/seed-node (Plan 3), command routing + `clone-linked-repos`/`sync-upstream`/`sync-github` refactors + governance + data-model fields (Plan 4).

**Placeholder scan:** every code step contains complete code; every run step names the exact command and expected result; the one conditional (Task 9 Step 4, per-package `node_modules` vs relative import) gives both concrete branches with a decision rule, not a "TBD".

**Type/name consistency:** `HOST_DRIVER_METHODS`, `registerDriver`, `getDriver`, `assertDriver`, `resolveDriver`, `resolveRemoteScheme`, `makeGithubDriver`, `makeExec`, `runHostDriverContract` are used identically across every task and match `src/index.mjs`'s exports. The `HostDriver` method set (13 methods) is identical in Task 2's list, Task 2's test, Task 4's contract, and the memory/github drivers. `fetchFile(entry, path, ref)`, `getCanonical→{defaultBranch,threshold,delegates}`, `getDrift→{behind,ahead,canonicalRef}`, `webUrl(entry,path,ref)` signatures match between definition, tests, contract, and the frontier consumer.
