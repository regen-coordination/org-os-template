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

**Spec:** `docs/superpowers/specs/2026-11-06-org-os-open-and-federate-design.md`. The relevant parts are §6 (federation), §9 N2, §11 (operator decisions 1a/2a/3a), §12 R4 (`requested`/`left` arrive here), §13 R9 (the Join door arrives here) and **§14 R11–R17, which bind over §6**.

**Operator decisions already taken (spec §11):**
- **1a:** the first pilot pair is ReFi BCN asking ReFi DAO. N2's acceptance plays it on scratch copies; the real request is a separate go.
- **2a:** `open-with-approval` is the recommended policy. Each hub's council sets its own; no code sets a hub's policy.
- **3a:** no node-lead hats. N2 has no chain step.

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
  - `networkFetch` already throws under VITEST.
- **The hub builds its change from validated request fields only** (R13), through `hubPeerOf(request)`. It never applies YAML, a diff or ops carried inside a request.
- **A request record holds org-level facts only** (R13): `from {name, type, url}`, `network`, `answers`, `invite`. No personal contact field exists in its schema.
- **Invites store `token_sha256` only** (R14), use the existing `lib/sha256.mjs`, can be used once, expire, and never appear in `.well-known/`.
- **Policy defaults** (R17):
  - no `join` block means `closed`;
  - `open` without `join.decision` is read as `open-with-approval`;
  - the policy picker marks `open-with-approval` with exactly `Recommended`.
- **No chain step and no hats** (decision 3a).
- **`server/git.ts` and its vocabulary test stay unchanged.**
  - Hub-side commits use the existing `commit` and `add`.
  - `gh` runs through the operations Planned `{cmd:'gh', args}`, or through `ctx.run` in adapters. It never runs through `git.ts`.
- **Real instances are read-only.** Tests and acceptance use temp repos, and `git clone --local` copies only.
- **Never name the private sibling instance** in any committed file or message.
- **Full suites, builds and browser walks run one at a time, through the lock:** `~/.cache/lf-heavy-run.sh "w5|network-n2|<what>" <command…>`.
- **Copy:** plain, second person. The words are instance, System, proposal, operator, network, hub, node. Never "surface".
- **Stay off the PR A and PR B paths:** no change to `server/session/`, sign-in, or `app/src/portal/`.
- **Commits:** `feat(network N2): …` / `fix(network N2): …`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A request file that's been edited or forged** (it claims another node's name, adds extra peers, or carries YAML for other files) must change nothing on the hub except the one `peers` entry built from validated fields. A request whose `from.url` isn't a public https address is refused. Test: Task 6, `builds the hub change from fields, never from the file`.
2. **A hub address that points to a private network address, redirects, answers slowly, or sends a body over 256 KB** must be refused before anything is parsed. Test: Task 2, `refuses private, redirecting, slow and oversized answers`.
3. **An invite token that's reused, expired, for another type, or simply guessed** must be refused, and an invite must still be safe in a public hub repo. Test: Task 1, `an invite matches once, before expiry, for its type, by token hash`.
4. **The same request imported twice, or polled twice,** must answer `Already received.` and create no second record or proposal. Test: Task 6, `the same request is received once`.
5. **A node that tries to send before its own change is on its trunk, or withdraws after the link is mutual,** must be told plainly. Sending is unavailable until the outgoing request is committed, and withdrawing after acceptance is leaving, which the hub then sees as `left`. Test: Task 5, `send waits for the trunk; withdraw after mutual is leaving`.

---

### Task 1: Request, invite and intake — data and pure rules

