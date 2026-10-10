# Site and Docs v2 — Plan 2: the Content — Implementation Plan

> **For agentic workers:** this plan is executed unit by unit by subagents (superpowers:subagent-driven-development). Each unit agent reads the whole of this file, then its own unit brief.

**Goal:** Every page on the site is checked against the code and says which commit it was checked at; the pages of the spec's structure that are missing are written; the temporary "unverified" flag is turned off.

**Architecture:** Seventeen units of about three pages each, grouped by the code they describe. A unit agent verifies or writes its pages and leaves a ledger fragment; a second agent reviews the unit's diff against the code; the controller commits it. A last task wires every page into the manifest, turns the flag off, and adds the two checks plan 1 left behind.

**Tech Stack:** Markdown under `docs/`; the manifest at `site/src/data/docs-manifest.mjs`; `node --test`; the site build (`cd site && npm run build`).

**Spec:** `docs/superpowers/specs/2026-10-10-site-docs-v2-design.md` — §3 (structure), §5 (this plan), §1 (audience).

**Written and started without the operator's review**, at their instruction to keep working overnight. Everything stays local and reviewable: one commit per unit, a ledger entry per page.

## Global Constraints

- Work only in the worktree `~/.cache/lf-worktrees/site-docs-v2`, branch `feat/site-docs-v2`. **Never push, never open a pull request.**
- The audience is people who already run an org-os instance (spec §1). A page answers "how does this work, what do I run, what does the file look like".
- **Another doc is never evidence.** A claim is confirmed by running the command or reading the code, on this branch.
- Commands that change state (`clone:framework`, `federate add`, `sync`, `setup`, anything that writes) run only against a scratch directory under `.superpowers/sdd/2026-10-10-site-docs-v2-content/scratch/<unit>/`, never against this repository or a sibling instance. Never use `/tmp`. Never `git stash`, `git clean`, `git reset --hard`.
- No file under `docs/` is moved or renamed. New pages are created directly under `docs/` in upper-case naming.
- Voice (`SOUL.md`): plain, direct, technically precise, no marketing. Say what a thing does; give the command; show the file.
- Honest scope stays wherever it applies: every instance today is run by the maintainer (single-operator dogfooding); the walkup "fork and answer an interview" setup path does not work for a newcomer (`docs/POSITIONING.md`, "Bootstrap status").
- People appear in public roles only. No private paths (`03 Libraries/…`, home directories), no links to a personal vault repository, no secrets, no content from sibling instances.
- Links between docs are written as relative file links (`[x](FEDERATION.md)`); the site rewrites them. A link to a file that is not tracked in this repository fails the build — link only to tracked files, or to `https://` addresses.
- Only `http`, `https` and `mailto` links are allowed besides relative ones.
- A unit agent does **not** run `npm run build` in `site/`, does **not** edit `site/`, and does **not** commit. It edits only the markdown files of its unit and writes its ledger fragment.

## Method — every unit

For each page of the unit:

1. **Read it whole.** List its checkable claims: commands, flags, file and directory names, field names, counts ("14 registries", "34 skills"), statuses (live · pilot · in-dev · planned), what a script is said to do, version numbers, URLs of this project.
2. **Check each claim against the code** on this branch: `ls`, `grep`, reading the script, `node <script> --help`, running a read-only command, running a test file. For a command that writes, run it in the unit's scratch directory, or read its source if running it is not practical.
3. **Settle the page's fate:**
   - **kept** — every claim holds; at most typos fixed;
   - **corrected** — the page stands; wrong claims fixed in place;
   - **rewritten** — more wrong or stale than right; written again from the code, keeping what was true and useful;
   - **merged** — its true content moved into another page of the unit, named in the ledger; the file is left in place, not on the site;
   - **dropped** — it describes something that does not exist, or is a plan or research note rather than documentation; the file is left in place, not on the site.
4. **Edit the markdown.** Remove a claim you could not verify, or keep it and mark it in the text ("not verified against the code"). Never leave an unverified claim standing unmarked. Cut what describes unbuilt things down to what exists, and say plainly what is not built. Fix or unlink dead links. Keep the page's leading `# Title` line (the site drops it and prints the manifest title).
5. **A new page** is written from the code, the tests and the package README. It opens with what the thing is in two or three sentences, its status in the modules vocabulary, and the commands an operator runs; then how it works; then the files it reads and writes. Then it goes through steps 1–4 like any other page.

Then write the unit's **ledger fragment** at `.superpowers/sdd/2026-10-10-site-docs-v2-content/ledger/<unit>.md`:

