# Network N2 (federation v1: joining a network) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A node operator asks to join a network from their instance. The request reaches the hub through a pluggable transport. The hub receives it under its `join.policy` and decides it under its own rules. The link then becomes mutual on both sides, with no YAML edited by hand.

**Architecture:**
- **Pure libraries** under `packages/admin/lib/federation/` define the request, the invite and how a request is received.
- **A transport registry** under `packages/admin/server/federation/transports/` holds `file` and `github` (built) and `hosted` and `p2p` (registered, unavailable).
- **The node's side:**
  - stages its own `identity` change;
  - writes the outgoing request;
  - sends it only through a confirmed `network: true` operation.
- **The hub's side:**
  - imports or polls requests;
  - applies its policy: refuse, accept under an invite or standing decision, or open an outside proposal;
  - replies through the same transport.
- **One Federation page** in the admin serves both sides. The launcher's Join door fills it in.

**Tech Stack:** TypeScript server (Hono), React app, Node ESM `.mjs` pure modules with JSDoc, vitest in `packages/admin`, `node --test` at the root. `gh` is the operator's own CLI, run as a subprocess and faked in tests.

**Spec:** `docs/superpowers/specs/2026-11-06-org-os-open-and-federate-design.md`. The relevant parts are §6 (federation), §9 N2, §11 (operator decisions 1a/2a/3a), §12 R4 (`requested`/`left` arrive here), §13 R9 (the Join door arrives here) and **§14 R11–R20, which bind over §6** (R18–R20 added 2026-11-17).

**Decisions for Luiz** (answer "as recommended" to take all four):
1. **GitHub requests go as an issue on the hub's repo** (recommended), not a pull request from a fork. No fork and no write access are needed, and a PR transport can be added later as a plug-in. Invited requests go as a file either way (R18).
2. **Received requests are recorded in the hub's git** (recommended), with org-level facts only, so the record is auditable. The alternative is the private store, which is more work, and the board can't read it today.
3. **The real ReFi BCN → ReFi DAO request is sent as a separate go after N2 lands** (recommended), once ReFi DAO's council has set its join policy. N2's acceptance plays it on copies only.
4. **Build the `open` policy now** (recommended). It applies only under a named standing decision, and behaves as "anyone can ask, the hub decides" without one. The alternative is to leave it out, so `open` works like that everywhere.

**Operator decisions already taken (spec §11):**
- **1a:** the first pilot pair is ReFi BCN asking ReFi DAO. N2's acceptance plays it on scratch copies; the real request is a separate go.
- **2a:** `open-with-approval` is the recommended policy. Each hub's council sets its own; no code sets a hub's policy.
- **3a:** no node-lead hats. N2 has no chain step.

**Checked against N1's code (2026-11-17).** The build is frozen until 23 Nov (LD-2026-042). This revision fixes what didn't match the code; spec §14 R18–R20 record the three rules it adds:
- **In-process operations have no actor and must change no file** (`server/operations/catalogue.ts:30-32`; the executor reports any undeclared change as a surprise). So `federation.poll` only fetches into an inbox under `stateDir`, and receiving is an actor route. `federation.reply` keeps its receipt under `stateDir`, not in the ledger.
- **`Operation.unavailable` and `variants` are synchronous,** and `variants` gets only the resource. So a transport's async check (`gh` installed and signed in) moves to `ready()`, which runs in `plan` and in a transports route. The node's outgoing requests reach `variants` as facts on the self instance card.
- **The ledger writers in `server/proposals/ledger.ts` write `data/proposals.yaml` only.** The hub gets its own small writer, built from the same guards.
- **`propose()` refuses with 409 `DIRECT`** when the importer may change `identity` alone (`server/proposals/propose.ts:167`). On such a hub, a request is `held`, and the operator accepts or refuses it (R19).
- **An invite token must never reach git or a public issue** (R18). The node keeps it under `stateDir` and joins it in only at send time. The github transport refuses an invited request. The hub's record keeps the matched invite's id, never the token.
- **Smaller fixes:**
  - the mount point (`createApp`'s `extend` in `server/serve.ts:195-208`, with `withLock`);
  - `networkFetch` moves to `server/net.ts`, so operations can import it;
  - the fake `gh` follows `tests/git-shim.ts`;
  - the new adapter's registration, its `Board` and `refreshes`;
  - the nav entry in `app/src/frame/path.ts`;
  - the launcher's `fetch` option;
  - the pre-fill moves from Task 10 into Task 9, which owns the page;
  - the `open` policy asks for its standing decision;
  - the proposal tests' real folder, `tests/server/proposals.*`.

**Not in N2:**
- the portal's network section (N3);
- the hosted Ask to join form (N4);
- network starters (N5);
- a pull-request transport;
- p2p.

## Global Constraints

- **Nothing is pushed, sent, fetched or replied to without the operator's confirmation** (R16). Every network step is a `network: true` operation and goes through the plan → nonce → job flow (`packages/admin/server/operations/routes.ts`).
- **No test touches the network.**
  - `fetch` is injected.
  - `gh` is a fake script put first on `PATH` in a temp folder.
  - `networkFetch` already throws under VITEST. Task 2 moves it from `server/serve.ts:85` to `server/net.ts`, unchanged, and serve.ts imports it from there.
- **An in-process operation reaches the network and writes only under `stateDir(repo)`** (`server/state.ts:13`, outside the repository). It has no actor: `inProcess(repo, signal)`. Every git write is an actor route, which resolves the actor with `knownActorOf(c)` (`server/request.ts`) inside `withLock`, as `server/workspace/collections.ts:298` does.
- **The hub builds its change from validated request fields only** (R13), through `hubPeerOf(request)`. It never applies YAML, a diff or ops carried inside a request.
- **A request record holds org-level facts only** (R13): `from {name, type, url}`, `network`, `answers`, `invite`. No personal contact field exists in its schema.
- **Invites store `token_sha256` only** (R14), use the existing `lib/sha256.mjs`, can be used once, expire, and never appear in `.well-known/`.
- **The token itself is never written to git, a public issue or a log** (R18):
  - the node's outgoing file doesn't hold it;
  - the hub's record holds the matched invite's `id`;
  - the github transport refuses an invited request.
- **Policy defaults** (R17):
  - no `join` block means `closed`;
  - `open` without `join.decision` is read as `open-with-approval`;
  - the policy picker marks `open-with-approval` with exactly `Recommended`.
- **No chain step and no hats** (decision 3a).
- **`server/git.ts` and its vocabulary test stay unchanged.**
  - Hub-side commits use the existing exports `commitDataPaths` (`server/git.ts:303`) and `restageDataPaths` (`server/git.ts:357`).
  - `gh` runs through `runCommand` (`server/resources/run.ts:6`), passed in as `TransportCtx.run`. It never runs through `git.ts`.
- **Real instances are read-only.** Tests and acceptance use temp repos, and `git clone --local` copies only.
- **Never name the private sibling instance** in any committed file or message.
- **Full suites, builds and browser walks run one at a time, through the lock:** `~/.cache/lf-heavy-run.sh "w5|network-n2|<what>" <command…>`.
- **Copy:** plain, second person. The words are instance, System, proposal, operator, network, hub, node. Never "surface".
- **Stay off the PR A and PR B paths:** no change to `server/session/`, sign-in, or `app/src/portal/`.
- **Commits:** `feat(network N2): …` / `fix(network N2): …`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A request file that's been edited or forged** (it claims another node's name, adds extra peers, or carries YAML for other files) must change nothing on the hub except the one `peers` entry built from validated fields. A request whose `from.url` isn't a public https address is refused. Test: Task 6, `builds the hub change from fields, never from the file`.
2. **A hub address that points to a private network address, redirects, answers slowly, or sends a body over 256 KB** must be refused before anything is parsed. Test: Task 2, `refuses private, redirecting, slow and oversized answers`.
3. **An invite token that's reused, expired, for another type, guessed, or about to leak** must be refused, and an invite must still be safe in a public hub repo.
   - The token never lands in the node's git, a GitHub issue, or the hub's record.
   - Tests:
     - Task 1, `an invite matches once, before expiry, for its type, by token hash`;
     - Task 4, `an invited request never goes into an issue`;
     - Task 5, `the outgoing file never holds the invite token`.
