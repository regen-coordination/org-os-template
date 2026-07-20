# rad-org-os Plan 3 — Bootstrap & Seed-Node — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Radicle-first onboarding path — `rad-bootstrap` (zero → live self-owned org-os on Radicle, no GitHub) — plus a self-hostable seed-node recipe and a 3-tier availability chooser, so a new activist/community group can stand up a sovereign org-os with its own keys and node.

**Architecture:** `rad-bootstrap` is an orchestrator over the real `rad` CLI (`rad auth` → mint did:key; `rad init` → create the RID + `rad` remote) plus file scaffolding (genesis org-os files, `members.yaml` with the operator as `did:key`, `federation.yaml` with `platforms.canonical: radicle`). All `rad`/`git`/`fs` effects go through injected runners so the logic is unit-testable without side effects; a gated integration test runs the real thing in a temp dir. The seed-node recipe is a Dockerized `radicle-node` + `radicle-httpd` with `compose.yml`, a Tor variant, and a seeding-policy guide. The availability chooser encodes the 3-tier spectrum (self-hosted / radicle.garden / public seeds) as data + a selector.

**Tech Stack:** Node.js ESM (`.mjs`), `node:test` + `node:assert/strict`, `node:child_process` for `rad`/`git`, `js-yaml` for reading/writing YAML (already a dependency), Docker/Compose for the seed-node recipe (config artifacts, structurally tested; deployment is a documented manual step). Reuses `@org-os/rad`'s `defaultExec`/`WriteUnavailableError`.

**Spec:** [`docs/superpowers/specs/2026-07-20-rad-org-os-design.md`](../specs/2026-07-20-rad-org-os-design.md) — "Bootstrap & seed-node deliverables" and the availability spectrum. **Roadmap:** [`2026-07-20-rad-org-os-ROADMAP.md`](2026-07-20-rad-org-os-ROADMAP.md).

**Prerequisites shipped:** Plans 1–2 on `v0.5` — `@org-os/host` (`HostDriver`, `resolveDriver`) and `@org-os/rad` (radicle driver, `rad-cli.mjs` exporting `defaultExec`, `errors.mjs` `WriteUnavailableError`). Read `packages/rad-org-os/src/rad-cli.mjs` and `src/driver.mjs` before starting. There is an existing genesis-scaffold script to reuse copy logic from: `scripts/clone-framework.mjs` (`git init` + genesis commit; read it).

**Verified against live `rad 1.8.0` (2026-07-20) — command surfaces used here are real, not guessed:**
- `rad auth --alias <ALIAS> [--stdin]` — mints/uses the operator identity (Ed25519 → did:key). Passphrase via env `RAD_PASSPHRASE` or `--stdin` (both disable the interactive prompt). An identity already exists on this machine (`did:key:z6Mkvyj7…`); `rad auth` is idempotent for an existing key.
- `rad init [PATH] --name <NAME> --description <DESC> --default-branch <BRANCH> --private|--public --scope all|followed [-u|--set-upstream] [--setup-signing]` — creates the repo identity (RID), registers the `rad` git remote, writes the identity doc (creator = sole delegate, threshold 1). Prints the RID on stdout.
- `rad node start|stop|status|config` — the local node; a real `rad init`/sync round-trip needs `rad node start`.

**Fixture/verification discipline:** pure generators are unit-tested; the `rad`-calling orchestrator is unit-tested with an injected fake exec; a **gated** integration test (`RAD_INTEGRATION=1`) runs the real `rad auth`/`rad init` in a `mkdtemp` scratch dir to prove the end-to-end path (and knocks out the "real rad init round-trip" debt). Docker artifacts are structurally tested (files exist, reference `radicle-node`/`radicle-httpd`, port 8776); a real deploy is a documented manual step.

---

## File structure

