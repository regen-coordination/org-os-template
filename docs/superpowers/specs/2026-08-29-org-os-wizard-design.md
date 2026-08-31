# org-os Wizard — Guided Setup and Operation Design Spec

**Date:** 2026-08-29
**Status:** Approved design, pre-implementation
**Owner:** onboarding + day-to-day operation path
**Binding contract:** [interfaces spec](2026-08-29-org-os-interfaces-design.md) §4 — the four canonical surfaces
**Supersedes:** [`docs/agent-plans/non-tech-onboarding.md`](../../agent-plans/non-tech-onboarding.md) · [`docs/agent-plans/instance-bootstrap.md`](../../agent-plans/instance-bootstrap.md)
**Carries findings from:** [ReFiDAO/refi-dao-os#3](https://github.com/ReFiDAO/refi-dao-os/pull/3) · [refi-dao hermes spec](https://github.com/ReFiDAO/refi-dao-os/blob/feat/hermes-integration/docs/specs/2026-08-29-refi-dao-hermes-integration-design.md)

## 1. Purpose

org-os has had two frozen onboarding plans since April. `instance-bootstrap`
(2026-04-25) owned the engine; `non-tech-onboarding` (2026-04-06) owned a web
wizard wrapped around it. Neither shipped, and the reason they did not is now
visible: both assumed onboarding is a **form** — a bounded sequence of questions
with a completion state — and both assumed the operator's first contact with
org-os is a *tool they operate*.

Two things happened since that changed the answer. `clone:framework` shipped in
v0.5.0, which means the engine half of `instance-bootstrap` is done and its
central open question is answered. And the refi-dao-os Hermes build
(2026-08-29) demonstrated the shape that actually works for a non-technical
operator: **the agent performs its own setup**, and the human's entire job is to
reach a working chat window.

This spec defines `org-os-wizard`: one guided path that takes an operator from
"I want an org-os instance" to a running instance, and then keeps going — the
same path, the same agent, the same conversation — through day-to-day operation.
It folds in and supersedes both frozen plans.

This spec owns the *onboarding and operation path*. It introduces no new plane
and no new server, so it does not amend the interfaces spec; §4 remains binding.
`docs/MODULES.md` remains the catalog canon.

## 2. Decisions (settled during brainstorming)

| # | Question | Decision |
|---|----------|----------|
| 1 | Fifth surface, or a path across the four? | **A path.** Not a surface. Its front door is the **Conversational** surface; it choreographs the other three. Rationale in §3. |
| 2 | Where does setup end and operation begin? | **Nowhere — it is one continuum.** `doctor assess`'s scorecard is the wizard's state machine; there is no separate progress model and no completion event. |
| 3 | What *is* the wizard, concretely? | **A named role** (`concierge`) defined as data + a skill, not a script and not a form. Carried from finding #1. |
| 4 | How does an operator get it? | **`install` / `update` with a preserved local region** — upstream refreshes org truth, the installer's own config and credentials are never touched. Reuses `overlay.mjs`'s ownership partition. Carried from finding #2. |
| 5 | Is there a web wizard? | **No.** The one page an operator receives only has to get them to a working chat window. This retires `non-tech-onboarding`'s central open question. Carried from finding #3. |
| 6 | Release targeting | Phase 0 is docs-only and 0.5.1-safe (serves the ~2026-09-10 session). Phases 1–2 target **0.6.0**; Phase 2 is gated on the 0.5.1 overlay landing. |

## 3. Why this is not a fifth surface

The interfaces spec §4 defines a surface by **audience × plane × home**, and the
governing rule is:

> A new interface is a new **client** of one of the two planes.
> A new server, or a new write path, requires amending this spec.

`org-os-wizard` fails every test for being a surface:

- **It introduces no plane and no server.** Setup writes through the data plane
  git-natively as a trusted local process (`clone:framework`, `generate:schemas`,
  ordinary commits); anything live it needs is a *client call* to the admin API.
  It is a client, which by the rule above makes it not an amendment.
- **It has no home of its own.** Its home is a chat window — which is the
  Conversational surface's home, already listed in §4.
- **A surface you exit is not a surface.** The wizard is defined by ending: it
  hands the operator to the Admin app for visual work and to the CLI when they
  outgrow chat. Surfaces persist; paths terminate.

What it *is*: a **choreography across all four surfaces**, entered through the
Conversational one.

```
  Day 0 ─────────────────────────────────────────────────────► Day N
  ┌──────────────┐
  │ ONE PAGE     │  gets the human to a working chat window. Nothing else.
  └──────┬───────┘
         ▼
  ╔══════════════╗   drives    ┌─────────────────────────────────────┐
  ║ CONVERSATIONAL║ ──────────► │ CLI  clone:framework ·              │
  ║  (front door) ║             │      generate:schemas · doctor      │
  ║  concierge    ║ ◄────────── │      (data plane, git-native)       │
  ╚══════╤═══════╝   scorecard  └─────────────────────────────────────┘
         │ hands off as the operator's needs grow
         ├──────────────► ADMIN   stewards, visual read-write (live plane client)
         ├──────────────► KMS     public read of what now exists
         └──────────────► CLI     direct, once chat is the slower path
```

The same agent runs the whole line. On day 0 it is doing setup; on day 40 it is
answering "what's overdue?" — and the transition between those is not an event,
it is the scorecard filling in.

## 4. `doctor assess` is the state machine

The wizard needs to know what to offer next. It does not invent a progress
model, because the instance already publishes one.

`packages/instance-doctor` emits a scorecard of checks whose findings each carry
a level (`BLOCKER` / `WARN`; `OK` means no finding), a stable machine `code`, and
a remediation `hint` — verified across all six instances during WS-H narrowed
acceptance (2026-08-29). That output *is* the wizard's to-do list:

| Scorecard state (real check codes) | What the concierge offers |
|---|---|
| no instance at the path | Door A or Door B (§6), then `clone:framework` |
| `not-a-git-repo`, `git-remote-absent` | "Do you want this backed up on GitHub?" → `remote add` walkthrough |
| `dao-json-missing`, `template-leakage`, `identity-name-disagreement` | `generate:schemas`, `validate:*`, explain what failed in plain language |
| `identity-md-missing`, `scaffold-placeholder` | `bootstrap-interviewer` — BOOTSTRAP.md Phase 1, where the substance goes |
| `registries-unpopulated` ⚠️ *new check* | `bootstrap-interviewer`, then the registries the org actually needs |
| `no-sources-ingested` ⚠️ *new check* | Source ingestion — BOOTSTRAP.md Phase 2, one source end-to-end |
| no blockers | Day-to-day: heartbeat, session open/close, drift, funding deadlines |

⚠️ **Two rungs have no signal today.** The doctor's snapshot never reads
`data/*.yaml` registry contents, so nothing currently reports that an instance
is structurally valid but organizationally empty — which is precisely the state
a freshly-cloned instance is in, and therefore the rung the wizard needs most.
`registries-unpopulated` and `no-sources-ingested` are new `WARN`-level checks
that Phase 1 adds to `instance-doctor`. This keeps the "no new state" property
intact: the wizard still reads exactly one state source, and that source gets
the two signals it was missing.

Two consequences worth stating explicitly. **The wizard has no state of its
own** — nothing to persist, nothing to corrupt, nothing to resume; re-running
`assess` reconstructs exactly where the operator is. And **the wizard degrades
correctly**: an operator who did half the setup by hand a month ago gets offered
the right next step, because the scorecard describes the instance rather than
the session.

## 5. The three findings, carried over

The refi-dao hermes spec closes with an explicit caveat: *"this is refi-dao-os
infrastructure, not a promoted org-os pattern. If refi-bcn-os wants the
join-pack/roster pattern, promotion to the framework is its own task."* This
spec is that promotion task, and it is deliberate about what does **not** come:
the join pack, Telegram channel routing, Railway, Proton Pass vault structure
and the DAO Bot roster stay instance infrastructure. Three patterns are
framework-general.

### Finding 1 — profiles are named per-role agents (→ the wizard is a role)

Hermes Bot Mode turns profiles into named agents, each with its own `SOUL.md`,
model, skills subset, and memory. refi-dao materialized five (`data/hermes-bots.yaml`
→ `infra/hermes/profiles/<bot>/`).

The framework consequence is **not** that org-os ships a roster. It is that the
wizard is a *named role with a SOUL*, not a script with prompts — because the
thing that makes an operator willing to say "set me up" to a chat window is that
something is there to answer.

- **New:** `data/agent-roster.yaml` — runtime-neutral role registry. v1 defines
  **exactly one role** (`concierge`) plus the schema for more. Instances add
  their own; the framework does not presume them.
- **New:** `skills/org-os-wizard/SKILL.md` — the concierge's behavior: the day-0
  recipe and the day-N ladder of §4.
- Runtime-neutral by construction: Hermes profiles, Berd's `.agents/skills/`
  bridge (module #4), and Claude Code skills all materialize from the same
  registry. The roster is data; the runtimes are consumers.

**Scope discipline:** one role, not five. A framework that ships a Comms Bot has
made an assumption about the org that org-os is not entitled to make.

### Finding 2 — `install` / `update` with a preserved local region

`hermes profile install <git-url>` installs a whole agent in one command — SOUL,
skills, cron, MCP. `hermes profile update` refreshes org truth **while preserving
the installer's own `config.yaml` and credentials**.

That preservation rule is the interesting half, and org-os already has it. The
v0.5.1 overlay (`packages/instance-doctor/src/overlay.mjs`, landed `c951a4f`)
partitions an instance into `FRAMEWORK_OWNED` (`scripts/`, `templates/` — copied
in) and `INSTANCE_OWNED` (`data/`, `memory/`, `IDENTITY.md`, … — never touched),
and never deletes, because it cannot distinguish an operator's file from one the
framework removed.

**`profile update` is that same contract one level down.** The spec's position
is that they must share one implementation rather than grow two drifting
copies:

| Region | Owner | On update |
|---|---|---|
| `PROFILE_ORG` — `SOUL.md`, skills subset, cron, MCP manifest | framework/org | refreshed |
| `PROFILE_LOCAL` — `config.yaml`, credentials, `MEMORY.md`, sessions | the installer | never touched |

`PROFILE_LOCAL` extends `overlay.mjs`'s existing partition with a third region;
the never-delete rule and the lineage stamp carry over unchanged.

**Verification gate V1 (blocking, before any of this is built):** the exact
Hermes CLI shape for `profile install` / `profile update` is **unverified** —
it is not present anywhere in the refi-dao-os tree, and this spec records it as
reported from the build session, not as read from source. The refi-dao build was
bitten by precisely this class of error: the deployed entrypoint called
`hermes cron add --name … --schedule …` when the real CLI is positional
`cron create "<schedule>" "<prompt>"`, and that mismatch silently broke the cron
reconcile from May until the August audit found it. **Pin the CLI against version
floor `v2026.8.16.2` and read the source before writing a line against it.** If
the interface differs, the org-os side is unaffected: org-os owns a manifest
(`agent-profile.yaml`) and the region contract; runtimes consume it.

### Finding 3 — the agent performs its own setup (→ no web wizard)

The pattern that beats a CLI is not a nicer CLI. The human opens the app and says
*"set me up"*; the agent clones the workspace, sets `terminal.cwd`, verifies the
key, and confirms.

`terminal.cwd` is load-bearing and was a real defect in the refi-dao build: Hermes
profiles do **not** inherit a working directory, so without an explicit pin every
Bot would have silently missed the workspace's `AGENTS.md` contract — an agent
that looks like it works and is not bound by the org's rules. The org-os analogue
is an agent operating outside the instance root, where `CLAUDE.md` / `AGENTS.md`
never load. **The concierge pins and then verifies its own working directory
before it does anything else**, and reports the result rather than assuming it.

The direct consequence for onboarding: **the one page you send a new operator
only has to get them to a working chat window.** Everything the
`non-tech-onboarding` plan wanted a web form for — identity questions, package
and skill selection, credential entry — is a conversation the agent is already
better at. The GitHub Pages form, the Actions backend, and the authentication
question in that plan's Open Questions are all retired unbuilt.

## 6. The one page

**New: `docs/START-HERE.md`** — human-facing, one screen, two doors. Its only job
is a working chat window with the concierge in it.

- **Door A — "I already use an AI coding agent"** (Claude Code, Cursor,
  OpenCode). Point it at the existing, verified recipe
  [`docs/ADOPT-WITH-AN-AGENT.md`](../../ADOPT-WITH-AN-AGENT.md) and say *"set up
  an org-os instance for &lt;my org&gt;."* This door works **today** and is
  end-to-end verified against v0.5.0 — Phase 0 ships nothing new for it.
- **Door B — "I don't have one yet"** — install a chat app, install the
  concierge profile from a git URL, say *"set me up."* Door B is Phase 2 and
  gated on V1.

`ADOPT-WITH-AN-AGENT.md` survives unchanged as Door A's recipe. `START-HERE.md`
is the page that gets sent to a person; `ADOPT-WITH-AN-AGENT.md` is the page that
gets pasted to an agent. Keeping them separate is deliberate — merging them
produces a page that is wrong for both readers.

**Doc updates in the same change:** `docs/OPERATOR-GUIDE.md` Level 2 points at
`START-HERE.md` (its Level 2 text already tells the truth about there being no
web form — this makes the entry point match); `BOOTSTRAP.md` Quick Path
cross-links the concierge as the guided route through Phases 1–3; interfaces spec
§4 gains one clarifying line under **Not surfaces** recording that a path *across*
surfaces is not itself a surface.

## 7. What the superseded plans contributed

Neither plan is discarded silently; both are stamped superseded, with their
answered questions recorded here.

**`instance-bootstrap`** (4 sessions estimated, priority 5):

| Its open question | Resolution |
|---|---|
| 1. Cloning mechanism | **Shipped** — `clone:framework`, 4/4 tests, produced bread-coop-os. Its own 2026-08-28 stamp already carried this correction. |
| 2. Selection mechanism | **Both, resolved by §5** — declarative config file is the interface; the concierge writes it from conversation. |
| 3. Boundary with `bootstrap-interviewer` | **Neither extend nor fork** — `bootstrap-interviewer` keeps identity capture unchanged; the concierge *invokes* it at the "registries thin" rung of §4. |
| 4. Selection storage | Config file at clone time → `federation.yaml`, as `clone:framework` already does. No new `instance.manifest.yaml`. |
| 5. Cloning order | **Answered by shipping** — config first, then clone-and-populate. |
| 6. Proof-of-pipeline source | Deferred to Phase 1; the concierge offers whichever source the operator names, and the ladder rung is source-agnostic. |
| 7. `package-integration` dependency | Dissolved — selection is a `clone:framework` config key today. |

Its Phase 3 (knowledge bootstrap) survives as the "no sources ingested" rung.
Its unresolved bounded task — diff-review of the 983-line wizard variant in
`archive/v3.5-execution` — carries forward to Phase 1 as an explicit salvage
check, not a blocker.

**`non-tech-onboarding`**: `docs/OPERATOR-GUIDE.md` and `docs/CHAT-INTERFACE.md`
are **shipped**. The web wizard, `deploy:pages` config, and shared navigation
header are **retired unbuilt** per Decision 5 — they were the wrapper around a
form that no longer exists. The README "Getting Started" task is absorbed by
`START-HERE.md`.

## 8. Phasing and release targeting

| Phase | Contents | Targets | Gate |
|---|---|---|---|
| **0** | `START-HERE.md` · OPERATOR-GUIDE Level 2 entry point · BOOTSTRAP cross-link · interfaces §4 line · superseded stamps on both plans | `main`, 0.5.1-safe (docs only) | none — Door A already works |
| **1** | `data/agent-roster.yaml` (concierge only) · `skills/org-os-wizard/SKILL.md` · the §4 ladder · `archive/v3.5-execution` salvage check | 0.6.0 | Phase 0 |
| **2** | `agent-profile.yaml` manifest · `PROFILE_LOCAL` region in `overlay.mjs` · install/update path · Door B | 0.6.0 | **V1** (CLI pinned + read at `v2026.8.16.2`) **and** the 0.5.1 overlay cut |

Phase 0 is deliberately shaped to serve the **~2026-09-10 Regen Knowledge Commons
session** (WS-I), which is 12 days out: it is docs-only, it ships the page you can
hand someone in the room, and it commits the framework to nothing that V1 could
invalidate.

## 9. Constraints honored

- **§4 is binding and unamended** — no new plane, no new server, no new write
  path. The concierge is a client (Decision 1, §3).
- **Draft-and-present** — the concierge never sends externally and never executes
  a credential grant; it drafts, the operator executes. Carried directly from the
  refi-dao credential layer.
- **The wizard never handles keys.** Provider keys stay where the runtime puts
  them; `PROFILE_LOCAL` is preserved precisely so an update cannot reach them.
- **Vault safety** — the concierge inherits the instance's `CLAUDE.md` /
  `AGENTS.md` rules, which is exactly what the `terminal.cwd` pin of finding 3
  exists to guarantee.
- **One role, not a roster** — §5 finding 1.
- **Nothing here is deployed by this spec.** Every artifact is markdown, YAML, or
  a skill: inert until an operator runs something.

## 10. Non-goals

- A web wizard, hosted form, or GitHub Actions bootstrap backend (Decision 5).
- A framework-shipped multi-agent roster (§5 finding 1) — refi-dao's five Bots
  stay refi-dao's.
- Hosting, signing, or distributing a chat application. Door B installs a
  *profile* into an app the operator already installed, exactly as refi-dao chose
  stock signed binaries over a fork.
- Replacing `bootstrap-interviewer`, `clone:framework`, or `instance-doctor`. The
  wizard drives all three and reimplements none.
- Multi-instance or federation onboarding. One operator, one instance.

## 11. Verification

- **V1 (blocking, Phase 2)** — Hermes `profile install` / `profile update` CLI
  shape read from source at `v2026.8.16.2` before implementation. §5 finding 2.
- Phase 0: `START-HERE.md` Door A followed literally by an agent with no prior
  context produces a valid instance whose only blocker is `git-remote-absent` —
  a re-run of the 2026-08-29 clean-room check against the new entry point.
- Phase 1: from a clean scorecard and from a deliberately broken one, the
  concierge offers the correct next rung in both cases (§4 table).
- Phase 1: the concierge verifies its own working directory before acting, and
  says so — the finding-3 defect, tested rather than assumed.
- Phase 2: `profile update` against a profile with modified `config.yaml`,
  added credentials, and local `MEMORY.md` leaves all three byte-identical while
  refreshing `SOUL.md` and the skills subset.
- Phase 2: the `PROFILE_LOCAL` region reuses `overlay.mjs` rather than
  duplicating it — verified by construction (shared export), not by inspection.
- Acceptance for the path as a whole: **one operator who is not Luiz reaches a
  clean scorecard using only `START-HERE.md`.** This is the same datapoint the
  v0.6 `external-pilot` gate needs; the wizard is how that gate gets fed.

## 12. Follow-ups (out of scope, recorded)

- **Berd bridge** (module #4) should materialize `agent-roster.yaml` into
  `.agents/skills/` once the roster exists — a consumer of Phase 1, not part of it.
- **Admin app hand-off** (§3) is currently a link the concierge suggests. A deeper
  join — the concierge deep-linking into an admin view — waits for admin M2.
- **Frozen-queue interaction:** `instance-bootstrap`'s freeze row leaves the
  QUEUE frozen table as it moves to Superseded; `non-tech-onboarding` shares a
  freeze row with four other plans, so that row loses one entry rather than
  clearing. Portfolio-memo governed either way.
- If a second instance asks for the refi-dao roster pattern (Comms/Governance/
  Ideation Bots), that is a *separate* promotion task with its own spec — the
  same posture refi-dao took toward this one.