4. **The same request imported twice, or polled twice,** must answer `Already received.` and create no second record or proposal. A solo hub, where the importer may change `identity` alone, must still be able to decide a request. Tests: Task 6, `the same request is received once` and `a solo hub holds the request for its operator`.
5. **A node that tries to send before its own change is on its trunk, or withdraws after the link is mutual,** must be told plainly. Sending is unavailable until the outgoing request is committed, and withdrawing after acceptance is leaving, which the hub then sees as `left`. Test: Task 5, `send waits for the trunk; withdraw after mutual is leaving`.

---

### Task 1: Request, invite and intake — data and pure rules

**Files:**
- Create: `packages/admin/lib/federation/request.mjs`, `packages/admin/lib/federation/invite.mjs`, `packages/admin/lib/federation/intake.mjs`
- Create: `packages/admin/schemas/federation-requests.schema.json`, `packages/admin/schemas/invites.schema.json`
- Modify:
  - `packages/admin/lib/registries.mjs`: add the two registries.
  - `schemas/change-classes.json`: rows for both registries, plus `federation/**`, all class `identity`.
  - `schemas/federation.yaml`:
    - peers gain `requested`, and document `type` and `relationship`, which real peers already carry and the schema doesn't list yet;
    - join gains `decision`.
  - `packages/admin/lib/federation/read.mjs`: read `peer.requested` and `join.decision`.
  - `packages/admin/lib/federation/peers.mjs`: add the `requested` and `left` link states.
- Test: `packages/admin/tests/lib/federation-request.test.ts`, `federation-invite.test.ts`, `federation-intake.test.ts`, plus the existing `read`/`peers` tests extended, and the registry-enumerating tests (`tests/registries.test.ts`, `tests/server/registry.shape.test.ts`) updated.

**Interfaces:**
- **Produces, from `request.mjs`:**
  - `REQUEST_SPEC = 'org-os/federation-request/1'`
  - `buildRequest({ id, from: {name, type, url}, hub: {name, url}, network, answers, invite?, now }) → FederationRequest`
  - `parseRequest(text) → { request: FederationRequest | null, problems: string[] }`. It reads YAML or JSON. It refuses unknown top-level keys, a `from.url` that isn't `isPublicUrl` (from peers.mjs), and a non-UUID `id`.
  - `requestText(request) → string`: YAML, keys in a fixed order.
  - `hubPeerOf(request, decision) → { name, url, type, trust: 'read', relationship: 'node', since: <date>, decision }`
- **Produces, from `invite.mjs`:**
  - `makeInvite({ name, type, network, expires, random }) → { record: { id, name, type, network, expires, token_sha256, used_by: null }, token }`. The token is 32 random bytes as base64url.
  - `inviteMatch(invites, token, request, now) → { invite } | { problem: string }`.
- **Produces, from `intake.mjs`:**
  - `intakeOutcome(join, request, invites, now)` returns one of:
    - `{ kind: 'refuse', reason }`
    - `{ kind: 'accept', by: 'invite', invite }`
    - `{ kind: 'accept', by: 'standing', decision }`
    - `{ kind: 'propose' }`
- **Registries:**
  - `{ name: 'federation-requests', topKey: 'requests', kind: 'collection', ledger: true }`.
    - Record: `{ id, received, transport, ref, from, network, answers, invite: <matched invite id> | null, outcome: 'refused'|'accepted'|'proposed'|'held', reason?, proposal?, decision? }`.
    - `invite` is the id of the invite that matched, **never the token** (R18).
    - Whether the hub has replied is kept outside git (Task 6), so the record has no `replied` field.
    - The schema has `additionalProperties: false` and no person fields.
    - `ledger: true` means the change engine refuses a staged op on it (`ledgerErrors`, `server/changes/stage.ts:283`), so only Task 6's routes write it.
  - `{ name: 'invites', topKey: 'invites', kind: 'collection' }`, with record `{ id, name, type, network, expires, token_sha256, used_by }`.
- **Link states:** `LINK_STATES = ['mutual', 'claimed', 'requested', 'left', 'not-an-instance', 'unknown']`.
  - `requested`: our entry has `requested`, no `decision`, and the other side doesn't list us.
  - `left`: our entry has `decision`, and the other side doesn't list us.
  - Otherwise as before.
- **Refusal sentences** (exact):
  - closed or no join: `This network isn't taking requests.`
  - wrong type: `This network takes <types joined with ", ">.`
  - a missing ask: `Answer "<ask>".`
  - invite policy without a match: `This network joins by invite. <inviteMatch problem>`