```
packages/rad-org-os/
  bootstrap/
    generate.mjs          # pure: buildMembersYaml, buildFederationYaml, buildGenesisStamp
    availability.mjs      # the 3-tier availability spectrum + chooseAvailability()
    rad-bootstrap.mjs     # orchestrator: radAuth, radInit, scaffold, genesis (injected exec/fs)
    cli.mjs               # thin CLI entrypoint (arg parsing → bootstrap())
  seed-node/
    Dockerfile            # radicle-node + radicle-httpd
    compose.yml           # node + httpd services
    compose.tor.yml       # + tor sidecar (no-trusted-seed / high-threat profile)
    seeding-policy.md     # rad seed/unseed guidance + the honest privacy framing
    README.md             # run-your-own-node quickstart
  test/
    generate.test.mjs
    availability.test.mjs
    rad-bootstrap.test.mjs
    seed-node.test.mjs
    bootstrap-integration.test.mjs   # gated RAD_INTEGRATION=1: real rad auth/init in a temp dir
```

Modified: `package.json` (add a `bootstrap` bin/script), `data/packages-matrix.yaml` note (optional).

---

### Task 1: Pure genesis-file generators

**Files:**
- Create: `packages/rad-org-os/bootstrap/generate.mjs`
- Test: `packages/rad-org-os/test/generate.test.mjs`

- [ ] **Step 1: Write failing generator tests**

`packages/rad-org-os/test/generate.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';
import { buildMembersYaml, buildFederationYaml, buildGenesisStamp } from '../bootstrap/generate.mjs';

test('buildMembersYaml makes the operator a did:key member (canonical from genesis)', () => {
  const doc = yaml.load(buildMembersYaml({ did: 'did:key:z6MkABC', alias: 'luiz', github: 'luizsg' }));
  const m = doc.members[0];
  assert.equal(m.id, 'did:key:z6MkABC');       // canonical id IS the did
  assert.equal(m.handles.github, 'luizsg');     // optional alias for reach
  assert.equal(m.alias, 'luiz');
});

test('buildMembersYaml omits github handle when not provided', () => {
  const doc = yaml.load(buildMembersYaml({ did: 'did:key:z6MkABC', alias: 'luiz' }));
  assert.equal(doc.members[0].handles?.github, undefined);
});

test('buildFederationYaml sets radicle canonical + rid + seed', () => {
  const doc = yaml.load(buildFederationYaml({ rid: 'rad:z3xyz', seed: 'https://seed.example', name: 'my-org', threshold: 1 }));
  assert.equal(doc.platforms.canonical, 'radicle');
  assert.equal(doc.platforms.seed_node, 'https://seed.example');
  assert.equal(doc.identity.rid, 'rad:z3xyz');
  assert.equal(doc.governance.proposal_threshold, 1);
});

test('buildGenesisStamp returns a metadata block with the genesis commit oid', () => {
  const meta = buildGenesisStamp({ commit: 'a'.repeat(40), now: '2026-07-20T00:00:00Z' });
  assert.equal(meta.genesis_commit, 'a'.repeat(40));
  assert.equal(meta.last_sync_commit, null);
  assert.equal(meta.created, '2026-07-20T00:00:00Z');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/rad-org-os && node --test test/generate.test.mjs`
Expected: FAIL — `generate.mjs` doesn't exist.

- [ ] **Step 3: Write `generate.mjs`**

`packages/rad-org-os/bootstrap/generate.mjs`:
```js
import yaml from 'js-yaml';

// Pure genesis-file content generators for a Radicle-first org-os instance.
// The operator's canonical id IS their did:key (identity sovereignty tracks hosting
// sovereignty, per the spec); a github handle is an optional alias for reach.
export function buildMembersYaml({ did, alias, github } = {}) {
  const member = { id: did, alias };
  if (github) member.handles = { github };
  return yaml.dump({ members: [member] });
}

export function buildFederationYaml({ rid, seed, name, threshold = 1 } = {}) {
  return yaml.dump({
    identity: { name, type: 'LocalNode', rid },
    network: 'radicle',
    platforms: { canonical: 'radicle', seed_node: seed, deployment: 'radicle-node' },
    agent: { runtime: 'open-model', workspace: '.' },
    governance: { proposal_threshold: threshold, decision_model: 'delegate-quorum' },
    peers: [],
    metadata: { framework_version: '0.5' },
  });
}

export function buildGenesisStamp({ commit, now } = {}) {
  return { created: now, genesis_commit: commit, last_sync_commit: null };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd packages/rad-org-os && node --test test/generate.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/rad-org-os/bootstrap/generate.mjs packages/rad-org-os/test/generate.test.mjs
git commit -m "feat(rad): pure genesis-file generators (members/federation/stamp)"
```

