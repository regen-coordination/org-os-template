# org-os platform — the board: resources, operations, two canvases

**Date:** 2026-10-15
**Status:** Built on feat/platform-board (its plan is with the process records, see docs/superpowers/history/org-os-0.6.md); awaiting review and the operator's merge.
**Package:** `packages/admin/` (grows into the platform; the name may change later, nothing depends on it)
**Branch:** `feat/platform-board`, cut from `51727d6` (the reviewed write path)
**Builds on:** [admin app spec](2026-07-23-admin-app-design.md) (M1, built) ·
[platform stock-take](../history/org-os-0.6.md) (§6 piece 1 done, fourth review PASS) ·
[interfaces spec](2026-08-29-org-os-interfaces-design.md) (the admin API is the framework's only server)
**Replaces:** the board half of the M2 plan (`plans/2026-07-23-admin-app-m2.md` tasks 1, 2, 4, 5, 6).
Saved views and kanban (M2 tasks 3, 7–10) move to sub-project 5.

Words used below: a **resource** is anything a card can show; a **board** is one canvas of
resources; an **operation** is a named action the server may run on a resource; a **job** is one
run of an operation. A **registry** is one `data/*.yaml` file and a **record** is one entry in it.

## 1. Purpose

The operator asked for "the full platform, with the board, akin to railway.app — not limited to
admin": one place where the organization is seen *and* operated. Not limited to admin means two
things, both chosen in session:

- **Records and running parts.** The board shows the organization's records (projects, people,
  funds, partners, ideas) and the parts of the platform that run (modules, crew seats, the fleet of
  instances, sources and channels), each with its state.
- **Several audiences, later.** Members and the public will see narrowed versions once hosting,
  sign-in and roles exist. This spec builds for the operator, locally, but shapes the model so roles
  can narrow it without a rewrite.

That whole ambition is five sub-projects. This spec is the first one; the rest get their own specs.

| # | Sub-project | Status |
|---|---|---|
| 0 | Merge the write path to `main` | operator's merge (reviewed, PASS) |
| **1+2** | **Resource model + graph API + operations + the board** | **this spec** |
| 3 | Activity trail (from `git log`) + proposals as environments (M3) | later spec |
| 4 | Hosting, sign-in, roles; operations become requests (`RequestExecutor`) | later spec |
| 5 | Views per audience: saved views, kanban, member/public read views | later spec |

