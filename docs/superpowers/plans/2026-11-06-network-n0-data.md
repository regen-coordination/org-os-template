# Network N0 (federation and systems data) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give org-os the data layer that opening instances and federation build on:
- `federation.yaml` can say which networks an instance is in and how a hub node takes join requests;
- each federation link's state is computed from both sides;
- `.well-known/federation.json` publishes the instance's own public claims;
- `repo` Systems can be mounted, with `repos.manifest.json` derived from them.

**Architecture:** Two new pure modules in `packages/admin/lib/federation/`:
- `read.mjs` normalises every shape of `federation.yaml` that real instances hold.
- `peers.mjs` turns peer references into comparable addresses and computes a link's state through an injected `io`.

Three callers use them:
- the fleet adapter (the Systems board);
- the standards builder, which adds `federation.json`;
- `validate-identity.mjs`, which warns and never fails.

Separately, the Systems schema gains `mount` and `purpose`, and a small script derives `repos.manifest.json` from them.

**Tech Stack:** Node ESM `.mjs` (JSDoc types), TypeScript server, vitest (`packages/admin`), `node --test` (root), `yaml` / `js-yaml` as already used.

**Spec:** `docs/superpowers/specs/2026-11-06-org-os-open-and-federate-design.md`: §4.1, §6.1–6.3, §9 N0, and §12 R1–R5, which bind over the earlier sections.

**Not in N0 (moved to N1, where the staging screens are):**
- the one-time import of `repos.manifest.json` entries as staged `repo` Systems (spec §4.1);
- the Systems page facts for mounted repos (branch, ahead/behind, uncommitted work; spec §4.2).

## Global Constraints

- **Branch and pushing:** work only on `feat/network`, in worktree `~/.cache/lf-worktrees/org-os-network`. Never push. Never merge into `feat/dao-os`, `release/0.6` or `feat/platform-full*`.
- **Vendoring rule:** `lib/federation/*.mjs` imports nothing from npm and no `node:` built-in. It is pulled into instances through the standards builder's imports (`scripts/lib/standards-vendor.mjs`: only `standards/load.mjs` may import `node:fs` and `node:path`).
- **Warnings only:** federation warnings never fail `validate:schemas`. It keeps exiting 0 by default and 1 only under `--strict`.
- **Nothing is moved:** nothing moves, rewrites or removes a `peers` entry. Nothing removes a `repos.manifest.json` entry.
- **What gets published:**
  - A peer goes into `federation.json` only when its `url` is `https:` and it isn't `visibility: private`.
  - A peer's `notes`, `contact` and `relationship` are never published, and neither are local paths.
  - Every withheld peer is counted, never written.
- **Link states:** `mutual` · `claimed` · `not-an-instance` · `unknown` (spec §12 R4). `requested` and `left` don't exist in N0.
- **Join policies (spec §6.2):** `closed` · `invite` · `open-with-approval` · `open`.
- **`purpose` values (spec §12 R1):** `website` · `knowledge` · `app` · `contracts` · `data` · `fork` · `archive` · `other`.
- **Git in tests:** any test that runs git does it in a fresh temp repo (`makeFixtureRepo` or `mkdtemp`), never this checkout.
- **Running tests:** run one test file per step. Run full suites only in Task 7, one at a time; the machine has 16 GB of memory and other suites may be running.
- **Commits:** every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Copy:** user-facing sentences are plain English, say what to do, and contain no jargon.

## Review Focus

1. **Local-only and private peers.** A peer known only by a local path (like a private local sibling instance in lf-work-os, withheld because it has no `url`), or marked `visibility: private`, must never appear in `federation.json`. Pinned in Task 4.
2. **A bare `repos/egregore` reference to a local folder.** It must read as a path, not as GitHub user `repos`. Pinned in Task 2.
3. **Remote URL forms.** The other side may list this instance as `git@github.com:Org/Repo.git`, `https://github.com/org/repo`, or with a trailing `/` or `.git`. The link must still read as mutual. Pinned in Task 2.
4. **A broken peer file.** A peer folder whose `federation.yaml` is not valid YAML must read `unknown` with the reason. It must not crash, and it must not read `not-an-instance`. Pinned in Task 2.
5. **No mounted Systems yet.** With no System carrying `mount`, `repos.manifest.json` stays byte-for-byte untouched. With some, manifest entries that no System names are kept. Pinned in Task 6.

---