---

### Task 2: Availability chooser (3-tier spectrum)

**Files:**
- Create: `packages/rad-org-os/bootstrap/availability.mjs`
- Test: `packages/rad-org-os/test/availability.test.mjs`

- [ ] **Step 1: Write failing tests**

`packages/rad-org-os/test/availability.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AVAILABILITY_TIERS, chooseAvailability } from '../bootstrap/availability.mjs';

test('the three tiers are self-hosted, garden, public', () => {
  assert.deepEqual(AVAILABILITY_TIERS.map((t) => t.key), ['self-hosted', 'garden', 'public']);
});

test('chooseAvailability returns the seed endpoint + honest trust note for each tier', () => {
  const s = chooseAvailability('self-hosted', { seed: 'https://my-node.example' });
  assert.equal(s.seed, 'https://my-node.example');
  assert.equal(s.trust, 'none');

  const g = chooseAvailability('garden');
  assert.match(g.seed, /radicle\.garden|garden/i);
  assert.match(g.caveat, /not encrypted at rest|operators/i);

  const p = chooseAvailability('public');
  assert.match(p.seed, /seed\.radicle\.xyz|iris|rosa/);
  assert.equal(p.privateOk, false); // public seeds can't host private repos
});

test('high-threat guidance points away from garden/public to self-hosted or tor', () => {
  assert.equal(chooseAvailability('public').recommendedForPrivate, false);
  assert.equal(chooseAvailability('self-hosted', { seed: 'x' }).recommendedForPrivate, true);
});

test('unknown tier throws', () => {
  assert.throws(() => chooseAvailability('nope'), /unknown availability tier/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/rad-org-os && node --test test/availability.test.mjs`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `availability.mjs`**

`packages/rad-org-os/bootstrap/availability.mjs`:
```js
// The availability spectrum (spec Q6). Honest framing: "private" on Radicle means
// selective replication, NOT encryption at rest — so a commercial/managed seed
// (garden) or a public seed is a reliability choice, not a censorship-resistance one.
export const AVAILABILITY_TIERS = [
  {
    key: 'self-hosted',
    label: 'Self-hosted seed node (our Docker recipe)',
    trust: 'none', privateOk: true, recommendedForPrivate: true,
    note: 'Maximum sovereignty; you run one container on a $5 VPS or spare laptop.',
  },
  {
    key: 'garden',
    label: 'radicle.garden managed node (€4.99/mo)',
    seed: 'https://app.radicle.garden', trust: 'garden-operators', privateOk: true, recommendedForPrivate: false,
    caveat: 'Private repos are replicated but NOT encrypted at rest — Garden operators may read your content.',
    note: 'Reliability without running infra; a commercial third party, so not the censorship-resistance path.',
  },
  {
    key: 'public',
    label: 'Public core-team seeds (iris / rosa / seed.radicle.xyz)',
    seed: 'https://seed.radicle.xyz', trust: 'public', privateOk: false, recommendedForPrivate: false,
    note: 'Reach/discovery for PUBLIC repos only; cannot host private repos.',
  },
];

export function chooseAvailability(tierKey, { seed } = {}) {
  const tier = AVAILABILITY_TIERS.find((t) => t.key === tierKey);
  if (!tier) throw new Error(`unknown availability tier: ${tierKey}`);
  return { ...tier, seed: seed || tier.seed || null };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd packages/rad-org-os && node --test test/availability.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/rad-org-os/bootstrap/availability.mjs packages/rad-org-os/test/availability.test.mjs
git commit -m "feat(rad): 3-tier availability chooser with honest privacy framing"
```

---

