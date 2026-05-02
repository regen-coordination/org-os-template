# 09 — Volition / Decision

_Aspect 9 of the autopoiesis Phase 1 research. Instance-level primary; framework-level secondary. PROCESS aspect: decision flow._

Biological autopoietic systems don't decide — they self-produce. Org-os instances do decide, because agents act on behalf of the org. The question is where the boundary of agent agency sits, who draws it, and what mechanism ensures the boundary holds. The short answer in this codebase: **volition is governed by three overlapping rule sets (AGENTS.md "Safety Policy", MASTERPLAN.md "Boundaries", per-skill SAFETY blocks), classification is performed by the agent itself through pattern-match against those rules, and the audit trail is split across `DECISIONS.md` (the why), `memory/YYYY-MM-DD.md` (the what), and `HEARTBEAT.md` (the what-next).** No code enforces the boundary; the rule lives in the agent's prompt context.

---

## Mechanism (step by step)

A concrete trace, using the canonical event types: a `/initialize` from the operator, a meeting transcript dropped into the workspace, and a destructive vault op the agent considers (e.g., `git stash --include-untracked`).

1. **Event arrives.** Sources are: operator slash command (`/initialize`, `/close`, free-form prompt), file landing in the tree (transcript, PR comment), `HEARTBEAT.md` self-poll at session start, scheduled job (`heartbeat-monitor` cron-style).
2. **Agent loads boundary context.** On every session, the startup sequence in `AGENTS.md` §1 forces a read of `MASTERPLAN.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, `MEMORY.md`, today's `memory/*.md`, `HEARTBEAT.md`. Three of these encode boundaries:
   - `AGENTS.md` §6 "Safety Policy" — explicit two-list classifier: "Autonomous Actions (no approval needed)" vs. "Requires Operator Approval", plus a Two-Tier Pattern hook for council-level decisions.
   - `MASTERPLAN.md` §6 "Boundaries" — same shape, framework-tuned (autonomous = analyze instances, write docs, create skills; requires-approval = merge to main, modify package.json, breaking schema changes).
   - `SOUL.md` "Boundaries" — negative constraints framed as identity ("never break downstream without a migration path", "never centralize what should federate"). These are not action classifications; they are the things the system **won't do at all**, regardless of who asks.
3. **Agent classifies the event.** Classification is **implicit** — pattern-match by the LLM against the bullet lists. There is no `classify(action) -> {autonomous, draft, escalate}` function in the codebase. The agent reads the bullets, reads the action it's about to take, and routes. Examples drawn from the actual rules:
   - "Write to `memory/`, `MEMORY.md`, `HEARTBEAT.md`" → autonomous. Append today's session note: do it.
   - "Sending messages to external parties" → requires approval. Compose a Telegram message: draft, present, wait.
   - "Changes to governance boundaries or safety policies" → requires approval. Edit `AGENTS.md` §6: draft as diff, present.
4. **Skill-level guards layer on top.** Some skills declare their own SAFETY block which overrides the generic Safety Policy. `skills/capital-flow/SKILL.md` lines 21–31 codifies a four-step pattern — **"Read → Draft → Present → Operator executes"** — and explicitly states "if in doubt: draft and present, never act." `docs/AGENT-MODES.md` shows the same pattern in `governance-facilitator` ("Draft-and-present ALL public communications") and `ideation-curator` ("Never approve ideas autonomously (only surface and propose)"). Skills can tighten the boundary; they cannot loosen it.
5. **Action OR draft.**
   - Autonomous → execute, write outcome to `memory/YYYY-MM-DD.md` (append-only) and tick `HEARTBEAT.md` if a tracked task closed.
   - Requires-approval → write a draft to a known location (e.g., `data/pending-payouts.yaml` for capital-flow, the chat for comms drafts, a PR diff for code), then surface to operator with a summary. The draft is not an action — it's a proposal artifact.
6. **Operator review.** Not file-mediated. Review happens in the chat surface itself (Claude Code, OpenCode, Cursor), where the operator says yes/no/edit. When approval is granted, the agent re-enters step 5 with the same action now classified autonomous *for this turn*.
7. **Execution + log.** On execute, the agent writes:
   - `memory/YYYY-MM-DD.md` — session log entry with **Focus / Key Decisions / Actions Taken / Next** (template in `.claude/commands/close.md`).
   - `DECISIONS.md` — **only** for "significant" decisions (the file's own preface: "append-only log of significant decisions"). Each entry: Status / Scope / Decision / Why / Refs. The threshold for "significant" is itself implicit — looking at recent entries, it's "decisions that change the framework's structure or policy", not "I processed a meeting note".
   - `HEARTBEAT.md` — move closed tasks to "Recently Completed", add new emergent tasks.
   - `MEMORY.md` — only if a Key Decision section needs updating; otherwise just the index.
8. **Session boundary.** `/close` (`.claude/commands/close.md`) is itself a volition checkpoint: it forces the audit trail to be written, then commits to git. Push failure is non-blocking. Without `/close`, the session's decisions stay in the model's working memory and don't propagate.

The vault-safety rules in `Zettelkasten/CLAUDE.md` are a **hard prefix** to step 3: certain action shapes (`git stash` in vault, `git clean`, `git reset --hard` with uncommitted content, deleting `*.md` at vault root) are pre-classified as **forbidden**, not "requires approval". These bypass the bullet-match — they are vetoes that fire even if the operator asks for them, modulo explicit override.

---

## Prior art

- **Beer's VSM System 5** — identity / policy as the locus of decision. In VSM, System 5 holds the organization's ethos and intervenes only when lower systems can't resolve a tension. Maps onto org-os surprisingly cleanly: `SOUL.md` is System 5 (ethos, the hard "won't do"), `MASTERPLAN.md` is System 4 (forward-looking strategy, what to focus on), `AGENTS.md` §6 is System 3 (operational control: this is autonomous, that needs approval), `HEARTBEAT.md` is System 1/2 (current activity, coordination). The split between SOUL boundaries and Safety Policy boundaries mirrors S5/S3.
- **Friston's active inference** — the system acts to minimize prediction error; agency = the policy that resolves the gap between the world and the model. Org-os doesn't formalize this, but the agent's behavior loop (read state → match boundary rules → act/draft → write outcome → re-read on next session) is a coarse free-energy loop. The model is the agent file set; deviations from `data/*.yaml` ground truth are the prediction error; `npm run validate:schemas` and `npm run analyze:instances` are the surprise meters.
- **Constitutional AI / agent-boundary literature** — Anthropic's CAI uses a written constitution to classify agent actions before they execute. `AGENTS.md` §6 + `MASTERPLAN.md` §6 + per-skill SAFETY blocks are exactly this pattern, just hand-written and natural-language. The classifier is the LLM reading its own constitution; there's no separate critic model.
- **RACI / formal organizational decision theory** — the framework gestures at a Two-Tier Pattern in `AGENTS.md` §6 ("Operator approval / Council-team approval") that maps onto Approver/Consulted layers, but in solo-maintainer phase the operator is both A and C and the council layer is `N/A` (`HEARTBEAT.md` lines 33–37, `IDENTITY.md` line 54).
- **Checks-and-balances design (separation of powers)** — the framework separates *who decides what to standardize* (framework, see Boundaries in `MASTERPLAN.md`) from *who decides what to do day-to-day* (instance, governed by its own `MASTERPLAN.md`). This is structural, not enforcement-bound; nothing prevents an instance from editing its `SOUL.md` to remove a boundary.

---

## Invariants / failure modes

**Closes the loop:** Event → context loaded (startup sequence) → classified against AGENTS.md §6 / MASTERPLAN.md §6 / skill SAFETY → action OR draft → operator review (for drafts) → execute → log to `memory/`, `HEARTBEAT.md`, `DECISIONS.md` → commit on `/close` → next session re-reads the log.

**Breaks the loop:**

- **Agent acts in autonomous category by mistake when it should have been requires-approval.** Prime example: vault-safety incidents. A `git stash --include-untracked` in the vault parent looks innocuous to a generic LLM (it's a standard git op). Without the explicit veto rule in `Zettelkasten/CLAUDE.md`, it would be classified autonomous and would silently destroy untracked vault content propagated to other devices. The veto rule exists precisely because the natural classification was wrong.
- **Draft made but never presented.** Capital-flow writes `data/pending-payouts.yaml`, but if the agent doesn't surface the draft in chat the operator may never see it. There's no scheduled prompt that says "you have N pending drafts awaiting review." `heartbeat-monitor` could fill this gap but currently only tracks `HEARTBEAT.md` items, not pending drafts.
- **Decision logged but not propagated to schemas/registries.** A `DECISIONS.md` entry that adds a new registry must also flow into `data/*.yaml` and then `npm run generate:schemas` must run. The HEARTBEAT reminder ("After any `data/` change → `npm run generate:schemas`") catches this, but only if the agent reads HEARTBEAT and only if the run actually fires. The 2026-04-29 entry in HEARTBEAT noting that `validate:schemas` references a missing script is exactly this kind of leak.
- **Boundary rule says one thing, skill says another.** `AGENTS.md` §6 lists "Maintain federation.yaml peer references" as autonomous; SOUL.md says "never centralize what should federate." A change adding a peer is autonomous by §6 but could violate SOUL if the change concentrates topology. No tooling reconciles these; the agent has to hold both in head.
- **Classification is implicit, so it drifts with the model.** An older Claude reading `AGENTS.md` §6 might classify "publish to external platforms" more aggressively than a newer one. The boundary text doesn't change but the interpretation does. Versioning the boundary text (per `DECISIONS.md` 2026-04-24) doesn't pin model behavior.
- **HEARTBEAT and DECISIONS disagree on what's "active."** `HEARTBEAT.md` lists tasks; `DECISIONS.md` records why those tasks exist. If a decision is superseded but the HEARTBEAT task remains, the agent will execute on stale rationale. Today the only mitigation is the `superseded` status convention in `DECISIONS.md` and operator vigilance.
- **`/close` not run.** Every artifact in step 7 above depends on `/close` firing. A session ended by Ctrl-C drops session memory entirely — the working-memory decisions never make it to disk. No autosave for the decision log.

---

## Open questions

- **What's the exact classification mechanism?** Today: pattern-match by the LLM against natural-language bullet lists. Should it be: skill-declared (each skill carries `requires_approval: true/false` per action it can take)? Operator-instructed per-session (a "trust budget" the operator sets at `/initialize`)? Code-enforced (a hook layer that intercepts tool calls and checks a manifest)?
- **How does the system decide between conflicting operator instructions?** No mechanism exists. If `MASTERPLAN.md` says "draft-and-present for anything public-facing" and the operator says "just post it", which wins? Today: probably the most recent instruction, but this is implicit.
- **Is `HEARTBEAT.md` authoritative when it conflicts with the daily memory entry?** Both are agent-written. `MEMORY.md` quick-index says HEARTBEAT is "Active Tasks" and memory/ is "Session notes" — but the agent updates both, and they can disagree (a task marked done in memory but still pending in HEARTBEAT). No tie-breaker rule.
- **What's the framework-vs-instance volition split?** Hinted in MASTERPLAN.md §1 ("Framework-focused: think about all organizations") vs. instance MASTERPLANs ("focus on RIGHT NOW for this org"). But there's no explicit rule that says e.g. "the framework decides what gets standardized; the instance decides what to ingest from its sources today." Tight skill-promotion policy (≥2 instances, `DECISIONS.md` 2026-04-24) is the only formal cross-layer rule.
- **What threshold makes a decision worth `DECISIONS.md`?** The file says "significant" but doesn't define it. Looking at entries, the de-facto bar is "would another agent need to know this to operate correctly?" — but this is a posterior criterion, not a prior one.
- **Who classifies SOUL-level vetoes vs. Safety-Policy-level approvals?** Vault-safety rules read like SOUL hard-no. Capital-flow's "draft and present" reads like Safety Policy. They live in different files with different escalation semantics. The separation is real but unwritten.
- **What happens on operator absence?** If the operator doesn't review a draft for N days, does it expire? Promote to autonomous? Stay forever? Today: stays forever as a stale file. No escalation policy.
- **Should `DECISIONS.md` entries have machine-readable status that drives tooling?** Currently free-text Status field with conventions ("active", "superseded", "withdrawn", "proposed"). A schema would let `analyze:instances` flag instances running on a superseded decision.

---

## Existing-plan touchpoints

- **`docs/agent-plans/non-tech-onboarding.md`** — the operator-vs-agent agency boundary at first touch. A non-technical operator can't be expected to read `AGENTS.md` §6; the web UI must encode the boundary in widget shape (greyed-out buttons for requires-approval actions, "Review draft" CTAs for surfaced proposals). This plan is where volition becomes UX.
- **`docs/agent-plans/system-reliability.md`** — volition boundary is itself a reliability invariant. The vault-safety rules are reliability infrastructure framed as volition. This plan should treat "agent acted in autonomous when it should have been approval" as a category of failure with its own detection (e.g., post-action diff review against a forbidden-shapes list).
- **`docs/superpowers/plans/2026-04-25-multica-integration.md`** — slash commands as volition entry points. Each `/command` is a typed volition channel: it tells the agent what category of action follows. `/initialize` is autonomous (it just renders); `/close` is autonomous-with-side-effects (commits + pushes); a hypothetical `/publish` would be requires-approval. Designing the slash-command surface is designing the volition API.
- **`docs/agent-plans/obsidian-interface.md`** and **`obsidian-canvas-interface.md`** — HEARTBEAT and decisions become a *visible* surface. The operator can see at a glance "what's the agent about to do, what has it drafted, what's pending review." This turns volition from chat-mediated to vault-mediated. Once decisions are first-class vault objects, an operator can review drafts asynchronously without being in a session.
- **`docs/agent-plans/instance-bootstrap.md`** — the bootstrap moment is itself a volition handover. The agent generates `SOUL.md`/`IDENTITY.md`/`MASTERPLAN.md` from interview answers; those files then constrain all future agent decisions in that instance. The interview defines the instance's volition envelope. Today it's hand-keyed prose; an obvious refinement is for the interview to surface the explicit safety lists.

---

## Framework-level note

Framework volition = governance of the framework itself: who decides what gets promoted from instance-local skill to framework-canonical, what gets retired, what counts as a breaking change, what the standard registries are. Today this is **solo-maintainer**, codified in `IDENTITY.md` ("Decision Model: solo-maintainer", `Governance Infrastructure` fields all `N/A (solo phase)`) and reinforced in `SOUL.md` ("Operating in solo-maintainer mode today, headed toward OSS collaboration and eventually DAO stewardship") and `DECISIONS.md` 2026-04-24 ("Identity trajectory: solo-maintainer → OSS → DAO"). The trajectory is explicit and trigger-bound — the OSS transition fires on the first external merged PR, the DAO transition fires when treasury forms. Until then, framework volition is one human's judgment, which means the framework's own safety policy ("Requires approval" in `MASTERPLAN.md` §6: merge to main, modify package.json, breaking schema changes) is enforced by self-discipline rather than by a council. The interesting design choice is that the governance fields are kept **present-but-`N/A`** in `IDENTITY.md` rather than removed — so the upgrade path is self-documenting and the agent already knows where future councils plug in.