**Success:** the operator runs a week of crew operations from the board instead of `npm run crew`,
recorded in `memory/` (M1's equivalent gate was never recorded; this one is).

## 2. Decisions (settled in session, 2026-10-15)

| # | Question | Decision |
|---|---|---|
| 1 | What "not limited to admin" means | Records **and** running parts, for several audiences: one platform. |
| 2 | First spec | Resource model + graph API + the board, local, one instance, operator first. |
| 3 | Running parts on the first board | All four: modules, crew/agents, instances (fleet), sources & channels. |
| 4 | Layout | **Two boards, one switch**: *Organization* (records) and *Systems* (running parts) on tabs; where they touch, portal cards and the side panel's links cross over. Chosen over one zoned canvas for three reasons: the tab is the natural role boundary for sub-projects 4–5; each board stays legible at real scale; it repeats the federation map's ruling ("two linked views, not one blended space"). |
| 5 | Card | **Railway style**: kind label, name, status pill, an attention line when something needs the operator, footer "who · when". |
| 6 | Systems actions | **Operate**: the server runs named operations (seat, nudge, release crew; re-analyze the fleet; run module checks and doctors; ingest a source), each changing one behind a server-enforced confirmation. |
| 7 | Architecture | **Grow `packages/admin`** into the platform: a resources layer and an operations layer on the one server. Hosted mode later swaps the executor so operations become requests to agents (sub-project 4). |
| 8 | Dependencies | `@xyflow/react` (MIT) and `@dagrejs/dagre` (MIT) in `packages/admin` only. Operator approved with the §6 design. |

## 3. The resource model and its API

Every resource has the same outer shape, whatever its source:

```jsonc
{
  "id": "project:luizfernando-net",     // "<kind>:<id in its source>", unique within an instance
  "kind": "project",
  "board": "organization",              // organization | systems
  "name": "luizfernando.net",
  "status": "discovery",                // the source's own word; shown in the pill
  "attention": { "level": "warn", "text": "v2 waits for your go" },  // level: warn | alert; null when nothing needs the operator
  "changed": { "at": "2026-10-12T14:03:00-03:00", "by": "steward-a" },  // null when unknown
  "facts": { "lead": "luiz-fernando" }, // kind-specific, for the side panel
  "source": { "path": "data/projects.yaml", "editable": true }
}
```

**Kinds.** Organization board: `project`, `person`, `funding`, `partner`, `idea`,
`knowledge-gaps`. Systems board: `module`, `role`, `seat`, `instance`, `source`, `channel`.
A `role` is a crew role (from `roles/`), shown so a role with no seat can still be seated; a
`seat` is one assignment.

**Edges** use the federation map's shape, `{ from, to, kind }`, with kinds `lead`, `member`,
`works-on`, `funds`, `feeds`, `partners-with`, `depends-on`, `seat-of`, `federation`. An edge whose
ends are on different boards carries `crosses: true`.

**Ids** are kind-prefixed. `instance:example-coop-os` maps to the federation map's `example-coop-os` by
dropping the prefix; that is the whole vocabulary bridge between the two maps.

**Knowledge gaps** become one summary resource, "268 knowledge gaps · 12 on active projects", not a
card each. Its side panel lists them.

**Attention is the server's only judgement.** One small rule file per kind, each a pure function
of the resource:

| Kind | warn | alert |
|---|---|---|
| funding | `deadline` within 14 days | within 3 days, or past while status is not terminal |
| module | — | any manifest check fails |
| seat | waiting at a dialog; or status `reported` (a report awaits the operator) | agent gone while status is `seated` |
| instance | `drift` not empty; `last_sync` older than 30 days | — |
| source | last ingest older than 14 days while `status: active` | — |
| project | — (tasks live in `HEARTBEAT.md`, not a registry; reading them is later work) | — |

No rule fires → `attention: null` and the card shows the plain status.

**Routes** (additions; all read-only):

| Route | Returns | For |
|---|---|---|
| `GET /api/resources?board=&kind=` | resource list | agents, scripts, ⌘K |
| `GET /api/resources/:id` | one resource and all its edges | side panel |
| `GET /api/graph/:board` | `{ nodes, edges, portals }` | the canvas |
| `WS /api/events` (existing) | adds `resources-changed { ids }`, `job-output`, `job-finished` | live updates |

Records are still written through the M1 routes; `source.editable` tells the UI when to offer the
form.

## 4. Adapters

Each adapter turns files into resources, with no web framework in it, under
`packages/admin/server/resources/`:

```ts
interface Adapter {
  kinds: Kind[];
  watch: string[];                                  // repo-relative paths
  read(repo: string): Promise<{ resources: Resource[]; edges: Edge[] } | { absent: string }>;
}
export function readResources(repo: string): Promise<Graph>;   // importable without the server
```

`readResources` is the module the terminal cockpit (`feat/org-os-cockpit`, `packages/org-state`)
can import later instead of keeping a second reader. This spec does not block on the cockpit.

| Adapter | Reads | Kinds | State from | Edges |
|---|---|---|---|---|
| records | `data/*.yaml` via M1's registry service | project, person, funding, partner, idea, knowledge-gaps | `status`; funding `deadline`, `next_action`, `fit`; idea `votes`, `updated` | project `lead`, `members` / `contributors` → person; idea `champions`, `submitted_by` → person; relationship → partner; funding `owner` → person |
| modules | `modules/*/module.yaml` | module | manifest `checks` run in process (`file-exists` is a stat); `version`, `type` | `dependencies` → module |
| crew | `node scripts/crew.mjs board --json` (5 s timeout); `roles/*.md` | role, seat | seat `status` + herdr `state` | seat → role (`seat-of`); seat → project (`works-on`) when its task or brief names one |
| fleet | `data/instances.yaml` if present, else `federation.yaml` peers | instance | `maturity`, `last_sync`, `drift`; a cloned peer's last commit date | instance → this instance (`federation`) |
| sources | `data/sources.yaml`, `data/channels.yaml`, `data/kms-cursors.json` | source, channel | `status`, `doc_count`, last ingest from the cursor file | source → the registry it feeds (`feeds`) |

**Both field spellings are read.** Projects in real instances use `name`, `members`, `startDate`;
`docs/DATA-MODEL.md` uses `contributors`, `started`, `target_completion`. The records adapter reads
both, as M1 already does for `opportunities` / `funding_opportunities`. Which spelling is right is a
data-model ruling outside this spec.

**Who changed what.** `git blame --porcelain` per registry file, entity line ranges mapped to
records, cached by the file's blob hash. Seats take `updated` from crew; modules and instances take
their file's last commit.

**Absence is stated, not thrown.** An adapter whose source is missing returns
`{ absent: "<sentence>" }`, e.g. "Crew isn't installed here (no scripts/crew.mjs)". The board draws
one dashed card with that sentence; every other adapter's cards still draw.

**Freshness.** The existing chokidar watcher grows to the union of adapters' `watch` paths
(`data/`, `modules/`, `roles/`, `memory/crew/`, `federation.yaml`); only adapters whose paths
changed re-read. Crew is additionally polled every 10 s while any seat is live, because herdr's
working/idle state touches no file.

## 5. Operations and jobs

### 5.1 The catalogue

`packages/admin/server/operations/catalogue.ts` is the complete list. No route accepts a command;
only an operation id and parameters validated against that operation's schema.

```ts
interface Operation {
  id: string;                    // "crew.seat"
  kinds: Kind[];                 // which cards offer it
  label: string;
  effect: "reads" | "changes";
  network: boolean;
  params: JSONSchema;
  argv(resource: Resource, params: unknown): { cmd: string; args: string[] };
  writes: string[];              // repo-relative paths it may change; [] = none
  timeoutMs: number;
}
```

| Kind | Operation | Wraps | Effect |
|---|---|---|---|
| module | Re-run checks | in-process manifest checks | reads |
| module | Run doctor | `npm run <short>:doctor` when that script exists (`buzz:doctor`, `paper:doctor`) | reads · network |
| seat | Read latest report | the seat's `memory/crew/<id>.md` | reads |
| seat | Nudge | `crew.mjs nudge <id>` | changes |
| seat | Release | `crew.mjs release <id> --outcome done\|abandoned` | changes |
| role | Seat | `crew.mjs seat <role> --title <t> [--task <id>] [--base <ref>] -- <brief>` | changes |
| seat | Focus pane | herdr's pane-focus command (exact form verified against herdr's help during planning) | reads |
| instance | Assess | instance-doctor `assess` against the peer's `local_path` (exact invocation verified during planning) | reads |
| instance | Re-analyze fleet | `npm run analyze:instances` · writes `data/instances.yaml` | changes |
| source | Ingest | `org-os-kms ingest <source>` · writes the store and `data/kms-cursors.json` | changes · network |

