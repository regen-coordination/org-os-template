# Network N2 on atproto (federation v1: joining a network, public links as records) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **This plan supersedes `2026-11-10-network-n2-federation.md` in part.** That plan still holds for every task marked
> **unchanged** below, and is the base text for every task marked **changed**: read its task, then apply the delta
> given here. Tasks marked **new** or **replaced** are complete here. Where the two disagree, this plan wins.

**Goal:** As in the 11-10 plan (a node asks to join, the hub decides under its own rules, the link becomes mutual with no YAML edited by hand), **plus**: a public membership link is a record each side publishes in its own atproto repository, and the link is mutual when both have published (operator decision Q8, 2026-11-22, `lf-work-os/docs/plans/knowledge-network.md`). Invites and non-public requests stay on the `file` and `github` transports.

**What changes from the 11-10 plan, in one paragraph.** The request, the invite, the intake rules, both transports, the hub's decision and the requests board stay as planned. Three things are added. **Reading**: each peer's DID is resolved to its own PDS, and its link and profile records are read there, as one more source for the computed link state. **Writing**: after a governed change is on the trunk, a confirmed operation publishes the org's own link records, and its profile's `networks`, through the instance's existing kms atproto session. **Precedence and migration**: rules for when `federation.yaml` and atproto disagree, and a path that brings existing `peers` lists onto atproto without publishing anything by itself. The 11-10 plan's acceptance (Task 11) is replaced: the pilot now plays on copies against a mocked PDS on two hosts.

