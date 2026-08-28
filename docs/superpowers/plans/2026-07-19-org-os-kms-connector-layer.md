# org-os-kms Connector Layer — Implementation Plan

> **Release status (2026-08-28):** Deferred to v0.6+ — portfolio memo §4 row 12; 19 unmerged commits preserved (archive tag per masterplan WS-E). Convergence: [v0.5 release masterplan](2026-08-28-v0.5-release-masterplan.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a composable connector layer to `@org-os/kms` so external protocols (GitHub + KOI real; geo/radicle/atproto/synthefy specced stubs) become pluggable knowledge sources declared in `kms.yaml`, feeding the toolkit-framework `ingest → store → review` pipeline.

**Architecture:** A portable **Connector contract + `runConnector` orchestration** lives framework-side (`toolkit-framework/src/connector.mjs`), mirroring the existing storage-adapter seam. Concrete connectors, their registry, and composition live in `org-os-kms/src/connectors/`. A new `ingest.pull` lifecycle op (on `close`) reads the `kms.yaml` `connectors:` list, runs each connector, stamps born-rules, stores via the instance's storage adapter, and persists per-connector cursors for incremental pulls. Everything enters as `maturity: raw` and is review-gated; outbound stays draft-and-present.

**Tech Stack:** Node.js ESM (`.mjs`), `node:test`, `js-yaml`, `gh` CLI (GitHub), existing `koi-bridge`/`regen-koi` MCP substrate (KOI). Zero new npm dependencies.

**Reference spec:** `docs/superpowers/specs/2026-07-19-org-os-kms-connector-layer-design.md`

---

## Orientation for the implementer (read once)

- **Two packages, sibling dirs** under `packages/`: `toolkit-framework` (portable, host-agnostic) and `org-os-kms` (the org-os host binding). `org-os-kms/src/framework.mjs` is the ONLY file that imports the framework (by relative path `../../toolkit-framework/src/...`). Route all new framework access through it.
- **Run tests** from inside a package: `cd packages/org-os-kms && node --test` (65 passing at baseline) and `cd packages/toolkit-framework && node --test`. Never let the baseline count drop.
- **Storage-adapter contract** (`toolkit-framework/src/storage.mjs`): `store(target, entries) → { stored: [ref] }`, `list(target) → [{schema, object, ref}]`, `index`, `writeIndex`. Call methods ON the adapter (`this`). Refs are opaque.
- **Validation** (`toolkit-framework/src/index.mjs`): `validateObject(schema, obj) → { valid, errors }` (checks required fields + enums + K1 axes; extra fields allowed). `schemaFields(schema)` returns the merged field map (with `extends`). `checkInvariants(obj) → { ok, violations }`. Every entry schema `extends: frontmatter`, which has a `maturity` field (K1 axis) — so `'maturity' in schemaFields(schema)` is the test for "this is KB content that must be born `raw`".
- **Exact valid object shapes** (copy these — validation is strict on required fields):
  - `source-system` — required `[title, type, steward, return_path]`; `type` ∈ `{wiki, map, repo, forum, knowledge-garden, directory, archive, database, library, docs-site, convening, podcast, newsletter, dataset}`.
  - `signal` — required `[title, type, signal_type]`; `type` is the literal string `signal`; `signal_type` ∈ `{content, ontology, resource, option, deployment, track, implementation, public-use, source-system, infrastructure}`.
  - `resource` — required `[title, type]`; `type` is the literal string `resource`; `resource_type` is open vocab (e.g. `document`).
- **Lifecycle executor** (`org-os-kms/src/executor.mjs`): `runLifecycle(event, ctx, deps)` runs ops in order; write ops fail-hard, read/render fail-soft. It is currently SYNCHRONOUS — Task 3 makes it async so `ingest.pull` can do network I/O.

---

## Task 1: Framework-side Connector contract + `runConnector`

**Files:**
- Create: `packages/toolkit-framework/src/connector.mjs`
- Test: `packages/toolkit-framework/test/connector.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `packages/toolkit-framework/test/connector.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runConnector, NOT_IMPLEMENTED } from '../src/connector.mjs';

// A fake in-memory storage adapter (satisfies the store() contract).
function memAdapter() {
  const stored = [];
  return {
    name: 'mem',
    store(_target, entries) {
      stored.push(...entries);
      return { stored: entries.map((e, i) => `${e.object.title}#${i}`) };
    },
    _stored: stored,
  };
}

// A fake connector that produces valid framework objects.
const fakeConnector = {
  name: 'fake',
  protocol: 'Fake',
  capabilities: { ingest: true, subscribe: false, publish: false },
  describe: () => ({ title: 'Fake Source', type: 'repo', steward: 'tester', return_path: 'https://example.org' }),
  pull: async () => ({ records: [{ t: 'Hello' }, { t: 'World' }], cursor: 'c2' }),
  map: (r) => [{ schema: 'signal', object: { title: r.t, type: 'signal', signal_type: 'content' } }],
};

test('runConnector stores the source card + mapped candidates, stamps born-rules, returns next cursor', async () => {
  const a = memAdapter();
  const res = await runConnector(fakeConnector, { config: {}, cursor: null, adapter: a, target: '.' });
  assert.equal(res.cursor, 'c2');
  assert.equal(res.candidates, 2);
  assert.equal(res.errors.length, 0);
  // card + 2 signals stored
  assert.equal(a._stored.length, 3);
  const sig = a._stored.find((e) => e.schema === 'signal');
  assert.equal(sig.object.maturity, 'raw');                 // stamped
  assert.equal(sig.object.provenance.origin, 'Fake Source'); // stamped from the card title
});

test('runConnector propagates a stub NOT_IMPLEMENTED from pull', async () => {
  const stub = {
    name: 'stub', protocol: 'Stub', capabilities: { ingest: true, subscribe: false, publish: false },
    describe: () => ({ title: 'Stub', type: 'repo', steward: 't', return_path: 'https://x.org' }),
    pull() { throw new Error(`${NOT_IMPLEMENTED}: stub`); },
    map: () => [],
  };
  await assert.rejects(() => runConnector(stub, { adapter: memAdapter(), target: '.' }), /NOT_IMPLEMENTED/);
});

