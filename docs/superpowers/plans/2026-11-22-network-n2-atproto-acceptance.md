# Network N2 on atproto — acceptance record (2026-11-23)

Branch `feat/network`. The pilot of decision 1a, played on scratch instances against a mocked PDS (decision 3: the
real pilot is a separate operator go). It stands in for the refi-bcn-os → refi-dao-os join. No real instance was
copied, opened, served or written; nothing reached a real PDS, plc.directory or GitHub.

## How it ran

The pilot is a test: `packages/admin/tests/federation/n2-acceptance.test.ts`. Run it with

    cd packages/admin && npx vitest run tests/federation/n2-acceptance.test.ts

Set `N2_ACCEPTANCE_OUT=<file>` to get its transcript (every call and answer, the invite token redacted), and
`N2_ACCEPTANCE_KEEP=1` to keep the scratch instances and their state folders.

- **Four scratch instances**, made with `makeFixtureRepo` (temp folders, `git init`): Cedar Node (the node, for
  refi-bcn-os), Delta Hub (the hub, for refi-dao-os), Fern Node (invited) and Gale Node (refused). The names are
  invented. Their `federation.yaml` follows the real instances' shape, read once, read-only, for realism. Each has
  written rules: a maintainer who decides `identity` and every other class directly.
- **Two PDS hosts** in the fake network (`tests/fake-pds.ts`): Cedar's DID on `pds-a.example.com`, Delta's on
  `pds-b.example.net`, and the private peer's DID on host B. A PLC directory, the handle answers, and each
  instance's own site serving its `federation.json`, built from its repository by the standards builder.
- **Each instance runs the real server** (`startServer`), with the fake network handed in-process through the new
  `network` option (ruling R12): `{ fetch, lookup, resolveTxt, allowPlaceholderLexicons: true, env }`. Each server
  gets its own `ATPROTO_APP_PASSWORD` in that `env`; Fern and Gale get none. The command line passes no `network`,
  so a live server can't lift the placeholder guard. `networkFetch` throws under the test runner.
- **GitHub is a fake `gh`** first on `PATH`, keeping issues in a scratch JSON file and logging every call.
- Every step goes through the routes and confirmed operations the Federation page uses: plan → nonce → job.

## The play, step by step

Ids and dates below are from the recorded run of 2026-11-23 08:20 UTC.