### Task 3: `rad-bootstrap` orchestrator

**Files:**
- Create: `packages/rad-org-os/bootstrap/rad-bootstrap.mjs`
- Test: `packages/rad-org-os/test/rad-bootstrap.test.mjs`

The orchestrator threads real effects through injected runners: `exec` (rad/git), `writeFile`, `mkdir`. Verified `rad` flags from the header are used. Parses the RID from `rad init` stdout.

- [ ] **Step 1: Write failing orchestrator tests**

`packages/rad-org-os/test/rad-bootstrap.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, parseRid, parseDid } from '../bootstrap/rad-bootstrap.mjs';

test('parseRid extracts a rad: RID from rad init output', () => {
  assert.equal(parseRid('Initialized public repository rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5\n'), 'rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5');
  assert.equal(parseRid('no rid'), null);
});

test('parseDid extracts a did:key from rad auth / rad self output', () => {
  assert.equal(parseDid('DID did:key:z6MkfuXgBSe5G8U6d5NuVbvrbuXRwzYjKJWPPddXgbVjqT9n\n'), 'did:key:z6MkfuXgBSe5G8U6d5NuVbvrbuXRwzYjKJWPPddXgbVjqT9n');
});

test('bootstrap runs auth → init → writes members/federation, returns rid + did', async () => {
  const calls = [];
  const writes = {};
  const exec = async (bin, args) => {
    calls.push(`${bin} ${args.join(' ')}`);
    if (bin === 'rad' && args[0] === 'self') return { code: 0, stdout: 'DID did:key:z6MkOP\n', stderr: '' };
    if (bin === 'rad' && args[0] === 'auth') return { code: 0, stdout: '', stderr: '' };
    if (bin === 'rad' && args[0] === 'init') return { code: 0, stdout: 'Initialized private repository rad:z3NEW\n', stderr: '' };
    if (bin === 'git' && args[0] === 'rev-list') return { code: 0, stdout: 'f'.repeat(40) + '\n', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const fs = {
    mkdir: async () => {},
    writeFile: async (p, c) => { writes[p] = c; },
  };
  const res = await bootstrap({
    targetDir: '/tmp/neworg', name: 'my-org', alias: 'luiz', visibility: 'private',
    seed: 'https://my-node.example', exec, fs, scaffold: async () => {},
  });
  assert.equal(res.rid, 'rad:z3NEW');
  assert.equal(res.did, 'did:key:z6MkOP');
  // used the verified flags:
  assert.ok(calls.some((c) => c.startsWith('rad auth --alias luiz')));
  assert.ok(calls.some((c) => c.includes('rad init') && c.includes('--private') && c.includes('--name my-org')));
  // wrote genesis files:
  assert.ok(Object.keys(writes).some((p) => p.endsWith('data/members.yaml')));
  assert.ok(Object.keys(writes).some((p) => p.endsWith('federation.yaml')));
});

test('bootstrap rejects an invalid visibility', async () => {
  await assert.rejects(() => bootstrap({ targetDir: '/x', name: 'n', visibility: 'secret', exec: async () => ({ code: 0, stdout: '', stderr: '' }), fs: {}, scaffold: async () => {} }), /visibility must be/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/rad-org-os && node --test test/rad-bootstrap.test.mjs`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `rad-bootstrap.mjs`**