- [ ] **Step 1: Write the failing tests.**
  - `request`:
    - a round trip through `requestText`/`parseRequest`;
    - an extra key is refused;
    - `from.url` `http://`, `https://localhost/x` and an IP are each refused;
    - `hubPeerOf` returns exactly the six fields listed, plus `decision`.
  - `invite`: `an invite matches once, before expiry, for its type, by token hash`:
    - the right token matches;
    - a second use (`used_by` set) gives `This invite has been used.`;
    - past `expires` gives `This invite has expired.`;
    - another type gives `This invite is for a <type>.`;
    - a wrong token gives `This invite doesn't match.`;
    - the invite record never contains the token;
    - the request schema has no field that could hold a token except `invite`, and the requests ledger schema refuses a record whose `invite` isn't an invite id.
  - `intake`: one case per policy:
    - no join or closed → refuse;
    - invite with and without a match;
    - `open-with-approval` → propose;
    - `open` with `decision` → accept by standing;
    - `open` without `decision` → propose;
    - a wrong type → refuse;
    - an unanswered ask → refuse.
  - `peers`: `requested` and `left` against local fixture folders.
- [ ] **Step 2: Run the tests and confirm they fail.**
  `cd packages/admin && npx vitest run tests/lib/federation-request.test.ts tests/lib/federation-invite.test.ts tests/lib/federation-intake.test.ts`
- [ ] **Step 3: Implement.** All three modules stay pure, with no `node:` imports (the app imports them).
- [ ] **Step 4: Run the tests and confirm they pass,** plus the read/peers/registry tests.
- [ ] **Step 5: Commit.** `feat(network N2): requests, invites and intake rules — data and pure functions`

### Task 2: Reading another instance's federation.json, guarded

**Files:**
- Create: `packages/admin/server/federation/remote.ts`, `packages/admin/server/net.ts` (`networkFetch`, moved unchanged from `server/serve.ts:85`)
- Modify:
  - `packages/admin/server/serve.ts`: import `networkFetch` from `./net.ts`;
  - `packages/admin/server/operations/catalogue.ts`: the `federation.check-links` operation.
  - `packages/admin/server/resources/adapters/fleet.ts`: URL-only peers read the cache.
- Test: `packages/admin/tests/federation/remote.test.ts`, `packages/admin/tests/operations/federation-check-links.test.ts`

**Interfaces:**
- **Produces:**
  - `wellKnownUrlOf(address: string) → string | null`. It maps:
    - `https://host` → `https://host/.well-known/federation.json`;
    - a `/.well-known/federation.json` URL → itself;
    - `https://github.com/<o>/<r>` → `https://raw.githubusercontent.com/<o>/<r>/HEAD/.well-known/federation.json`.

    Anything else, or anything failing `isPublicUrl`, gives null.
  - `fetchFederationJson(address, deps: { fetch: FetchLike; lookup?: (host) => Promise<string[]> }) → Promise<{ doc } | { problem }>`. Its guards:
    - every resolved address of the host must be public (refuse loopback, private, link-local, CGNAT and unique-local, v4 and v6);
    - `redirect: 'error'`;
    - a 10 s timeout;
    - a 256 KB cap;
    - the JSON must carry `spec: 'org-os/federation/1'`.
  - `remoteCache(repo)` with `get(url)` / `put(url, doc)` under `join(stateDir(repo), 'federation', 'remote')`, keyed by sha256 of the URL, storing `fetched_at`.
  - The operation `federation.check-links`:
    - `kinds: ['instance']`, offered on the self card;
    - `effect: 'reads'`, `network: true`;
    - `params: { type: 'object', additionalProperties: false, properties: { address: { type: 'string', maxLength: 2048 } } }`:
      - with `address`, it looks up that one hub (the Ask form's `Look it up`, Task 9);
      - without it, it looks up every URL-only peer;
    - an `InProcess` that calls `fetchFederationJson(address, { fetch: networkFetch })` with the job's `signal`, and writes only the cache, which sits under `stateDir`, outside the repository, so the executor sees no changed file;
    - `refreshes: 'fleet'`.
  - **Fleet:** a peer with no local folder but a cached doc gets its state from the cached doc's `networks`/`peers` (the other side's claims). Its fact line says `checked <fetched_at>`.

- [ ] **Step 1: Write the failing tests.**
  - `wellKnownUrlOf`: each mapping, plus null cases.
  - `refuses private, redirecting, slow and oversized answers`, using an injected fetch and lookup:
    - a host resolving to 10.0.0.1 or ::1 is refused before fetch is called;
    - a redirect is refused;
    - a body that never ends is refused after the timeout (fake timers);
    - 300 KB is refused;
    - wrong `spec` is refused.
  - A good doc lands in the cache, and the fleet reads it (the state goes from `unknown` to `mutual` or `claimed`).
  - The operation `needsConfirm` is true.
  - Its params refuse an unknown key.
  - Run under vitest, its `InProcess` fails with `no network in tests`, which proves it goes through `networkFetch`.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.** The DNS check uses `node:dns/promises` `lookup(host, { all: true })` by default.
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit.** `feat(network N2): read another instance's federation.json — guarded, cached, confirmed`

### Task 3: The transport interface, the file transport, and the waiting ones

**Files:**
- Create:
  - `packages/admin/server/federation/transports/types.ts`
  - `index.ts` (the registry)
  - `file.ts`
  - `waiting.ts` (`hosted`, `p2p`)
- Test: `packages/admin/tests/federation/transports.test.ts`

**Interfaces:**
- **Produces, from `types.ts`:**
  ```ts
  export type TransportId = 'file' | 'github' | 'hosted' | 'p2p' | (string & {})
  export interface Sent { ref: string; summary: string; text?: string }
  export interface Incoming { ref: string; text: string }
  export interface Status { state: 'waiting' | 'accepted' | 'refused'; reason?: string }
  /** `run` defaults to `runCommand` (server/resources/run.ts:6); it inherits the process env. */
  export interface TransportCtx { run: Runner; repo: string; signal?: AbortSignal }
  export interface Transport {
    id: TransportId; label: string
    /** Synchronous: Operation.unavailable and variants are (catalogue.ts:51). Shape only: the hub's `where`, an invite. */
    unavailable(where: string | null, request: FederationRequest | null): string | null
    /** Asynchronous checks of this machine (gh installed, signed in), run in `plan` and by GET /api/federation/transports. */
    ready(ctx: TransportCtx): Promise<string | null>
    send(request: FederationRequest, where: string | null, ctx: TransportCtx): Promise<Sent>
    poll?(where: string, ctx: TransportCtx): Promise<Incoming[]>
    status?(ref: string, ctx: TransportCtx): Promise<Status>
    reply?(ref: string, outcome: { kind: 'accepted' | 'refused'; sentence: string }, ctx: TransportCtx): Promise<void>
  }
  ```