1. **Open.** Delta: `POST /api/federation/join {policy: open-with-approval, types: [LocalNode], asks: [why],
   where: https://github.com/delta-hub/join-requests}` → committed under `identity/direct`. Cedar:
   `federation.check-links {address: Delta}` → `Read Delta Hub.`; `GET /api/federation/hub` shows the policy.
   Cedar: `check-links {handle: delta-hub.example.org}`, so Delta's DID is tied to Delta's url both ways before the
   ask (final review F-I1). Delta: `check-links {address: Cedar}` and `{handle: cedar-node.example.org}` →
   `cedar-node.example.org is did:plc:vlx2pd5uwj5nz4te7d2mfxvh.` (the DID is tied to Cedar's url both ways).
2. **Ask and send by github.** Cedar: `POST /api/federation/ask` → request `ce1c5385-…`, committed. The peer entry
   for Delta carries `requested` and Delta's DID (written only because the lookup tied it). The Send menu lists file and GitHub as ready; hosted, p2p and
   atproto wait. `federation.send {transport: github}` → `Sent as an issue: …/join-requests/issues/1`.
3. **Receive.** Delta: `federation.poll` → `1 request waiting.`; `POST /api/federation/requests/receive` →
   `held` ("Held for you to decide: Cedar Node asks to join Delta."). **Path taken: held, then accepted by the
   maintainer**, because the maintainer's rule for `identity` is direct.
4. **Accept and tell.** Delta: `decide {accept: true}` → one commit with `Org-Rule: identity/direct`; the peer entry
   is `{name, url, type, trust: read, relationship: node, since, decision: request ce1c5385-…}`, with no `did`
   (final review F-I2: an acceptance never writes one). Delta then sets Cedar's DID through the migration list
   (`GET` then `POST /api/federation/migration`): one commit under `identity/direct`, no `federation/join`, and no
   write to the PDS. `federation.reply` → `Told Cedar Node: Accepted.` (the fake issue is closed with an `Accepted:` comment).
5. **Record.** Cedar: `federation.status` → `Accepted: Welcome to Delta.` (the word once); `POST …/record` → committed; `requested` is gone and
   `decision` is set.
6. **The hub publishes.** Delta: `check-links`, then `publish-links`. Plan: "Publish 1 link and withdraw 0, and
   update the profile." The PDS then holds exactly one `hasMember` for Cedar's DID (network Delta) and Delta's
   profile `{name, networks: [{hub: <Delta's DID>, name: Delta}], createdAt}`.
7. **The node reads it.** Cedar: `check-links` → "Delta Hub on atproto: read (1 link, a profile)." Delta's card:
   `mutual`, atproto line "On atproto: they've published it", drift on our side `Not published yet.` (see
   finding 1: the plan expected `claimed` here).
8. **The node publishes.** Cedar: "Publish 1 link and withdraw 0, and update the profile. 1 peer is kept private."
   The PDS holds one `memberOf` for Delta's DID.
9. **Mutual, read back from both repositories.** `check-links` on both. The listRecords reads were
   `pds-a.example.com` for Cedar's DID and `pds-b.example.net` for Delta's (and the private peer's, counted only):
   each DID from its own host. Both cards: `mutual`, sources `{files: lists-us, atproto: lists-us}`, no drift.
10. **Host B down.** Cedar's check says "Delta Hub on atproto: Not read: pds-b.example.net could not be reached."
    The card stays `mutual`, with the earlier reading and its date (`checked 08:20:26`). Never `left`. (Finding 2.)
11. **Refusal.** Gale looks Delta up, asks, sends by file (the job log is the request text). Delta imports it →
    `held` → `decide {accept: false, reason}` → "Refused: Not this season: the network is full, …". No peer entry.
12. **Invite.** Delta sets `policy: invite` and makes an invite for Fern (14 days) → id `i-0b40f80f`, link
    `https://delta-hub.example.org/.well-known/federation.json#invite=<token>`, committed (`token_sha256` only).
    Fern asks with the token. Its request file in git has no token. Sending by github is refused at plan: "Not sent:
    An invited request goes as a file, so the invite stays private." By file: the log says the file is saved in the
    state folder, without printing it; the saved copy is a `no-store` download. Delta imports it → `accepted`,
    `decision: invite i-0b40f80f`, the invite marked `used_by`. The same token again → "Refused: This network joins
    by invite. This invite has been used."
    Fern sent a file, so it has no Record step and its peer entry keeps no `decision`. Fern: `check-links` → drift
    `Not published yet.` (its `memberOf` is wanted, mutual by files); `publish-links` → one `memberOf` for Delta.
    Fern tied Delta's DID before asking, as Cedar did. Delta ties Fern's DID before importing; the acceptance (under
    `Org-Rule: federation/join`) writes no `did`, and Delta adds it through the migration list. Delta then publishes
    "Publish 1 link and withdraw 0." After a check on both, both cards read `mutual`.
13. **Leave.** Cedar: `POST …/withdraw` → `leaving: true`, "Leaving Delta. The hub will see the link as left. Then
    publish, so your record is withdrawn.", committed. `check-links`, `publish-links`: "Publish 0 links and withdraw
    1, and update the profile. 1 peer is kept private." Cedar's PDS has no link record left. Delta: `check-links` →
    Cedar's card `left`, sources `{files: silent, atproto: silent}`, atproto line "They withdrew their record."

## Checks

| Check | Result |
|---|---|
| Keys of every record written | link: `$type`, `subject`, `relation`, `network`, `createdAt`; profile: `$type`, `name`, `networks`, `createdAt`. Nothing else, no other collection. |
| PDS write log (sessions, puts, deletes) grepped for 21 needles: the 4 request ids, the 3 answers, the invite id, the token, its SHA-256, the hub's 3 decision texts, the node's recorded decision, the private peer's name, DID, url and host, the three app passwords | none found |
| Every POST to a PDS host | one of `com.atproto.server.createSession`, `com.atproto.repo.putRecord`, `com.atproto.repo.deleteRecord`; nothing else |
| The app passwords, against the request bodies as sent (before the fake's `***` redaction) | each only in `createSession` to its own account's PDS; in no other request. Every other needle is in no request body either |
| The private peer | no record; not named in any job log or receipt (job logs say "1 private peer …"); its DID read on atproto, counted only |
| The invite token | in no tree and no `git log -p --all` of the four instances; in no job log, receipt, gh issue or gh call log; in the PDS write log nowhere. Only in Fern's state folder: `federation/outgoing/<id>.json` and `<id>.request.yaml`, where the asking node keeps it outside git (R18) |
| `validate-governance.mjs <copy> --strict` | exit 0 on all four ("the rules are well-formed and the history agrees with them") |
| `validate-identity.mjs <copy>` | exit 0 on all four (2 warnings each: no `.well-known/`, no genesis commit) |
| Real instances, before and after | refi-bcn-os HEAD `8d55df30c38d2b34e69c73d6095903cb90f1df90`, status checksum `e7a517228255f2b4ff832d419aee18ff7df6b744`; refi-dao-os HEAD `589ee55d2be044076ba60846f0f36d425753dcc0`, status checksum `5c8b5716a165f241c4c9bb0dad8e2795326da698`. Identical before and after. |

## Fixed on the way

- **R12 seam.** `catalogueWith(network)` (catalogue.ts) swaps the network of `federation.check-links` and
  `federation.publish-links` only; `startServer({ network })` mounts it. Tested in `atproto-publish.test.ts`.
- **A stale self card after an ask.** The ask, record and withdraw routes commit after `federation.yaml` is written,
  so the refresh its watcher sets off could read the trunk too early, and the card missed the new request (Send
  stayed unavailable). The federation routes now ask for the cards to be read again after each write.

## Findings, with the controller's rulings

1. **`mutual` after only the hub has published.** The plan's done-when said `claimed`. Ruled: accepted as built
   (R23 binds). `mutual` means both sides' statements agree; the drift line `Not published yet.` says the node's own
   record still needs publishing. The docs say so.
2. **A failed check is not shown on the card when an earlier reading exists.** The link keeps the last reading and
   its date and never moves to `left`; the failure is in the job log only. Ruled: deferred to the final review (the
   card should also say the last check failed).
3. **A request sent as a file has no Record step.** Ruled: file-sent joins, invited ones included, complete through
   "mutual by files" (R4). Shown by Fern above; the docs say so.
4. **"Accepted: Accepted: …".** Fixed: the answer line says the verdict word once (`lib/federation/answer.mjs`, used
   by the status job, the Federation page's answer line and the refused words). After recording, the card still says
   "Record it, then publish."
5. **The real refi-bcn-os nests `networks` under `federation:`.** Asking would refuse with "Move "networks" to the
   top level of federation.yaml first". The docs' live-pilot list now says to move such keys to the top level.

## Screenshots

Taken headless (playwright-core with the installed Chrome) after steps 1–8, through the lock, with every network
seam throwing: `/federation` on the node (Delta "Part of it", "they've published it", Published links with DID, PDS,
"Everything is published.", "1 peer is kept private and never published.") and on the hub (Published links, Join
policy, Invites, the Requests list), and the launcher's Join card. Saved under scratch, not committed. The
migration section had no rows: every public peer already had a DID and a link.

## Full suites (one at a time, through the lock)

- Admin `npm test`: 525 files, 8027 passed, 2 skipped, 0 failed at the final whole-branch review (head 00038308).
  After the final review's fixes: 525 files, 8042 passed, 2 skipped, 0 failed (the pilot's 12 steps among them).
- `tsc --noEmit` in packages/admin: clean. The app build (`npm run build`): built.
- Root `npm test`, at the review and again after its fixes: 1012 tests, 1011 passed, 1 failed. The failure is the known one from before this task:
  `the clone's path set matches tests/clone-manifest.txt exactly` reports `docs/OPENING.md` as shipped but not in
  the manifest. This task edits OPENING.md but adds no shipped file, so the manifest is unchanged by it.