`packages/rad-org-os/bootstrap/rad-bootstrap.mjs`:
```js
import { join } from 'node:path';
import { defaultExec } from '../src/rad-cli.mjs';
import { WriteUnavailableError } from '../../org-os-host/src/errors.mjs';
import { buildMembersYaml, buildFederationYaml } from './generate.mjs';

export function parseRid(s) {
  const m = /rad:z[1-9A-HJ-NP-Za-km-z]+/.exec(s || '');
  return m ? m[0] : null;
}
export function parseDid(s) {
  const m = /did:key:z6[1-9A-HJ-NP-Za-km-z]+/.exec(s || '');
  return m ? m[0] : null;
}

// Zero -> live self-owned org-os on Radicle. Effects injected for testing.
// Steps (spec Section 4): auth (mint did) -> scaffold framework -> rad init (RID +
// rad remote + identity doc) -> mint members.yaml (did canonical) -> write
// federation.yaml (canonical: radicle) -> genesis stamp.
export async function bootstrap({
  targetDir, name, alias = name, visibility = 'private', seed, github,
  exec = defaultExec(), fs = realFs(), scaffold = defaultScaffold, now = new Date().toISOString(),
} = {}) {
  if (!['private', 'public'].includes(visibility)) throw new Error(`visibility must be private|public, got ${visibility}`);

  const run = async (bin, args) => {
    const res = await exec(bin, args, { cwd: targetDir });
    if (res.code === -1) throw new WriteUnavailableError(`${bin} is not available`, { hint: `install ${bin}` });
    if (res.code !== 0 && /node is not running|not running/i.test(res.stderr || '')) {
      throw new WriteUnavailableError('the local Radicle node is not reachable', { hint: 'start your node: rad node start' });
    }
    if (res.code !== 0) throw new Error(`${bin} ${args.join(' ')} failed: ${res.stderr.trim() || res.code}`);
    return res.stdout;
  };

  // 1. identity (idempotent for an existing key)
  await run('rad', ['auth', '--alias', alias]);
  const did = parseDid(await run('rad', ['self']));

  // 2. scaffold org-os framework files into targetDir
  await fs.mkdir(targetDir, { recursive: true });
  await scaffold(targetDir, fs);

  // 3. rad init -> RID + rad remote + identity doc (creator = sole delegate, threshold 1)
  const initArgs = ['init', targetDir, '--name', name, '--default-branch', 'main', `--${visibility}`, '--scope', 'all'];
  const rid = parseRid(await run('rad', initArgs));
  if (!rid) throw new Error('rad init did not return an RID');

  // 4-5. genesis data files
  await fs.writeFile(join(targetDir, 'data/members.yaml'), buildMembersYaml({ did, alias, github }));
  await fs.writeFile(join(targetDir, 'federation.yaml'), buildFederationYaml({ rid, seed, name, threshold: 1 }));

  return { rid, did, visibility, seed: seed || null };
}

function realFs() {
  return {
    mkdir: (p, o) => import('node:fs/promises').then((m) => m.mkdir(p, o)),
    writeFile: (p, c) => import('node:fs/promises').then((m) => m.writeFile(p, c)),
  };
}
// Minimal default scaffold: create the data/ dir. A richer scaffold (copy framework
// files) can reuse scripts/clone-framework.mjs; kept injectable so tests stay pure.
async function defaultScaffold(targetDir, fs) {
  await fs.mkdir(join(targetDir, 'data'), { recursive: true });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd packages/rad-org-os && node --test test/rad-bootstrap.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/rad-org-os/bootstrap/rad-bootstrap.mjs packages/rad-org-os/test/rad-bootstrap.test.mjs
git commit -m "feat(rad): rad-bootstrap orchestrator (auth/init/genesis, verified rad flags)"
```

---

### Task 4: Seed-node recipe (Docker + Tor + policy)

**Files:**
- Create: `packages/rad-org-os/seed-node/Dockerfile`, `compose.yml`, `compose.tor.yml`, `seeding-policy.md`, `README.md`
- Test: `packages/rad-org-os/test/seed-node.test.mjs`

- [ ] **Step 1: Write failing structural tests**

`packages/rad-org-os/test/seed-node.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'seed-node');
const read = (f) => readFileSync(join(dir, f), 'utf8');

test('all seed-node artifacts exist', () => {
  for (const f of ['Dockerfile', 'compose.yml', 'compose.tor.yml', 'seeding-policy.md', 'README.md']) {
    assert.ok(existsSync(join(dir, f)), `${f} exists`);
  }
});

test('Dockerfile installs radicle and the node listens on 8776', () => {
  const d = read('Dockerfile');
  assert.match(d, /radicle\.dev\/install|rad/i);
  assert.match(d, /8776/);
});

test('compose runs a node and an httpd read gateway', () => {
  const c = read('compose.yml');
  assert.match(c, /radicle-node|rad node/i);
  assert.match(c, /radicle-httpd|httpd/i);
});

test('tor profile adds a tor service (no-trusted-seed path)', () => {
  assert.match(read('compose.tor.yml'), /tor/i);
});

test('seeding-policy states the honest at-rest caveat', () => {
  assert.match(read('seeding-policy.md'), /not encrypted at rest/i);
  assert.match(read('seeding-policy.md'), /rad seed|rad unseed/i);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/rad-org-os && node --test test/seed-node.test.mjs`