### Task 1: Read every shape of `federation.yaml`

**Files:**
- Create: `packages/admin/lib/federation/read.mjs`
- Test: `packages/admin/tests/lib/federation-read.test.ts`

**Interfaces:**
- Produces:

```js
export const JOIN_POLICIES // Object.freeze(['closed', 'invite', 'open-with-approval', 'open'])
export const TRUST_LEVELS  // Object.freeze(['full', 'read', 'read-write', 'none'])
/** @typedef {{ name: string, hub: string | null, role: string | null }} Network */
/** @typedef {{ index: number, name: string, ref: string | null, url: string | null, type: string | null,
 *   trust: string | null, relationship: string | null, since: string | null, decision: string | null,
 *   private: boolean }} Peer */
/** @typedef {{ policy: string, types: string[], asks: string[], where: string | null }} Join */
/** @typedef {{ level: 'warn', text: string }} FederationProblem */
export function readFederation(doc /* unknown: parsed YAML */)
  // → { identity: Record<string, unknown>, networks: Network[], peers: Peer[], join: Join | null, problems: FederationProblem[] }
```

- [ ] **Step 0: Install dependencies in the fresh worktree**

Run: `cd ~/.cache/lf-worktrees/org-os-network && npm ci && npm ci --prefix packages/admin`
Expected: both finish without errors.

- [ ] **Step 1: Write the failing tests.** Each case's input is a small object shaped like the real files (spec §12 R2).

```ts
import { readFederation, JOIN_POLICIES } from '../../lib/federation/read.mjs'

it('reads legacy network + hub as a string into one network', () => {
  expect(readFederation({ network: 'regen-coordination', hub: 'https://hub.regencoordination.xyz/' }).networks)
    .toEqual([{ name: 'regen-coordination', hub: 'https://hub.regencoordination.xyz/', role: null }])
})
it('reads legacy hub as an object {name, repo}', () => {
  expect(readFederation({ network: 'lf-personal', hub: { name: 'LF Zettelkasten OS', repo: '../../' } }).networks)
    .toEqual([{ name: 'lf-personal', hub: '../../', role: null }])
})
it('prefers networks over network/hub and warns once', () => {
  const r = readFederation({ network: 'old', networks: [{ name: 'refi-dao', hub: 'https://github.com/ReFiDAO/refi-dao-os', role: 'node' }] })
  expect(r.networks.map(n => n.name)).toEqual(['refi-dao'])
  expect(r.problems).toEqual([{ level: 'warn', text: 'federation.yaml: network and hub are ignored because networks is set.' }])
})
it('no network at all gives an empty list and no problem', () => {
  expect(readFederation({ identity: { name: 'X' } })).toMatchObject({ networks: [], peers: [], join: null, problems: [] })
})
it('keeps every peer with a name, in order, with its index; skips and warns on one without', () => {
  const r = readFederation({ peers: [
    { name: 'ReFi DAO', repo: '../refi-dao-os', url: 'https://github.com/ReFiDAO/refi-dao-os', trust: 'read', relationship: 'network-seat' },
    { repo: 'x/y' },
    { name: 'altiplano', repo: 'repos/altiplano', url: 'https://github.com/a/altiplano', trust: 'read', visibility: 'private' },
  ] })
  expect(r.peers.map(p => [p.index, p.name, p.private])).toEqual([[0, 'ReFi DAO', false], [2, 'altiplano', true]])
  expect(r.peers[0]).toMatchObject({ ref: '../refi-dao-os', relationship: 'network-seat', since: null, decision: null })
  expect(r.problems).toEqual([{ level: 'warn', text: 'federation.yaml: peers #2 has no name; it is skipped.' }])
})
it("accepts trust read-write (real instances use it) and warns on a value it doesn't know", () => {
  const r = readFederation({ peers: [{ name: 'A', trust: 'read-write' }, { name: 'B', trust: 'admin' }] })
  expect(r.peers.map(p => p.trust)).toEqual(['read-write', 'admin'])
  expect(r.problems).toEqual([{ level: 'warn', text: 'federation.yaml: peer "B" has trust "admin"; expected one of full, read, read-write, none.' }])
})
it('reads join on a hub node', () => {
  expect(readFederation({ join: { policy: 'open-with-approval', types: ['LocalNode'], asks: ['operator', 'portal'], where: 'https://github.com/ReFiDAO/refi-dao-os' } }).join)
    .toEqual({ policy: 'open-with-approval', types: ['LocalNode'], asks: ['operator', 'portal'], where: 'https://github.com/ReFiDAO/refi-dao-os' })
})
it('drops a join whose policy is unknown, with the four policies named', () => {
  const r = readFederation({ join: { policy: 'maybe' } })
  expect(r.join).toBeNull()
  expect(r.problems[0]!.text).toBe(`federation.yaml: join.policy "maybe" is not one of ${JOIN_POLICIES.join(', ')}; join is ignored.`)
})
it('reads a non-object document as empty', () => {
  expect(readFederation(null)).toMatchObject({ identity: {}, networks: [], peers: [], join: null })
})
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `cd packages/admin && npx vitest run tests/lib/federation-read.test.ts`
Expected: FAIL, because the module isn't found.

- [ ] **Step 3: Implement `readFederation` in `packages/admin/lib/federation/read.mjs`.**
  - No imports.
  - `hub` reads as follows: a string stays as it is; an object gives `url ?? repo ?? null`.
  - A legacy network is produced only when `network` is a non-empty string.
  - `since` and `decision` are strings or `null`.
  - `types` and `asks` keep only their string items, and default to `[]`.

- [ ] **Step 4: Run the tests and check they pass**

Run: `cd packages/admin && npx vitest run tests/lib/federation-read.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/admin/lib/federation/read.mjs packages/admin/tests/lib/federation-read.test.ts
git commit -m "feat(network N0): read every shape of federation.yaml — networks, peers, join"
```

---

### Task 2: Peer addresses and link state

**Files:**
- Create: `packages/admin/lib/federation/peers.mjs`
- Test: `packages/admin/tests/lib/federation-peers.test.ts`

**Interfaces:**
- Consumes: `readFederation` (Task 1).
- Produces:

```js
/** @typedef {{ kind: 'github', owner: string, repo: string, path: string }
 *   | { kind: 'url', href: string } | { kind: 'path', path: string }} Address  // path: absolute */