- **Produces, from `index.ts`:**
  - `transports() → readonly Transport[]`;
  - `transportOf(id) → Transport | null`;
  - `registerTransport(t: Transport) → () => void`, which returns the function that unregisters it, for tests and for N4's hosted transport.
- **Each transport:**
  - **file:**
    - always available;
    - `send` returns `{ ref: 'file:<id>', summary: 'Saved as a file to send.', text: requestText(request) }`;
    - no `poll`, `status` or `reply`: the hub imports the file, and the node is told by whatever channel carried it.
  - **hosted:** `unavailable` gives `Comes with hosted hubs, after sign-in.`
  - **p2p:** `unavailable` gives `Comes later.`

  `send` on an unavailable transport throws.

- [ ] **Step 1: Write the failing tests.**
  - The registry lists exactly `file, github, hosted, p2p`. This task registers `github` as a placeholder whose `unavailable` is `Not built yet.`; Task 4 replaces it.
  - `file` sends the exact `requestText`.
  - `hosted` and `p2p` say their sentences, and `send` throws.
  - A fake fifth transport added with `registerTransport` can be found by `transportOf`, and is listed by `transports()`, with no caller change (the plugin seam). The function it returns removes it again.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit.** `feat(network N2): pluggable request transports — file now; hosted and p2p registered and waiting`

### Task 4: The github transport, through the operator's gh

**Files:**
- Create: `packages/admin/server/federation/transports/github.ts`, `packages/admin/tests/gh-shim.ts` (beside `tests/git-shim.ts`, which it follows)
- Modify: `packages/admin/server/federation/transports/index.ts`
- Test: `packages/admin/tests/federation/transport-github.test.ts`

**Interfaces:**
- **Consumes:** Task 3's `Transport` and `TransportCtx`.
- **`unavailable(where, request)`** (synchronous):
  - `where` isn't `https://github.com/<o>/<r>` (the hub's `join.where`) → `This hub doesn't take requests on GitHub.`
  - the request carries an `invite` → `An invited request goes as a file, so the invite stays private.` (R18: an issue is public, and anyone reading it could use the token first.)
- **`ready(ctx)`** (asynchronous):
  - `gh --version` fails → `Install the GitHub CLI (gh) to send this way, or send it as a file.`
  - `gh auth status` fails → `Sign in to gh first: gh auth login.`
- **Commands** (exact args; the body is passed with `--body-file` from a temp file, never on the command line):

| Method | Command | Notes |
|---|---|---|
| `send` | `gh issue create --repo <o>/<r> --title "org-os join request: <from.name> → <network>" --body-file <tmp>` | `ref` is the printed issue URL. The body is a short sentence, then the request in a fenced `yaml` block. |
| `poll` | `gh issue list --repo <o>/<r> --state open --search "org-os join request in:title" --json url,body --limit 50` | Each body's fenced yaml becomes an `Incoming`. |
| `status` | `gh issue view <ref> --json state,comments` | `OPEN` → `waiting`. `CLOSED` with the last comment starting `Accepted` → `accepted`, or `Refused` → `refused`, with the comment's first line as the reason. |
| `reply` | `gh issue close <ref> --comment "<Accepted|Refused>: <sentence>"` | |

- **Fake gh:** `withFakeGh<T>(script: Record<string, { stdout?: string; code?: number }>, fn: () => Promise<T>) → Promise<{ result: T; calls: string[][] }>`.
  - It writes an executable `gh` into a temp folder, keyed by the subcommand pair (`issue create`, `auth status`, …).
  - It puts the folder first on this process's `PATH` for the duration of `fn`, as `withFailingCommit` does, because `runCommand` takes no env and inherits the process's.
  - It records each call's argv, then restores `PATH` and removes the folder.

- [ ] **Step 1: Write the failing tests** against the fake gh.
  - Each method's exact argv.
  - The body never appears in argv.
  - A request containing a backtick fence is escaped so it can't close the block early.
  - The `unavailable` and `ready` sentences.
  - `an invited request never goes into an issue`: `unavailable` gives the invite sentence, and `send` throws before `gh` is called (the fake records no `issue create`).
  - A poll that returns an issue with no yaml block skips it.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit.** `feat(network N2): the github transport — an issue on the hub's repo, through the operator's gh`

### Task 5: The node's side — ask, send, follow

**Files:**
- Create: `packages/admin/server/federation/node.ts`, `packages/admin/server/federation/routes.ts`
- Modify:
  - `packages/admin/server/serve.ts`: in `createApp(repo, (a, ctx) => …)`, beside `mountSystemsMap(a, { repo, fetch })` (serve.ts:208), mount `mountFederation(a, { repo, fetch, withLock: ctx.withLock })`;
  - `packages/admin/server/operations/catalogue.ts`: `federation.send`, `federation.status`;
  - `packages/admin/server/resources/adapters/fleet.ts`: the self instance card gains `facts.outgoing`, because `Operation.variants` gets only the resource (catalogue.ts:49).
- Test: `packages/admin/tests/federation/node.test.ts`

**Interfaces:**
- **Consumes:**
  - Task 1's `buildRequest`, `requestText`, `readFederation`;
  - Task 2's `fetchFederationJson`;
  - Task 3's `transportOf`;
  - `commitOrStage` (`server/workspace/pages.ts:232`; the caller holds the write lock), `FileOp` (`server/changes/types.ts:12`), `fileBase` (`server/workspace/files.ts:76`), and the `editedText` pattern (`server/workspace/collections.ts:153`), which keeps comments;
  - `knownActorOf(c)` (`server/request.ts`).
- **Produces:**
  - `facts.outgoing` on the self instance card: `{ id, network, hub, onTrunk: boolean, sent: { transport, ref, at } | null, status: Status | null }[]`;
  - it is read from `federation/outgoing/*.yaml` as committed on the trunk, plus `stateDir(repo)/federation/outgoing/<id>.json`.