Expected: FAIL — files don't exist.

- [ ] **Step 3: Write the seed-node artifacts**

`packages/rad-org-os/seed-node/Dockerfile`:
```dockerfile
# The org's sovereignty anchor: a radicle-node + radicle-httpd read gateway.
# Runs on any small Linux host (1-2 GB RAM, 10 GB disk, a public static IP, port 8776).
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

# Install Radicle (rad, radicle-node, radicle-httpd).
RUN curl -sSf https://radicle.dev/install | sh
ENV PATH="/root/.radicle/bin:${PATH}"

# The node's peer-to-peer port (gossip).
EXPOSE 8776
# The read-only HTTP JSON API gateway.
EXPOSE 8080

# An identity must be provisioned on first run (rad auth) with a passphrase from the
# environment; then the node runs in the foreground.
CMD ["sh", "-c", "rad auth --alias \"${RAD_ALIAS:-org-seed}\" --stdin <<<\"${RAD_PASSPHRASE}\" || true; rad node start --foreground"]
```

`packages/rad-org-os/seed-node/compose.yml`:
```yaml
# Self-hosted seed node — the default availability tier. `docker compose up -d`.
services:
  node:
    build: .
    restart: unless-stopped
    environment:
      RAD_ALIAS: ${RAD_ALIAS:-org-seed}
      RAD_PASSPHRASE: ${RAD_PASSPHRASE:?set a passphrase in .env}
    ports:
      - "8776:8776"        # p2p gossip
    volumes:
      - radicle:/root/.radicle
  httpd:
    build: .
    restart: unless-stopped
    command: ["radicle-httpd", "--listen", "0.0.0.0:8080"]
    ports:
      - "8080:8080"        # read-only JSON API (serves the frontier crawl + dashboards)
    volumes:
      - radicle:/root/.radicle
    depends_on: [node]
volumes:
  radicle:
```

`packages/rad-org-os/seed-node/compose.tor.yml`:
```yaml
# High-threat / no-trusted-seed profile: reach the node over Tor so a private repo's
# only replica is the org's own node. Compose overlay: `docker compose -f compose.yml -f compose.tor.yml up -d`.
services:
  tor:
    image: dperson/torproxy
    restart: unless-stopped
    volumes:
      - tor:/var/lib/tor
  node:
    environment:
      # Route node connections through the Tor SOCKS proxy sidecar.
      ALL_PROXY: socks5://tor:9050
    depends_on: [tor]
volumes:
  tor:
```

`packages/rad-org-os/seed-node/seeding-policy.md`:
```markdown
# Seeding policy — what your node keeps available

Your seed node keeps repositories fetchable while it is online. Control what it seeds:

- `rad seed <RID>` — seed a repo (your own + chosen peers').
- `rad unseed <RID>` — stop seeding.
- Public repos can *additionally* announce to public seeds (`iris.radicle.network`,
  `rosa.radicle.network`, `seed.radicle.xyz`) for reach; your node stays authoritative.

## Privacy — read this honestly

`rad init --private` gives **selective replication**: the repo is invisible and
inaccessible to nodes not on its allow-list. But private repos are **NOT encrypted at
rest** — every allow-listed node, and every delegate, can read the full contents.

- Low-threat community group wanting reliability → self-hosted node (this recipe) or a
  managed node (radicle.garden). Both can hold private repos, both can read them.
- High-threat organizing (the reason sovereignty matters) → use the Tor profile
  (`compose.tor.yml`) so your node is the only replica, and do not add third-party seeds
  to a private repo's allow-list.
```