```markdown
# <unit id> — <unit name>
Checked at: <output of `git rev-parse HEAD` when you started>

## <path of page>
- Fate: kept | corrected | rewritten | merged into <path> | dropped | new
- Manifest: slug `<slug>` · title "<title>" · section <start|operate|knowledge|modules|reference|concepts> · summary "<one line, under 110 characters>" · covers `<code paths the page describes, comma-separated>`
  (omit this line for merged and dropped pages)
- Changed: <what you changed and why, as bullets>
- Checked: <the commands you ran or files you read for the main claims>
- Not verified: <claims you could not check, and what you did with each> — or "nothing"
```

Slugs already published must not change: `architecture`, `modules`, `agentic-architecture`, `federation`, `ecosystem`, `data-model`, `eip4824`, `package-lifecycle`, `operator-guide`, `adopt-with-an-agent`, `rad-org-os`, `setup`. A new slug is the lower-case, hyphenated topic (`commands`, `kms-planes`, `instance-doctor`).

Report back with the short status contract only; the detail lives in the ledger fragment.

## Units

`V` = verify an existing page · `N` = write a new page. Paths are from the repository root.

| Unit | Section | Pages | Code to check against |
|---|---|---|---|
| U01 | Start | V `docs/SETUP.md` · V `docs/SETUP-PATHS.md` · V `docs/ADOPT-WITH-AN-AGENT.md` | `scripts/clone-framework.mjs`, `scripts/setup*`, `package.json` scripts, `templates/`, `packages/instance-doctor`, `tests/clone-framework*` |
| U02 | Start | N `docs/OVERVIEW.md` (what org-os is; what an instance contains) · V `docs/TOOL-SETUP.md` · V `docs/HOST-INTEGRATION.md` (section: operate) | repo root files, `docs/POSITIONING.md` §1 as a source of wording only, `federation.yaml`, `data/`, `skills/`, `integrations/` |
| U03 | Operate | V `docs/OPERATOR-GUIDE.md` · V `docs/COMMANDS.md` | `package.json` scripts, `scripts/`, `skills/initialize`, `skills/commands`, `.claude/` commands if present |
| U04 | Operate | V `docs/PLANS.md` · V `docs/IDEA-HATCHING.md` · V `docs/RELIABILITY.md` | `docs/agent-plans/`, `data/ideas.yaml`, `scripts/` named in the pages, `skills/idea-scout`, `skills/heartbeat-monitor` |
| U05 | Operate | V `docs/VAULT-SAFETY.md` · V `docs/VAULT-SAFETY-CASE-STUDY.md` · V `docs/VERSIONING.md` · V `docs/migrations/v2-to-v3.md` · V `docs/migrations/v3-to-v3-5.md` | `scripts/vault-*`, `scripts/update-version.mjs`, `VERSION.md`, `CHANGELOG.md`, `package.json` |
| U06 | Operate | N `docs/INSTANCE-DOCTOR.md` | `packages/instance-doctor/` (README, src, tests), `npm run doctor` |
| U07 | Reference | V `docs/FILE-STRUCTURE.md` · V `docs/DATA-MODEL.md` | the repository tree, `data/*.yaml`, `schemas/`, `scripts/generate-all-schemas*`, `scripts/validate-*` |
| U08 | Reference | V `docs/FEDERATION.md` · V `docs/EIP4824-GUIDE.md` | `federation.yaml`, `.well-known/`, `scripts/generate-*schema*`, `packages/org-os-kms/src/federate.mjs`, `scripts/analyze-*` |
| U09 | Reference | V `docs/SKILL-SPECIFICATION.md` · V `docs/SKILL-PROMOTION.md` · V `docs/PACKAGES.md` · V `docs/PACKAGE-LIFECYCLE.md` | `skills/`, `SKILLS.md`, `data/skills-matrix*`, `data/packages-matrix*`, `packages/`, scripts named in the pages |
| U10 | Knowledge | N `docs/KMS.md` (the kms: overview) · N `docs/KMS-PLANES.md` (the two planes and the publication gate) · V `packages/org-os-kms/docs/CONNECTORS.md` | `packages/org-os-kms/` (README, `src/cli.mjs`, `src/planes/`, `src/gate.mjs`, `src/promote.mjs`, `src/connectors/`, `test/`) |
| U11 | Knowledge | N `docs/KMS-EXTENSION-PACKS.md` · N `docs/TERRITORY-PACK.md` (one page if they do not stand apart: say so in the ledger) | `packages/org-os-kms/src/extensions.mjs`, `packages/org-os-territory/`, `packages/toolkit-framework/` |
| U12 | Knowledge | N `docs/KMS-PUBLISHING.md` (standard.site and atproto) · N `docs/FEDERATION-MAP.md` | `packages/org-os-kms/src/atproto/`, `src/render*.mjs`, `src/map.mjs`, `src/frontier.mjs`, `packages/org-os-federation-map/` |
| U13 | Modules | V `docs/MODULES.md` · V `docs/RAD-ORG-OS.md` · N `docs/ADMIN-APP.md` | `modules/`, `packages/` named per module, `packages/admin/`, `site/src/data/modules.yaml` (read only) |
| U14 | Modules | V `docs/integrations/berd.md` · V `docs/integrations/buzz.md` · V `docs/integrations/paper.md` · V `docs/integrations/cloudflare-os.md` | `modules/org-os-berd`, `modules/org-os-buzz`, `modules/org-os-paper`, `packages/buzz-integration`, `packages/paper-integration`, `packages/cloudflare-os-integration` |
| U15 | Modules | V `docs/integrations/egregore.md` · V `docs/integrations/graphify.md` · V `docs/integrations/koi.md` · V `docs/integrations/opal.md` | `packages/egregore-core`, `packages/koi-bridge`, `packages/opal-bridge`, `packages/koi-opal-bridge`, `skills/knowledge-graph`, `integrations/` |
| U16 | Concepts | V `docs/ARCHITECTURE.md` · V `docs/AGENTIC-ARCHITECTURE.md` · V `docs/AGENT-MODES.md` | the repository as a whole; `AGENTS.md`, `SOUL.md`, `skills/`, `packages/` |
| U17 | Concepts | V `docs/PATTERNS.md` · V `docs/AUTORESEARCH.md` · V `docs/ECOSYSTEM.md` | the repository; for ECOSYSTEM, public `https://` addresses only (plan 1 unlinked its sibling-folder links; give each a real public address where one is known from the repository itself, else leave it as plain text) |