/** @typedef {{ resolve(base: string, rel: string): string, isDir(abs: string): boolean,
 *   readFederationAt(abs: string): { found: false } | { found: true, doc: unknown } | { found: true, error: string } }} PeerIO */
export const LINK_STATES // Object.freeze(['mutual', 'claimed', 'not-an-instance', 'unknown'])
export function addressOf(ref /* string */, base /* string */, io /* PeerIO */) // → Address | null
export function sameAddress(a /* Address */, b /* Address */) // → boolean
export function selfAddresses(root /* string */, remotes /* string[] */, io /* PeerIO */) // → Address[]
export function isPublicUrl(url /* unknown */) // → boolean: an https: URL with a host, nothing else
export function linkState(peer /* Peer */, self /* Address[] */, base /* string */, io /* PeerIO */)
  // → { state: 'mutual' | 'claimed' | 'not-an-instance' | 'unknown', path: string | null, reason: string | null }
```

`addressOf` rules, in order:
1. `git@github.com:O/R(.git)`, `https://github.com/O/R(.git)(/)` and `github.com/O/R` give `github`.
   - `owner` and `repo` are lower-cased, with `.git` and a trailing `/` stripped.
   - `/tree/<branch>/<rest>` gives `path`: decoded `<rest>`, otherwise `''`.
2. Any other `http(s):` URL gives `url`, with the host lower-cased and the trailing `/` stripped.
3. A ref starting with `.` or `/`, or containing a space, gives `path` (`io.resolve(base, ref)`).
4. A bare `a/b` gives `path` when `io.isDir(io.resolve(base, ref))`, and `github` otherwise.
5. Anything else gives `path` when that folder exists, and `null` otherwise.

`linkState` reads the peer's `ref ?? url`:
- No address, or a `github`/`url` address: `unknown`, with reason `"can't read their side from here"`. Fetching arrives in N2.
- A `path` address that isn't a folder: `unknown`, with reason `"no folder at <path>"`.
- `readFederationAt` returns `{ found: false }`: `not-an-instance`.
- It returns `{ error }`: `unknown`, with reason `"their federation.yaml can't be read: <error>"`.
- Otherwise the state is `mutual` when any of their peers' addresses (resolved against *their* folder) is the same as one of `self`, and `claimed` otherwise.

- [ ] **Step 1: Write the failing tests.** Build a fake `PeerIO` over an in-memory map of folder → file result, with `resolve` from `node:path` (the test may import built-ins).