**Architecture** (additions to the 11-10 plan's):
- **Pure libraries** under `packages/admin/lib/federation/`:
  - `links.mjs`: the link-record contract (relations, reciprocity, the planner of what this org should publish);
  - `state.mjs`: the combiner that computes one link state from every source, with the precedence rules.
- **atproto reading** under `packages/admin/server/federation/atproto/`:
  - `resolve.ts`: DID → DID document → PDS, and handle ↔ DID, under the same guards as `federation.json`;
  - `read.ts`: unauthenticated `com.atproto.repo.listRecords` on that PDS, cached under `stateDir`.
- **atproto writing** in `server/federation/atproto/publish.ts`: it plans from `federation.yaml` on the trunk and applies through kms's own `createClient` (`packages/org-os-kms/src/atproto/client.mjs`), loaded through the one kms bridge (`server/knowledge/kms.ts`).
- **One new operation**, `federation.publish-links` (`network: true`, in-process, confirmed every time), and `federation.check-links` (11-10 Task 2) extended to read atproto.
- **The Federation page** gains a `Published links` section: both sides' sources per link, drift, and the publish step.

**Tech Stack:** as the 11-10 plan. No atproto SDK: reads are plain XRPC GETs through the guarded fetch; writes use kms's existing XRPC client (identical on `feat/network` and the 20 Nov kms integration line, so N2 does not wait for that merge). A fake PDS and PLC directory are an injected `fetch` in tests.

**Spec:** `docs/superpowers/specs/2026-11-06-org-os-open-and-federate-design.md`: everything the 11-10 plan names, **plus §15 R21–R28 (added 2026-11-22), which bind over §6 and §14 where they differ.**

**Depends on:** N0, N1 (built on `feat/network`), P2 proposals (as before). Not on the 20 Nov kms merge. A *live* write additionally needs the network's lexicon authority (knowledge-network phase 2) and an atproto account per org; see decision 3.

## Decisions for Luiz

Answer "as recommended" to take all eight.

**Carried over from the 11-10 plan, restated in light of atproto:**

1. **GitHub requests go as an issue on the hub's repo** (recommended, unchanged). atproto makes a pull request even less useful: the hub-side change is built by the hub from validated fields (R13), and the membership statement is now a record the hub publishes itself, so a PR would carry nothing the hub uses. Invited requests still go as a file (R18). A PR transport stays a possible later plug-in.
2. **Received requests are recorded in the hub's git, org-level facts only** (recommended, unchanged). They are never written to atproto: a request is not a public link (Q8, R27). The alternative, the private store, is more work, and the board can't read it today.
3. **The real ReFi BCN → ReFi DAO link is a separate go after N2 lands** (recommended), gated on three things that N2 doesn't build:
   - ReFi DAO's council has set its join policy (as before);
   - both instances have an atproto account in `kms.yaml` `atproto` (`did`, `handle`, `pds`), with its app password in the server's environment. Neither `refi-bcn-os` nor `refi-dao-os` has an `atproto` block today;
   - knowledge-network phase 2 has fixed the network's lexicon domain. Until then the collections are `example.orgosnetwork.*`, and the writer refuses an `example.*` collection on a live account, as kms does for its placeholder lexicons.

   N2's acceptance plays the pilot on copies against a mocked PDS. Phase 3's done-when ("mutual on atproto, read back from both repositories") is met at that separate go, not at N2's merge.
4. **Build the `open` policy now** (recommended, unchanged). atproto doesn't change it: under a standing decision the hub's acceptance is committed on arrival, but publishing its `hasMember` record is still a confirmed step (R16, R25). Nothing is ever published automatically.

**New, raised by atproto:**

5. **Which account publishes an org's link records, a hub's `hasMember` included:** the instance's one atproto identity, the account `kms.yaml` `atproto` names, which must equal `identity.did` in `federation.yaml` (recommended). For ReFi DAO, point `refi-dao-os`'s `kms.yaml` at **the ReFi DAO organisation account** (the Certified account from the Certified plan, S2b), not at the existing commons account on Bluesky's host: a membership is the organisation's statement, and the commons account speaks for the knowledge commons. The commons account stays where it is and can be listed as a System. The alternative, a separate account just for links (a `federation.atproto` block and a second app password), isn't built; it can come later without changing the records.
6. **Does a hub need a Certified account first?** No (recommended). Any PDS works, because N2 resolves each DID to its own host (R26). Certified is the preferred host for organisations (Q1, Q12) and recommended for the pilot, but N2 neither requires nor checks it. One thing to check at S2b: whether a Certified account can issue an app password (its write path, "entryway", was "under development" on 18 Nov). If it can't, the pilot uses an account on another host and moves later.
7. **When does a node publish its `memberOf`?** After the hub has accepted, when the node records the acceptance (recommended). Publishing at ask time would make every request public before the hub decides, which Q8 keeps off atproto. Two peers outside a network (`peerOf`) publish once their link is decided or mutual by files, or when one side sets `link: peerOf` explicitly (R24).
8. **A public request as a record** (an `atproto` transport: the node publishes its `memberOf` as the request, and the hub finds records naming it): **registered now as a waiting transport, built after the network index** (phase 4) (recommended). Finding records that name you needs an index or a backlink service. The alternative, building it now on a third-party backlink index, puts a dependency the network doesn't run on the join path.

**Technical defaults, one accept** (my calls; each is in the tasks):
- **Precedence** (R23): own side, `federation.yaml` governs and the record is published from it; other side, its records decide once it has a profile record, its files otherwise; a failed read is `unknown`, never `left`.
- **The org's DID** lives in `federation.yaml` `identity.did` (class `identity`) and is published in `federation.json` as `did`. A peer's DID is `peers[].did`.
- **The relation** comes from an explicit `peers[].link` (`memberOf` | `hasMember` | `peerOf` | `none`), else is derived: a peer that is a network's `hub` → `memberOf`; a peer the hub accepted from a request → `hasMember`. Free-form `relationship` values are never mapped.
- **Record keys:** reading never depends on the key (it lists and matches fields). Writing uses `linkKey(subject, relation, network)` (base32 of the first 80 bits of a SHA-256) when the lexicon's key is `any`, and a TID otherwise. Either works with whatever the lexicon draft settles.
- **The authority** is one constant, `NETWORK_AUTHORITY = 'example.orgosnetwork'` in `lib/federation/links.mjs`, until phase 2. It isn't per-instance config.
- **Resolution:** `did:plc` through `https://plc.directory`, `did:web` through `https://<host>/.well-known/did.json`. DID documents are cached 24 h, and records are fetched only inside the confirmed check.
- **No signature verification** of repository commits in N2: the record is trusted as its PDS serves it, as every atproto app reading `listRecords` does. Proof-checked reads (`com.atproto.sync.getRecord`) are a later hardening.

**Operator decisions already taken:** as the 11-10 plan (1a pilot pair, 2a `open-with-approval` recommended, 3a no hats), plus **Q8** (this plan) and **Q3** (only what lies outside every membrane is published on atproto; a `visibility: private` peer is inside one).

**Not in N2:** as the 11-10 plan (portal section N3, hosted Ask to join N4, starters N5, a PR transport, p2p), plus: the `atproto` request transport (decision 8), the network index (phase 4), a separate links account (decision 5), and changing kms's own connector, which keeps its one-PDS limit (`packages/org-os-kms/docs/CONNECTORS.md` §7). N2's resolver can be offered to kms as its own change.

## How the tasks map

| # | Task | Status | From 11-10 |
|---|---|---|---|
| 1 | Request, invite and intake: data and pure rules; `did` and `link` fields | **changed** | Task 1 |
| 2 | Reading another instance's `federation.json`, guarded; `did` published | **changed** | Task 2 |
| 3 | atproto reading: DID → PDS, link and profile records | **new** | — |
| 4 | Link state from every source: the combiner and its precedence | **new** | (Task 1's `requested`/`left`) |
| 5 | Transports: interface, `file`, the waiting ones, `atproto` added | **changed** | Task 3 |
| 6 | The github transport | **unchanged** | Task 4 |
| 7 | Publishing the org's own records through the kms session | **new** | — |
| 8 | The node's side: ask, send, follow, then publish `memberOf` | **changed** | Task 5 |
| 9 | The hub's side: receive, decide, reply, then publish `hasMember` | **changed** | Task 6 |
| 10 | Requests as resources, the requests board, "From outside" | **unchanged** | Task 7 |
| 11 | Invites | **unchanged** | Task 8 |
| 12 | Migration: existing `peers` lists onto atproto | **new** | — |
| 13 | The Federation page | **changed** | Task 9 |
| 14 | The launcher's Join door | **unchanged** | Task 10 |
| 15 | Docs, the pilot on copies against a mocked PDS, full suites | **replaced** | Task 11 |

Fifteen tasks: four unchanged, six changed, one replaced, four new. Order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15. Tasks 3, 4 and 7 depend on nothing in 5–11, so a second worker can take them after Task 2.

## Global Constraints

Every constraint of the 11-10 plan holds. In addition:

- **Nothing is published, deleted, resolved or read on atproto without the operator's confirmation** (R16). Reads happen inside `federation.check-links`, writes inside `federation.publish-links`. Both are `network: true` and go through plan → nonce → job.
- **No test touches the network, a real PDS, or plc.directory.**
  - Every atproto call goes through an injected `fetch`, defaulting to `networkFetch` (`server/net.ts`, 11-10 Task 2), which throws under VITEST.
  - kms's `createClient({ pds, fetchImpl })` is always given that fetch, never `globalThis.fetch`.
  - The fake PDS (`packages/admin/tests/fake-pds.ts`, Task 3) serves **two hosts**, so every test that reads both sides proves per-DID resolution.
- **Tests run in fresh temp repos only** (`makeFixtureRepo`, or `mkdtemp` plus `git init`), never on a real instance. Run-time and mutation tests of code that runs git make their own repos (crew rule, 2026-10-18).
- **What may be published** is exactly R24's set. A test enumerates every key of every record the fake PDS received and allows only `$type`, `subject`, `relation`, `network`, `createdAt` (link), and `$type`, `networks` and keys already on the profile record (profile).
- **A `visibility: private` peer never gets a record, is never named in a plan, a job's output, a receipt or a log, and is counted only** (R3, R24). The same holds for a peer without a public https `url`.
- **Requests stay off atproto** (Q8, R27). No request id, answer, invite id, invite token, decision reference, note or contact reaches a record. A test greps the fake PDS's write log for each.
- **The app password is read from the server's environment (`ATPROTO_APP_PASSWORD`), as `knowledge.publish` already requires.** It is never written, never returned by a route, never put in a job's output, and every error is passed through `String(e.message).split(password).join('***')`, as kms's `publish` does (`packages/org-os-kms/src/ops.mjs`).
- **Writes plan from the trunk.** `federation.yaml` is read as committed on the trunk, never from the working tree or a staged change, as invites are matched (R14).
- **The PDS is the truth for what is published.** The receipt under `stateDir(repo)/federation/published.json` is a cache for drawing the page. Each publish plan reads the org's own records back first.
- **No in-process operation commits** (R20). `federation.publish-links` writes the network and its receipt only. The executor's before and after snapshots must show no changed file.
- **kms is reached through `server/knowledge/kms.ts` only** (R-35 of the kms lane). If the instance has no kms (`kmsPresence` not ok), publishing is unavailable with kms's own sentence, and reading still works.
- **Placeholder lexicons are never written to a live account.** The writer refuses any collection starting with `example.` unless the injected deps carry `allowPlaceholderLexicons: true`, which only tests and the acceptance script set (kms's pattern, `packages/org-os-kms/src/ops.mjs`).
- **Never name the private sibling instance** in any committed file, fixture or message. Fixtures use invented names.

## Review Focus

The 11-10 plan's five points hold. In addition:

6. **A peer marked `visibility: private`, or one whose `url` isn't public https, that also has a `did` and an explicit `link`** must produce no record and no named line anywhere, only a count. If such a peer already has a record from an earlier publish (it was public then), the plan deletes that record. Tests: Task 7, `a private peer is never published, and an old record of it is withdrawn`.
7. **A forged or wrong-host read** (a PDS that answers for another DID, a DID document whose PDS is a private address, a redirect, a 300 KB answer, a handle whose DID document doesn't name it back) must be refused before parsing, and the link state stays `unknown`, never `claimed` or `left`. Tests: Task 3, `refuses private, redirecting, oversized and mismatched answers`, and `a handle is accepted only when its DID names it back`.
8. **A disagreement between `federation.yaml` and atproto** must never be resolved by writing. It is shown as drift with its fix, and the fix is a confirmed publish. Tests: Task 4, `precedence, case by case`, and Task 7, `the plan follows federation.yaml on the trunk, never the records`.
9. **A publish whose identity doesn't line up** (`identity.did` ≠ `kms.yaml` `atproto.did`, or the DID document names another PDS, or no app password, or an `example.*` collection on a live account) must write nothing. A publish that would delete every link record must refuse. Test: Task 7, `nothing is written unless the identity lines up`, and `never deletes every record in one run`.
10. **A failed read must never move a link.** An unreachable PDS or PLC directory leaves the last reading in place with its date, and the state says `unknown` when there is none. Test: Task 4, `a failed read is unknown, never left`.

---

### Task 1: Request, invite and intake: data and pure rules (changed)

**Base:** 11-10 Task 1, in full. **Delta:**

**Files (additional):**
- Modify: `schemas/federation.yaml`:
  - `identity` gains `did` (string, pattern `^did:(plc|web):`);
  - peers gain `did` (same pattern) and `link` (enum `memberOf | hasMember | peerOf | none`).
- Modify: `packages/admin/lib/federation/read.mjs`: `Peer` gains `did: string | null` and `link: string | null`; `readFederation` returns `identity.did` as read. An invalid `did` or `link` is a warning in `problems` and reads as null, never an error (the module's rule: it never throws).
- Test: `packages/admin/tests/lib/federation-read.test.ts` extended.

**Interfaces (changed):**
- `LINK_STATES` stays exactly as 11-10 Task 1 lists it (`mutual`, `claimed`, `requested`, `left`, `not-an-instance`, `unknown`). **`requested` and `left` are no longer computed in `peers.mjs`.** `peers.mjs`'s `linkState` keeps reading the local folder only and returns the *files* reading of the other side. Task 4's combiner computes the final state. This keeps `peers.mjs` pure and vendorable, as it is today.

- [ ] **Step 1 (added tests):** `did` and `link` are read; a malformed DID (`did:key:…`, `plc:abc`, a URL) is a warning and reads null; an unknown `link` value is a warning; a peer without either reads as before.
- [ ] Steps 2–5 as 11-10 Task 1. Commit as there.

### Task 2: Reading another instance's federation.json, guarded (changed)

**Base:** 11-10 Task 2, in full. **Delta:**

**Files (additional):**
- Modify: `packages/admin/lib/standards/federation.mjs`: `federationDoc` publishes `did` from `identity.did` when it matches the DID pattern. Published peers (`isPublishedPeer`) also carry their `did` when set. `link` is never published (it's an intent, not a fact).
- Modify: `packages/admin/lib/standards/project.mjs`: the public projection (`:539`) carries `identity.did` and `peers[].did` through. Everything else stays withheld and counted.
- Modify: `packages/admin/server/federation/remote.ts`: the guards move into one exported function, `guardedJson(url, deps, { maxBytes, accept? }) → Promise<{ json } | { problem }>`. `fetchFederationJson` and Task 3's resolver and reader all call it. The guards are unchanged: every resolved address public, `redirect: 'error'`, a 10 s timeout, the size cap.
- Test: `packages/admin/tests/standards/federation.test.ts` extended, `packages/admin/tests/federation/remote.test.ts` extended.

- [ ] **Step 1 (added tests):**
  - `federation.json` carries `did`, and a published peer's `did`. A private peer's `did` doesn't appear (a leak test that greps the built output for it).
  - `link` never appears.
  - `guardedJson` refuses with the same sentences for every caller.
- [ ] Steps 2–5 as 11-10 Task 2. Commit as there.

### Task 3: atproto reading: DID → PDS, link and profile records (new)

**Files:**
- Create: `packages/admin/server/federation/atproto/resolve.ts`, `packages/admin/server/federation/atproto/read.ts`
- Create: `packages/admin/tests/fake-pds.ts` (beside `tests/git-shim.ts`)
- Modify: `packages/admin/server/operations/catalogue.ts`: `federation.check-links` (11-10 Task 2) also reads atproto for every peer with a `did`, and for `identity.did`.
- Test: `packages/admin/tests/federation/atproto-resolve.test.ts`, `packages/admin/tests/federation/atproto-read.test.ts`

**Interfaces:**
- **From `resolve.ts`:**
  - `didDocUrl(did) → string | null`: `did:plc:<id>` → `https://plc.directory/<did>`; `did:web:<host>` → `https://<host>/.well-known/did.json`; did:web with a path or port, and any other method → null.
  - `resolveDid(did, deps: { fetch, lookup? }) → Promise<{ pds: string, handle: string | null } | { problem }>`:
    - reads the DID document through `guardedJson` (cap 64 KB);
    - requires `id === did`;
    - `pds` is the `service` entry with `id` ending `#atproto_pds` and `type: 'AtprotoPersonalDataServer'`, and it must pass `isPublicUrl`;
    - `handle` is the first `alsoKnownAs` entry of the form `at://<handle>`.
  - `resolveHandle(handle, deps) → Promise<{ did } | { problem }>`: `https://<handle>/.well-known/atproto-did` first, then the DNS TXT record `_atproto.<handle>` (`did=…`, through an injected `resolveTxt`). It is accepted only when `resolveDid(did).handle === handle` (both ways).
- **From `read.ts`:**
  - `readRepo(did, deps) → Promise<{ did, pds, profile: ProfileRecord | null, links: LinkRecord[], fetchedAt } | { problem }>`:
    - resolves the PDS (above);
    - calls `GET <pds>/xrpc/com.atproto.repo.listRecords?repo=<did>&collection=<NETWORK_AUTHORITY>.link&limit=100`, following `cursor` up to 10 pages, each page through `guardedJson` (cap 256 KB);
    - reads the profile with the same call on `<NETWORK_AUTHORITY>.profile`, keeping only the record whose key is `self`;
    - **refuses any record whose `uri` doesn't start with `at://<did>/`** (a PDS answering for another repository);
    - each record's `value` is checked by Task 4's `parseLinkRecord`/`parseProfileRecord`; one that fails is skipped and counted, never fatal.
  - `atprotoCache(repo)`: `get(did)` / `put(did, reading)` under `join(stateDir(repo), 'federation', 'atproto')`, keyed by sha256 of the DID. DID documents are cached 24 h. Records are kept until the next confirmed check, with `fetchedAt`. A failed read never overwrites a good cached reading; it records `lastProblem` beside it.
- **`federation.check-links`, extended:** for each peer with a `did`, plus the instance's own `identity.did`, it calls `readRepo` and puts the result in the cache. A per-DID failure is reported in the job's output (by peer name, unless the peer is private, which is counted only) and the others continue, as kms's connector does per peer. It still writes nothing in the repository.
- **The fake PDS** (`tests/fake-pds.ts`): `makeFakeNetwork({ hosts: { [pdsUrl]: { accounts: { [did]: { handle, password } } } }, didWeb?: {...} }) → { fetch, lookup, resolveTxt, writes: Array<{ host, nsid, body }>, records(did, collection), setDown(host) }`.
  - It serves plc.directory DID documents for every account, pointing each at its own host.
  - It serves `listRecords`, `createSession` (checks the password), `putRecord` (honours `swapRecord`: a stale cid answers 400 `InvalidSwap`), and `deleteRecord`.
  - `lookup` answers public addresses for its hosts. A test can make one host resolve to `10.0.0.1`, redirect, answer slowly, or answer for another DID.

- [ ] **Step 1: Write the failing tests.**
  - `didDocUrl` for plc, web, web-with-path (null), `did:key` (null).
  - `resolveDid` finds the PDS of two accounts on two different hosts (the regression test for kms's one-PDS limit).
  - `refuses private, redirecting, oversized and mismatched answers`: a DID document whose PDS is `https://10.0.0.1`, a redirect, 300 KB, `id` ≠ the DID, and a `listRecords` answer carrying a record of another DID are each refused, and the cache keeps the earlier reading.
  - `a handle is accepted only when its DID names it back`: a handle whose DID document lists another handle is refused.
  - `readRepo` pages through `cursor`, keeps the profile `self` only, and skips an invalid link record, counting it.
  - Under vitest, the operation's real `InProcess` fails with `no network in tests`.
  - The operation's snapshot shows no changed file.
- [ ] **Step 2: Run the tests and confirm they fail.**
  `cd packages/admin && npx vitest run tests/federation/atproto-resolve.test.ts tests/federation/atproto-read.test.ts`
- [ ] **Step 3: Implement.** `resolveTxt` defaults to `node:dns/promises` `resolveTxt`. No atproto SDK.
- [ ] **Step 4: Run the tests and confirm they pass,** plus `tests/federation/remote.test.ts` and `tests/operations/federation-check-links.test.ts`.
- [ ] **Step 5: Commit.** `feat(network N2): read each peer's atproto records from its own PDS: guarded, cached, confirmed`

### Task 4: Link state from every source: the combiner and its precedence (new)

**Files:**
- Create: `packages/admin/lib/federation/links.mjs`, `packages/admin/lib/federation/state.mjs`
- Modify: `packages/admin/server/resources/adapters/fleet.ts`: the state on each peer's card comes from `combineLinkState` (below), fed by `linkState` (files), the remote cache (11-10 Task 2) and the atproto cache (Task 3). The card's facts gain `sources` and `drift`.
- Test: `packages/admin/tests/lib/federation-links.test.ts`, `packages/admin/tests/lib/federation-state.test.ts`, `packages/admin/tests/resources/fleet.test.ts` extended

**Interfaces:**
- **From `links.mjs`** (pure, no `node:` imports):
  - `NETWORK_AUTHORITY = 'example.orgosnetwork'`, `LINK_NSID`, `PROFILE_NSID`;
  - `RELATIONS = ['memberOf', 'hasMember', 'peerOf']`, `reciprocal(relation)`: `memberOf` ↔ `hasMember`, `peerOf` ↔ `peerOf`;
  - `parseLinkRecord(value) → LinkRecord | null`: exactly `$type`, `subject` (a DID), `relation`, optional `network` (string ≤ 200), `createdAt` (ISO datetime). Unknown keys are ignored when read (another client may add them) and never written;
  - `parseProfileRecord(value) → { networks: { hub, name }[], rest: object } | null`;
  - `relationOf(peer, fed) → 'memberOf' | 'hasMember' | 'peerOf' | null`:
    - an explicit `peer.link` wins, and `none` gives null;
    - else a peer that is the `hub` of one of `fed.networks` (same address, by `sameAddress`) → `memberOf`;
    - else a peer with `relationship: 'node'` and a `decision` on an instance with a `join` block → `hasMember`;
    - else null. Free-form `relationship` values are never mapped.
  - `linkKey(subject, relation, network)`: base32 (lowercase, no padding) of the first 10 bytes of a SHA-256 of `subject|relation|network`. The hash is passed in by the server (`lib/sha256.mjs`), so the module stays pure.
- **From `state.mjs`:**
  - `combineLinkState({ peer, relation, selfDid, files, remote, atproto, ownRecords }) → { state, sources, drift, reason }`.
    - `state` is one of `LINK_STATES`;
    - `sources` is `{ files: 'lists-us' | 'silent' | 'unknown', atproto: 'lists-us' | 'silent' | 'not-on-atproto' | 'unknown', checked: <fetchedAt> | null }`;
    - `drift` is a list of `{ side: 'ours' | 'theirs', text }`.
  - **The other side** (R23):
    - when its atproto reading has a profile record, it is **on atproto**: it lists us exactly when it has a link record with `subject === selfDid` and `relation === reciprocal(relation)`. Its files are a cross-check: if they disagree, `drift` gains `{ side: 'theirs', text: 'Their files list you; their record isn't published.' }` or the reverse;
    - when it has no profile record, its files decide (the local folder, else the remote cache), as in N0;
    - when neither can be read, its side is `unknown`.
  - **Our side:** `federation.yaml` decides. `ownRecords` (our atproto reading) only makes drift:
    - `Not published yet.` when R24 says the link should be published and our record is missing;
    - `Published, but federation.yaml no longer lists it.` (or `… lists it as private.`) when a record exists that R24 doesn't allow. That is the urgent case, attention `warn`.
  - **States:** `mutual` when we list them and they list us; `requested` and `left` as 11-10 Task 1 defines them, with "they list us" taken from the rule above; `claimed` otherwise when we list them. `not-an-instance` and `unknown` come from the files reading as in N0, but only when the atproto reading doesn't settle it.
  - **A failed read:** a reading with `lastProblem` and no earlier success is `unknown`. One with an earlier success uses that success and says `checked <date>`. A failure never produces `left` or `claimed` by itself.

- [ ] **Step 1: Write the failing tests.** `precedence, case by case`, one per row:

| Ours (files) | Theirs: atproto | Theirs: files | Expected |
|---|---|---|---|
| lists, `decision` | profile + reciprocal record | lists | `mutual`, no drift |
| lists, `decision` | profile, no record | lists | `left`, drift `theirs` |
| lists, `requested` | profile, no record | silent | `requested` |
| lists | no profile | lists | `mutual` (files decide) |
| lists | no profile | silent | `claimed` |
| lists | profile + record with the wrong relation (`peerOf` against our `memberOf`) | lists | `claimed`, drift `theirs` |
| lists, private | any | any | state computed, no record expected, never `Not published yet.` |
| not listed, our record exists | any | any | drift `ours` `Published, but federation.yaml no longer lists it.` |
| lists, `decision` | read failed, no earlier success | unknown | `unknown` |
| lists, `decision` | read failed, earlier success with record | lists | `mutual`, `checked <date>` |

  Also: `a failed read is unknown, never left`; `relationOf` for each rule, including `none` and a free-form `relationship: 'network-seat'` (null); reciprocity both ways; `parseLinkRecord` refuses a non-DID subject and an unknown relation; `linkKey` is stable and differs per network.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.** Both modules stay pure (the app imports them for the page's words).
- [ ] **Step 4: Run the tests and confirm they pass,** plus `tests/resources/fleet.test.ts` and the N0 peers tests unchanged.
- [ ] **Step 5: Commit.** `feat(network N2): one link state from every source: federation.yaml governs our side, their records theirs`

### Task 5: Transports: interface, file, the waiting ones, atproto added (changed)

**Base:** 11-10 Task 3, in full. **Delta:**
- The registry lists exactly `file, github, hosted, p2p, atproto`.
- **atproto:** `unavailable` gives `Comes with the network index.` (decision 8), and `send` throws. Its label is `Publish a request (public)`.
- The plugin-seam test still adds a sixth transport with no caller change.
- Commit: `feat(network N2): pluggable request transports: file now; hosted, p2p and atproto registered and waiting`

### Task 6: The github transport (unchanged)

As 11-10 Task 4.

### Task 7: Publishing the org's own records through the kms session (new)

**Files:**
- Create: `packages/admin/server/federation/atproto/publish.ts`
- Modify:
  - `packages/admin/lib/federation/links.mjs`: `planLinks` (pure, below);
  - `packages/admin/server/knowledge/kms.ts`: the `Kms` interface gains `createClient` from `atproto/client.mjs`, loaded the same way as kms's other modules;
  - `packages/admin/server/operations/catalogue.ts`: `federation.publish-links`;
  - `packages/admin/server/resources/adapters/fleet.ts`: the self card's facts gain `published` (from the receipt) and `toPublish` (the count of drift lines on our side).
- Test: `packages/admin/tests/federation/atproto-publish.test.ts`, `packages/admin/tests/lib/federation-links.test.ts` extended

**Interfaces:**
- **`planLinks({ fed, selfDid, ownRecords, ownProfile, now, hash }) → { create, delete, keep, profile, withheld: { private, noUrl, noDid, noRelation, undecided } }`** (pure):
  - **Wanted set (R24):** one link per peer that passes `isPublishedPeer` (`lib/standards/federation.mjs`), has a `did`, has a relation (`relationOf`), and, when the relation is derived, has a `decision` or was mutual by files at the last check. An explicit `link:` counts as the decision.
    - `network` is the matching `networks[].name` for `memberOf`. For `hasMember`, it's the network this instance is the hub of: its `networks` entry with `role: hub`, or the only network it lists. It's omitted when that is ambiguous, and for `peerOf`.
    - `createdAt` is the peer's `since` when set, else `now`.
  - **`create`:** wanted links with no matching own record. A record matches on `(subject, relation, network)`, not on its key.
  - **`delete`:** own records that aren't wanted. This includes a record whose peer became private or was removed.
  - **`keep`:** the rest. Re-publishing an unchanged record is never planned.
  - **`profile`:** `networks` = for each of `fed.networks` whose hub peer has a wanted `memberOf`, `{ hub: <hub's did>, name }`; and, on a hub, `{ hub: selfDid, name }` for its own network. Every other key on the existing profile record is kept as it is (phase 2 owns the rest of the profile). The profile is planned only when `networks` changed; `swapRecord` carries its current cid.
  - **`withheld`:** counts only, never names.
- **`publishLinks(repo, deps: { fetch, env, kms, now, allowPlaceholderLexicons? }) → Promise<{ applied: { created, deleted, profile }, failures, withheld }>`** — the in-process body. Its steps, each refusing with exactly the sentence given:
  1. Read `federation.yaml` **on the trunk**.
  2. `identity.did` must be set → `Set this instance's DID first (identity.did).`
  3. `kms.yaml` `atproto.did` must equal it → `kms.yaml's atproto account isn't this instance's DID.`
  4. `ATPROTO_APP_PASSWORD` must be in the env → `Put the app password in the server's environment (ATPROTO_APP_PASSWORD).`
  5. `resolveDid(identity.did).pds` must equal `kms.yaml` `atproto.pds`, comparing origins → `This DID's PDS isn't the one kms.yaml names.`
  6. A live collection may not start with `example.` → `The network's lexicon isn't set yet (example.*), so nothing is written to a live account.`
  7. Read our own records back with `readRepo(identity.did)`.
  8. Run `planLinks`.
  9. When `wanted` is empty and `delete` would remove every own record → `Not withdrawn: this would remove every published link. Withdraw them one at a time.` (kms's mass-delete guard; no bypass.)
  10. Apply through `kms.createClient({ pds, fetchImpl: deps.fetch })`, then `login({ identifier: handle || did, password })`. Each create is `putRecord` with `linkKey` as the rkey (or a TID if the lexicon key isn't `any`). Each delete is `deleteRecord`. The profile is `putRecord` at rkey `self` with `swapRecord`.
  11. Failures are per record and never stop the rest. A swap conflict on the profile is a failure that says `Your profile changed elsewhere. Check again, then publish.`
  12. Write the receipt `stateDir(repo)/federation/published.json` `{ at, did, created: [atUri], deleted: [atUri], profileCid }`. Peer names don't go in it.
  13. Pass every error message through the password scrub.
- **`federation.publish-links`:** `kinds: ['instance']` on the self card, `effect: 'changes'`, `network: true`, `params: NO_PARAMS`, `refreshes: 'fleet'`.
  - `unavailable`:
    - kms's `kmsPresence` sentence when there's no kms;
    - `Nothing to publish.` when the self card's `toPublish` is 0.
  - `plan` (async) runs steps 1–9 with the cached reading and answers with the counts: `Publish <n> links and withdraw <m>. <k> peers are kept private.` Any refusal is `HttpError(409, 'Not published: <sentence>')`, before a nonce is issued.
  - The `InProcess` runs `publishLinks` with the job's `signal`.

- [ ] **Step 1: Write the failing tests.** Each runs in a fresh temp repo with a solo `governance.yaml`, the fake network on two hosts, and `allowPlaceholderLexicons: true`.
  - `the plan follows federation.yaml on the trunk, never the records`:
    - a peer staged but not applied is not published;
    - after apply, it is;
    - an extra record on the PDS that `federation.yaml` doesn't list is planned for delete, and `federation.yaml` is untouched (diff empty).
  - `a private peer is never published, and an old record of it is withdrawn`:
    - a peer with `visibility: private`, a `did` and `link: peerOf` gets no record;
    - its name appears in no plan text, job output or receipt (grep);
    - `withheld.private` is 1;
    - when the same peer had a record from before, the plan deletes it.
  - `nothing is written unless the identity lines up`: steps 2–6 each refuse with their sentence, and the fake PDS's write log stays empty.
  - The app password appears in no output, even when `createSession` fails and echoes it.
  - `never deletes every record in one run`.
  - `publishes only the five fields`: every link record body has exactly `$type, subject, relation, network?, createdAt`; no request id, answer, invite id, token, decision reference or note reaches the write log.
  - The profile keeps a key it didn't write (`displayName: 'X'` survives); a stale cid gives the swap sentence.
  - Running twice plans nothing the second time.
  - Without `allowPlaceholderLexicons`, an `example.*` collection is refused.
  - The executor's snapshot shows no changed file.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass,** plus `tests/operations/` and the kms bridge tests.
- [ ] **Step 5: Commit.** `feat(network N2): publish this org's own link records through its kms atproto session: planned from the trunk, confirmed`

### Task 8: The node's side: ask, send, follow, then publish memberOf (changed)

**Base:** 11-10 Task 5, in full. **Delta:**
- **`POST /api/federation/ask`** also stages `did` on the new peer entry when the hub's `federation.json` carries one (Task 2), so the node can later publish its `memberOf` without a second step. No record is published at ask time (decision 7, R27).
- **`Record it`** (after `accepted`) stages the peer's `decision` and removes `requested`, as before. Its answer then says `Recorded. Once this is on your trunk, publish the link so it shows as mutual on atproto.` The Federation page then offers `federation.publish-links` (Task 7). It isn't chained automatically.
- **Withdraw after mutual** (leaving) is unchanged in git. Its answer adds `Then publish, so your record is withdrawn.`
- **`facts.outgoing`** gains `atproto: { theirs: 'lists-us' | 'silent' | 'not-on-atproto' | 'unknown' }` from the atproto cache.
- **Added tests:**
  - `ask stages the hub's did, and publishes nothing`: the fake PDS's write log is empty after ask, send and status.
  - After Record it and apply, the plan of `federation.publish-links` holds exactly one `memberOf` for the hub, with the network's name.
  - After leaving and apply, the plan deletes it.
- Commit as 11-10 Task 5.

### Task 9: The hub's side: receive, decide, reply, then publish hasMember (changed)

**Base:** 11-10 Task 6, in full. **Delta:**
- **`hubPeerOf(request, decision, did?)`** (Task 1, which gains the optional third argument and stays pure) also carries `did` when the request's `from.url` serves a `federation.json` with one. `receive` reads it from the remote cache only and passes it in; if the cache doesn't have it, the peer is written without `did`, and Task 12's fill-in step adds it later. Receiving never fetches, because it is an actor route, not a network step.
- After an `accept` commit (invite, standing decision, or a held request accepted), and after a proposed request is ratified, the outcome sentence adds `Publish the link so it shows as mutual on atproto.` The hub card's `toPublish` count rises, and Task 7's operation does the rest. **Nothing is published by `receive`, `decide` or the ratify itself** (R20, R25).
- A refused request publishes nothing, ever.
- **Added tests:**
  - `acceptance publishes nothing by itself`: the write log is empty after receive, decide and ratify.
  - After apply, the plan of `federation.publish-links` holds one `hasMember` for the node.
  - After the hub removes the peer under its rules, the plan deletes it.
  - A refused request's node never appears in a plan.
- Commit as 11-10 Task 6.

### Task 10: Requests as resources, the requests board, "From outside" (unchanged)

As 11-10 Task 7. The board's `mutual` column still means accepted by the hub. Whether the link is published shows on the fleet card and the Federation page, not on the board.

### Task 11: Invites (unchanged)

As 11-10 Task 8. Invites never touch atproto, and the leak test there also covers the fake PDS's write log in Task 15's acceptance.

### Task 12: Migration: existing peers lists onto atproto (new)

**Files:**
- Create: `packages/admin/lib/federation/migrate.mjs`
- Modify: `packages/admin/server/federation/routes.ts`
- Test: `packages/admin/tests/lib/federation-migrate.test.ts`, `packages/admin/tests/federation/migrate.test.ts`

**Interfaces:**
- **`migrationRows(fed, caches) → Row[]`** (pure): one row per peer that passes `isPublishedPeer`. Private peers and peers without a public url are left out of the list entirely, and only counted (`{ rows, kept: { private, noUrl } }`). Each row is `{ index, name, did, didSource: 'federation.yaml' | 'their federation.json' | null, relation, relationSource: 'link' | 'derived' | null, publishable: boolean, why }`, where:
  - `did` comes from the peer entry, else the remote cache's `federation.json` `did` for that peer;
  - `relation` comes from `relationOf`;
  - `publishable` is R24's test;
  - `why` is one plain sentence when it isn't publishable:
    - `No DID yet.`;
    - `Choose how it's linked.`;
    - `They don't list you yet. Set the link explicitly to publish anyway.`
- **`GET /api/federation/migration`** returns the rows from the trunk's `federation.yaml` and the caches. It doesn't fetch; the UI runs `federation.check-links` first.
- **`POST /api/federation/migration { set: [{ index, did?, link? }] }`** stages, in the actor's change, one `FileOp` editing `federation.yaml` that sets `did` and/or `link` on the named peers, keeping comments (the `editedText` pattern of 11-10 Task 5). It's class `identity`, so it's decided under the org's rules. Its checks:
  - a `did` given as a handle is resolved only from the cache of a confirmed check, and is refused with `Look it up first.` otherwise;
  - a `did` must have resolved both ways (Task 3);
  - `index` must point at a row in the list, so a private peer can't be set through this route (400 `Not a public peer.`).
- **The old shapes** (`network`/`hub` as a pair; peers nested under `federation:`) are read as N0 reads them. Migration never rewrites them; it only adds the two fields where the peer already sits.
- **Nothing is published by migration.** Publishing is Task 7's confirmed operation, after the staged change is applied.

- [ ] **Step 1: Write the failing tests.**
  - A fixture `federation.yaml` with five invented peers: a hub with a DID in its `federation.json`, a `relationship: 'network-seat'` peer, a private peer with a DID, a URL-less peer, and a mutual sibling. The rows are exactly three, the private and URL-less peers are counted, and the private peer's name appears in no row.
  - The free-form relationship gives `Choose how it's linked.`.
  - Setting `link: peerOf` makes the claimed sibling publishable.
  - The staged change keeps comments and touches only the named entries.
  - A POST naming the private peer's index is refused.
  - A handle not resolved both ways is refused.
  - Nested-shape and pair-shape files keep their shape after staging.
  - After apply, `federation.publish-links` plans exactly the publishable rows.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit.** `feat(network N2): bring existing peers onto atproto: DIDs and links staged under the org's rules, nothing published by itself`

### Task 13: The Federation page (changed)

**Base:** 11-10 Task 9, in full. **Delta:**
- **`Networks`** words gain the atproto source in a second line per link:
  - `On atproto: they've published it` / `not yet` / `they're not on atproto` / `couldn't check (<date>)`.
  - When `left` comes from a deleted record, the line says `They withdrew their record.`
- **A new section, `Published links`** (after `Networks`):
  - this instance's DID and its PDS (or `Set this instance's DID first.`);
  - the counts from the publish plan;
  - each drift line, ours first;
  - one `Publish` button (the confirmed `federation.publish-links`), disabled with its sentence when unavailable;
  - a line `<k> peers are kept private and never published.` when any are.
- **A new section, `Bring your peers onto atproto`** (shown when any migration row isn't publishable): the rows of Task 12, each with a DID field (DID or handle, then `Look it up` through the confirmed check) and a relation picker (`Member of` / `Has member` / `Peer of` / `Don't publish`), then `Stage`.
- **The transports list** greys `atproto` with `Comes with the network index.`
- **Added tests:**
  - each atproto line's words;
  - the drift lines and the private count, which never names the peer;
  - `Publish` disabled with each refusal sentence from Task 7's plan;
  - the migration rows stage only `did`/`link`;
  - `pre-fills from the link and sends nothing` still holds, and also asserts no call to `federation.publish-links`.
- Commit as 11-10 Task 9.

### Task 14: The launcher's Join door (unchanged)

As 11-10 Task 10. The hub sentence is drawn from `federation.json`, which now also carries `did` (Task 2). The door shows nothing about atproto.

### Task 15: Docs, the pilot on copies against a mocked PDS, full suites (replaced)

**Files:**
- Modify: `docs/FEDERATION.md` (the request flow, transports, policies, invites, **and the link records**), `docs/OPENING.md` (the Join door)
- Create: `docs/superpowers/plans/2026-11-22-network-n2-atproto-acceptance.md`, `packages/admin/scripts/n2-acceptance-pds.mjs` (a small local HTTP server wrapping `tests/fake-pds.ts`'s handlers, for the acceptance only, never imported by server code)

- [ ] **Step 1: Docs.** In `docs/FEDERATION.md`, the section `Joining a network` (at most 160 lines) covers the 11-10 contents, plus:
  - the two records and their fields;
  - that a link is mutual on atproto when both have published;
  - what is never published (private peers, requests, invites);
  - which account writes them (`kms.yaml` `atproto`, equal to `identity.did`);
  - the precedence rule in four sentences;
  - the placeholder authority until phase 2.

  Update `docs/OPENING.md`'s Join paragraph.
- [ ] **Step 2: The pilot (decision 1a) on copies only, against the mocked PDS.**
  - Make `git clone --local` copies of the real `refi-bcn-os` and `refi-dao-os` into a scratch folder. Record each real repo's `git status --porcelain | shasum` and `rev-parse HEAD` before and after; they must be identical. **No real instance is written, and no real PDS or plc.directory is called.**
  - Start the acceptance PDS with two hosts: an invented DID for BCN on host A, and one for DAO on host B. The two hosts show per-DID resolution end to end.
  - In each copy, set `identity.did` and a `kms.yaml` `atproto` block for its invented account through staged changes applied under the copy's rules. Export `ATPROTO_APP_PASSWORD` for the server of each copy only, and run with `allowPlaceholderLexicons`.
  - Play 11-10 Task 11's flow (DAO sets `open-with-approval`; BCN looks it up, asks, applies, sends by `file`; DAO imports, then either holds and accepts or proposes and ratifies; record which path the copy took; BCN records the acceptance).
  - Then:
    - DAO publishes. The acceptance PDS holds one `hasMember` for BCN's DID and DAO's profile.
    - BCN, after a confirmed check, shows `claimed`, with `They've published it` and drift `Not published yet` on its own side.
    - BCN publishes its `memberOf`. A confirmed check on both copies shows `mutual`, read back from both repositories on their two hosts (phase 3's done-when, played on copies).
    - BCN leaves under its rules and publishes. DAO, after a check, shows `left`, with `They withdrew their record.`
  - **Privacy, on the copies:** give BCN's copy an invented private peer with a DID and `link: peerOf`. Publishing creates no record for it, and grepping the acceptance PDS's write log, the job outputs and the receipts finds its name nowhere.
  - **Requests off atproto:** make an invite on the DAO copy and send an invited request by `file`. Grep both copies' trees, `git log -p`, and the acceptance PDS's write log for the token, the invite id, the request id and every answer. None may appear in the write log, and the token appears nowhere.
  - **Failure:** take host B down and check from BCN. The link stays at its last reading with `couldn't check (<date>)`, never `left`.
  - Repeat the send with `github` against the fake gh, as 11-10 Task 11 does.
  - Record every command and result in the acceptance file. Name only lf-work-os, refi-bcn-os, refi-dao-os, refi-med-os and regen-coordination-os.
- [ ] **Step 3: Headless screenshots** of `/federation` (node and hub, with `Published links` and the migration rows) and the launcher's Join card, through the lock, saved under scratch and not committed.
- [ ] **Step 4: Full suites, one at a time, through the lock:**
  - `~/.cache/lf-heavy-run.sh "w5|network-n2|root" npm test`
  - `~/.cache/lf-heavy-run.sh "w5|network-n2|admin" npm --prefix packages/admin test`
  - `~/.cache/lf-heavy-run.sh "w5|network-n2|tsc" npm --prefix packages/admin run typecheck`

  Expected: green, apart from the load-timeout flakes the N0 record names. Tell flakes apart by re-running the file alone.
- [ ] **Step 5: Commit.** `docs(network N2): joining a network with links on atproto, and the BCN → DAO pilot played on copies`