test('runConnector rejects a describe() that is not a valid source-system', async () => {
  const bad = { name: 'bad', protocol: 'Bad', capabilities: { ingest: true }, describe: () => ({ title: 'no type' }), pull: async () => ({ records: [] }), map: () => [] };
  await assert.rejects(() => runConnector(bad, { adapter: memAdapter(), target: '.' }), /source-system/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/toolkit-framework && node --test test/connector.test.mjs`
Expected: FAIL — `Cannot find module '../src/connector.mjs'`.

- [ ] **Step 3: Write the implementation**

Create `packages/toolkit-framework/src/connector.mjs`:

```js
// src/connector.mjs — the Connector seam: where knowledge COMES FROM (orthogonal to
// storage, which is where it LANDS). A connector is a source driver for one external
// protocol. It presents itself as a source-system peer (describe), fetches foreign
// records since a cursor (pull), and translates each record into framework KB
// candidates (map). runConnector sequences describe → pull → map → validate → store
// and is the single place all lifecycle/error policy for connectors lives.
//
// Connector = {
//   name: string,
//   protocol: string,
//   capabilities: { ingest: bool, subscribe: bool, publish: bool },
//   describe(config)          → source-system object (this source AS a federation peer)
//   pull(config, {cursor})    → { records: [...], cursor: <opaque> }   // network read; may be async
//   map(record, config)       → [{ schema, object }]                   // PURE, total; no I/O
//   subscribe?(config, onEvent) → unsubscribe()   // optional; only if capabilities.subscribe
//   publish?(config, records)   → { applied:false, draft }  // optional; DRAFT-ONLY
// }
//
// Cursors are connector-opaque tokens (like storage refs): the orchestrator stores and
// replays them but never inspects them.
import { validateObject, checkInvariants, schemaFields, listSchemas } from './index.mjs';

export const NOT_IMPLEMENTED = 'NOT_IMPLEMENTED';

/**
 * Run one connector: describe → pull → map → validate/stamp → store.
 * ctx = { config, cursor, adapter, target }. Async because pull does I/O.
 * Returns { source, stored, candidates, cursor, errors }.
 * The source-system card is always stored (idempotent) so the connector registers as a peer.
 * KB-content candidates (schema has a `maturity` field) are stamped maturity:'raw' and given
 * provenance.origin from the card, then validated; invalid candidates go to `errors`, not storage.
 */
export async function runConnector(connector, ctx = {}) {
  const { config = {}, cursor = null, adapter, target } = ctx;
  if (!adapter) throw new Error('runConnector: adapter required');
  const errors = [];

  // 1. identity — the connector IS a source-system peer
  const card = connector.describe(config);
  const cv = validateObject('source-system', card);
  if (!cv.valid) throw new Error(`describe() is not a valid source-system: ${cv.errors.join('; ')}`);

  // 2. pull (network; a stub throws NOT_IMPLEMENTED here — let it propagate)
  const pulled = await connector.pull(config, { cursor });
  const records = (pulled && pulled.records) || [];
  const nextCursor = pulled && pulled.cursor !== undefined ? pulled.cursor : cursor;

  // 3. map (pure) → candidates
  const candidates = [];
  for (const r of records) {
    try {
      const mapped = connector.map(r, config) || [];
      candidates.push(...mapped);
    } catch (e) {
      errors.push(`map: ${e.message}`);
    }
  }

  // 4. validate + stamp born-rules for KB-content schemas
  const known = new Set(listSchemas());
  const toStore = [{ schema: 'source-system', object: card }];
  for (const c of candidates) {
    if (!c || !c.schema || !c.object || typeof c.object !== 'object') { errors.push('map produced an empty candidate'); continue; }
    if (!known.has(c.schema)) { errors.push(`unknown schema "${c.schema}"`); continue; }
    const object = { ...c.object };
    if ('maturity' in schemaFields(c.schema)) {              // KB content → born raw, provenance stamped
      if (object.maturity == null) object.maturity = 'raw';
      if (!object.provenance) object.provenance = { origin: card.title };
    }
    const v = validateObject(c.schema, object);
    if (!v.valid) { errors.push(`${c.schema} "${object.title || '?'}": ${v.errors.join('; ')}`); continue; }
    const inv = checkInvariants(object);
    if (!inv.ok) { errors.push(`${c.schema} "${object.title || '?'}": ${inv.violations.join('; ')}`); continue; }
    toStore.push({ schema: c.schema, object });
  }

  // 5. store (idempotent by slug per the adapter contract)
  const { stored } = adapter.store(target, toStore);
  return { source: card.title, stored: stored.length, candidates: candidates.length, cursor: nextCursor, errors };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/toolkit-framework && node --test test/connector.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full framework suite to confirm no regression**

Run: `cd packages/toolkit-framework && node --test`
Expected: all pass (existing count + 3 new).

- [ ] **Step 6: Commit**

```bash
git add packages/toolkit-framework/src/connector.mjs packages/toolkit-framework/test/connector.test.mjs
git commit -m "feat(toolkit-framework): add Connector contract + runConnector orchestration"
```

---

## Task 2: Expose `runConnector` + `NOT_IMPLEMENTED` through the org-os-kms framework seam

**Files:**
- Modify: `packages/org-os-kms/src/framework.mjs`
- Test: `packages/org-os-kms/test/framework.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `packages/org-os-kms/test/framework.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fw from '../src/framework.mjs';

test('framework re-exports runConnector and NOT_IMPLEMENTED', () => {
  assert.equal(typeof fw.runConnector, 'function');
  assert.equal(fw.NOT_IMPLEMENTED, 'NOT_IMPLEMENTED');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/org-os-kms && node --test test/framework.test.mjs`
Expected: FAIL — `fw.runConnector` is undefined.

- [ ] **Step 3: Add the re-export**

In `packages/org-os-kms/src/framework.mjs`, after the existing `ingest.mjs` export block, add:

```js
export { runConnector, NOT_IMPLEMENTED } from '../../toolkit-framework/src/connector.mjs';
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/org-os-kms && node --test test/framework.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/org-os-kms/src/framework.mjs packages/org-os-kms/test/framework.test.mjs
git commit -m "feat(org-os-kms): expose runConnector via the framework seam"
```

---

## Task 3: Make the lifecycle executor async (so ops can do I/O)

The executor calls `op.run(ctx)` synchronously. `ingest.pull` needs network I/O, so `run` must be awaitable. Awaiting a sync return value is a no-op, so this is backward-compatible for every existing op.

**Files:**
- Modify: `packages/org-os-kms/src/executor.mjs`
- Modify: `packages/org-os-kms/test/executor.test.mjs`
- Modify (call site): `packages/org-os-kms/src/cli.mjs:39`

- [ ] **Step 1: Write the failing test**

Append to `packages/org-os-kms/test/executor.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLifecycle } from '../src/executor.mjs';

test('runLifecycle awaits async exec ops', async () => {
  const ops = {
    'async.op': { kind: 'exec', write: true, run: async () => {
      await Promise.resolve();
      return { ok: true, report: { did: 'async-work' } };
    } },
  };
  const events = { close: ['async.op'] };
  const report = await runLifecycle('close', {}, { ops, events });
  assert.equal(report.errors.length, 0);
  assert.deepEqual(report.ran[0].report, { did: 'async-work' });
});

test('runLifecycle fail-hard on an async write op that rejects', async () => {
  const ops = { 'boom': { kind: 'exec', write: true, run: async () => { throw new Error('kaboom'); } } };
  const report = await runLifecycle('close', {}, { ops, events: { close: ['boom'] } });
  assert.match(report.errors[0], /boom: kaboom/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/org-os-kms && node --test test/executor.test.mjs`
Expected: FAIL — the async op's Promise is treated as a value; `report.ran[0].report` is `undefined`, and the rejecting op is not caught.

- [ ] **Step 3: Make `runLifecycle` async**

In `packages/org-os-kms/src/executor.mjs`, change the function signature and the two `op.run(ctx)` awaits:

```js
export async function runLifecycle(event, ctx = {}, deps = {}) {
  const events = deps.events || LIFECYCLE_BINDINGS;
  const ops = deps.ops || DEFAULT_OPS;
  const names = events[event];
  if (!names) throw new Error(`unknown lifecycle event: ${event}`);

  const report = { event, ran: [], skills: [], errors: [] };
  for (const name of names) {
    const op = ops[name];
    if (!op) { report.errors.push(`unregistered op: ${name}`); return report; }
    if (op.kind === 'skill') { report.skills.push(op.skill); continue; }
    try {
      const res = (await op.run(ctx)) || {};
      const ok = res.ok !== false;
      report.ran.push({ op: name, ok, report: res.report });
      if (!ok && op.write) { report.errors.push(`${name}: reported failure`); return report; }
    } catch (e) {
      report.errors.push(`${name}: ${e.message}`);
      if (op.write) return report;
    }
  }
  return report;
}
```

- [ ] **Step 4: Fix the CLI call site**

In `packages/org-os-kms/src/cli.mjs`, line 39 (`dispatch` is already `async`), change:

```js
    case 'lifecycle': return await runLifecycle(args[0], { dir });
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd packages/org-os-kms && node --test test/executor.test.mjs test/cli.test.mjs`
Expected: PASS. (Existing executor tests still pass — `await` on a sync return is a no-op.)

- [ ] **Step 6: Run the full suite**

Run: `cd packages/org-os-kms && node --test`
Expected: all pass (baseline 65 + new).

- [ ] **Step 7: Commit**

```bash
git add packages/org-os-kms/src/executor.mjs packages/org-os-kms/src/cli.mjs packages/org-os-kms/test/executor.test.mjs
git commit -m "refactor(org-os-kms): make lifecycle executor async for I/O ops"
```

---

## Task 4: Stub helper + the four specced-stub connectors

**Files:**
- Create: `packages/org-os-kms/src/connectors/stub.mjs`
- Create: `packages/org-os-kms/src/connectors/geo.mjs`
- Create: `packages/org-os-kms/src/connectors/radicle.mjs`
- Create: `packages/org-os-kms/src/connectors/atproto.mjs`
- Create: `packages/org-os-kms/src/connectors/synthefy.mjs`
- Test: `packages/org-os-kms/test/connectors-stub.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `packages/org-os-kms/test/connectors-stub.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fw from '../src/framework.mjs';
import { geoConnector } from '../src/connectors/geo.mjs';
import { radicleConnector } from '../src/connectors/radicle.mjs';
import { atprotoConnector } from '../src/connectors/atproto.mjs';
import { synthefyConnector } from '../src/connectors/synthefy.mjs';

const stubs = [
  ['geo', geoConnector], ['radicle', radicleConnector],
  ['atproto', atprotoConnector], ['synthefy', synthefyConnector],
];

for (const [name, conn] of stubs) {
  test(`${name} stub: describe() is a valid source-system`, () => {
    assert.equal(conn.name, name);
    const card = conn.describe({});
    const v = fw.validateObject('source-system', card);
    assert.ok(v.valid, `invalid card: ${v.errors.join('; ')}`);
  });
  test(`${name} stub: capabilities declare ingest-only, pull throws NOT_IMPLEMENTED`, () => {
    assert.deepEqual(conn.capabilities, { ingest: true, subscribe: false, publish: false });
    assert.throws(() => conn.pull({}, { cursor: null }), /NOT_IMPLEMENTED/);
    assert.deepEqual(conn.map({}, {}), []);
    assert.equal(typeof conn.spec, 'string');
    assert.ok(conn.spec.length > 80, 'stub must carry an implementation spec');
  });
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/org-os-kms && node --test test/connectors-stub.test.mjs`
Expected: FAIL — `Cannot find module '../src/connectors/geo.mjs'`.

- [ ] **Step 3: Write the stub helper**

Create `packages/org-os-kms/src/connectors/stub.mjs`:

```js
// src/connectors/stub.mjs — factory for a specced-but-unbuilt connector (the geo.mjs
// precedent generalized). A stub is a first-class, discoverable connector: describe()
// returns a valid source-system card, capabilities declare ingest-only, map() returns [],
// and pull() throws NOT_IMPLEMENTED. `spec` carries the implementation contract as prose so
// the file IS the design doc for building it later.
import { NOT_IMPLEMENTED } from '../framework.mjs';

export function makeStub({ name, protocol, type, steward, return_path, endpoint, spec }) {
  return {
    name,
    protocol,
    spec,
    capabilities: { ingest: true, subscribe: false, publish: false },
    describe(config = {}) {
      const card = {
        title: config.title || `${protocol} source`,
        type,
        steward: config.steward || steward,
        return_path: config.return_path || return_path,
      };
      if (endpoint) card.url = config.url || endpoint;
      return card;
    },
    pull() {
      throw new Error(`${NOT_IMPLEMENTED}: connector "${name}" (${protocol}) — see the spec docstring in src/connectors/${name}.mjs`);
    },
    map() { return []; },
  };
}
```

- [ ] **Step 4: Write the four stubs**

Create `packages/org-os-kms/src/connectors/geo.mjs`:

```js
// src/connectors/geo.mjs — SPECCED STUB. Read side of the Geo knowledge graph
// (IPFS + The Graph / Geo Browser). Pairs with toolkit-framework's geo STORAGE adapter
// (the write/persist side) — same protocol, both seams specced.
//
// IMPLEMENTATION SPEC (build here):
//  - auth: read is public over a space id; writes (future publish) need a Geo wallet/signer.
//  - describe: type 'database'; url = geobrowser.io space; return_path = the space's edit URL.
//  - pull(config, {cursor}): query the Geo read API (The Graph) for triples in config.space
//    changed since cursor; cursor = the last-seen edit/block index (opaque).
//  - map(tripleSet): assemble one entity's triples into a KB object, deserializing via the
//    kernel's JSON-LD @context (toolkit-framework toJsonLdContext()); pick schema by rdf:type
//    (default 'resource', resource_type from the entity's type).
//  - publish (future): content-add one triple-set per object serialized through the @context.
import { makeStub } from './stub.mjs';

export const geoConnector = makeStub({
  name: 'geo',
  protocol: 'Geo (IPFS + The Graph)',
  type: 'database',
  steward: 'Geo space steward',
  return_path: 'https://www.geobrowser.io',
  endpoint: 'https://www.geobrowser.io',
  spec: 'Read side of the Geo knowledge graph (IPFS + The Graph). pull queries the Geo read API '
    + 'for triples in a space since an opaque edit-index cursor; map assembles an entity from its '
    + 'triples via the kernel JSON-LD @context and picks a schema by rdf:type (default resource). '
    + 'Pairs with the framework geo storage adapter (write side).',
});
```

Create `packages/org-os-kms/src/connectors/radicle.mjs`:

```js
// src/connectors/radicle.mjs — SPECCED STUB. Peer-to-peer git (Radicle). No central API:
// read from a seeded Radicle node's Collaborative Objects (COBs).
//
// IMPLEMENTATION SPEC (build here):
//  - auth: read from a public seed node by repo RID (rad:z...); write needs the local rad key.
//  - describe: type 'repo'; url = the rad:// RID; return_path = the RID (issues/patches as COBs).
//  - pull(config, {cursor}): via `rad` CLI or the node HTTP API, list issue/patch COBs for
//    config.rid changed since cursor; cursor = the last COB object id (oid), opaque.
//  - map(cob): issue COB → signal (signal_type 'content'); patch COB → resource. Preserve the
//    COB oid in source_lineage.
//  - publish (future): create a signed COB on the local node via `rad issue`/`rad patch`.
import { makeStub } from './stub.mjs';

export const radicleConnector = makeStub({
  name: 'radicle',
  protocol: 'Radicle (p2p git COBs)',
  type: 'repo',
  steward: 'Radicle node operator',
  return_path: 'rad://',
  spec: 'Peer-to-peer git. pull lists issue/patch Collaborative Objects (COBs) for a seeded '
    + 'repo RID since an opaque COB-oid cursor (via the rad CLI / node HTTP API); map turns an '
    + 'issue COB into a signal and a patch COB into a resource, preserving the oid in '
    + 'source_lineage. No central API — everything is per-node and content-addressed.',
});
```

Create `packages/org-os-kms/src/connectors/atproto.mjs`:

```js
// src/connectors/atproto.mjs — SPECCED STUB. AT Protocol (Bluesky) — federated social
// over DIDs + lexicons.
//
// IMPLEMENTATION SPEC (build here):
//  - auth: read is public via a PDS/AppView; write needs an app password / OAuth session.
//  - describe: type 'archive'; url = the account's PDS; steward = the handle; return_path = profile URL.
//  - pull(config, {cursor}): com.atproto.repo.listRecords over config.did for the configured
//    lexicon collections (e.g. app.bsky.feed.post); cursor = the repo `rev` / listRecords cursor.
//  - map(record): a lexicon record → signal (signal_type 'content'); text → title/notes,
//    at:// uri → source_lineage. Long threads may map to a single signal, not one per post.
//  - publish (future): com.atproto.repo.createRecord — DRAFT-ONLY; never auto-post.
import { makeStub } from './stub.mjs';

export const atprotoConnector = makeStub({
  name: 'atproto',
  protocol: 'AT Protocol (Bluesky)',
  type: 'archive',
  steward: 'AT Protocol handle',
  return_path: 'https://bsky.app',
  spec: 'AT Protocol / Bluesky. pull reads lexicon records via com.atproto.repo.listRecords '
    + 'over a DID since the repo rev cursor; map turns a lexicon record (e.g. app.bsky.feed.post) '
    + 'into a signal with the at:// uri as source_lineage. DID-based identity; read is public, '
    + 'writes need a session and stay draft-only.',
});
```

Create `packages/org-os-kms/src/connectors/synthefy.mjs`:

```js
// src/connectors/synthefy.mjs — SPECCED STUB. Synthefy — protocol details UNKNOWN in this
// workspace; this connector is a placeholder whose spec is deliberately OPEN.
//
// IMPLEMENTATION SPEC — OPEN, needs protocol docs before building:
//  - TODO: auth model (API key? OAuth? wallet?).
//  - TODO: object model (what are Synthefy's native records?).
//  - TODO: cursor model (how does Synthefy express "changed since"?).
//  - TODO: describe type (provisionally 'database') + return_path.
//  - map: once the object model is known, translate to resource/signal.
import { makeStub } from './stub.mjs';

export const synthefyConnector = makeStub({
  name: 'synthefy',
  protocol: 'Synthefy',
  type: 'database',
  steward: 'Synthefy account',
  return_path: 'https://synthefy.com',
  spec: 'OPEN — Synthefy protocol docs are not yet available in this workspace. Auth, object '
    + 'model, and cursor model are all TODO. Provisional source-system type is database. This '
    + 'stub exists to reserve the name and prove the contract admits an unknown protocol shape.',
});
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd packages/org-os-kms && node --test test/connectors-stub.test.mjs`
Expected: PASS (8 tests — 2 per stub).

- [ ] **Step 6: Commit**

```bash
git add packages/org-os-kms/src/connectors/stub.mjs packages/org-os-kms/src/connectors/geo.mjs packages/org-os-kms/src/connectors/radicle.mjs packages/org-os-kms/src/connectors/atproto.mjs packages/org-os-kms/src/connectors/synthefy.mjs packages/org-os-kms/test/connectors-stub.test.mjs
git commit -m "feat(org-os-kms): add specced-stub connectors (geo, radicle, atproto, synthefy)"
```

---

## Task 5: The GitHub connector (real)

`map` is pure and fully unit-tested. `pull` shells out to `gh` (already a workspace dependency) and is exercised by a smoke test in Task 14, not here.

**Files:**
- Create: `packages/org-os-kms/src/connectors/github.mjs`
- Test: `packages/org-os-kms/test/connectors-github.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `packages/org-os-kms/test/connectors-github.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fw from '../src/framework.mjs';
import { githubConnector } from '../src/connectors/github.mjs';

test('github describe() is a valid source-system of type repo', () => {
  const card = githubConnector.describe({ repos: ['ReFiDAO/refi-dao-os'] });
  assert.equal(card.type, 'repo');
  const v = fw.validateObject('source-system', card);
  assert.ok(v.valid, v.errors.join('; '));
});

test('github maps an issue record to a valid signal', () => {
  const rec = {
    kind: 'issue', repo: 'ReFiDAO/refi-dao-os', number: 5,
    title: 'Clarify local-node onboarding', body: 'We should document the steps.',
    url: 'https://github.com/ReFiDAO/refi-dao-os/issues/5',
    updatedAt: '2026-07-01T12:00:00Z', author: { login: 'alice' },
  };
  const out = githubConnector.map(rec, {});
  assert.equal(out.length, 1);
  assert.equal(out[0].schema, 'signal');
  const o = out[0].object;
  assert.equal(o.type, 'signal');
  assert.equal(o.signal_type, 'content');
  assert.equal(o.title, 'Clarify local-node onboarding');
  assert.equal(o.source_lineage, rec.url);
  assert.ok(fw.validateObject('signal', { ...o, maturity: 'raw' }).valid);
});

test('github maps a release record to a valid resource', () => {
  const rec = { kind: 'release', repo: 'ReFiDAO/refi-dao-os', name: 'v2.0.0', body: 'Notes', url: 'https://github.com/ReFiDAO/refi-dao-os/releases/tag/v2.0.0', publishedAt: '2026-06-01T00:00:00Z' };
  const out = githubConnector.map(rec, {});
  assert.equal(out[0].schema, 'resource');
  assert.equal(out[0].object.type, 'resource');
  assert.ok(fw.validateObject('resource', { ...out[0].object, maturity: 'raw' }).valid);
});

test('github map returns [] for an unknown record kind', () => {
  assert.deepEqual(githubConnector.map({ kind: 'label' }, {}), []);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/org-os-kms && node --test test/connectors-github.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the connector**

Create `packages/org-os-kms/src/connectors/github.mjs`:

```js
// src/connectors/github.mjs — REAL connector. GitHub as a knowledge source. pull shells out
// to the `gh` CLI (already a workspace dependency — no token wrangling); map is pure.
// Cursor = the highest issue/discussion updatedAt seen (ISO string), so pulls are incremental.
import { execFileSync } from 'node:child_process';

function ghJSON(args) {
  const out = execFileSync('gh', args, { encoding: 'utf8' });
  return JSON.parse(out || '[]');
}

export const githubConnector = {
  name: 'github',
  protocol: 'GitHub (gh CLI)',
  capabilities: { ingest: true, subscribe: false, publish: false },

  describe(config = {}) {
    const repos = config.repos || [];
    return {
      title: config.title || `GitHub: ${repos.join(', ') || 'unconfigured'}`,
      type: 'repo',
      steward: config.steward || 'GitHub repo maintainers',
      return_path: config.return_path || (repos[0] ? `https://github.com/${repos[0]}/issues` : 'https://github.com'),
      url: repos[0] ? `https://github.com/${repos[0]}` : 'https://github.com',
    };
  },

  // Network read via gh. include: which record kinds to pull (default issues).
  async pull(config = {}, { cursor } = {}) {
    const repos = config.repos || [];
    const include = config.include || ['issues'];
    const since = cursor || config.since || null;
    const records = [];
    let high = since;
    const bump = (ts) => { if (ts && (!high || ts > high)) high = ts; };

    for (const repo of repos) {
      if (include.includes('issues')) {
        const issues = ghJSON(['issue', 'list', '--repo', repo, '--state', 'all', '--limit', '200',
          '--json', 'number,title,body,url,updatedAt,author']);
        for (const it of issues) {
          if (since && it.updatedAt <= since) continue;
          records.push({ kind: 'issue', repo, ...it });
          bump(it.updatedAt);
        }
      }
      if (include.includes('releases')) {
        const rels = ghJSON(['release', 'list', '--repo', repo, '--limit', '100', '--json', 'name,tagName,url,publishedAt']);
        for (const r of rels) {
          if (since && r.publishedAt <= since) continue;
          records.push({ kind: 'release', repo, name: r.name || r.tagName, url: r.url, publishedAt: r.publishedAt, body: '' });
          bump(r.publishedAt);
        }
      }
    }
    return { records, cursor: high };
  },

  // PURE translation — no I/O. One foreign record → 0..n KB candidates.
  map(record, _config = {}) {
    if (record.kind === 'issue') {
      return [{ schema: 'signal', object: {
        title: record.title,
        type: 'signal',
        signal_type: 'content',
        interpretation: record.body || '',
        source_lineage: record.url,
        steward: (record.author && record.author.login) || 'unknown',
      } }];
    }
    if (record.kind === 'release') {
      return [{ schema: 'resource', object: {
        title: record.name,
        type: 'resource',
        resource_type: 'release',
        url: record.url,
        source_lineage: record.url,
      } }];
    }
    return [];
  },
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/org-os-kms && node --test test/connectors-github.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/org-os-kms/src/connectors/github.mjs packages/org-os-kms/test/connectors-github.test.mjs
git commit -m "feat(org-os-kms): add GitHub connector (issues+releases -> signal/resource)"
```

---

## Task 6: The KOI connector (real)

Wraps the existing KOI substrate. `pull` calls the KOI coordinator over HTTP (`/events/poll` + `/bundles/fetch`); `map` is pure and fully tested against a fixture bundle. `pull` is smoke-tested in Task 14.

**Files:**
- Create: `packages/org-os-kms/src/connectors/koi.mjs`
- Test: `packages/org-os-kms/test/connectors-koi.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `packages/org-os-kms/test/connectors-koi.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fw from '../src/framework.mjs';
import { koiConnector } from '../src/connectors/koi.mjs';

test('koi describe() is a valid source-system of type knowledge-garden', () => {
  const card = koiConnector.describe({ coordinator: 'https://regen.gaiaai.xyz/api/koi' });
  assert.equal(card.type, 'knowledge-garden');
  assert.ok(fw.validateObject('source-system', card).valid);
});

test('koi maps a NEW bundle to a valid resource, preserving the RID', () => {
  const bundle = {
    rid: 'rid:orgos:doc:refi-dao-local-node-model',
    event_type: 'NEW',
    manifest: { timestamp: '2026-07-01T00:00:00Z' },
    contents: { title: 'Local Node Model', text: 'A local node is...' },
  };
  const out = koiConnector.map(bundle, {});
  assert.equal(out.length, 1);
  assert.equal(out[0].schema, 'resource');
  const o = out[0].object;
  assert.equal(o.type, 'resource');
  assert.equal(o.title, 'Local Node Model');
  assert.equal(o.source_lineage, bundle.rid);
  assert.ok(fw.validateObject('resource', { ...o, maturity: 'raw' }).valid);
});

test('koi maps a FORGET event to a review-flagged signal (never a delete)', () => {
  const out = koiConnector.map({ rid: 'rid:orgos:doc:x', event_type: 'FORGET' }, {});
  assert.equal(out[0].schema, 'signal');
  assert.equal(out[0].object.signal_type, 'source-system');
  assert.equal(out[0].object.proposed_intervention, 'review');
  assert.ok(fw.validateObject('signal', { ...out[0].object, maturity: 'raw' }).valid);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/org-os-kms && node --test test/connectors-koi.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the connector**

Create `packages/org-os-kms/src/connectors/koi.mjs`:

```js
// src/connectors/koi.mjs — REAL connector. KOI-net as a knowledge source. Wraps the KOI
// coordinator HTTP surface (the same one packages/koi-bridge speaks): POST /events/poll for
// NEW/UPDATE/FORGET events, POST /bundles/fetch for contents. map is pure. Cursor = the KOI
// event sequence watermark (opaque). RID is preserved as source_lineage so KOI identity
// survives round-trips. subscribe (live event stream) is declared-but-deferred.
export const koiConnector = {
  name: 'koi',
  protocol: 'KOI-net',
  capabilities: { ingest: true, subscribe: false, publish: false },

  describe(config = {}) {
    const coordinator = config.coordinator || 'https://regen.gaiaai.xyz/api/koi';
    return {
      title: config.title || `KOI: ${config.rid_scope || coordinator}`,
      type: 'knowledge-garden',
      steward: config.steward || 'KOI federation',
      return_path: config.return_path || coordinator,
      url: coordinator,
    };
  },

  // Network read: poll events since cursor, fetch their bundles. Uses global fetch (Node 18+).
  async pull(config = {}, { cursor } = {}) {
    const coordinator = config.coordinator || 'https://regen.gaiaai.xyz/api/koi';
    const pollRes = await fetch(`${coordinator}/events/poll`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ since: cursor || null, rid_scope: config.rid_scope || null }),
    });
    if (!pollRes.ok) throw new Error(`KOI poll failed: ${pollRes.status}`);
    const { events = [], cursor: next } = await pollRes.json();
    const rids = events.filter((e) => e.event_type !== 'FORGET').map((e) => e.rid);
    let bundles = [];
    if (rids.length) {
      const fetchRes = await fetch(`${coordinator}/bundles/fetch`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rids }),
      });
      if (fetchRes.ok) bundles = (await fetchRes.json()).bundles || [];
    }
    const byRid = new Map(bundles.map((b) => [b.rid, b]));
    // Emit one record per event; NEW/UPDATE carry contents, FORGET carries none.
    const records = events.map((e) => ({ ...e, ...(byRid.get(e.rid) || {}) }));
    return { records, cursor: next !== undefined ? next : cursor };
  },

  // PURE translation.
  map(record, _config = {}) {
    if (record.event_type === 'FORGET') {
      return [{ schema: 'signal', object: {
        title: `KOI FORGET: ${record.rid}`,
        type: 'signal',
        signal_type: 'source-system',
        proposed_intervention: 'review',
        interpretation: `KOI signalled FORGET for ${record.rid}; review before removing anything.`,
        source_lineage: record.rid,
      } }];
    }
    const c = record.contents || {};
    return [{ schema: 'resource', object: {
      title: c.title || record.rid,
      type: 'resource',
      resource_type: 'document',
      original_source: record.rid,
      source_lineage: record.rid,
      notes: c.text ? String(c.text).slice(0, 500) : undefined,
    } }];
  },
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/org-os-kms && node --test test/connectors-koi.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/org-os-kms/src/connectors/koi.mjs packages/org-os-kms/test/connectors-koi.test.mjs
git commit -m "feat(org-os-kms): add KOI connector (events/bundles -> resource; FORGET -> review signal)"
```

---

## Task 7: The connector registry

**Files:**
- Create: `packages/org-os-kms/src/connectors/index.mjs`
- Test: `packages/org-os-kms/test/connectors-index.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `packages/org-os-kms/test/connectors-index.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getConnector, listConnectors } from '../src/connectors/index.mjs';

test('registry lists all six connectors', () => {
  assert.deepEqual(listConnectors().sort(), ['atproto', 'geo', 'github', 'koi', 'radicle', 'synthefy']);
});

test('getConnector returns the named connector', () => {
  assert.equal(getConnector('github').name, 'github');
  assert.equal(getConnector('koi').name, 'koi');
});

test('getConnector throws with the available list on an unknown name', () => {
  assert.throws(() => getConnector('nope'), /unknown connector: nope \(available: /);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/org-os-kms && node --test test/connectors-index.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the registry**

Create `packages/org-os-kms/src/connectors/index.mjs`:

```js
// src/connectors/index.mjs — the connector registry. name -> connector object. Mirrors the
// framework's storage-adapter registry shape (getAdapter/listAdapters). The lifecycle op and
// CLI resolve connectors through here; concrete protocol drivers live in sibling files.
import { githubConnector } from './github.mjs';
import { koiConnector } from './koi.mjs';
import { geoConnector } from './geo.mjs';
import { radicleConnector } from './radicle.mjs';
import { atprotoConnector } from './atproto.mjs';
import { synthefyConnector } from './synthefy.mjs';

const CONNECTORS = {
  github: githubConnector,
  koi: koiConnector,
  geo: geoConnector,
  radicle: radicleConnector,
  atproto: atprotoConnector,
  synthefy: synthefyConnector,
};

export function listConnectors() { return Object.keys(CONNECTORS); }

export function getConnector(name) {
  const c = CONNECTORS[name];
  if (!c) throw new Error(`unknown connector: ${name} (available: ${listConnectors().join(', ')})`);
  return c;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/org-os-kms && node --test test/connectors-index.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/org-os-kms/src/connectors/index.mjs packages/org-os-kms/test/connectors-index.test.mjs
git commit -m "feat(org-os-kms): add connector registry (getConnector/listConnectors)"
```

---

## Task 8: Cursor persistence in config

`ingest.pull` writes each connector's advanced cursor back to `kms.yaml` so the next pull is incremental. Add a focused writer to `config.mjs`.

**Files:**
- Modify: `packages/org-os-kms/src/config.mjs`
- Test: `packages/org-os-kms/test/config.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `packages/org-os-kms/test/config.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { persistConnectorCursors } from '../src/config.mjs';

test('persistConnectorCursors updates connector cursors in kms.yaml without clobbering other keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kms-cfg-'));
  writeFileSync(join(dir, 'kms.yaml'), yaml.dump({
    instance: 'test', adapter: 'repo-data', target: '.',
    connectors: [{ name: 'github', config: { repos: ['a/b'] }, cursor: null }],
  }));
  persistConnectorCursors(dir, [{ name: 'github', config: { repos: ['a/b'] }, cursor: '2026-07-01T00:00:00Z' }]);
  const doc = yaml.load(readFileSync(join(dir, 'kms.yaml'), 'utf8'));
  assert.equal(doc.instance, 'test');            // untouched
  assert.equal(doc.connectors[0].cursor, '2026-07-01T00:00:00Z'); // updated
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/org-os-kms && node --test test/config.test.mjs`
Expected: FAIL — `persistConnectorCursors` is not exported.

- [ ] **Step 3: Implement**

In `packages/org-os-kms/src/config.mjs`, add imports at top and the new function at the bottom, and default `connectors: []` in `loadKmsConfig`'s return:

```js
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import * as fw from './framework.mjs';

export function loadKmsConfig(dir = '.') {
  const cfg = fw.loadConfig(dir);
  if (!cfg) throw new Error(`not an initialized instance (no kms.yaml): ${dir}`);
  if (!cfg.adapter) throw new Error('kms.yaml: missing "adapter"');
  if (cfg.target === undefined) throw new Error('kms.yaml: missing "target"');
  return { render: {}, peers: {}, connectors: [], ...cfg };
}

/** Write advanced cursors back into kms.yaml. Reads the file, replaces the `connectors`
 *  list with the passed-in one (cursors updated), writes once. Other keys are preserved. */
export function persistConnectorCursors(dir, connectors) {
  const path = join(dir, 'kms.yaml');
  const doc = yaml.load(readFileSync(path, 'utf8')) || {};
  doc.connectors = connectors;
  writeFileSync(path, yaml.dump(doc, { lineWidth: -1 }));
  return { path, connectors: connectors.length };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/org-os-kms && node --test test/config.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/org-os-kms/src/config.mjs packages/org-os-kms/test/config.test.mjs
git commit -m "feat(org-os-kms): persist connector cursors to kms.yaml"
```

---

## Task 9: The `ingest.pull` lifecycle op

Reads `ctx.config.connectors`, runs each via `runConnector` + the registry, writes cursors back, and reports per connector. A stub's `NOT_IMPLEMENTED` is reported and skipped (never aborts a live connector); any other error fails the op hard (it is `write:true`). The registry is injectable (`ctx.getConnector`) for testing.

**Files:**
- Modify: `packages/org-os-kms/src/ops.mjs`
- Test: `packages/org-os-kms/test/ops.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `packages/org-os-kms/test/ops.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPS } from '../src/ops.mjs';

function fakeAdapterFactory() {
  const stored = [];
  return { name: 'mem', store(_t, e) { stored.push(...e); return { stored: e.map((_x, i) => `r${i}`) }; }, _stored: stored };
}

test('ingest.pull runs declared connectors, reports per-connector, writes cursors back', async () => {
  const adapter = fakeAdapterFactory();
  const good = {
    name: 'good', protocol: 'G', capabilities: { ingest: true },
    describe: () => ({ title: 'Good', type: 'repo', steward: 't', return_path: 'https://x.org' }),
    pull: async () => ({ records: [{ t: 'A' }], cursor: 'cur-1' }),
    map: (r) => [{ schema: 'signal', object: { title: r.t, type: 'signal', signal_type: 'content' } }],
  };
  const persisted = [];
  const ctx = {
    dir: '/tmp/none',
    config: { adapter: 'x', target: '.', connectors: [{ name: 'good', config: {}, cursor: null }] },
    // injected seams (avoid real registry / real fs / real getAdapter):
    getConnector: (n) => (n === 'good' ? good : (() => { throw new Error(`unknown ${n}`); })()),
    getAdapter: () => adapter,
    persistCursors: (_dir, conns) => persisted.push(...conns),
  };
  const res = await OPS['ingest.pull'].run(ctx);
  assert.equal(res.ok, true);
  assert.equal(res.report.pulled[0].name, 'good');
  assert.equal(res.report.pulled[0].stored, 2); // card + 1 signal
  assert.equal(persisted[0].cursor, 'cur-1');    // cursor written back
});

test('ingest.pull skips a NOT_IMPLEMENTED stub without failing the op', async () => {
  const stub = {
    name: 'stub', protocol: 'S', capabilities: { ingest: true },
    describe: () => ({ title: 'S', type: 'repo', steward: 't', return_path: 'https://x.org' }),
    pull() { throw new Error('NOT_IMPLEMENTED: stub'); }, map: () => [],
  };
  const ctx = {
    dir: '/tmp/none',
    config: { adapter: 'x', target: '.', connectors: [{ name: 'stub', config: {}, cursor: null }] },
    getConnector: () => stub,
    getAdapter: () => fakeAdapterFactory(),
    persistCursors: () => {},
  };
  const res = await OPS['ingest.pull'].run(ctx);
  assert.equal(res.ok, true);
  assert.equal(res.report.pulled[0].skipped, 'NOT_IMPLEMENTED');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/org-os-kms && node --test test/ops.test.mjs`
Expected: FAIL — `OPS['ingest.pull']` is undefined.

- [ ] **Step 3: Implement the op**

In `packages/org-os-kms/src/ops.mjs`, add imports and the new op. At the top with the other imports:

```js
import { getConnector as defaultGetConnector } from './connectors/index.mjs';
import { persistConnectorCursors } from './config.mjs';
```

Then add this entry inside the `OPS` object (place it before `'bridge'`):

```js
  // Pull knowledge from declared connectors into the KB. write:true → fail-hard on a real
  // error; a stub's NOT_IMPLEMENTED is reported+skipped so it never aborts a live connector.
  'ingest.pull': { kind: 'exec', write: true, run: async (ctx) => {
    const getConn = ctx.getConnector || defaultGetConnector;
    const adapter = ctx.getAdapter ? ctx.getAdapter(ctx.config.adapter) : fw.getAdapter(ctx.config.adapter);
    const persist = ctx.persistCursors || persistConnectorCursors;
    const target = ctx.config.target === '.' ? ctx.dir : join(ctx.dir, ctx.config.target);
    const connectors = ctx.config.connectors || [];
    const report = { pulled: [], errors: [] };
    for (const decl of connectors) {
      try {
        const conn = getConn(decl.name);
        const res = await fw.runConnector(conn, { config: decl.config || {}, cursor: decl.cursor ?? null, adapter, target });
        decl.cursor = res.cursor;
        report.pulled.push({ name: decl.name, stored: res.stored, candidates: res.candidates, errors: res.errors });
        if (res.errors.length) report.errors.push(...res.errors.map((e) => `${decl.name}: ${e}`));
      } catch (e) {
        if (/NOT_IMPLEMENTED/.test(e.message)) { report.pulled.push({ name: decl.name, skipped: 'NOT_IMPLEMENTED' }); continue; }
        report.errors.push(`${decl.name}: ${e.message}`);
      }
    }
    persist(ctx.dir, connectors);
    return { ok: report.errors.length === 0, report };
  } },
```

Note: `join` is already imported at the top of `ops.mjs` (`import { join } from 'node:path'`).

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/org-os-kms && node --test test/ops.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/org-os-kms/src/ops.mjs packages/org-os-kms/test/ops.test.mjs
git commit -m "feat(org-os-kms): add ingest.pull lifecycle op (connectors -> review queue)"
```

---

## Task 10: Wire `ingest.pull` into the close lifecycle + connector defaults

Prepend `ingest.pull` to the `close` sequence so the pull → review → bridge order holds. Add a `CONNECTOR_DEFAULTS` table (the profile/bind twin, mirrored in Task 13).

**Files:**
- Modify: `packages/org-os-kms/src/bind.mjs`
- Test: `packages/org-os-kms/test/bind.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `packages/org-os-kms/test/bind.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIFECYCLE_BINDINGS, CONNECTOR_DEFAULTS } from '../src/bind.mjs';

test('close lifecycle runs ingest.pull first, then csis-review, then bridge', () => {
  const close = LIFECYCLE_BINDINGS.close;
  assert.equal(close[0], 'ingest.pull');
  assert.ok(close.indexOf('ingest.pull') < close.indexOf('csis-review'));
  assert.ok(close.indexOf('csis-review') < close.indexOf('bridge'));
});

test('CONNECTOR_DEFAULTS documents the available connectors', () => {
  assert.deepEqual(Object.keys(CONNECTOR_DEFAULTS).sort(), ['atproto', 'geo', 'github', 'koi', 'radicle', 'synthefy']);
  assert.equal(CONNECTOR_DEFAULTS.github.status, 'active');
  assert.equal(CONNECTOR_DEFAULTS.geo.status, 'stub');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/org-os-kms && node --test test/bind.test.mjs`
Expected: FAIL — `ingest.pull` not first / `CONNECTOR_DEFAULTS` undefined.

- [ ] **Step 3: Update bind.mjs**

In `packages/org-os-kms/src/bind.mjs`, replace the `close` array and add `CONNECTOR_DEFAULTS`:

```js
export const LIFECYCLE_BINDINGS = {
  initialize: ['config.load', 'index.rebuild', 'review.list', 'render.dashboard', 'render.site'],
  close: ['ingest.pull', 'csis-review', 'bridge', 'emit-contributions', 'federate.check', 'index.rebuild', 'render.site', 'render.dashboard', 'sync.push'],
};

/** Available connectors + build status (the profile twin — mirror in profile/profile.yaml). */
export const CONNECTOR_DEFAULTS = {
  github:   { status: 'active', protocol: 'GitHub (gh CLI)' },
  koi:      { status: 'active', protocol: 'KOI-net' },
  geo:      { status: 'stub',   protocol: 'Geo (IPFS + The Graph)' },
  radicle:  { status: 'stub',   protocol: 'Radicle (p2p git COBs)' },
  atproto:  { status: 'stub',   protocol: 'AT Protocol (Bluesky)' },
  synthefy: { status: 'stub',   protocol: 'Synthefy' },
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/org-os-kms && node --test test/bind.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/org-os-kms/src/bind.mjs packages/org-os-kms/test/bind.test.mjs
git commit -m "feat(org-os-kms): run ingest.pull first on close; add CONNECTOR_DEFAULTS"
```

---

## Task 11: CLI `ingest` verb

`org-os-kms ingest [--connector <name>] [--dir <dir>] [--dry]`. `--dry` returns the parsed route only (like the existing dispatch contract). Without `--dry` it runs `ingest.pull` for all declared connectors, or just one if `--connector` is given.

**Files:**
- Modify: `packages/org-os-kms/src/cli.mjs`
- Test: `packages/org-os-kms/test/cli.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `packages/org-os-kms/test/cli.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispatch } from '../src/cli.mjs';

test('ingest is a known verb (dry parse)', () => {
  const r = dispatch(['ingest', '--connector', 'github', '--dir', '/tmp/x'], { dry: true });
  assert.equal(r.verb, 'ingest');
  assert.equal(r.flags.connector, 'github');
  assert.equal(r.flags.dir, '/tmp/x');
});

test('unknown verb still rejected', () => {
  assert.equal(dispatch(['frobnicate'], { dry: true }).error, 'unknown verb: frobnicate');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/org-os-kms && node --test test/cli.test.mjs`
Expected: FAIL — `ingest` is not in `VERBS`, so `dispatch` returns `{ error: 'unknown verb: ingest' }`.

- [ ] **Step 3: Implement the verb**

In `packages/org-os-kms/src/cli.mjs`:

(a) Add `'ingest'` to the `VERBS` set:

```js
const VERBS = new Set(['lifecycle', 'bridge', 'render', 'federate', 'promote', 'init', 'ingest']);
```

(b) Import the op registry at the top with the other imports:

```js
import { OPS } from './ops.mjs';
```

(c) Add the case inside the `switch (verb)` block (after `case 'lifecycle':`):

```js
    case 'ingest': {
      const cfg = loadKmsConfig(dir);
      // Optionally narrow to a single connector.
      if (flags.connector) cfg.connectors = (cfg.connectors || []).filter((c) => c.name === flags.connector);
      return await OPS['ingest.pull'].run({ dir, config: cfg });
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/org-os-kms && node --test test/cli.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `cd packages/org-os-kms && node --test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/org-os-kms/src/cli.mjs packages/org-os-kms/test/cli.test.mjs
git commit -m "feat(org-os-kms): add `ingest` CLI verb (all connectors or --connector <name>)"
```

---

## Task 12: Cohesion — per-instance registry-binding overrides

Let an instance override `REGISTRY_BINDINGS` from `kms.yaml` (`registry_bindings:`), so refi-dao-os can express its Quartz content path as config instead of vendored source edits.

**Files:**
- Modify: `packages/org-os-kms/src/bind.mjs` (add `effectiveBindings`)
- Modify: `packages/org-os-kms/src/registry-bridge.mjs` (use it)
- Test: `packages/org-os-kms/test/registry-bridge.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `packages/org-os-kms/test/registry-bridge.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveBindings } from '../src/bind.mjs';

test('effectiveBindings overlays kms.yaml registry_bindings over the defaults', () => {
  const eff = effectiveBindings({ registry_bindings: { 'encyclopedia-entry': 'content/kb/' } });
  assert.equal(eff['encyclopedia-entry'], 'content/kb/');   // overridden
  assert.equal(eff.resource, 'data/resources.yaml');         // default preserved
});

test('effectiveBindings returns the defaults when no override is present', () => {
  const eff = effectiveBindings({});
  assert.equal(eff['encyclopedia-entry'], 'src/content/docs/kb/');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/org-os-kms && node --test test/registry-bridge.test.mjs`
Expected: FAIL — `effectiveBindings` not exported.

- [ ] **Step 3: Add `effectiveBindings` to bind.mjs**

In `packages/org-os-kms/src/bind.mjs`, add:

```js
/** The registry bindings a given instance uses: defaults overlaid with kms.yaml overrides.
 *  Lets an instance repoint a target (e.g. a Quartz content dir) via config, not code edits. */
export function effectiveBindings(config = {}) {
  return { ...REGISTRY_BINDINGS, ...(config.registry_bindings || {}) };
}
```

- [ ] **Step 4: Use it in registry-bridge.mjs**

In `packages/org-os-kms/src/registry-bridge.mjs`:

(a) Change the import to also pull in `effectiveBindings`:

```js
import { REGISTRY_BINDINGS, effectiveBindings } from './bind.mjs';
```

(b) In `bridge(ctx)`, compute the effective bindings once and use them instead of the imported constant. Replace the top of `bridge`:

```js
export function bridge(ctx) {
  const { dir, config } = ctx;
  const bindings = effectiveBindings(config);
  const items = fw.getAdapter(config.adapter).list(join(dir, config.target));
  const report = { bridged: [], docs: [], skipped: [], errors: [] };
  const byRegistry = new Map();

  for (const { schema, object } of items) {
    const registry = bindings[schema];
    // ...unchanged below...
```

(The rest of the function body is unchanged — only the `REGISTRY_BINDINGS[schema]` lookup becomes `bindings[schema]`.)

- [ ] **Step 5: Run to verify it passes**

Run: `cd packages/org-os-kms && node --test test/registry-bridge.test.mjs`
Expected: PASS (new + existing bridge tests).

- [ ] **Step 6: Commit**

```bash
git add packages/org-os-kms/src/bind.mjs packages/org-os-kms/src/registry-bridge.mjs packages/org-os-kms/test/registry-bridge.test.mjs
git commit -m "feat(org-os-kms): per-instance registry-binding overrides via kms.yaml"
```

---

## Task 13: Profile block + documentation

**Files:**
- Modify: `packages/org-os-kms/profile/profile.yaml`
- Modify: `packages/org-os-kms/README.md`
- Create: `packages/org-os-kms/docs/CONNECTORS.md`

- [ ] **Step 1: Add the connectors block to the profile**

In `packages/org-os-kms/profile/profile.yaml`, after the `lifecycle_bindings:` block, add (keep the mirror-comment convention the file already uses):

```yaml
# Available connectors (composition surface). Mirror src/bind.mjs CONNECTOR_DEFAULTS.
# An instance declares which of these it composes in its own kms.yaml `connectors:` list.
connectors:
  github:   { status: active, protocol: "GitHub (gh CLI)" }
  koi:      { status: active, protocol: "KOI-net" }
  geo:      { status: stub,   protocol: "Geo (IPFS + The Graph)" }
  radicle:  { status: stub,   protocol: "Radicle (p2p git COBs)" }
  atproto:  { status: stub,   protocol: "AT Protocol (Bluesky)" }
  synthefy: { status: stub,   protocol: "Synthefy" }
```

- [ ] **Step 2: Write the connectors doc**

Create `packages/org-os-kms/docs/CONNECTORS.md`:

```markdown
# Connectors

A **connector** is a source driver for one external protocol. It presents itself as a
`source-system` peer (`describe`), fetches foreign records since an opaque cursor (`pull`),
and translates each record into framework KB candidates (`map`). Connectors feed the
framework's `ingest → store → review` pipeline — they do not replace storage or federation.

## Composing a knowledge base

Declare connectors in your instance's `kms.yaml`:

```yaml
connectors:
  - name: github
    config:
      repos: ["ORG/repo-a", "ORG/repo-b"]
      include: [issues, releases]
    cursor: null            # written back after each pull (incremental)
  - name: koi
    config:
      coordinator: "https://regen.gaiaai.xyz/api/koi"
      rid_scope: "rid:orgos:org:your-org"
    cursor: null
```

`ingest.pull` runs on `/close` (first, so pulled objects are reviewed the same session and
bridged only after review). Or run it manually:

```bash
node src/cli.mjs ingest --connector github     # one connector
node src/cli.mjs ingest                         # all declared connectors
```

## Contract

| method | purpose |
|---|---|
| `describe(config)` | this source AS a `source-system` card (identity/peer) |
| `pull(config, {cursor})` | fetch records since cursor → `{ records, cursor }` (network; may be async) |
| `map(record, config)` | PURE: one record → `[{ schema, object }]` KB candidates |
| `capabilities` | `{ ingest, subscribe, publish }` — only `ingest` is built today |

Cursors are connector-opaque tokens — the orchestrator stores and replays them, never inspects.
All KB candidates are stamped `maturity: raw` and pass `csis-review` before becoming canonical.
Outbound (`publish`) is draft-and-present only.

## Status

| connector | status | notes |
|---|---|---|
| `github` | active | issues → signal, releases → resource (via `gh` CLI) |
| `koi` | active | events/bundles → resource; FORGET → review signal |
| `geo` | stub | read side of the Geo graph; spec in `src/connectors/geo.mjs` |
| `radicle` | stub | p2p-git COBs; spec in `src/connectors/radicle.mjs` |
| `atproto` | stub | Bluesky lexicon records; spec in `src/connectors/atproto.mjs` |
| `synthefy` | stub | OPEN — needs protocol docs; spec in `src/connectors/synthefy.mjs` |

Stubs are registered and discoverable; their `pull` throws `NOT_IMPLEMENTED` and the docstring
is the implementation spec. Building one = fill in `pull`/`map`, flip status to active.
```

- [ ] **Step 3: Add a Connectors section to the README**

In `packages/org-os-kms/README.md`, add a short section linking to the doc:

```markdown
## Connectors

`@org-os/kms` composes external protocols into a knowledge base. Declare them in `kms.yaml`
`connectors:`; they feed the framework's ingest → store → review pipeline. GitHub and KOI are
live; Geo, Radicle, atproto, and Synthefy are specced stubs. See `docs/CONNECTORS.md`.
```

- [ ] **Step 4: Sanity-check the profile YAML parses**

Run: `cd packages/org-os-kms && node -e "import('js-yaml').then(y => (console.log('connectors:', Object.keys(y.default.load(require('fs').readFileSync('profile/profile.yaml','utf8')).connectors))))"`
Expected: `connectors: [ 'github', 'koi', 'geo', 'radicle', 'atproto', 'synthefy' ]`

- [ ] **Step 5: Commit**

```bash
git add packages/org-os-kms/profile/profile.yaml packages/org-os-kms/README.md packages/org-os-kms/docs/CONNECTORS.md
git commit -m "docs(org-os-kms): profile connectors block + CONNECTORS.md + README section"
```

---

## Task 14: Proving-ground validation (runtime, not unit tests)

Validate the layer end-to-end against real instances. This task produces no code — it runs the layer and records results. STOP and report to the operator if any step disturbs existing KB entries.

**Files:**
- Modify: `packages/org-os-kms/README.md` (append a short "Validated against" note with results)

- [ ] **Step 1: Full unit suite green in both packages**

Run: `cd packages/toolkit-framework && node --test` then `cd packages/org-os-kms && node --test`
Expected: both suites pass; org-os-kms ≥ 65 baseline + all new tests.

- [ ] **Step 2: Dry CLI route check**

Run: `cd packages/org-os-kms && node src/cli.mjs ingest --connector github --dir /tmp/none` — but FIRST confirm `/tmp/none` has no `kms.yaml` so this only checks error handling.
Expected: a clean error message `✗ not an initialized instance (no kms.yaml): /tmp/none`, exit 1 (proves the verb is wired and fails safe).

- [ ] **Step 3: Cold-start proof against org-os itself (empty KB scaffold)**

In a scratch copy or the org-os instance, add a minimal `kms.yaml` with one github connector pointing at a small public repo you control, then:

Run: `node packages/org-os-kms/src/cli.mjs ingest --connector github --dir <instance-dir>`
Expected: JSON report with `pulled[0].name === 'github'`, `stored >= 1`, `errors: []`. Inspect `<instance-dir>/data/kb/signal.yaml` — new entries exist with `maturity: raw` and `provenance.origin`.

- [ ] **Step 4: Non-destructive proof against refi-dao-os (primary proving ground)**

FIRST snapshot the count: `node -e "const y=require('js-yaml');const d=y.load(require('fs').readFileSync('<refi-dao>/data/kb/signal.yaml','utf8'));console.log(Object.keys(d.entries||{}).length)"` — record N.
Add a `connectors:` block to refi-dao-os `kms.yaml` (github → `ReFiDAO/refi-dao-os`, koi → the regen coordinator). Run the pull, then re-count.
Expected: the pre-existing 104 KB entries are all still present (count ≥ N; upsert-by-id never deletes); new candidates land in the review queue as `raw`.

- [ ] **Step 5: Idempotency proof**

Run the same pull from Step 4 a second time immediately.
Expected: no duplicate entries (store is idempotent by slug; the second run's `stored` count reflects upserts, not new rows). Re-count KB entries = same as after Step 4.

- [ ] **Step 6: Record results + commit**

Append a short "Validated 2026-07-19: cold-start (org-os), non-destructive + idempotent (refi-dao-os)" note with the observed counts to `packages/org-os-kms/README.md`.

```bash
git add packages/org-os-kms/README.md
git commit -m "docs(org-os-kms): record connector-layer proving-ground validation"
```

---

## Self-review checklist (completed by plan author)

- **Spec coverage:** contract (T1) · placement framework-side/kms-side (T1–T2) · async lifecycle for I/O (T3) · 4 stubs incl. geo read side (T4) · github real (T5) · koi real + FORGET-as-review (T6) · registry (T7) · cursor persistence (T8) · `ingest.pull` op with NOT_IMPLEMENTED skip + fail-hard (T9) · close-lifecycle order pull→review→bridge + CONNECTOR_DEFAULTS (T10) · CLI verb (T11) · binding-override cohesion fix (T12) · profile/docs twin (T13) · proving ground: cold-start + non-destructive + idempotent (T14). All spec sections map to a task.
- **Placeholder scan:** the only "TODO"s are inside `synthefy.mjs`'s spec docstring, which is intentional (the protocol is unknown) and required by the spec's "Open questions". No plan-level placeholders.
- **Type consistency:** `runConnector(connector, {config,cursor,adapter,target})` and its `{source,stored,candidates,cursor,errors}` return shape are used identically in T1, T9. `getConnector`/`listConnectors` (T7) match usage in T9/T11. `effectiveBindings(config)` (T12) matches its registry-bridge use. `persistConnectorCursors(dir, connectors)` (T8) matches the `persist`/`ctx.persistCursors` seam in T9. Object shapes (`signal`: title/type/signal_type; `resource`: title/type; `source-system`: title/type/steward/return_path) match the schemas verified against real KB entries.

## Execution handoff

Non-goals (do NOT build here): live `subscribe`, real `publish`/contribute-back, refi-bcn-os paradigm migration (stub plan lives in `refi-bcn-os/docs/plans/org-os-kms-adoption.md`), Notion & Synthefy implementations.