**Out on purpose:** syncing or updating a peer instance (writes another repo; the server's git rule
is one repo, its own) · `crew clean-worktrees --yes` (the operator's, in a terminal) · anything
naming `stash`, `clean`, `reset` or a force flag.

### 5.2 Running one

- Every command is started with `spawn(cmd, args, { shell: false, cwd: repo })`. A parameter
  holding shell metacharacters stays one argument.
- **Confirmation is enforced by the server.** An operation that `changes` or reaches the
  `network` must be planned first: `POST /api/operations/:op/plan` with the resource id and
  params returns `{ cmd, args, writes, timeoutMs, nonce }`. The nonce is bound to that exact argv,
  single-use, valid 2 minutes. `POST /api/jobs { nonce }` runs it. Without a valid nonce: `403`;
  reused or expired: `409` "this confirmation was already used or expired — plan it again".
  `reads` operations without `network` run directly via `POST /api/jobs { op, resource, params }`.
  The M1 origin, host and content-type checks apply to all of these routes.
- **Git honesty for operations that write.** Before: every path in `writes` must be clean, or the
  job is refused with the path named ("commit or set it aside first"); never stashed. After: if
  exactly declared paths changed, they are committed as `platform(<op>): <resource>`; if any other
  path changed, nothing is committed, nothing is reverted, and the job ends
  `finished-with-surprises` naming every path. Crew operations declare no repo writes: crew works
  in its own worktrees.
- **Jobs** are recorded with their log outside the repo, in
  `~/.org-os/admin/<instance-id>/jobs/<job-id>.{json,log}`, so no instance needs a new ignore
  rule. Output streams as `job-output`; the end as `job-finished { status }`. Statuses: `ok`,
  `failed` (exit code + last 20 lines), `timed-out`, `cancelled`, `finished-with-surprises`,
  `interrupted` (the server restarted mid-run; never re-run automatically).
- **Cancel** sends SIGTERM, then SIGKILL after 5 s. One job per resource at a time; two at a time
  overall; a third waits in a visible queue.

### 5.3 The seam for hosted mode

Every run goes through an `Executor` interface. This spec builds `LocalExecutor` (spawn). Sub-
project 4 adds `RequestExecutor`, which turns the same planned operation into a handoff or task an
agent carries out. Catalogue, plans, nonces and UI do not change.

## 6. The screen

- **Shell** (M1's frame, extended): top bar with organization name, branch, mode, the three home
  tabs (Organization · Systems · Overview) each with an attention count, and ⌘K. Sidebar: boards,
  registries (M1's tables and forms, unchanged), running jobs. Opens on the last board used;
  Organization the first time.
- **Canvas:** React Flow with style-B cards. Automatic layout in columns by kind
  (`@dagrejs/dagre`). Cards can be dragged; positions the operator set are stored by the server in
  `~/.org-os/admin/<instance-id>/layout.json` (not in the repo); "Reset layout" clears them. Kind
  chips and a "needs attention" chip filter. Portal cards ("3 seats work on 2 projects") switch
  boards with those cards selected.
- **Side panel** on selecting a card: header and attention line · Facts · Links grouped by edge
  kind, ↗ marking those on the other board · Actions (that kind's operations) · History (its jobs
  and last git change). An editable record adds **Edit**, which opens the M1 form in the panel.
- **Confirm box** for operations that change or reach the network: the exact command, what it may
  write, its timeout, Run / Cancel. While a job runs the card footer shows it ("Re-analyze ·
  running 12 s") and the panel streams the log.
- **⌘K** searches resources by name, operations ("seat platform", "ingest example-commons") and
  registries; an operation chosen there goes through the same confirm box.
- **Live:** `resources-changed` refreshes only the named cards. An edit open in the panel is never
  overwritten: if the record changes underneath, the panel shows theirs beside yours to choose
  (closes the stock-take's D8).
- **Text is text.** Every string from data or peers renders as text; no `dangerouslySetInnerHTML`
  anywhere (the federation map's final review found remote text reaching a page as HTML). Card
  text clips at two lines.

The mockups agreed in session (layout C, card B, the Systems board with a module open) are in
`.superpowers/brainstorm/` of the main org-os checkout, which is gitignored.

## 7. Failure

- An adapter that fails becomes one dashed card saying why; other cards stay.
- A registry file that does not parse: the graph routes still answer; that registry's cards are
  replaced by one card naming the file and the parser's line.
- Operations end in one of the job statuses of §5.2, each with a sentence. No operation leaves a
  half-state unsaid: an uncommitted change after a job is always named in its result.
- The server restarting marks running jobs `interrupted` on startup.

## 8. Testing

Vitest with fixture repos (temp dirs, real git), M1's conventions.

- **Adapters on real data:** run over this repository's own `data/`, `modules/`, `federation.yaml`;
  guard: the Organization graph has more edges than projects (the planned M2 map had 13 edges for
  298 nodes). Fixture tests per adapter for both field spellings and for absence.
- **Attention rules:** a table per kind, including each window's edges (14 days, 3 days, today,
  past).
- **Operations:** each catalogue entry builds its argv; metacharacters stay one argument; a
  `changes` job without a nonce → 403, reused nonce → 409; a dirty declared path is refused;
  undeclared writes → `finished-with-surprises` and no commit; timeout and cancel kill the
  process. These use a fake catalogue entry that runs a tiny script, so no test seats a real agent.
- **Crew adapter:** contract tests against a recorded `crew board --json` output; one live smoke,
  skipped when `crew.mjs` is absent.
- **UI:** component tests for the card (each attention level), the panel (links, actions, confirm
  box) and the stale-edit comparison. One Playwright run of the golden path: open the board → open
  a module → re-run its checks → switch boards by a portal → edit a project in the panel → see the
  commit.

## 9. Done

- **For an agent or script:** `GET /api/graph/systems` returns this instance's modules, roles,
  seats, fleet and sources with state; any operation can be planned and run through the same two
  calls the board uses.
- **For the operator:** opening the app shows both boards with real state; seating, nudging and
  releasing a crew role, re-analyzing the fleet, running a module's checks or doctor and ingesting a
  source all happen without a terminal, and each ends in a commit or a sentence.
- **Pilot gate:** a week of crew operations from the board instead of `npm run crew`, recorded in
  `memory/`.

## 10. Order and prerequisites

1. **Merge the write path** (`crew/2026-10-11-engineer-one-line-in-the-root-package-json-so-tha`,
   tip `51727d6`) to `main` — the operator's. This branch is cut from it, so the build can start
   before the merge; the branch must rebase cleanly on `main` before it merges.
2. **`feat/crew` merged** — until then the crew adapter shows its absence card; everything else
   works.
3. **Build order:** resources + graph API → operations + jobs → the board UI.

## 11. Out of scope

Activity trail and proposals (sub-project 3) · hosting, sign-in, roles, `RequestExecutor` (4) ·
views per audience, saved views, kanban (5) · the project field-name ruling · operations on peer
repositories · Ring B/C editing from the admin spec.

## 12. Corrections found while planning (2026-10-15)

Reading the commands this spec wraps showed seven things it had wrong. Where this section and the
sections above disagree, this section holds. The implementation plan
(with the process records, see `docs/superpowers/history/org-os-0.6.md`) is written against it.

1. **Operations in v1 never commit.** Every wrapped command writes files the operator keeps out of
   commits or commits by hand: crew's trail (`memory/crew/`), the drift report
   (`memory/reports/instances-drift-<date>.md`, untracked in practice), the KMS store. So a job
   commits nothing. It snapshots the working tree before and after, names every path that changed in
   its result, and ends `finished-with-surprises` when a changed path is outside the operation's
   declared `writes`. The "declared paths must be clean" pre-check and the `platform(<op>)` commit
   of §5.2 are dropped until an operation needs them. §9's "each ends in a commit or a sentence"
   reads "each ends in a sentence naming what changed".
2. **Re-analyze fleet** writes `memory/reports/instances-drift-<date>.md`, not `data/instances.yaml`
   (it only reads that file). It is offered on this instance's own card.
3. **Ingest belongs to KMS connectors**, which are declared in `kms.yaml` (`connectors: [{ name,
   config }]`), not in `data/sources.yaml`. A new Systems kind, `connector`, carries it. The command
   is `org-os-kms ingest --connector <name> --dir <repo>` (`packages/org-os-kms/src/cli.mjs`); it
   writes the store under `kms.yaml`'s `target` and `data/kms-cursors.json`. The cursor file holds
   no time, so a connector's staleness comes from the platform's own job history (last `ok` ingest).
   `data/sources.yaml` and `data/channels.yaml` entries stay cards, with no operation and no edge
   (registries are not nodes, so "source → the registry it feeds" has nothing to point at).
4. **herdr:** `pane focus` moves to a *neighbouring* pane. Focus is
   `herdr workspace focus <workspace>` (the seat record carries `workspace`). A read-only **Read
   pane** is added: `herdr pane read <pane> --source recent --lines 80 --format text`.
5. **Module checks come in two forms.** `file-exists: <path>` is checked in process by the adapter.
   `command: <text>` is a command line from the manifest; the adapter never runs it. Each one is
   offered as its own operation, "Run check: <command>", which needs confirmation (it is arbitrary
   code) and is unavailable when the text holds a shell character (the platform runs no shell).
6. **The knowledge-gaps summary counts gaps by `kind`.** Gaps name graph nodes, not projects, so
   "N on active projects" cannot be computed.
7. **Edges and layout.** Two edge kinds are added, `champion` and `submitted` (idea → person). A
   funding opportunity `funds` a project when the project's `funding_source` names it; a partner
   `partners-with` a person when its `contact` is a member id. The layout is columns by kind with
   one ordering pass that pulls each card towards its neighbours, which needs no layout library:
   `@dagrejs/dagre` is not added. The Overview moves to `/overview`; `/` opens the last board used.
   The golden-path browser run uses `playwright-core` with the installed Chrome, a new
   devDependency that waits for the operator's yes.