- **Routes:**
  - `GET /api/federation/hub?address=<a>` returns `{ hub: { name, type, url, networks, join } }` or `{ problem }`.
    - It reads only the cache, and only when it is fresh (under 10 min).
    - Otherwise it answers `{ problem: 'Look it up first.' }`, and the UI runs `federation.check-links` with `{ address }` (Task 2).
  - `GET /api/federation/transports?hub=<url>&id=<outgoing id>` returns `[{ id, label, unavailable }]`. Each `unavailable` is the transport's `unavailable(where, request)`, else its `ready(ctx)`.
  - `POST /api/federation/ask { hub: url, network, answers, invite? }`. It stages, in the actor's change:
    - one `FileOp` editing `federation.yaml`: append `networks: {name, hub, role: 'node'}` and `peers: {name, url, type, trust: 'read', relationship: 'hub', requested: <id>, since: <today>}`;
    - one `FileOp` creating `federation/outgoing/<id>.yaml`: `requestText` of the request **without** `invite`, with `from` taken from the instance's own identity and its public `url`.

    The invite token, when there is one, goes only to `stateDir(repo)/federation/outgoing/<id>.json` as `{ invite }`, outside git (R18). `federation.send` joins it in at send time.

    It returns `{ id }`, or 400 with the first unmet ask or the policy refusal from `intakeOutcome` (checked early, so the node is told before sending).
  - `POST /api/federation/outgoing/<id>/withdraw`:
    - before acceptance, it stages removal of the networks/peers entries and the outgoing file;
    - after acceptance (the peer has `decision`), the same staged change is "leaving", and the answer says `Leaving <network>. The hub will see the link as left.`
