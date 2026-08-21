# Task 14 — Clean-room bootstrap experiment: "Harbor Bakery Co-op"

**Persona:** Operations coordinator, Harbor Bakery Co-op — a 9-person worker-owned bakery in
Lisbon. Comfortable in a terminal, knows nothing about DAOs, EIP-4824, ReFi, Radicle, or org-os.
**Rule of the experiment:** only `README.md`, `BOOTSTRAP.md`, `docs/OPERATOR-GUIDE.md`, and
documents those three explicitly link to may be consulted for *how* to do something. Source may
only be read after something fails, to characterize the failure — and every such read is logged
below as a deviation.
**Clean room:** `/tmp/cleanroom-org`, cloned from `https://github.com/regen-coordination/org-os-template.git` @ `main`. Left in place, unmodified beyond the experiment itself, for inspection.

---

## Total wall-clock

**00:21:29 UTC → 00:31:36 UTC ≈ 10 minutes 7 seconds**, clone to a validation suite that reports
"all green." That number is misleading and the verdict section explains why: it is the time for
a tool-calling agent to execute a scripted sequence at machine speed, including two decisions to
read source and hand-edit files after the documented path broke. A first-time human operator
reading cold would spend materially longer just parsing the conflicting setup-path docs (Finding
B1/M1 below), then would either (a) get stuck indefinitely at the first interactive prompt if
running through any non-TTY/CI/agent-driven shell, or (b) if running a real terminal, finish in
comparable time to what's measured here — but land on the same silently-broken, falsely-"passing"
instance documented in B5–B7, because nothing in the documented flow would ever tell them.

---

## Timestamped log

| UTC time | Stage | Result |
|---|---|---|
| 00:21:29 | Start | — |
| 00:21:34 | `git clone` | Done, ~5s |
| 00:21:34–00:22:11 | Read README.md, BOOTSTRAP.md, docs/SETUP-PATHS.md (linked from README) | Found **two** documented operator paths and a **third**, non-functional one — see B1/M1 |
| 00:22:21–00:22:26 | `npm install` | Clean, 22 packages, ~5s. 1 high-severity `npm audit` finding (not investigated, m3) |
| 00:22:26–00:27:26 | Attempt `npm run setup` (the documented "interactive guided interview") via 4 distinct automation strategies | **All 4 failed to advance past question 1.** See B2 |
| 00:24:40 | Read docs/OPERATOR-GUIDE.md (looking for a non-interactive fallback) | None found; see M2 |
| 00:27:26–00:29:37 | Confirmed zero files mutated by the failed attempts (`git status`); read `scripts/setup-org-os.mjs` to characterize the failure (**deviation — logged**) | Revealed B1, B3, B4 |
| 00:29:37–00:30:20 | Manually hand-edited `SOUL.md`, `IDENTITY.md`, `federation.yaml` to best-effort simulate a completed wizard run for Harbor Bakery Co-op (**deviation — logged, see below**) | — |
| 00:30:20–00:30:54 | Ran `npm run initialize` and `node scripts/initialize.mjs --format=markdown` (the `/initialize` equivalent) | Renders — see B5, the actual "first session" a newcomer would see |
| 00:31:12–00:31:13 | `npm run generate:schemas` | "✓ All schemas generated successfully," republishes leaked content — B6 |
| 00:31:26–00:31:27 | `npm run validate:schemas` | "14 passed, 0 failed, 0 warnings" on a misidentified instance — B7 |
| 00:31:35–00:31:36 | `npm run validate:structure` | "53 passed, 0 failed, 2 warnings," same blind spot — B7 |
| 00:31:53 | End of experiment | — |