```ts
it('a bare repos/egregore that is a local folder is a path, not GitHub user "repos"', () => {
  expect(addressOf('repos/egregore', '/w/me', io({ '/w/me/repos/egregore': { found: false } }))).toEqual({ kind: 'path', path: '/w/me/repos/egregore' })
  expect(addressOf('ReFiDAO/refi-dao-os', '/w/me', io({}))).toEqual({ kind: 'github', owner: 'refidao', repo: 'refi-dao-os', path: '' })
})
it('reads a monorepo folder link as github with a path', () => {
  expect(addressOf('https://github.com/luizfernandosg/Zettelkasten/tree/main/03%20Libraries/ReFi%20DAO', '/w', io({})))
    .toEqual({ kind: 'github', owner: 'luizfernandosg', repo: 'zettelkasten', path: '03 Libraries/ReFi DAO' })
})
it('git@, https, .git, trailing slash and case are the same repo', () => {
  const a = addressOf('git@github.com:ReFiDAO/refi-dao-os.git', '/', io({}))!
  for (const r of ['https://github.com/refidao/refi-dao-os', 'https://github.com/ReFiDAO/refi-dao-os/', 'github.com/ReFiDAO/refi-dao-os.git'])
    expect(sameAddress(a, addressOf(r, '/', io({}))!)).toBe(true)
})
it('isPublicUrl takes only https URLs', () => {
  expect([isPublicUrl('https://refidao.com'), isPublicUrl('http://x.org'), isPublicUrl('../refi-bcn-os'), isPublicUrl(null)]).toEqual([true, false, false, false])
})
it('mutual when their side lists us by our remote URL', () => {
  const fs = { '/w/hub': { found: true, doc: { peers: [{ name: 'Me', repo: 'https://github.com/me-org/me-os' }] } } }
  const self = selfAddresses('/w/me', ['git@github.com:me-org/me-os.git'], io(fs))
  expect(linkState(peer('../hub'), self, '/w/me', io(fs))).toEqual({ state: 'mutual', path: '/w/hub', reason: null })
})
it('mutual when their side lists us by a relative path', () => {
  const fs = { '/w/hub': { found: true, doc: { peers: [{ name: 'Me', repo: '../me' }] } }, '/w/me': { found: true, doc: {} } }
  expect(linkState(peer('../hub'), selfAddresses('/w/me', [], io(fs)), '/w/me', io(fs)).state).toBe('mutual')
})
it('claimed when their side does not list us', () => {
  const fs = { '/w/hub': { found: true, doc: { peers: [] } } }
  expect(linkState(peer('../hub'), selfAddresses('/w/me', [], io(fs)), '/w/me', io(fs)).state).toBe('claimed')
})
it('not-an-instance when the folder has no federation.yaml', () => {
  expect(linkState(peer('repos/site'), [], '/w/me', io({ '/w/me/repos/site': { found: false } })).state).toBe('not-an-instance')
})
it('unknown, with the reason, when their federation.yaml is broken', () => {
  expect(linkState(peer('../hub'), [], '/w/me', io({ '/w/hub': { found: true, error: 'bad indentation' } })))
    .toEqual({ state: 'unknown', path: '/w/hub', reason: "their federation.yaml can't be read: bad indentation" })
})
it('unknown for a GitHub-only peer and for a missing folder', () => {
  expect(linkState(peer('someone/far-away'), [], '/w/me', io({})).reason).toBe("can't read their side from here")
  expect(linkState(peer('../gone'), [], '/w/me', io({})).reason).toBe('no folder at /w/gone')
})
```

`io(map)` and `peer(ref)` are small helpers in the test file. `io` reports `isDir` as true for every key in the map. `peer` builds a Task 1 `Peer` with `name: 'P'`.

- [ ] **Step 2: Run the tests and check they fail**

Run: `cd packages/admin && npx vitest run tests/lib/federation-peers.test.ts`
Expected: FAIL, because the module isn't found.

- [ ] **Step 3: Implement the five exports in `packages/admin/lib/federation/peers.mjs`.** Its only import is `./read.mjs`. URL parsing uses the global `URL`, which is not an import.

- [ ] **Step 4: Run the tests and check they pass**

Run: `cd packages/admin && npx vitest run tests/lib/federation-peers.test.ts tests/lib/federation-read.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/admin/lib/federation/peers.mjs packages/admin/tests/lib/federation-peers.test.ts
git commit -m "feat(network N0): peer addresses and link state — mutual, claimed, not an instance, unknown"
```