**Files:**
- Create: `packages/admin/lib/federation/request.mjs`, `packages/admin/lib/federation/invite.mjs`, `packages/admin/lib/federation/intake.mjs`
- Create: `packages/admin/schemas/federation-requests.schema.json`, `packages/admin/schemas/invites.schema.json`
- Modify:
  - `packages/admin/lib/registries.mjs`: add the two registries.
  - `schemas/change-classes.json`: rows for both registries, plus `federation/**`, all class `identity`.
  - `schemas/federation.yaml`: peers gain `requested`; join gains `decision`.
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
    - Record: `{ id, received, transport, ref, from, network, answers, invite, outcome: 'refused'|'accepted'|'proposed', reason?, proposal?, decision?, replied: boolean }`.
    - The schema has `additionalProperties: false` and no person fields.
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
    - the record never contains the token.
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
- Create: `packages/admin/server/federation/remote.ts`
- Modify:
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
    - an `InProcess` that fetches each URL-only peer's federation.json and fills the cache;
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
  export type TransportId = 'file' | 'github' | 'hosted' | 'p2p'
  export interface Sent { ref: string; summary: string; text?: string }
  export interface Incoming { ref: string; text: string }
  export interface Status { state: 'waiting' | 'accepted' | 'refused'; reason?: string }
  export interface TransportCtx { run: Runner; repo: string }
  export interface Transport {
    id: TransportId; label: string
    unavailable(where: string | null, ctx: TransportCtx): Promise<string | null>
    send(request: FederationRequest, where: string | null, ctx: TransportCtx): Promise<Sent>
    poll?(where: string, ctx: TransportCtx): Promise<Incoming[]>
    status?(ref: string, ctx: TransportCtx): Promise<Status>
    reply?(ref: string, outcome: { kind: 'accepted' | 'refused'; sentence: string }, ctx: TransportCtx): Promise<void>
  }
  ```
- **Produces, from `index.ts`:** `TRANSPORTS: readonly Transport[]` and `transportOf(id) → Transport | null`.
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
  - A fake fifth transport added in the test can be found by `transportOf` with no caller change (the plugin seam).
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit.** `feat(network N2): pluggable request transports — file now; hosted and p2p registered and waiting`

### Task 4: The github transport, through the operator's gh

**Files:**
- Create: `packages/admin/server/federation/transports/github.ts`, `packages/admin/tests/helpers/fake-gh.ts`
- Modify: `packages/admin/server/federation/transports/index.ts`
- Test: `packages/admin/tests/federation/transport-github.test.ts`

**Interfaces:**
- **Consumes:** Task 3's `Transport` and `TransportCtx`.
- **`where`** must be `https://github.com/<o>/<r>` (the hub's `join.where`). Otherwise `unavailable` gives `This hub doesn't take requests on GitHub.`
- **`unavailable`:**
  - `gh --version` fails → `Install the GitHub CLI (gh) to send this way, or send it as a file.`
  - `gh auth status` fails → `Sign in to gh first: gh auth login.`
- **Commands** (exact args; the body is passed with `--body-file` from a temp file, never on the command line):

| Method | Command | Notes |
|---|---|---|
| `send` | `gh issue create --repo <o>/<r> --title "org-os join request: <from.name> → <network>" --body-file <tmp>` | `ref` is the printed issue URL. The body is a short sentence, then the request in a fenced `yaml` block. |
| `poll` | `gh issue list --repo <o>/<r> --state open --search "org-os join request in:title" --json url,body --limit 50` | Each body's fenced yaml becomes an `Incoming`. |
| `status` | `gh issue view <ref> --json state,comments` | `OPEN` → `waiting`. `CLOSED` with the last comment starting `Accepted` → `accepted`, or `Refused` → `refused`, with the comment's first line as the reason. |
| `reply` | `gh issue close <ref> --comment "<Accepted|Refused>: <sentence>"` | |

- **Fake gh:** `fakeGh(dir, script: Record<string, { stdout?: string; code?: number }>) → { env, calls(): string[][] }`. It writes an executable `gh` into a temp folder and puts it first on `PATH`, recording each call's argv.

- [ ] **Step 1: Write the failing tests** against the fake gh.
  - Each method's exact argv.
  - The body never appears in argv.
  - A request containing a backtick fence is escaped so it can't close the block early.
  - The `unavailable` sentences.
  - A poll that returns an issue with no yaml block skips it.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit.** `feat(network N2): the github transport — an issue on the hub's repo, through the operator's gh`