**Deviation disclosure:** two things above go beyond "docs only." (1) After `npm run setup` failed
identically across a plain stdin pipe, a `script`-allocated pty with blind Enters, `expect` with
output pattern-matching, and `expect` with blind timed keystrokes — all four leaving zero files
changed — I read `scripts/setup-org-os.mjs` to find out what the six questions actually are and
why nothing was advancing. That is exactly the sanctioned "look at source to characterize a
failure" case, and it is itself the finding: a newcomer has no way to get this information short
of doing the same. (2) I then hand-edited `SOUL.md`/`IDENTITY.md`/`federation.yaml` with plausible
Harbor Bakery Co-op values (mimicking what the wizard *should* have written) purely so the
experiment could proceed to test `/initialize` and schema generation, which the task also
required. No newcomer following only the three allowed docs would know to do this by hand; I did
it once the automated path was exhausted, exactly as instructed ("log it, then work it out").

---

## Friction items, ranked by severity

### Blocker (a newcomer stops here, or gets a result they'd trust that is actually wrong)

**B1 — The documented "six questions" don't exist as six questions, and don't match what the tool asks.**
`BOOTSTRAP.md` Phase 1 lists six topics — org identity, **team**, **projects**, **communication**,
network, **data sources** — attributed to "the bootstrap-interviewer skill." But the command
README tells an operator to run for this ("interactive guided interview": `npm run setup`) invokes
`scripts/setup-org-os.mjs`, which asks **nine** prompts in this order: org type (select),
org name (text), org description (text), **base URL** (text, required), operational packages
(multiselect: meetings/projects/finances/coordination/webapps/**web3**), agent runtime (select:
none/cursor/openclaw/custom), federation network name (text, optional), emoji (text, optional),
Notion integration (confirm). It never asks about team/members, projects, communication channels,
or data sources at all — `data/members.yaml`, `data/projects.yaml`, `data/channels.yaml`, and
`TOOLS.md`/`data/sources.yaml` are never touched by this script. Confirmed by reading the full
443-line script after automated attempts failed with no diagnosable error (00:29:00).

**B2 — The interactive setup wizard cannot be completed by a non-interactive/agent-driven caller.**
`npm run setup < /dev/null` exits code 13 with only `Warning: Detected unsettled top-level await
at .../scripts/setup-org-os.mjs:20` and no other message — the process silently dies waiting on
`await select(...)` with no explanation that a TTY is required. I then tried three more approaches
to drive it as a real terminal would: `script -q <log> npm run setup` fed via a pipe (same
exit 13), `expect` with output pattern-matching to send `\r` on prompt text (`TIMEOUT_HIT` — the
select never advances), and `expect` with blind timed arrow-key/Enter sequences matching the known
prompt order from source (`FINAL_TIMEOUT`, echoed keystrokes visible in the log confirming the pty
never entered raw mode). All four attempts, across ~5 minutes (00:22:26–00:27:26), left **zero**
files modified (`git status --short` clean except `package-lock.json` from `npm install`). This
env's base shell has `TERM=""` and `stdin.isTTY`/`stdout.isTTY` both `undefined` — exactly the
condition an AI coding agent's shell tool operates under. Org-os's own positioning is "run by
humans **and AI agents together**," with Claude Code / OpenCode / Cursor named as first-class
runtimes throughout the docs — yet the one command that turns a fork into an org cannot be run by
one of those agents on its own. There is no documented non-interactive/config-driven equivalent
for the *in-place* setup path (the config-file-driven `clone-framework.mjs` engine exists but
targets a **new sibling directory**, not the repo you're standing in — see M4).

**B3 — Even a human who completes the wizard would get a silent no-op on `IDENTITY.md`.**
The `org-os-template` GitHub repo — the exact URL README and BOOTSTRAP.md tell an operator to
fork — is not a blank template. It is the maintainer's own live, populated, self-hosting
instance (README: "The framework is itself an instance, self-hosting since 2026-04-24"). The
setup script's file-mutation logic depends on regex/marker guards that assume pristine
placeholder text:
- `SOUL.md` is only rewritten `if (soulContent.includes('_This file defines the organization'))`.
  The cloned file reads `_This file defines the character, values, and voice of org-os itself...`
  — no match, so **the mission paragraph is silently never rewritten**, no error, no warning.
- `IDENTITY.md`'s Name/Type rewrite regex is `/\*\*Name:\*\* _\(e\.g\..+?\)_/` — expecting a
  literal `**Name:** _(e.g. Acme DAO)_` placeholder. The cloned file has `- **Name:** org-os` (a
  bulleted line, no placeholder pattern) — **also silently never rewritten.**
Confirmed by reading source and the current file contents directly (00:29:00). A real newcomer
running the real wizard in a real terminal would finish setup, see the friendly "Setup complete
for Harbor Bakery Co-op!" outro message, and have an `IDENTITY.md` that still says `**Name:**
org-os` / `**Maintainer:** Luiz Fernando (github.com/luizfernandosg)` with zero indication
anything went wrong.

**B4 — The "template" ships the maintainer's real personal/org data, untouched by setup.**
`data/members.yaml` (real name "Luiz Fernando", `github:luizfernandosg`, "Solo-maintainer phase"),
`data/projects.yaml` (a live internal project, `v2-stabilization`), and `TOOLS.md` (hardcoded
Gnosis Chain / Ethereum RPC endpoints and Gnosis Safe transaction-service URLs) are none of them
touched by `scripts/setup-org-os.mjs`. No doc in the allowed set instructs an operator to clear or
edit them.

**B5 — The actual first-session dashboard is dominated by leaked, unrelated content.**
Ran the literal `/initialize` equivalent (`node scripts/initialize.mjs --format=markdown`) after
best-effort manually correcting the identity layer to Harbor Bakery Co-op. The rendered dashboard
— what a newcomer's very first session actually looks like — shows: **"54 tasks · Skills: 33"**
in the banner; a **"dirty"** git-status badge; a Projects table of **13 entries**, all the
maintainer's own framework engineering work (`OPAL Rollout`, `rad-org-os`, `Cloudflare OS
Integration`, `Framework Evolution`, …), every one owned by `github:luizfernandosg`; a Tasks
section topped by `◇ Execute autopoiesis-research Phase 2 (12-task TDD plan; cascade closure:
sync-upstream.mjs + validate-identity.mjs + lineage stamp)` and 53 more like it; a "Knowledge
Graph: 2,906 nodes · 4,678 edges · 184 communities"; exactly **one member, "Luiz Fernando"**; and
a Federation panel listing peers `organizational-os-framework` / `organizational-os` at "full"
trust — none of which Harbor Bakery Co-op created, asked for, or would understand. This is not a
crash or an error message — it renders cleanly and confidently. It is simply not that org's data.

**B6 — Schema generation republishes the leaked content into public EIP-4824 output.**
`npm run generate:schemas` (00:31:12) reports `✓ All schemas generated successfully!` with zero
warnings, and regenerates `.well-known/projects.json` (13 entries, all `github:luizfernandosg`'s),
`.well-known/proposals.json`, `.well-known/ideas.json` (9 entries) from the untouched `data/*.yaml`
files in B4. `.well-known/dao.json` — the core EIP-4824 identity artifact and the headline
"publish machine-readable org data" feature — is explicitly **skipped**: `· Skipped dao.json
(identity.daoURI not set — keeping existing file)`, because `daoURI` (an on-chain field
irrelevant to a cooperative bakery) was never set. It is left reading `"name": "org-os"` after a
"successful" generation run. If deployed as-is, Harbor Bakery Co-op's public organizational
identity page would say it is "org-os" and its public project registry would be the framework
maintainer's own roadmap.

**B7 — Both documented validation commands give the leaked instance a full, confident pass.**
`npm run validate:schemas` (00:31:26): `Results: 14 passed, 0 failed, 0 warnings — ✓
Identity/schema validation passed`. `npm run validate:structure` (00:31:35): `Results: 53 passed,
0 failed, 2 warnings — ✓ Instance passes structural validation` (the two warnings are cosmetic —
a leftover `MASTERPROMPT.md` and a missing optional `ideas/` dir — unrelated to B3–B6). Neither
check compares `.well-known/dao.json`'s or `.well-known/projects.json`'s *content* against
`IDENTITY.md`/`data/*.yaml` — `validate:schemas`'s IDENTITY.md↔federation.yaml cross-check is the
only content comparison it does, and I had already hand-fixed both files to agree with each other
(both still disagreeing with `dao.json`, which the check never looks at). This is the most
consequential finding of the experiment: the documented health-check tooling actively tells an
operator their instance is correct when it demonstrably is not.

### Major (would confuse a newcomer badly, plausible give-up point)

**M1 — `docs/SETUP-PATHS.md`, explicitly linked from README "for choosing between" the two setup
commands, describes a flow that does not exist.** README: "See ... `docs/SETUP-PATHS.md` for
choosing between them." That document is entirely about choosing an "Egregore-assisted /
Filesystem-native / Hybrid" **path** via `npm run setup → Choose path: "Egregore-assisted"`.
The real `scripts/setup-org-os.mjs` (read in full, B1/B2) contains no path-selection prompt, no
mention of Egregore/Filesystem/Hybrid, and no reference to `config/paths/` (which doesn't exist in
the repo either — checked: `ls config` → no such file or directory). The doc a newcomer is
explicitly sent to for disambiguation describes a different, seemingly aspirational tool.

**M2 — `docs/OPERATOR-GUIDE.md`'s "Level 2: Guided Setup (Basic Computer Literacy)... via web form
or chat flow" gives no URL, command, or pointer.** This is the level explicitly aimed at an
operator like Harbor Bakery Co-op's coordinator ("You don't need to be a developer"). Every
concretely runnable instruction anywhere in the three allowed docs is a terminal `npm` command —
there is no discoverable web form or chat flow, contradicting the document's own premise.

**M3 — README presents two competing, un-reconciled "operator" bootstrap commands** (`node
scripts/clone-framework.mjs --target ../my-new-org --config config.yaml`, labeled "Recommended,"
vs. `npm run setup`) with no guidance in README itself on which to use, deferring to M1's dead-end
doc.

**M4 — The "Recommended" `clone-framework.mjs` path contradicts README's own "fork a repo, answer
six questions" framing.** It requires hand-authoring a YAML config (org/operator/network/packages/
skills fields, none explained before this point) and materializes the new org in a **new sibling
directory**, not the forked repo itself. "Fork and answer six questions" reads as "clone this repo
and start working in it"; the recommended path is actually "clone the framework as a generator,
then produce a separate, second directory elsewhere." (Not executed against a live target — doing
so would have required writing outside `/tmp/cleanroom-org`, out of scope per this experiment's
constraints — but the shape of the contradiction is visible directly from BOOTSTRAP.md's own
example.)

### Minor (papercuts)

**m1 —** `npm run setup < /dev/null`'s only diagnostic is a raw Node internals line (`Warning:
Detected unsettled top-level await ... const orgType = await select({`) with exit code 13 — no
human-readable "this needs an interactive terminal" message.

**m2 —** `docs/OPERATOR-GUIDE.md` Level 4 says "Create new agent skills in `agents/skills/`"; the
actual directory is `skills/` at repo root. `agents/skills/` does not exist (verified: `ls agents`
→ no such file or directory; only `.agents/` and `skills/` exist at top level).

**m3 —** `npm install` reports "1 high severity vulnerability" via `npm audit` on a fresh clone
(not investigated further — outside org-os-specific UX, but the first thing a newcomer's terminal
shows them).

**m4 —** The wizard's "Base URL (where will this be deployed?)" question is **required**, with
domain-format validation (`Base URL is required`; rejects strings containing `http`), forcing a
brand-new co-op with no website plan to invent a plausible-looking domain just to get past
question 4 of 9.

**m5 —** The wizard's "Which agent runtime will you use?" options are `none / cursor / openclaw /
custom` — **Claude Code**, the framework's own most-documented and namesake runtime (README,
AGENTS.md, BOOTSTRAP.md, the entire `/initialize`/`/close` slash-command model), is not one of the
choices.

---

## Verdict: is "fork, answer six questions, and have a first session in hours" true as written?

**No.** Every clause fails independently:

- **"Answer six questions"** — the documented interview isn't six questions; it's nine, and they
  don't cover four of the six topics BOOTSTRAP.md says they cover (B1).
- **"Fork ... and have a first session"** — the fork target is not a template, it's the
  maintainer's live instance, so "answering the questions" (even successfully, even by a human in
  a real terminal) leaves core identity fields and all org data silently unset (B3, B4).
- **"In hours"** — for the primary audience the project's own positioning claims (an AI agent
  operating the workspace), the six/nine-question step cannot be completed at all through a
  non-interactive shell — not in hours, not ever, without external intervention (B2).
- **"A first session"** — the session you do get, whether by hand-fixing files (as this experiment
  did) or by somehow completing the wizard, is not Harbor Bakery Co-op's session. It's the
  maintainer's own 54-task, 13-project, 2,906-node backlog wearing a bakery's name tag (B5), and
  it is then published as such (B6) with the tooling's full, false endorsement (B7).

The mechanical 10-minute wall-clock is real, but it measures the wrong thing: getting *a* result
fast is not the same as getting *your organization's* result. The honest number is closer to
"minutes to something that looks done and passes every check, indefinitely to something that's
actually true," because nothing in the documented path — including the two explicit
validation/health-check commands — currently detects the difference.

## Plain answer: would a non-web3 cooperative get through this unaided?

**No.** A human at a real terminal (unlike this agent) would likely get past the raw-mode/TTY
wall (B2) that stopped four different automation strategies cold. But they would still walk away
from a "successful" setup with an `IDENTITY.md` that still says `org-os` / `Luiz Fernando` (B3),
a dashboard full of a stranger's engineering backlog on day one (B5), and two green "all passed"
validation runs actively telling them nothing is wrong (B7). Nothing in `README.md`, `BOOTSTRAP.md`,
or `docs/OPERATOR-GUIDE.md` — the only docs this experiment was allowed to read — would tell a
bakery co-op operator any of this happened. They would either abandon the project confused about
why their "bakery OS" is full of DAO federation jargon and TDD plans, or worse, publish it as-is.

---

## Fix-list, ordered by first-hour impact

1. **Make the fork target an actual blank template.** Strip `data/members.yaml`,
   `data/projects.yaml`, `TOOLS.md`, `.well-known/*.json`, `SOUL.md`, `IDENTITY.md`, and
   `federation.yaml` back to genuine placeholders in the `org-os-template` repo specifically (keep
   the maintainer's live content in a separate self-hosting repo/branch, not the fork target). This
   alone fixes B3, B4, B5, and B6 at the source.
2. **Add a content-diff check to `validate:schemas`/`validate:structure`** that fails (not
   passes) when `.well-known/dao.json`'s `name` disagrees with `IDENTITY.md`'s `Name`, or when
   `data/projects.yaml`/`data/members.yaml` still contain the upstream template's placeholder IDs
   (`github:luizfernandosg`, `v2-stabilization`, etc.) after setup. This turns B7 from a false
   green light into an actual safety net, and is cheap relative to its value.
3. **Give the interactive wizard a non-interactive/scriptable mode** (flags or a `--config
   answers.yaml`, analogous to what `clone-framework.mjs` already has) that works *in place* in
   the current repo, not only in a new sibling directory. This fixes B2 for both CI users and any
   AI agent driving the setup — the exact audience the project's positioning names first.
4. **Reconcile `BOOTSTRAP.md`'s six-question description with what `scripts/setup-org-os.mjs`
   actually asks**, or make the script actually ask about team/projects/channels/sources as
   documented. Either fixes B1; the current state (two different, undocumented-as-different flows
   sharing the name "the six questions") is pure confusion for zero benefit.
5. **Delete or fix `docs/SETUP-PATHS.md`.** It's linked from README as the disambiguation doc and
   describes a tool that doesn't exist (M1). A newcomer who follows the README's own pointer for
   help gets actively misled.
6. **Point Level 2 of `docs/OPERATOR-GUIDE.md` at something real** — a URL, a command, or an
   honest "not built yet, use Level 3" (M2). As written it promises non-technical operators a path
   that isn't there.