---

### Task 3: The fleet card shows the link state

**Files:**
- Modify: `packages/admin/server/resources/adapters/fleet.ts` (the `fed.peers` branch only; the `data/instances.yaml` branch is the framework's registry and stays as it is)
- Create: `packages/admin/server/federation-io.ts`
- Test: `packages/admin/tests/resources/fleet.test.ts`

**Interfaces:**
- Consumes: `readFederation`, `selfAddresses`, `linkState` (Tasks 1–2).
- Produces: `export const nodePeerIO: PeerIO` in `server/federation-io.ts`.
  - `resolve` is `node:path`'s `resolve`.
  - `isDir` uses `statSync` and is false on any error.
  - `readFederationAt` reads `<abs>/federation.yaml` with `yaml`'s `parse`. It gives `{ found: false }` when the file is absent and `{ found: true, error: <first line> }` when parsing fails.
  - Each peer's resource gains `facts.link`, which is the state, and `facts.linkReason`.

**Status and attention for each state** (exact copy):

| State | `status` | `attention` |
|---|---|---|
| mutual | `'mutual'` | `null` |
| claimed | `'claimed'` | `{ level: 'warn', text: 'Only this side lists the link. Ask them to add this instance.' }` |
| not-an-instance | `'a repo, not an instance'` | `{ level: 'warn', text: 'This is a repo, not an org-os instance. Map it as a System.' }` |
| unknown | `'not checked'` | `null` |

- `relationship` and `trust` stay in `facts`, as they are today.
- `self` addresses come from `ctx.run('git', ['remote', '-v'], { cwd: ctx.repo, timeoutMs: 5000 })`: the URL column of each line, de-duplicated. When git fails, there are no remotes.

- [ ] **Step 1: Update and add tests in `tests/resources/fleet.test.ts`**
  - In `'reads federation peers, with this instance as the hub they link to'`, the sibling has no `federation.yaml`, so expect `status: 'a repo, not an instance'` and `facts.link: 'not-an-instance'`. Far Away (GitHub only) expects `status: 'not checked'` and `attention: null`.
  - Add `'a sibling that lists this instance back is mutual'`. Write `federation.yaml` into the sibling with `peers: [{ name: Fixture Org, repo: ../<basename(repo)> }]`, then expect `status: 'mutual'` and `attention: null`.
  - Add `'a sibling instance that does not list this one is claimed, with the ask'`. The sibling's `federation.yaml` has `peers: []`. Expect the claimed row's status and attention from the table above.

- [ ] **Step 2: Run the tests and check they fail**

Run: `cd packages/admin && npx vitest run tests/resources/fleet.test.ts`
Expected: FAIL on the three cases above. `'reads this repository\'s real fleet'` still passes.

- [ ] **Step 3: Implement `nodePeerIO` and wire `linkState` into the peers branch of `fleet.read`.**

- [ ] **Step 4: Run the tests and check they pass**

Run: `cd packages/admin && npx vitest run tests/resources/fleet.test.ts tests/server/instance-card.test.ts`
Expected: PASS. If `instance-card` asserts a peer's old status, update that assertion to the table, and say so in the commit body.

- [ ] **Step 5: Commit**

```bash
git add packages/admin/server/federation-io.ts packages/admin/server/resources/adapters/fleet.ts packages/admin/tests/resources/fleet.test.ts packages/admin/tests/server/instance-card.test.ts
git commit -m "feat(network N0): the fleet card says whether a federation link is mutual, claimed, a repo, or not checked"
```

---

### Task 4: `.well-known/federation.json`

**Files:**
- Create: `packages/admin/lib/standards/federation.mjs`
- Modify: `packages/admin/lib/standards/build.mjs`: add `'federation.json'` to `STANDARD_FILES`, after `'knowledge.json'`, and add the doc to `built`.
- Modify: `packages/admin/lib/standards/load.mjs`: put `federation: readFederation(federationDoc)` on the input.
- Modify: `packages/admin/lib/standards/project.mjs`: pass `federation` through `projectPublic` as `pub.federation`, and add to `withheld`.
- Modify: `scripts/generate-all-schemas.mjs`: its `STANDARD_FILES` copy gets the same addition. The existing test keeps the two lists equal.
- Test: `packages/admin/tests/standards/federation.test.ts`, plus the existing `build.test.ts` and `load.test.ts` where their file lists are asserted.
- Regenerate: `tests/clone-manifest.txt`, because the vendored set now includes `lib/federation/*.mjs`.

**Interfaces:**
- Consumes: `readFederation` (Task 1), `isPublicUrl` (Task 2).
- Produces: `export function federationDoc(pub)`, which returns this document:

```json
{
  "spec": "org-os/federation/1",
  "name": "…", "type": "…", "scope": "… or omitted", "daoURI": "…",
  "networks": [{ "name": "…", "hub": "… only when isPublicUrl, else omitted", "role": "… or omitted" }],
  "peers": [{ "name": "…", "url": "https://…", "type": "… or omitted", "trust": "… or omitted" }],
  "join": { "policy": "…", "types": [], "asks": [], "where": "… only when isPublicUrl, else omitted" }
}
```

- `join` is omitted when null.
- A peer that isn't published is counted in `withheld` as `{ collection: 'peers', records: <n>, fields: 0 }`. It is withheld when it is `private`, or when it has no public `url`.
- `notes`, `contact`, `relationship`, `repo` and any local path never appear.

- [ ] **Step 1: Write the failing tests in `tests/standards/federation.test.ts`.** Build through `buildCore` with the package's standards fixtures (`tests/standards/fixtures.ts`), with these peers:
  - a public one: `{ name: 'ReFi DAO', url: 'https://github.com/ReFiDAO/refi-dao-os', relationship: 'network-seat', notes: 'secret note' }`
  - a local-only one: `{ name: 'local-only-peer', repo: '../local-only-peer', relationship: 'sovereign-counterpart' }`
  - a private one: `{ name: 'altiplano', url: 'https://github.com/a/altiplano', visibility: 'private' }`

```ts
expect(out.files['federation.json'].peers).toEqual([{ name: 'ReFi DAO', url: 'https://github.com/ReFiDAO/refi-dao-os' }])
expect(JSON.stringify(out.files['federation.json'])).not.toMatch(/local-only-peer|altiplano|secret note|sovereign|network-seat|\.\.\//)
expect(out.withheld).toContainEqual({ collection: 'peers', records: 2, fields: 0 })
// a hub node with join, and a legacy hub given as a local path:
expect(doc.join).toEqual({ policy: 'invite', types: ['LocalNode'], asks: [] })   // where '../x' omitted
expect(doc.networks).toEqual([{ name: 'lf-personal' }])                          // hub '../../' omitted
// no daoURI: nothing is built, federation.json included (spec §12 R5)
expect(buildCore(noDaoUri).files).toEqual({})
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `cd packages/admin && npx vitest run tests/standards/federation.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `federationDoc`, wire it into the builder, and add the generator's list entry.**

- [ ] **Step 4: Run the standards tests and the vendoring tests, then regenerate the clone manifest**

Run: `cd packages/admin && npx vitest run tests/standards` and expect PASS.
Then run `cd ../.. && node --test tests/clone-standards.test.mjs` and expect PASS.
Then run `npm run clone:manifest` and check that `git diff tests/clone-manifest.txt` shows only the new `scripts/lib/federation/*.mjs` (and `scripts/lib/standards/federation.mjs`) lines.

- [ ] **Step 5: Commit**

```bash
git add packages/admin/lib/standards packages/admin/tests/standards scripts/generate-all-schemas.mjs tests/clone-manifest.txt
git commit -m "feat(network N0): .well-known/federation.json — this instance's public claims, private and local peers withheld"
```

---

### Task 5: Warnings in `validate:schemas`, and the federation docs

**Files:**
- Modify: `scripts/validate-identity.mjs`: add a new last section, `"<next number>. federation links"`.
- Modify: `schemas/federation.yaml`:
  - add `networks` (name, hub, role), `join` (policy enum, types, asks, where), and peer `since`, `decision`, `visibility`;
  - add `read-write` to the `trust` enum;
  - mark `network` and `hub` as "read as one item of networks".
- Modify: `docs/FEDERATION.md`:
  - add `networks` and `join`, in the same table style as the rest of the file;
  - add a "Link state" subsection (the four N0 states, and that state is computed from both sides and never stored);
  - replace "A federation has exactly one hub" with "Each network has one hub node; an instance can be in several networks."
- Test: `tests/validate-identity-federation.test.mjs` (root, `node --test`).

**Interfaces:**
- Consumes: Tasks 1–2. The section loads `read.mjs` and `peers.mjs` from `../packages/admin/lib/federation/` and falls back to `./lib/federation/` (the vendored copy). If neither exists, it prints `· federation links: not checked here (no checker in this checkout)` and passes.
- Produces: one `warn()` line per finding. The section never calls `check(…, false)`. The exact lines are:
  - `peer "<name>": only this side lists the link`
  - `peer "<name>": a repo, not an org-os instance — map it as a System in data/systems.yaml`
  - `peer "<name>": <reason>` (for `unknown` with a path, so a missing folder or a broken file shows up)
  - each `readFederation` problem's text, as it is

- [ ] **Step 1: Write the failing test.** Make a temp dir holding `me/` and `site/`, where `site/` has no `federation.yaml` and `me/federation.yaml` lists `../site`. Run `node scripts/validate-identity.mjs <tmp>/me` and assert:
  - the exit code is 0;
  - stdout contains `peer "site": a repo, not an org-os instance — map it as a System in data/systems.yaml`;
  - with `--strict`, the exit code is 1.

- [ ] **Step 2: Run the test and check it fails**

Run: `node --test tests/validate-identity-federation.test.mjs`
Expected: FAIL, because the line is missing.

- [ ] **Step 3: Implement the section, and edit the schema doc and FEDERATION.md.**

- [ ] **Step 4: Run the test and check it passes**

Run: `node --test tests/validate-identity-federation.test.mjs && npm run validate:schemas`
Expected: PASS. The framework's own `validate:schemas` still exits 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/validate-identity.mjs schemas/federation.yaml docs/FEDERATION.md tests/validate-identity-federation.test.mjs
git commit -m "feat(network N0): validate:schemas warns on one-sided links and repos listed as peers; federation docs: networks, join, link state"
```

---

### Task 6: Mounted repo Systems and the derived manifest

**Files:**
- Modify: `packages/admin/schemas/systems.schema.json`:
  - add `mount`: `"x-kinds": ["repo"]`, a string or null, pattern `^(?!/)(?!.*(^|/)\.\.(/|$))[^\0]+$`, title "Mounted at", description "A repo System: where its local clone lives inside this instance, like repos/site.";
  - add `purpose`: `"x-kinds": ["repo"]`, the enum from Global Constraints plus null, title "Purpose", description "A repo System: what the repo is to the organization.";
  - add both names to `x-order` after `files`.
- Modify: `packages/admin/tests/schemas/systems.composed.test.ts`: the `x-kinds` table test gains `mount: ['repo']` and `purpose: ['repo']`.
- Create: `scripts/repos-manifest.mjs`
- Modify: root `package.json`: `"generate:schemas": "node scripts/generate-all-schemas.mjs && node scripts/repos-manifest.mjs"`, and add `"repos:manifest": "node scripts/repos-manifest.mjs"`.
- Test: `tests/repos-manifest.test.mjs`

**Interfaces:**
- Produces, in `scripts/repos-manifest.mjs`:
  - `export function deriveManifest(systems /* unknown[] */, current /* object | null */)`, which returns `{ manifest: object | null, notes: string[] }`. It is pure. The CLI part runs only when the file is the entry point, and it takes an optional `[target-dir]` like `generate-all-schemas.mjs`.
  - It reads `data/systems.yaml` (key `systems`) and `repos.manifest.json`, and writes the manifest only when `manifest` is not null and differs from what is on disk.

Rules:
- No System with both `kind: repo` and `mount` gives `manifest: null`, so the file is left alone, and the note `repos.manifest.json left as it is: no repo System has a mount yet`.
- A mounted System gives the entry `{ name: basename(mount), url: <system.url>.git, branch: system.branch ?? 'main' }`. Its `baseDirectory` is kept as it is, or is `"repos"` when there was none.
- A mount that isn't under `baseDirectory` is skipped, with the note `system "<id>": mount <mount> is outside <baseDirectory>/; not in the manifest`.
- Current entries that no System names are kept, in their current order after the derived ones, each with the note `repos.manifest.json: "<name>" isn't mapped as a System yet`.

- [ ] **Step 1: Write the failing tests**

```js
test('no mounted System leaves the manifest untouched', () => {
  assert.deepEqual(deriveManifest([{ id: 's', kind: 'repo', url: 'https://github.com/a/site' }], cur), { manifest: null, notes: ['repos.manifest.json left as it is: no repo System has a mount yet'] })
})
test('a mounted System is written, and an unmapped entry is kept with a note', () => {
  const { manifest, notes } = deriveManifest([{ id: 'site', kind: 'repo', url: 'https://github.com/a/site', mount: 'repos/site' }],
    { baseDirectory: 'repos', repositories: [{ name: 'old', url: 'https://github.com/a/old.git', branch: 'main' }] })
  assert.deepEqual(manifest.repositories, [{ name: 'site', url: 'https://github.com/a/site.git', branch: 'main' }, { name: 'old', url: 'https://github.com/a/old.git', branch: 'main' }])
  assert.deepEqual(notes, ['repos.manifest.json: "old" isn\'t mapped as a System yet'])
})
test('a mount outside baseDirectory is skipped with a note', () => { /* mount 'vendor/x' → note text as in Rules */ })
test('the CLI writes nothing when nothing changed (byte-identical file, same mtime)', () => { /* temp dir */ })
```

Also add a vitest case to `tests/schemas/systems.composed.test.ts`: a repo System with `mount: '../escape'` is refused, and one with `mount: 'repos/site', purpose: 'website'` validates.

- [ ] **Step 2: Run the tests and check they fail**

Run: `node --test tests/repos-manifest.test.mjs; cd packages/admin && npx vitest run tests/schemas/systems.composed.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the schema fields, `deriveManifest` and the CLI, and update the npm script.**

- [ ] **Step 4: Run the tests and check they pass**

Run: the same two commands, then `npm run repos:manifest` in this checkout.
Expected: PASS. The framework's own `repos.manifest.json` is unchanged (`git diff --quiet repos.manifest.json`), because no System here has a mount.

- [ ] **Step 5: Commit**

```bash
git add packages/admin/schemas/systems.schema.json packages/admin/tests/schemas/systems.composed.test.ts scripts/repos-manifest.mjs tests/repos-manifest.test.mjs package.json
git commit -m "feat(network N0): repo Systems can be mounted; repos.manifest.json derived from them, never losing an entry"
```

---

### Task 7: Read the real instances, then run the full suites

This task changes no code unless a step fails. It proves N0 against the real fleet, read-only.

**Files:**
- Create: `docs/superpowers/plans/2026-11-06-network-n0-acceptance.md`, which records what each run printed (instance names and counts only, no member names).

- [ ] **Step 1: Validate each real instance, read-only**

Run, for each of `lf-work-os`, `refi-bcn-os`, `refi-dao-os`, `refi-med-os` and `regen-coordination-os` under `~/Desktop/Workspaces/Zettelkasten/03 Libraries/`:
`node scripts/validate-identity.mjs "<that path>"`
Expected for each:
- exit 0, with a "federation links" section;
- ReFi BCN's `ReFi-BCN-Website`, `Regenerant-Catalunya` and `refi-bcn-knowledge` read either as "a repo, not an org-os instance" or as unknown with a "no folder" reason, depending on what is cloned;
- lf-work-os's `ReFi Barcelona (ReFi BCN)` reads "only this side lists the link".

Then check that `git -C "<that path>" status --porcelain` is identical before and after each run. Nothing may be written.

- [ ] **Step 2: Build lf-work-os's `federation.json` in a temp copy, never in place**

Run: `T=$(mktemp -d) && cp -R "<lf-work-os>/federation.yaml" "<lf-work-os>/IDENTITY.md" "<lf-work-os>/data" "$T"/ && node scripts/generate-all-schemas.mjs "$T"; cat "$T/.well-known/federation.json" 2>/dev/null; rm -rf "$T"`
Expected:
- if lf-work-os has no `identity.daoURI`, it prints "nothing generated", which is correct under spec §12 R5;
- otherwise `peers` holds neither of lf-work-os's two local-only sibling peers (withheld because they have no `url`), and the withheld count is printed.

Record which case happened.

- [ ] **Step 3: Run the full suites, one at a time**

Run: `npm test` (root), then `npm run test:admin`. Never run them at the same time.
Expected: both green. Record the pass counts against the branch-point counts (admin 7305/1 skipped, root 984, from `feat/platform-full-l7`).

- [ ] **Step 4: Commit the acceptance record**

```bash
git add docs/superpowers/plans/2026-11-06-network-n0-acceptance.md
git commit -m "docs(network N0): acceptance — the real fleet read, federation.json built in a temp copy, suites green"
```