- **Operations** (both on the self instance card, with variants per outgoing request):
  - `federation.send`: `network: true`, `effect: 'changes'`.
    - Params: `{ id: string (uuid pattern), transport: string }`, both required, with `additionalProperties: false`.
    - Its `variants(r)` give one per outgoing request and transport, from `r.facts.outgoing`.
    - Each variant's `unavailable` is:
      - `Apply your own change first, then send.` while `onTrunk` is false;
      - otherwise the transport's synchronous `unavailable(where, request)`.
    - Its `plan` is async. It calls `transport.ready(ctx)` and throws `HttpError(409, 'Not sent: <sentence>')` before any nonce is issued.
    - Then it returns an `InProcess`, which:
      - reads the committed text and joins in the token from the state file;
      - calls `transport.send`;
      - writes `sent: { transport, ref, at }` into `stateDir(repo)/federation/outgoing/<id>.json`, never into git.
    - For `file`, the job's result carries the text, and the UI offers it as a download.
  - `federation.status`: `network: true`, `effect: 'reads'`. It calls `transport.status(ref)` and stores the answer in the same state file.
  - When `accepted`, the Federation page offers `Record it`. That stages the peer's `decision: <hub's reason line>` and removes `requested`.

- [ ] **Step 1: Write the failing tests.** Use `makeFixtureRepo`, injected fetch and the fake transports.
  - `ask` stages exactly the two FileOps, and comments in `federation.yaml` survive.
  - An unanswered ask gives 400 `Answer "<ask>".`
  - A closed hub gives 400.
  - `send waits for the trunk; withdraw after mutual is leaving`:
    - send is unavailable before apply and available after;
    - withdraw before acceptance removes the entries;
    - withdraw after `decision` answers the leaving sentence.
  - Status `accepted` → `Record it` stages the `decision`.
  - `the outgoing file never holds the invite token`:
    - asking with an invite stages an outgoing file with no `invite` key;
    - the token is in the state file only;
    - the text the fake transport receives at send carries it.
  - `ready()` failing makes `plan` answer 409 `Not sent: …`, and no nonce is issued.
  - The self card's `facts.outgoing` lists the request with `onTrunk` false before apply and true after.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass,** plus `tests/operations/` and `tests/resources/fleet.test.ts`.
- [ ] **Step 5: Commit.** `feat(network N2): ask to join — the node stages its own side, sends only when confirmed, follows the answer`

### Task 6: The hub's side — receive, apply the policy, reply

**Files:**
- Create: `packages/admin/server/federation/hub.ts`, `packages/admin/server/federation/ledger.ts`
- Modify:
  - `packages/admin/server/federation/routes.ts`
  - `packages/admin/server/operations/catalogue.ts`: `federation.poll`, `federation.reply`.
  - `packages/admin/schemas/proposals.schema.json`: the optional `origin`.
  - `packages/admin/lib/proposals.mjs`: `checkProposals` (`:301`) accepts `origin`.
  - `packages/admin/server/proposals/propose.ts`: `ProposeInput.origin?` (`:38`), written on the entry.
  - `packages/admin/server/resources/adapters/fleet.ts`: the self card gains `facts.inbox` (a count) and `facts.toReply` (`{ id, from, outcome }[]`), so `federation.reply` can draw its variants.
- Test: `packages/admin/tests/federation/hub.test.ts`

**Interfaces:**
- **Consumes:**
  - Task 1's `parseRequest`, `intakeOutcome`, `hubPeerOf`, `inviteMatch` and the registries;
  - Task 3's `transportOf`;
  - `propose()` (`server/proposals/propose.ts:114`), which refuses with 409 `DIRECT` when the actor may apply the change alone (`:167`);
  - `effectiveRule` and `readRuleContext` (as `commitOrStage` uses them, `server/workspace/pages.ts:233-236`);
  - `guardFiles` (`server/changes/apply.ts:82`), `guardTrunk` (`server/proposals/ledger.ts:111`), `commitDataPaths` / `restageDataPaths` (`server/git.ts:303`, `:357`), and `withTrailers` (`lib/trailers.mjs:40`, `decision` → `Org-Decision`).
- **Produces, from `ledger.ts`:** `writeHubFiles(repo, files: { rel: string; text: string }[], message: string, trailers: TrailerValues, ident?: GitIdent) → Promise<{ commit: string }>`.
  - It is the hub's writer for `data/federation-requests.yaml`, `data/invites.yaml` and `federation.yaml`, because the proposals ledger's writers are bound to `data/proposals.yaml`.
  - Its steps follow `commitLedger` (`server/proposals/ledger.ts:264`):
    1. `guardTrunk`, then `guardFiles(rels)`;
    2. each data file is validated against its schema, and refused with 422 `Not written: …`;
    3. `assertGitSafe`;
    4. one `commitDataPaths`;
    5. on failure, each file's bytes are put back, and `restageDataPaths` runs.
- **Produces, from `hub.ts`:**
  - `receive(repo, actor: KnownActor, incoming: { transport, ref, text }, now) → Promise<{ outcome, sentence, proposal? }>`. The caller holds the write lock. Its steps:
    1. `parseRequest`.
    2. Refuse when `request.id` or `ref` is already in the registry: `Already received.`, creating nothing.
    3. Run `intakeOutcome`.
    4. Write the outcome:
       - **refuse:** `writeHubFiles` appends the record `outcome: 'refused'` with `reason`.
       - **accept:** one `writeHubFiles` commit that:
         - adds `hubPeerOf(request, decision)` to `federation.yaml`;
         - appends the record `outcome: 'accepted'`, with `invite: <invite.id>` or null;
         - for an invite, sets that invite's `used_by: request.id` in `data/invites.yaml`.

         The trailers are `{ actor, decision: 'invite <invite.id>' | <join.decision> }`. The message is `federation: accept <from.name> into <network>`.
       - **propose:** first judge `effectiveRule(readRuleContext(repo, actor), ['identity'], ['federation.yaml'])`.
         - When it is `direct`, the importer may change identity alone, and `propose()` would refuse with `DIRECT`. The record is written `outcome: 'held'`, and the operator decides it (below, R19).
         - Otherwise, stage the same `federation.yaml` edit in the actor's change. Then call `propose(repo, actor, change, { title: 'Join request: <from.name> → <network>', origin: { kind: 'federation-request', request: id, from: from.name } })`. Then write the record `outcome: 'proposed'` with `proposal`.
  - `POST /api/federation/requests/:id/decide { accept: boolean, reason?: string }`, for a `held` request only:
    - accept: one `writeHubFiles` commit of the peer entry and the record (`outcome: 'accepted'`, `decision: 'request <id>'`), after re-checking the rule is still `direct`;
    - refuse: the record becomes `outcome: 'refused'` with `reason`, which is required.
  - `POST /api/federation/requests/receive { text? }`:
    - with `text` (Import), it calls `receive` with `transport: 'file'` and `ref: 'file:<id>'`;
    - without it, it receives each inbox item, and deletes each one once its record has landed.
    - It answers one `{ ref, outcome, sentence }` per request.
  - `federation.poll`: `network: true`, `effect: 'reads'`, offered on the self card when `join.where` is set.
    - Its `InProcess` calls `transport.poll(join.where)` and writes each `Incoming` to `stateDir(repo)/federation/inbox/<sha256(ref)>.json`.
    - It writes nothing in git and has no actor (Global Constraints).
    - It answers `<n> requests waiting. Receive them on the Federation page.`
  - **Outcome of a proposed request:** derived from its proposal's state (`ratified` → accepted, with the decision the ratify wrote; `rejected`/`expired`/`withdrawn` → refused). It is never stored twice.
  - `federation.reply`: `network: true`, `effect: 'changes'`.
    - Params: `{ id }`.
    - Its variants come from the hub card's `facts.toReply`: final outcomes with no reply receipt, whose transport has `reply`.
    - Its `InProcess` calls `transport.reply(ref, { kind, sentence })`, then writes the receipt `stateDir(repo)/federation/replied/<id>.json` `{ at, ref }`.
    - The adapter (Task 7) reads that receipt. It isn't a ledger field, because an in-process operation has no actor and can't commit.

- [ ] **Step 1: Write the failing tests.** Use temp hub repos with `governance.yaml` solo and with a two-member rule, the file transport, and the fake gh for poll and reply.
  - `builds the hub change from fields, never from the file`: a request carrying an extra `change:` block, or YAML for `IDENTITY.md`, is refused by `parseRequest`. A valid one yields a `federation.yaml` diff that adds exactly one peer and touches no other file.
  - `the same request is received once`: by id and by ref.
  - One case per outcome:
    - closed hub → refused record;
    - invite match → commit with the `Org-Decision: invite <id>` trailer and the invite `used_by`;
    - `open-with-approval` → an open proposal with `origin`, authored by the importer;
    - ratifying it → the derived outcome is accepted.
  - `a solo hub holds the request for its operator`, on a solo `governance.yaml` with `open-with-approval`:
    - the outcome is `held`, and no proposal is opened;
    - `decide { accept: true }` commits the peer with `Org-Decision: request <id>`;
    - `decide { accept: false }` without a reason is refused.
  - An accepted request's record holds the invite's id, and no token appears anywhere in the hub's repository (grep the tree for the token).
  - `federation.poll` writes only the inbox: the executor's snapshot before and after shows no changed file. `receive` with no text then drains the inbox.
  - `writeHubFiles` puts every file back when the commit fails (as `tests/server/proposals.ledger.test.ts` tests `commitLedger`).
  - The proposals schema accepts `origin` and still refuses other unknown keys.
  - Reply calls gh with the exact `--comment`, then writes the receipt, and the request leaves `toReply`.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass,** plus `tests/server/proposals.propose.test.ts`, `tests/server/proposals.ledger.test.ts` and `tests/lib/proposals.test.ts`.
- [ ] **Step 5: Commit.** `feat(network N2): the hub receives requests under its join policy — refuse, accept under a decision, or propose`

### Task 7: Requests as resources, the requests board, and "From outside"

**Files:**
- Create: `packages/admin/server/resources/adapters/federation.ts`, `packages/admin/boards/federation-requests.yaml`
- Modify:
  - the `Kind` union in `server/resources/types.ts:6`;
  - `ADAPTERS` in `server/resources/index.ts:13`;
  - `Operation.refreshes` in `server/operations/catalogue.ts:55`: it gains `'federation'`, which `federation.poll`, `federation.reply` and the decide route's notify use;
  - `RECORD_KINDS` in `lib/board-query.mjs:31`;
  - `KIND_ORDER` and the label `join request` in `app/src/kinds.ts:6`;
  - `BUILTIN_ORDER` in `server/boards/read.ts:10`;
  - `app/src/pages/Governance.tsx`: the group;
  - `app/src/blocks/proposals.tsx`.
- Test: `packages/admin/tests/resources/federation-requests.test.ts`, `packages/admin/app/src/pages/Governance.test.tsx` (extend), and the tests that list the kinds (`app/src/sections.test.ts`, `tests/lib/board-query.test.ts`, `tests/boards/read.test.ts`) updated.

**Interfaces:**
- **Adapter:** `{ name: 'federation', board: 'organization', title: 'Join requests' }`, watching `data/federation-requests.yaml` and `data/proposals.yaml`, with the shape of `server/resources/adapters/proposals.ts`. The reply receipts live under `stateDir`, which no watcher sees, so `federation.reply`'s `refreshes: 'federation'` re-reads it after a job.
- **Kind `federation-request`:** one Resource per record.
  - `status` is one of `requested | under-decision | mutual | refused`:
    - `proposed` + open proposal → `under-decision`;
    - `held` → `under-decision`;
    - accepted → `mutual`;
    - refused → `refused`;
    - received with nothing yet → `requested`.
  - `facts` are `{ from, network, transport, ref, proposal?, replied }`.
  - Attention is `warn`:
    - `Decide it.` for `held`;
    - `Tell them the outcome.` when the outcome is final, the transport has `reply`, and there is no reply receipt.
- **The built-in board `federation-requests`:** one `kanban` block, `source: { kind: federation-request }`, `view: { group: status, columns: [requested, under-decision, mutual, refused] }`.
  - It is the first built-in kanban. `builtinBoards()` loads it at start and `validateBoard` checks it there, so a bad file fails every test that reads boards.
  - `status` is a base field (`BASE_FIELDS`, `lib/board-query.mjs:36`), so grouping by it needs no new field list.
- **The Governance Open tab:** a first group titled exactly `From outside`, listing open proposals with `origin.kind === 'federation-request'`. They are left out of the main list so they don't show twice.

- [ ] **Step 1: Write the failing tests.**
  - The adapter maps each outcome and proposal state to the right column.
  - Attention appears when not replied.
  - The board loads and groups.
  - Governance renders `From outside` with the right proposal and doesn't repeat it below.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass,** plus the build through the lock.
- [ ] **Step 5: Commit.** `feat(network N2): join requests on a board, and outside proposals in their own group`

### Task 8: Invites — make one, send the link, use it once

**Files:**
- Modify: `packages/admin/server/federation/hub.ts`, `packages/admin/server/federation/routes.ts`
- Test: `packages/admin/tests/federation/invites.test.ts`

**Interfaces:**
- **Consumes:** Task 1's `makeInvite` and `inviteMatch`.
- **`POST /api/federation/invites { name, type, network, days }`:**
  - `days` is 1–90, default 30.
  - It stages a `create` op on `invites:<id>` holding the record (class `identity`, under the hub's rules).
  - It returns `{ id, link }` **once**. The link is `<hub's own federation.json url>#invite=<token>`. The token isn't stored anywhere, so the answer says exactly `Copy this link now. It won't be shown again.`