Notes for particular units:

- **U13.** If `docs/MODULES.md` changes a module's status or name, write the needed change to `site/src/data/modules.yaml` in the ledger (a test requires the two to agree); do not edit `site/`.
- **U01.** `SETUP.md` names a GitHub organisation; check it against `git remote -v` and `package.json`. `/get-started` on the site lands on this page, so it must work for a real operator.
- **U02.** OVERVIEW is short — a page a newcomer can read in three minutes and an operator can use as a map: what an instance contains (identity files, `data/`, `memory/`, `skills/`, `.well-known/`, `federation.yaml`), and where each is documented.
- **U10–U12.** Read the code first, then decide how many pages the material deserves; fewer, fuller pages are better than thin ones.

## Review — every unit

A second agent, which did not write the unit, gets the unit's diff (`git diff -- <the unit's files>`, plus new files) and its ledger fragment, and checks:

- every changed or new claim against the code (spot-check at least five per page, and every command line);
- that nothing unverifiable was left standing unmarked;
- the constraints above (voice, honest scope, no private paths, links to tracked files only);
- that the fate is right — a page marked "kept" really has no wrong claims.

Findings go back to the unit agent once; then the controller commits the unit: `docs(<area>): <unit name> — checked against the code`.

## Task 18 — Integration (after every unit is committed)

One agent, with the build:

1. **Manifest.** From the ledger fragments, give every kept, corrected, rewritten and new page an entry in `site/src/data/docs-manifest.mjs` (source, slug, title, section, order, summary, `verified` = the unit's "Checked at" commit, `covers`). Order within a section follows spec §3. Remove entries for merged and dropped pages — but the twelve published slugs must keep resolving: if one was merged or dropped, add a redirect for it in `site/src/data/redirects.mjs` to the page that replaced it, and extend the verifier's redirect check to cover it.
2. **Flag.** `ALLOW_UNVERIFIED = false`.
3. **Redirects and home.** `/about` → `/docs/overview`; the home page's intro link → `/docs/overview`.
4. **Fragment check.** In `site/scripts/verify-build.mjs`: an internal link with a `#fragment` must point at an `id` that exists in the built target page. Prove it with a break-and-restore run.
5. **Drift report.** `site/scripts/docs-drift.mjs` (spec §5.5): for each manifest page with `covers`, list the paths changed between its `verified` commit and `HEAD` (`git diff --name-only <verified>..HEAD -- <covers>`); print a report; always exit 0. Unit-test the pure part. Add it to `.github/workflows/validate.yml` as a non-blocking step after the site tests.
6. **Modules mirror.** Apply any `modules.yaml` change U13 recorded.
7. **Build until green:** `cd site && npm run build && npm test`. A dead link the build names is fixed in the doc (keep the text, drop or repair the link).
8. **Ledger.** Assemble the fragments into `docs/superpowers/specs/2026-10-10-site-docs-v2-ledger.md` (spec §5.1), one section per unit, with a summary table at the top: page · fate · slug.
9. Commit.

## Left for plan 3 (release)

Version surfaces to `0.5.1`; the `docs-feedback` label; the operator's by-eye pass; the pull request; merge with a merge commit; the tag; the live check.