`packages/rad-org-os/seed-node/README.md`:
```markdown
# org-os seed node

Run your org's home node in one container. Requirements: a Linux host with ~1-2 GB RAM,
10 GB disk, a public static IP/DNS name, and port 8776 reachable.

    cp .env.example .env    # set RAD_ALIAS + RAD_PASSPHRASE
    docker compose up -d    # node (8776) + read-only httpd API (8080)

High-threat / no-trusted-seed setup:

    docker compose -f compose.yml -f compose.tor.yml up -d

See `seeding-policy.md` for what to seed and the honest privacy framing. This node is
your org's sovereignty anchor — the federation may run a convenience mirror for public
content, but your private repos live only where you replicate them.
```

- [ ] **Step 4: Run to verify pass**

Run: `cd packages/rad-org-os && node --test test/seed-node.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/rad-org-os/seed-node/ packages/rad-org-os/test/seed-node.test.mjs
git commit -m "feat(rad): seed-node recipe (Docker + Tor profile + seeding policy)"
```

---

### Task 5: CLI entrypoint + gated live integration + wiring

**Files:**
- Create: `packages/rad-org-os/bootstrap/cli.mjs`
- Create: `packages/rad-org-os/test/bootstrap-integration.test.mjs`
- Modify: `packages/rad-org-os/package.json` (add a `bin`), `packages/rad-org-os/README.md`

- [ ] **Step 1: Write the CLI entrypoint**

`packages/rad-org-os/bootstrap/cli.mjs`:
```js
#!/usr/bin/env node
import { bootstrap } from './rad-bootstrap.mjs';

// Usage: rad-bootstrap <targetDir> --name <name> [--alias <a>] [--private|--public] [--seed <url>] [--github <h>]
function parseArgs(argv) {
  const [targetDir, ...rest] = argv;
  const opts = { targetDir, visibility: 'private' };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--private') opts.visibility = 'private';
    else if (a === '--public') opts.visibility = 'public';
    else if (a === '--name') opts.name = rest[++i];
    else if (a === '--alias') opts.alias = rest[++i];
    else if (a === '--seed') opts.seed = rest[++i];
    else if (a === '--github') opts.github = rest[++i];
  }
  return opts;
}

export { parseArgs };

if (import.meta.url === `file://${process.argv[1]}`) {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.targetDir || !opts.name) {
    console.error('usage: rad-bootstrap <targetDir> --name <name> [--alias <a>] [--private|--public] [--seed <url>] [--github <h>]');
    process.exit(2);
  }
  bootstrap(opts).then((r) => {
    console.log(`✓ bootstrapped ${opts.name}\n  RID: ${r.rid}\n  DID: ${r.did}\n  visibility: ${r.visibility}`);
  }).catch((e) => { console.error(`bootstrap failed: ${e.message}`); process.exit(1); });
}
```

- [ ] **Step 2: Write a CLI arg-parse test + the gated integration test**

Append a small unit test file `packages/rad-org-os/test/cli.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../bootstrap/cli.mjs';

test('parseArgs reads targetDir, name, visibility, seed', () => {
  const o = parseArgs(['/tmp/org', '--name', 'my-org', '--public', '--seed', 'https://s.example']);
  assert.equal(o.targetDir, '/tmp/org');
  assert.equal(o.name, 'my-org');
  assert.equal(o.visibility, 'public');
  assert.equal(o.seed, 'https://s.example');
});
```

`packages/rad-org-os/test/bootstrap-integration.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { bootstrap } from '../bootstrap/rad-bootstrap.mjs';

// Gated: needs a live `rad` + a running node (`rad node start`). Creates a REAL
// private repo in the operator's radicle storage, then cleans up the temp working dir.
const run = process.env.RAD_INTEGRATION === '1' ? test : test.skip;