- **Invite match:** an invite counts only when its record is on the trunk (`readRegistry` on the trunk, not the actor's staged change). Intake (Task 6) matches it there.
- **`.well-known/`:** the standards builder publishes no invite data. Add a leak test.

- [ ] **Step 1: Write the failing tests.**
  - The staged record holds `token_sha256` and no token.
  - The link's token hashes to it.
  - A staged-but-unapplied invite doesn't match.
  - An applied one matches once.
  - Nothing in `projectPublic`'s output (`lib/standards/project.mjs:174`, through `lib/standards/build.mjs`) contains the invite id or hash, when fed a repo whose `data/invites.yaml` holds one.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit.** `feat(network N2): invites — a one-time link, only its hash kept, valid once applied`

### Task 9: The Federation page

**Files:**
- Create: `packages/admin/app/src/pages/Federation.tsx`
- Modify:
  - `packages/admin/app/src/App.tsx`: the route `/federation`, beside `/systems/map` (App.tsx:217);
  - `packages/admin/app/src/frame/path.ts`: `{ href: '/federation', label: 'Federation', parent: '/systems' }` in `PLACES`, as Compose and Deploy are;
  - `packages/admin/app/src/api.ts`;
  - the CSS beside the existing page styles (tokens only).
- Test: `packages/admin/app/src/pages/Federation.test.tsx`

**Interfaces:**
- **Consumes:** Tasks 5–8's routes and operations, through the existing operations plan → confirm → job UI.
- **Sections, top to bottom:**
  1. **`Networks`:** each with its link state, in plain words:
     - mutual → `Part of it`;
     - requested → `Asked, waiting`;
     - claimed → `Only this side lists it`;
     - left → `Left`;
     - refused → `Refused: <reason>`.

     Each has a `Check` action (`federation.status`) and `Withdraw`.
  2. **`Ask to join a network`:**
     - an address field `The hub's address`;
     - `Look it up` (the confirmed check);
     - the hub's name, type and policy in one sentence:
       - closed: `This network isn't taking requests.`
       - invite: `This network joins by invite.`, plus an `Invite link` field;
       - open-with-approval: `Anyone can ask. The hub decides under its own rules.`
       - open: `Anyone can join. The hub has agreed to accept requests.`
     - one field per `asks`;
     - `Ask`, which stages; then `Send` offers each transport from `GET /api/federation/transports`, with each unavailable one shown greyed with its sentence.
     - **Pre-fill:** the page reads `?hub=<url>&network=<name>` from the query, and `#invite=<token>` from the fragment, which it then clears from the address bar with `history.replaceState`. It fills the form from them and runs no operation by itself. The launcher (Task 10) lands here.
  3. **On a hub (the instance has a `join` block, or the person picks `Take requests`):**
     - **`Join policy`:** the four choices with `Recommended` on `open-with-approval`.
       - Choosing `open` asks for `The decision that agreed to it`: a decision id picked from the Decided tab's list. Without one, the page says `Without a decision, this works as "anyone can ask, the hub decides".` (R17).
       - Changing it stages a `federation.yaml` edit (class `identity`).
     - **`Invites`:** a make-invite form, and the one-time link display.
     - **`Requests`:**
       - `Check for requests` (`federation.poll`), then `Receive them (<n>)` when the inbox holds any;
       - `Import a request`: a file input, read client-side as `app/src/import/ImportSheet.tsx` does, then its text POSTed to `/api/federation/requests/receive`;
       - for each `held` request, `Accept` and `Refuse` (with a required reason);
       - a link to the requests board.

- [ ] **Step 1: Write the failing tests,** with api mocked.
  - Each state's words.
  - A closed hub disables Ask.
  - The invite field appears only for invite.
  - An unanswered ask disables Ask.
  - The transports list greys hosted and p2p with their sentences.
  - The one-time link shows once.
  - Import posts the file's text.
  - The policy picker marks `Recommended` and stages. `open` without a decision shows the fallback sentence.
  - `pre-fills from the link and sends nothing`: given `?hub=…&network=…#invite=…`, the fields are filled, the fragment is cleared, and no call to `/api/operations/*` or `/api/federation/ask` is made.
  - A held request shows `Accept` and `Refuse`, and `Refuse` needs a reason.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement,** following the design guards (no inline look styles; a live region only if allow-listed with a reason).
- [ ] **Step 4: Run the tests and confirm they pass,** plus the guard tests (`app/src/design/legacy.test.ts`, `app/src/design/skins/skins.test.ts`, `app/src/parts/liveRegions.test.ts`) and the build through the lock.
- [ ] **Step 5: Commit.** `feat(network N2): the Federation page — ask to join, follow it, and take requests`

### Task 10: The launcher's Join door

**Files:**
- Modify:
  - `packages/admin/launcher/serve.ts`:
    - the doors (serve.ts:124);
    - `POST /api/launcher/join/inspect`;
    - `LauncherOptions` (serve.ts:32) gains `fetch?: FetchLike` and `lookup?`, with tests injecting both;
    - `openFlow(repo, landing = '/systems/map?first=1')` (serve.ts:65), whose return type in `startLauncher`'s signature changes with it.
  - `packages/admin/launcher/index.ts`: pass `networkFetch` from `server/net.ts`.
  - `packages/admin/app/src/launcher/Launcher.tsx`, `packages/admin/app/src/launcher/api.ts`
- Test: `packages/admin/tests/launcher/join.test.ts`, `packages/admin/app/src/launcher/Launcher.test.tsx` (extend)

**Interfaces:**
- **Consumes:** Task 2's `wellKnownUrlOf`/`fetchFederationJson`, behind the launcher's existing Origin/Host guard. The inspect call is itself the confirmation: the person pressed `Look it up`.
- **Doors:** `{ id: 'join', available: true }`.
- **`POST /api/launcher/join/inspect { address }`:**
  - It accepts a hub address or an invite link (`…#invite=<token>`; the fragment is split off before fetching and never sent).
  - It returns `{ hub: { name, type, url, network, policy, types, asks }, invite: boolean }`, or `{ error }`.
- **UI:**
  - The Join card has an address field and `Look it up`, then the hub sentence (as in Task 9), then `Create a new one` / `Adopt a repo`.
  - The type is preset to `types[0]` when the hub names types.
  - After open, `openFlow(repo, landing)` sends the person to `/federation?hub=<url>&network=<name>`.
  - The invite token is handed over through the URL fragment `#invite=<token>`, never in the query, so it doesn't reach server logs.
  - The fragment is added by the launcher's page in the browser, after `openFlow` answers. The token is never sent back to the launcher's server, nor to the admin's.
  - Task 9's page does the pre-fill.

- [ ] **Step 1: Write the failing tests.**
  - The inspect route refuses a foreign Origin.
  - It strips the fragment before fetching (assert the fetched URL).
  - Its answer shape matches.
  - Join is available. The existing test `Join is disabled and says why` (`Launcher.test.tsx:122`) is replaced.
  - The create flow with a hub lands on `/federation?hub=…&network=…#invite=…`.
  - The token is in no request body or URL sent to the launcher's server: the fetch mock records every call, and none carries it.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit.** `feat(network N2): the launcher's Join door — look up a hub, open or create, land ready to ask`

### Task 11: Docs, the pilot played on copies, and full suites

**Files:**
- Modify: `docs/FEDERATION.md` (the request flow, transports, policies and invites), `docs/OPENING.md` (the Join door)
- Create: `docs/superpowers/plans/2026-11-10-network-n2-acceptance.md`

- [ ] **Step 1: Docs.** In `docs/FEDERATION.md`, add a section `Joining a network` of at most 120 lines. It covers:
  - the four policies, with `open-with-approval` recommended;
  - the request's fields, stating that it holds no personal contact;
  - the transports and what each needs;
  - invites;
  - what each link state means.

  Update `docs/OPENING.md`'s Join paragraph.
- [ ] **Step 2: The pilot, decision 1a, on copies only.**
  - Make `git clone --local` copies of the real `refi-bcn-os` and `refi-dao-os` into a scratch folder. Record each real repo's `git status --porcelain | shasum` and `rev-parse HEAD` before and after; they must be identical.
  - In the DAO copy:
    - set `join: { policy: open-with-approval, types: [LocalNode], asks: [why], where: <a placeholder github URL> }` through the Federation page's policy picker (staged, then applied under its rules);
    - give the copy a public `url` so its `federation.json` is served by a local stub. The test fetch is injected; the acceptance uses a small local HTTP server and a `lookup` override, allowed only in the acceptance script, never in code.
  - From the BCN copy:
    - Look it up, answer, Ask, and apply its own change;
    - Send by `file`.
  - In the DAO copy:
    - Import the file. If the copy's rules let the operator change `identity` alone, the request is `held`, so Accept it. Otherwise it becomes an outside proposal under `From outside`, so ratify it under its rules. Record which path the copy took.
    - Either way, `federation.yaml` gains BCN with `decision`;
    - the requests board shows `mutual`.
  - Back in BCN: record the acceptance. Both sides' link state is `mutual`.
  - Repeat the send with `github` against the fake gh, to show poll, receive, status and reply.
  - Make an invite on the DAO copy, and show that an invited request is refused by `github` and goes by `file`.
  - Grep both copies' trees and `git log -p` for the token. It must appear nowhere.
  - Record every command and result in the acceptance file. Name only lf-work-os, refi-bcn-os, refi-dao-os, refi-med-os and regen-coordination-os.
- [ ] **Step 3: Headless screenshots** of `/federation` (node and hub) and the launcher's Join card, through the lock, saved under scratch and not committed.
- [ ] **Step 4: Full suites, one at a time, through the lock:**
  - `~/.cache/lf-heavy-run.sh "w5|network-n2|root" npm test`
  - `~/.cache/lf-heavy-run.sh "w5|network-n2|admin" npm --prefix packages/admin test`
  - `~/.cache/lf-heavy-run.sh "w5|network-n2|tsc" npm --prefix packages/admin run typecheck`

  Expected: green, apart from the load-timeout flakes the N0 record names. Tell flakes apart by re-running the file alone.
- [ ] **Step 5: Commit.** `docs(network N2): joining a network, and the BCN → DAO pilot played on copies`