### Task 5: The node's side — ask, send, follow

**Files:**
- Create: `packages/admin/server/federation/node.ts`, `packages/admin/server/federation/routes.ts`
- Modify:
  - `packages/admin/server/serve.ts`: mount `mountFederation(app, { repo, fetch })` in `extend`.
  - `packages/admin/server/operations/catalogue.ts`: `federation.send`, `federation.status`.
- Test: `packages/admin/tests/federation/node.test.ts`

**Interfaces:**
- **Consumes:**
  - Task 1's `buildRequest`, `requestText`, `readFederation`;
  - Task 2's `fetchFederationJson`;
  - Task 3's `transportOf`;
  - the existing `commitOrStage` / `stage`, the `FileOp` shape, `fileBase`, and the `editedText` pattern (`server/workspace/collections.ts:153`), which keeps comments.
- **Routes:**
  - `GET /api/federation/hub?address=<a>` returns `{ hub: { name, type, url, networks, join } }` or `{ problem }`. It is read-only, uses the cache when fresh (under 10 min), and otherwise goes through the confirmed check operation; the UI calls the operation.
  - `POST /api/federation/ask { hub: url, network, answers, invite? }`. It stages, in the actor's change:
    - one `FileOp` editing `federation.yaml`: append `networks: {name, hub, role: 'node'}` and `peers: {name, url, type, trust: 'read', relationship: 'hub', requested: <id>, since: <today>}`;
    - one `FileOp` creating `federation/outgoing/<id>.yaml` (= `requestText`, `from` taken from the instance's own identity and its public `url`).

    It returns `{ id }`, or 400 with the first unmet ask or the policy refusal from `intakeOutcome` (checked early, so the node is told before sending).
  - `POST /api/federation/outgoing/<id>/withdraw`:
    - before acceptance, it stages removal of the networks/peers entries and the outgoing file;
    - after acceptance (the peer has `decision`), the same staged change is "leaving", and the answer says `Leaving <network>. The hub will see the link as left.`
- **Operations** (both on the self instance card, with variants per outgoing request):
  - `federation.send`: `network: true`, `effect: 'changes'`, params `{ id, transport }`.
    - It is unavailable until `federation/outgoing/<id>.yaml` is on the trunk: `Apply your own change first, then send.`
    - Its plan is `InProcess`: `transport.send`, then it writes `sent: { transport, ref, at }` into `stateDir(repo)/federation/outgoing/<id>.json`, not into git.
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
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass,** plus `tests/operations/`.
- [ ] **Step 5: Commit.** `feat(network N2): ask to join — the node stages its own side, sends only when confirmed, follows the answer`

### Task 6: The hub's side — receive, apply the policy, reply

**Files:**
- Create: `packages/admin/server/federation/hub.ts`
- Modify:
  - `packages/admin/server/federation/routes.ts`
  - `packages/admin/server/operations/catalogue.ts`: `federation.poll`, `federation.reply`.
  - `packages/admin/schemas/proposals.schema.json`: the optional `origin`.
  - `packages/admin/lib/proposals.mjs`: `checkProposals` accepts `origin`.
  - `packages/admin/server/proposals/propose.ts`: `ProposeInput.origin?`.
- Test: `packages/admin/tests/federation/hub.test.ts`

**Interfaces:**
- **Consumes:**
  - Task 1's `parseRequest`, `intakeOutcome`, `hubPeerOf`, `inviteMatch` and the registries;
  - Task 3's `transportOf`;
  - `propose()` (`server/proposals/propose.ts:114`);
  - the ledger writers in `server/proposals/ledger.ts`;
  - `withTrailers` (`lib/trailers.mjs`).
- **Produces:**
  - `receive(repo, actor: KnownActor, incoming: { transport, ref, text }, now) → Promise<{ outcome, sentence, proposal? }>`. Its steps:
    1. `parseRequest`.
    2. Refuse when `request.id` or `ref` is already in the registry: `Already received.`, creating nothing.
    3. Run `intakeOutcome`.
    4. Write the outcome:
       - **refuse:** append the record `outcome: 'refused'` with `reason`.
       - **accept:** one commit that adds `hubPeerOf(request, decision)` to `federation.yaml`, appends the record `outcome: 'accepted'`, and for an invite sets `used_by: request.id`. The trailers are `{ actor, decision: 'invite <invite.id>' | <join.decision> }`. The message is `federation: accept <from.name> into <network>`.
       - **propose:** stage the same `federation.yaml` edit in the actor's change, then `propose(repo, actor, change, { title: 'Join request: <from.name> → <network>', origin: { kind: 'federation-request', request: id, from: from.name } })`, then append the record `outcome: 'proposed'` with `proposal`.
  - `POST /api/federation/requests/import { text }`: `receive` with `transport: 'file'` and `ref: 'file:<id>'`.
  - `federation.poll`: `network: true`, `effect: 'changes'`. It calls `transport.poll(join.where)` and runs `receive` on each, answering one line per request.
  - **Outcome of a proposed request:** derived from its proposal's state (`ratified` → accepted, with the decision the ratify wrote; `rejected`/`expired`/`withdrawn` → refused). It is never stored twice.
  - `federation.reply`: `network: true`. It is available when the outcome is final, `replied` is false, and the record's transport has `reply`. It calls `transport.reply(ref, {kind, sentence})`, then sets `replied: true` (a ledger write through these routes only).

- [ ] **Step 1: Write the failing tests.** Use temp hub repos with `governance.yaml` solo and with a two-member rule, the file transport, and the fake gh for poll and reply.
  - `builds the hub change from fields, never from the file`: a request carrying an extra `change:` block, or YAML for `IDENTITY.md`, is refused by `parseRequest`. A valid one yields a `federation.yaml` diff that adds exactly one peer and touches no other file.
  - `the same request is received once`: by id and by ref.
  - One case per outcome:
    - closed hub → refused record;
    - invite match → commit with the `Org-Decision: invite <id>` trailer and the invite `used_by`;
    - `open-with-approval` → an open proposal with `origin`, authored by the importer;
    - ratifying it → the derived outcome is accepted.
  - The proposals schema accepts `origin` and still refuses other unknown keys.
  - Reply calls gh with the exact `--comment`, then `replied: true`.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass,** plus `tests/proposals/` (or wherever the proposal tests live).
- [ ] **Step 5: Commit.** `feat(network N2): the hub receives requests under its join policy — refuse, accept under a decision, or propose`

### Task 7: Requests as resources, the requests board, and "From outside"

**Files:**
- Create: `packages/admin/server/resources/adapters/federation.ts`, `packages/admin/boards/federation-requests.yaml`
- Modify:
  - the `Kind` in `server/resources/types.ts`;
  - `RECORD_KINDS` in `lib/board-query.mjs`;
  - `KIND_ORDER` in `app/src/kinds.ts`;
  - `BUILTIN_ORDER` in `server/boards/read.ts`;
  - `app/src/pages/Governance.tsx`: the group;
  - `app/src/blocks/proposals.tsx`.
- Test: `packages/admin/tests/resources/federation-requests.test.ts`, `packages/admin/app/src/pages/Governance.test.tsx` (extend)

**Interfaces:**
- **Kind `federation-request`:** one Resource per record.
  - `status` is one of `requested | under-decision | mutual | refused`:
    - `proposed` + open proposal → `under-decision`;
    - accepted → `mutual`;
    - refused → `refused`;
    - received with nothing yet → `requested`.
  - `facts` are `{ from, network, transport, ref, proposal?, replied }`.
  - Attention is `warn` with `Tell them the outcome.` when the outcome is final and `replied` is false.
- **The built-in board `federation-requests`:** one `kanban` block, `source: { kind: federation-request }`, `view: { group: status, columns: [requested, under-decision, mutual, refused] }`.
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
  - Nothing in `projectPublic`'s output contains the invite id or hash.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit.** `feat(network N2): invites — a one-time link, only its hash kept, valid once applied`

### Task 9: The Federation page

**Files:**
- Create: `packages/admin/app/src/pages/Federation.tsx`
- Modify: `packages/admin/app/src/App.tsx` (route `/federation`), the nav where Systems is listed, `packages/admin/app/src/api.ts`, the CSS beside the existing page styles (tokens only)
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
     - `Ask`, which stages; then `Send` offers each available transport, with each unavailable one shown greyed with its sentence.
  3. **On a hub (the instance has a `join` block, or the person picks `Take requests`):**
     - **`Join policy`:** the four choices with `Recommended` on `open-with-approval`. Changing it stages a `federation.yaml` edit (class `identity`).
     - **`Invites`:** a make-invite form, and the one-time link display.
     - **`Requests`:** `Check for requests` (`federation.poll`), `Import a request` (a file input; read client-side as `ImportSheet.tsx` does, then POST the text), and a link to the requests board.

- [ ] **Step 1: Write the failing tests,** with api mocked.
  - Each state's words.
  - A closed hub disables Ask.
  - The invite field appears only for invite.
  - An unanswered ask disables Ask.
  - The transports list greys hosted and p2p with their sentences.
  - The one-time link shows once.
  - Import posts the file's text.
  - The policy picker marks `Recommended` and stages.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement,** following the design guards (no inline look styles; a live region only if allow-listed with a reason).
- [ ] **Step 4: Run the tests and confirm they pass,** plus the guard tests (`app/src/design/legacy.test.ts`, `app/src/design/skins/skins.test.ts`, `app/src/parts/liveRegions.test.ts`) and the build through the lock.
- [ ] **Step 5: Commit.** `feat(network N2): the Federation page — ask to join, follow it, and take requests`

### Task 10: The launcher's Join door

**Files:**
- Modify:
  - `packages/admin/launcher/serve.ts`: the doors, `POST /api/launcher/join/inspect`, and `openFlow` gains an optional landing path.
  - `packages/admin/app/src/launcher/Launcher.tsx`, `api.ts`
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
  - The Federation page pre-fills from these and never sends by itself.

- [ ] **Step 1: Write the failing tests.**
  - The inspect route refuses a foreign Origin.
  - It strips the fragment before fetching (assert the fetched URL).
  - Its answer shape matches.
  - Join is available.
  - The create flow with a hub lands on `/federation?hub=…&network=…#invite=…`.
  - `Federation.test.tsx`: the page pre-fills from the URL and makes no call to `federation.send`.
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
    - Import the file → an outside proposal under `From outside`;
    - ratify it under its rules → `federation.yaml` gains BCN with `decision`;
    - the requests board shows `mutual`.
  - Back in BCN: record the acceptance. Both sides' link state is `mutual`.
  - Repeat the send with `github` against the fake gh, to show poll, status and reply.
  - Record every command and result in the acceptance file. Name only lf-work-os, refi-bcn-os, refi-dao-os, refi-med-os and regen-coordination-os.
- [ ] **Step 3: Headless screenshots** of `/federation` (node and hub) and the launcher's Join card, through the lock, saved under scratch and not committed.
- [ ] **Step 4: Full suites, one at a time, through the lock:**
  - `~/.cache/lf-heavy-run.sh "w5|network-n2|root" npm test`
  - `~/.cache/lf-heavy-run.sh "w5|network-n2|admin" npm --prefix packages/admin test`
  - `~/.cache/lf-heavy-run.sh "w5|network-n2|tsc" npm --prefix packages/admin run typecheck`

  Expected: green, apart from the load-timeout flakes the N0 record names. Tell flakes apart by re-running the file alone.
- [ ] **Step 5: Commit.** `docs(network N2): joining a network, and the BCN → DAO pilot played on copies`