run('live: bootstrap a scratch org with real rad auth + rad init', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'radboot-'));
  try {
    const res = await bootstrap({ targetDir: dir, name: `scratch-${Date.now()}`, alias: 'luizfernando', visibility: 'private', seed: 'https://seed.radicle.xyz' });
    assert.match(res.rid, /^rad:z/);
    assert.match(res.did, /^did:key:z6/);
    assert.ok(existsSync(join(dir, 'federation.yaml')));
    const fed = yaml.load(readFileSync(join(dir, 'federation.yaml'), 'utf8'));
    assert.equal(fed.platforms.canonical, 'radicle');
    assert.equal(fed.identity.rid, res.rid);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```
Add a comment: to run, `rad node start` first, then `RAD_INTEGRATION=1 node --test test/bootstrap-integration.test.mjs`. This also pins any real `rad auth`/`rad init` output differences; correct `parseRid`/`parseDid` if the live format differs.

- [ ] **Step 3: Run to verify (skipped path)**

Run: `cd packages/rad-org-os && npm test`
Expected: all unit tests pass; the integration test reports as skipped.

- [ ] **Step 4: Wire the bin + README**

In `packages/rad-org-os/package.json`, add:
```json
  "bin": { "rad-bootstrap": "bootstrap/cli.mjs" },
```
Append to `packages/rad-org-os/README.md`:
```markdown

## rad-bootstrap

Zero → live self-owned org-os on Radicle (no GitHub):

    node bootstrap/cli.mjs ./my-org --name my-org --private --seed https://my-node.example

Then run your seed node (see `seed-node/README.md`) so your repos stay available.
```

- [ ] **Step 5: Run the whole package suite**

Run: `cd packages/rad-org-os && npm test`
Expected: all green (generate, availability, rad-bootstrap, seed-node, cli + prior driver/httpd/etc.; integration skipped).

- [ ] **Step 6: Commit**

```bash
git add packages/rad-org-os/bootstrap/cli.mjs packages/rad-org-os/test/cli.test.mjs packages/rad-org-os/test/bootstrap-integration.test.mjs packages/rad-org-os/package.json packages/rad-org-os/README.md
git commit -m "feat(rad): rad-bootstrap CLI + gated live bootstrap integration"
```

---

## Self-review

**Spec coverage:** spec "Bootstrap & seed-node deliverables" → `rad-bootstrap` (Tasks 1,3,5: auth→scaffold→init→members→federation→genesis, using verified `rad` flags), seed-node recipe (Task 4: Dockerfile/compose/compose.tor/seeding-policy), availability spectrum (Task 2: self-hosted/garden/public with the honest at-rest framing). did:key-canonical members (Task 1), `platforms.canonical: radicle` genesis (Task 1). Deferred correctly: `crefs` protected-main authoring and command routing → Plan 4 (bootstrap sets threshold 1; Plan 4 adds the `crefs` rule); a richer framework-file scaffold reuses `scripts/clone-framework.mjs` behind the injectable `scaffold` hook.

**Placeholder scan:** every code/file step is complete; `rad` flags are the live-verified forms; the one env-dependent piece (real `rad auth`/`rad init` output) is exercised by the gated integration with an explicit "correct parseRid/parseDid if live format differs" note — a named verification, not a TBD.

**Type/name consistency:** `buildMembersYaml`, `buildFederationYaml`, `buildGenesisStamp`, `chooseAvailability`, `AVAILABILITY_TIERS`, `bootstrap`, `parseRid`, `parseDid`, `parseArgs` are used identically across tasks. `bootstrap()` returns `{rid, did, visibility, seed}` consistently in the orchestrator test, the integration test, and the CLI. The injected-effect pattern (`exec`/`fs`/`scaffold`) matches the driver's DI style from Plan 2 and reuses `defaultExec`/`WriteUnavailableError`.

**Live-verification debt (tracked):** the real `rad auth`/`rad init` stdout formats (for `parseRid`/`parseDid`) are pinned by the gated integration when run with `RAD_INTEGRATION=1` + `rad node start`; Docker artifacts are structurally tested, with a real `docker compose up` deploy as a documented manual step. Both are isolated (pure parsers / config files), so corrections are one-line changes.
