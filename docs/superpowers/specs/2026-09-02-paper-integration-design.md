# Paper × org-os Integration — Design Spec

**Date:** 2026-09-02
**Status:** design approved in dialogue (operator session 2026-09-02); awaiting written review, then `writing-plans`
**Paper:** https://paper.design — "the connected canvas for teams shipping with agents." A free-form design canvas whose every element is real HTML/CSS, so a design exports as code with no translation step. Web app (`app.paper.design`) + desktop app (`Paper.app`, todesktop build, `0.5.6` installed on the operator's Mac). Agent surface: **Paper MCP**, a local HTTP MCP server the desktop app starts when a file is open — `http://127.0.0.1:29979/mcp`, no auth, MCP protocol `2025-03-26`, SSE-framed replies, 36 tools observed live 2026-09-02 (the public docs page lists 24). Pricing: Free = 100 metered MCP tool calls/week; Pro = $20/editor/month, 1M/week. Docs: `/docs/mcp`, `/docs/tokens`, `/docs/paste`.
**Prototype instance:** `refi-dao-os` — the only instance with a canonical machine-layer brand (`data/brand.yaml` v2.0, revised 2026-09-02; spec `refi-dao-os/docs/specs/2026-09-02-brand-system-v2-design.md`).

## Goal

Give org-os agents a **human-editable design canvas** for on-brand artifacts. Today an agent asked for a ReFi DAO social card writes a self-contained HTML file (`docs/brand/eval/out/02-growfi-social-card.html`); a human who wants to nudge the headline or move the Orb has to edit CSS. Paper closes that gap: the agent drafts the composition onto a canvas from the org's brand tokens, the human refines it by hand in Paper, and PNG/SVG/JSX exports flow back into the repo.

The first step of that path — and the only part that must be deterministic — is getting the org's brand tokens *into* the Paper file so the agent never invents a colour. That is what the package does. Everything else is method (a skill) and record (docs, VERIFIED.md).

This resolves nothing in the interop surface matrix — Paper is a new row — and follows its principles: org-os stays the substrate, not the runtime; integrations are modules with honest maturity labels; the wrapper is one file deep.

## Decisions (locked)

| Question | Decision |
|---|---|
| Paper's job in org-os | **Agent design canvas.** Agents draft DESIGN.md compositions onto a Paper canvas from brand tokens; a human refines by hand; exports flow back. (Over: token-sync-only — proves the bridge but never tests Paper as a design surface; design-asset home / Figma successor — touches council-level sharing policy, and Paper ships no shared libraries yet.) |
| Shape | **Thin bridge + canvas skill** — module `org-os-paper`: `packages/paper-integration/` (client, doctor, push-tokens, lint-tokens, VERIFIED.md) + `skills/paper-design/` + `docs/integrations/paper.md`. Agents design via the MCP tools directly; the package wraps only health, token sync and token drift. (Over: skill-only — no doctor, no repeatable sync, no drift lint, nothing usable from Hermes/Berd, no contract with the live server; full design-ops lane — three unverified sub-systems on a 100-call budget.) |
| Plan / account | **Free tier, personal account.** 100 metered calls/week is a hard design constraint: doctor spends zero, push spends ≤3, one artifact ≤25. Protocol-level calls (`initialize`, `tools/list`) are free. |
| Prototype | **Tier-2 brief 02 — GrowFi onboarding social card** (`refi-dao-os/docs/brand/eval/02-growfi-social-card.md`). Fixed brief, existing HTML output to compare against, a social card is Paper's sweet spot. |
| Token direction | **One way: brand.yaml → Paper.** `data/brand.yaml` `tokens:` stays the source of truth. Paper-side token edits are drift; `lint-tokens` catches them. No flow back. |
| Token names | **Preserved verbatim** (`--refi-color-blue`), so `var(--refi-*)` on the canvas is byte-identical to brand.css usage and `get_jsx` output is a drop-in for the web side. |
| MCP registration | **Instance-level opt-in** via a committed `.mcp.json` (`type: http`). The framework repo has no brand to design and gets no `.mcp.json`. Hosts beyond Claude Code get a documented snippet, marked unverified. |
| Where scripts run | From org-os against a sibling instance via `--tokens <path>` (instance-doctor hub-mode precedent) — no instance can pull framework packages yet. |
| Session lifecycle | **Not a session lane.** No `/initialize` or `/close` hook. A dead Paper can never fail a session. |
| Version pin | Paper `0.5.6` / MCP `2025-03-26`, recorded in VERIFIED.md. Paper auto-updates; doctor warns on drift; the Buzz re-verification protocol applies on any bump. |

## Architecture

```
org-os (framework)                                refi-dao-os (first adopter)
─────────────────────────────────────────────     ──────────────────────────────────────────
modules/org-os-paper/module.yaml  integration      .mcp.json → paper: http 127.0.0.1:29979/mcp
packages/paper-integration/                        data/brand.yaml  tokens: (already canonical)
  lib/paper.mjs        JSON-RPC-over-HTTP client   .claude/skills/refi-dao-brand  + "Canvas" route
  scripts/doctor.mjs   free protocol calls only    TOOLS.md         Paper section (file id, budget)
  scripts/push-tokens.mjs  brand.yaml → tokens     .env             PAPER_FILE_ID (gitignored)
  scripts/lint-tokens.mjs  drift check             docs/brand/eval/out/02-…paper.png + report
  VERIFIED.md          contract with reality
skills/paper-design/SKILL.md   the agent method
docs/integrations/paper.md     runbook
docs/MODULES.md + site mirror  catalog entry
                                │
                                │ JSON-RPC 2.0 over HTTP (POST), SSE-framed replies
                                ▼
                 Paper Desktop  ·  http://127.0.0.1:29979/mcp  ·  36 tools
                 (tokens · artboards · write_html · export · comments)
```

**The rule: org-os never draws.** Agents design through Paper's MCP tools directly, following the skill. The package wraps only what must be deterministic and repeatable. Same partition as Buzz, where the wrapper never implements Nostr.

**Why a client at all, when the agent already has the tools.** Three reasons: (1) `doctor` must run without an MCP-capable client — from Hermes, Berd, CI, or a shell; (2) the token push must be idempotent, diffed and testable, not re-improvised each session at metered cost; (3) VERIFIED.md needs a surface to pin. The client speaks the MCP wire format directly (three methods: `initialize`, `tools/list`, `tools/call`) — no SDK dependency, ~100 lines.

## Components

### `packages/paper-integration/lib/paper.mjs`

`createClient({ url = process.env.PAPER_MCP_URL ?? "http://127.0.0.1:29979/mcp", fetch = globalThis.fetch })` returning:

- `initialize()` → `{ serverInfo: { name, version }, protocolVersion }`. Free.
- `listTools()` → `[{ name, inputSchema }]`. Free.
- `call(name, args)` → parsed `result` (content text auto-JSON-parsed when it parses). **Metered.** Increments `client.metered`.
- Replies arrive as `text/event-stream` (`event: message` / `data: {...}`) or plain JSON; the client accepts both.
- JSON-RPC errors → `PaperError { code, message, data }`; connection refused / timeout → `PaperError { code: "unreachable" }`; a quota refusal → `PaperError { code: "quota" }` once its shape is observed (VERIFIED.md row).
- Every script ends with one stderr line: `metered calls: N`.

`fetch` is injected so tests run against a fake server with no Paper and no network.

### `scripts/doctor.mjs` — `npm run paper:doctor`

Four checks, **zero metered calls**:

1. `initialize` succeeds and `serverInfo.name === "paper-desktop"`.
2. `serverInfo.version` equals the pin in VERIFIED.md → OK; newer → WARN (re-verify); older → WARN.
3. `tools/list` contains the five tools the package depends on: `get_tokens`, `create_tokens`, `set_tokens`, `export`, `write_html`.
4. A target file is configured: `--file <id>` or `PAPER_FILE_ID` in `.env`. (Whether that file is *open* is a metered question — `get_basic_info` — and is asked only with `--deep`.)

Exit 0 green, 2 not-ready, each failing check with a one-line fix ("open a file in Paper Desktop"; "set PAPER_FILE_ID"). Same contract as `buzz:doctor`.

### `scripts/push-tokens.mjs` — `npm run paper:push-tokens -- --tokens <brand.yaml> [--file <id>] [--canvas-width 1080] [--dry-run] [--prune]`

Reads `tokens:` (flat `name: cssValue`) and `stylesheet.prefix` from any brand.yaml-shaped file. Maps each to a Paper token (below). Then:

1. `get_tokens({ fileId })` — 1 call — the current Paper-side set.
2. Diff by full name: **new** → one `create_tokens` batch; **changed value** → one `set_tokens` batch; **unchanged** → nothing. Never creates a duplicate name (Paper allows duplicates, "discouraged").
3. `--prune` (opt-in) deletes Paper tokens that carry the org's prefix but are absent from brand.yaml. Never touches tokens outside the prefix.
4. `--dry-run` prints the plan (creates / sets / skips / conversions) and exits — **zero calls**.

Idempotent: a second run with nothing changed costs exactly one call and reports `0 created · 0 updated`. Every `fileId` is passed explicitly (see Error handling — sticky file).

### `scripts/lint-tokens.mjs` — `npm run paper:lint-tokens -- --tokens <brand.yaml> [--file <id>]`

One `get_tokens`, compare against the mapped plan, exit 1 listing **missing** (in brand.yaml, not in Paper), **changed** (value differs after normalisation), **extra** (prefix-carrying tokens in Paper not in brand.yaml — reported, not failing, unless `--strict`). The Paper-side twin of refi-dao-os's `lint:brand`.

### `skills/paper-design/SKILL.md`

The agent method. Framework-generic; the per-org class-to-inline table lives in the instance's brand skill.

- **When:** any request to produce an org artifact on a Paper canvas, or to pull a Paper design into the repo.
- **Preconditions:** `paper:doctor` green · tokens pushed (`paper:lint-tokens` passes) · `get_font_family_info` confirms the brand face is available (halt before `create_artboard` if not — a missing face means a broken design).
- **Method:** load the org's DESIGN.md → pick the composition → translate its class vocabulary into inline styles referencing `var(--<prefix>-*)` only → `create_artboard` → one visual group per `write_html` → screenshot at most three times per artifact → targeted `update_styles`/`set_text_content` fixes, never delete-and-restart → `find_nodes` colour audit → `export` → `finish_working_on_nodes`.
- **Review loop:** the human comments in Paper. The agent `list_comment_threads` (status open) → addresses each → `set_comment_thread_status: resolved`. Never resolves a thread it did not act on.
- **Export back:** `export` PNG at `2x` into the instance's designated output dir; `get_jsx` in its inline-styles format for the code-side twin (the exact `format` enum value is a VERIFIED.md row). Screenshots verify, exports ship — never build code from a screenshot.
- **Hard rules:** never call image generation (metered and off-brand); never write a literal colour — every colour is a `var()`; never load an external stylesheet (nothing indicates the canvas fetches one); the per-artifact budget is **25 metered calls** by default and the skill states the free-tier weekly cap plainly.
- **Paper's own guide vs. the budget:** Paper's guide wants a screenshot after every section and `write_html` for every ~15 lines. The skill keeps the small-writes discipline (the human watches the canvas build) and overrides the screenshot cadence to fit the budget.

### Instance-side hook (refi-dao-os)

`.claude/skills/refi-dao-brand/SKILL.md` gains a **Canvas (Paper)** route pointing at `paper-design`, and a class → inline-style table for the **social card** composition only (`.refi-page.refi-grain` ground, `.refi-orb` sphere, `.refi-heading-1`, `.refi-caption`, logomark placement). The other five compositions are filled in as they are exercised. `TOOLS.md` gains a Paper section (file id, endpoint, budget, install notes). `.mcp.json` registers the server.

### Catalog and pins (org-os)

- `modules/org-os-paper/module.yaml` — `type: integration`, `dependencies: [org-os-standards]`, identity `files:` mapping, `checks:` file-exists on `lib/paper.mjs` and `VERIFIED.md`.
- `docs/MODULES.md` entry + `site/src/data/modules.yaml` mirror row. Status `in-dev` until the prototype's acceptance criteria hold, then `pilot`.
- `docs/integrations/paper.md` — status, pin, what Paper is, the lane in one paragraph, operating (doctor / push / lint), registration per host, budget, what is NOT verified.
- `.env.example` — `PAPER_MCP_URL` (default shown), `PAPER_FILE_ID`.
- `data/skills-matrix.yaml` — `paper-design`, `owner: framework`, `promotion_status: evaluating`, `instances_using: [refi-dao-os]` once the prototype runs.
- `package.json` — `paper:doctor`, `paper:push-tokens`, `paper:lint-tokens`.

## Data flow — brand.yaml → Paper tokens

Paper has **ten token types** — `breakpoint · color · container · fontFamily · fontSize · fontWeight · letterSpacing · lineHeight · radius · spacing` — and constrains values: sizes are px strings, `fontWeight` is a number, colours are CSS colour strings, aliasing is `var(--other)`. brand.yaml uses rem throughout and one `clamp()`.

Type is inferred **by value first, family second**:

| brand.yaml family (refi-dao-os) | Paper type | conversion |
|---|---|---|
| any hex / rgb / rgba / hsl value — `color-*`, `bg-*`, `text`, `text-muted/subtle/inverted`, `border-*`, `series-*` | `color` | as-is |
| `text-xs` … `text-6xl` (rem) | `fontSize` | rem → px at 16 |
| `text-hero` (`clamp(3rem, 8vw, 6rem)`) | `fontSize` | evaluated at `--canvas-width` (default 1080 → 86px), **flagged** |
| `space-*` | `spacing` | rem → px |
| `radius-*` | `radius` | to px; `9999px` kept |
| `weight-*` | `fontWeight` | string → number |
| `font-sans`, `font-display`, `font-mono` | `fontFamily` | **first family of the stack**; full stack in the token `description` |
| `glow-*`, `glass-blur`, `glass-shadow` | — | **skipped and listed** — Paper has no shadow or blur token type |

Every conversion is written into the token's `description` (e.g. `from 0.875rem · brand.yaml text-base`) so a designer sees provenance in Paper's Theme panel. Names are `--<prefix><name>` — `--refi-color-blue` — matching Paper's `^--[a-zA-Z0-9_-]+$`.

Whether Paper accepts a full font stack as a `fontFamily` value, and whether it accepts rem at all, are the kind of documented-default guesses VERIFIED.md exists to replace. The design assumes first-family-only and px-only until the prototype observes otherwise.

The mapper is a **pure function** `planTokens(brandYaml, { canvasWidth }) → { tokens: [{type,name,value,description}], skipped: [{name, reason}], converted: [{name, from, to}] }`, tested table-driven against a fixture copied from refi-dao-os brand.yaml.

## Prototype protocol — brief 02 on the canvas (refi-dao-os)

**Prerequisites (zero metered calls):**

- **Switzer installed locally.** Paper resolves fonts from the machine or Google Fonts; Switzer is on neither by default, and is not installed on the operator's Mac (checked 2026-09-02). Download from Fontshare into `~/Library/Fonts`. The ITF Free Font License permits use and forbids redistributing the files — **nothing font-related is committed.** The install script asks before running.
- **A target file.** The operator creates or opens a file in Paper Desktop ("ReFi DAO — Brand canvas"); its id goes into refi-dao-os `.env` as `PAPER_FILE_ID`. Fallback: one `create_file` call.
- **Registration.** `.mcp.json` committed in refi-dao-os. The building session drives Paper through the package client over HTTP — same tools, same metering — so no client restart is needed.
- **The real logomark.** `repos/repos/ReFi-DAO-Website/site/assets/ReFi_Logomark.svg` exists locally (brand.yaml `logos[logomark].web_export`). The card carries it inline — the HTML eval had to hand-build a stand-in because the published system reaches no asset (Tier-2 finding #1).

**Steps and budget:**

| step | metered calls |
|---|---|
| `paper:doctor` | 0 |
| `paper:push-tokens --dry-run`, review, then the real push | 2–3 |
| `paper:lint-tokens` — proves the round trip | 1 |
| `get_basic_info` · `get_font_family_info(["Switzer"])` · `create_artboard` 1080×1350 | 3 |
| `write_html`, one group each: ground glow · grain layer (inline SVG `feTurbulence`) · Orb (conic gradient + noise overlay) · inline logomark SVG · heading · caption | 6–8 |
| two `get_screenshot`, up to two targeted `update_styles` | 4 |
| `find_nodes` colour audit · `export` PNG 2x · `get_jsx` inline · `finish_working_on_nodes` | 4 |
| **ceiling** | **30** |

**Outputs** → `refi-dao-os/docs/brand/eval/out/`: `02-growfi-social-card.paper.png` (the export), `02-growfi-social-card.paper.html` (the inline-style JSX wrapped so it opens in a browser), `PAPER-PROTOTYPE-2026-09-02.md` (calls used, what worked, gaps found, the verdicts it needs from the operator — same shape as `VERDICTS.md`).

**Acceptance → `pilot`** (all must hold):

1. `paper:doctor` green.
2. A second `paper:push-tokens` costs 1 call and reports 0 created · 0 updated.
3. `paper:lint-tokens` passes after push and **fails** after one token is edited by hand in Paper (then restored).
4. The `find_nodes` audit finds zero colours that do not resolve to a `--refi-*` token.
5. The export shows visible grain — not flat Space (DESIGN.md §6: "Flat Space is wrong Space").
6. The card passes the brief's *Must* / *Must not* lists and DESIGN.md's rejection patterns at operator review.
7. Total metered calls for the whole prototype ≤ 30, recorded in the report.

**→ `live`:** the operator hand-refines the card in Paper and leaves at least one comment thread; a later session lists it, addresses it, resolves it.

## Config

Repo-root `.env` (gitignored; placeholders in `.env.example`):

- `PAPER_MCP_URL` — default `http://127.0.0.1:29979/mcp`; only set to override.
- `PAPER_FILE_ID` — the target Paper file (bare id, `/file/<id>` path, or full URL — Paper accepts all three). Recorded per instance in `TOOLS.md`; not a secret, but per-operator, so it lives in `.env` not in a tracked file.

No credentials exist in this integration: the MCP server is unauthenticated and bound to loopback.

`.mcp.json` (instance root, committed):

```json
{ "mcpServers": { "paper": { "type": "http", "url": "http://127.0.0.1:29979/mcp" } } }
```

## Error handling

- **Paper not running / port closed.** Doctor exits 2: *open a file in Paper Desktop.* Push and lint exit 2 the same way — never a stack trace.
- **Not a session lane.** Nothing in `/initialize` or `/close` depends on Paper; there is nothing to fail open *from*.
- **Sticky-file trap.** Paper routes calls that omit `fileId` to the most recently opened file *in the session*. Each script is a fresh process, so every call passes `fileId` explicitly. Multiple open files stay safe; parallel agents stay safe.
- **Duplicates.** Push diffs first and updates existing names with `set_tokens`; it never creates a second `--refi-color-blue`. Prune is opt-in and prefix-scoped.
- **Unsupported and converted tokens.** Skips are listed in the output, never silent (the Buzz rule: never advance past what you couldn't parse). Conversions are recorded in the token description.
- **Quota exhausted.** The client maps the server's refusal to `PaperError { code: "quota" }` and the script prints the weekly cap. The exact error shape is unobserved; the first sighting becomes a VERIFIED.md row.
- **Version drift.** Paper auto-updates. Doctor warns when the running version ≠ pin. On any bump: re-observe `tools/list` and the token value rules first, update VERIFIED.md, then reconcile the client and tests — never the other way round.
- **Font missing.** The skill halts before `create_artboard`. Doctor does not check fonts because that check is metered.
- **Free-tier budget blown mid-artifact.** The skill's budget line is a stop, not a hint: at 25 calls the agent exports what exists, releases working indicators, and reports — it does not "finish quickly".

## Testing

**Unit tests** — `tests/paper-integration/*.test.mjs`, node:test, picked up by the existing `npm test` glob. A fake `fetch` stands in for the server:

- `paper-lib.test.mjs` — SSE and plain-JSON reply parsing; JSON-RPC error → `PaperError`; unreachable → `code: "unreachable"`; metered counter counts `tools/call` only.
- `paper-plan-tokens.test.mjs` — the pure mapper against `tests/fixtures/paper/brand.refi-dao.yaml` (copied from refi-dao-os): every family lands in the right type; rem→px; clamp at width; weight → number; font stack → first family + description; glow/glass skipped with reasons; names prefixed and pattern-valid.
- `paper-push-tokens.test.mjs` — diff into create / set / no-op; `--dry-run` makes zero `tools/call`; second run is 1 call; `--prune` deletes only prefix-carrying extras; `fileId` present on every call.
- `paper-doctor.test.mjs` — exit codes for unreachable / wrong server name / version drift / missing tool / no file id.
- `paper-lint-tokens.test.mjs` — passes on match; fails on missing and on changed; extras reported, failing only with `--strict`.

Scripts are exercised via `spawnSync`, like the Buzz tests.

**Existing gates stay green** — `tests/scripts/module-manifests.test.mjs` (new manifest), `site/test/modules-catalog.test.mjs` (new mirror row), `npm run validate:structure`, `npm run selftest`; in refi-dao-os `npm run lint:brand` (brand.yaml is only read).

**VERIFIED.md** — the contract with reality, one dated row per observed fact: server name/version; protocol version; SSE framing; tool count and the five pinned names; whether `create_tokens` accepts a full font stack; whether it accepts rem; response shapes of `create_tokens`, `set_tokens`, `get_tokens` (json), `export` (base64? path?); whether inline SVG `feTurbulence` renders on the canvas; the quota error shape if seen. The working rule is Buzz's: the client changes **only** to match a re-verified row — never to track documentation, never speculatively.

## Sequencing

1. **Package + tests** (org-os): client, mapper, doctor, push, lint — TDD, fake server. Module manifest, package.json scripts, `.env.example`.
2. **Live verification** against Paper 0.5.6: doctor → dry-run → push against refi-dao-os brand.yaml → lint. Fill VERIFIED.md. Reconcile client to observations.
3. **Skill + docs** (org-os): `skills/paper-design/SKILL.md`, `docs/integrations/paper.md`, MODULES.md + mirror (`in-dev`), skills-matrix.
4. **Instance wiring** (refi-dao-os): `.mcp.json`, TOOLS.md, `.env`, refi-dao-brand Canvas route + social-card table. Switzer install (asks first).
5. **Prototype**: brief 02 on the canvas under the budget; outputs + report to `docs/brand/eval/out/`.
6. **Acceptance + status flip**: criteria 1–7 → `pilot` in MODULES.md, mirror, integrations doc; DECISIONS.md entries in both repos; memory.

Steps 1–3 land on org-os branch `luizfernando`; steps 4–6 land in refi-dao-os on its current branch, staging **only the paths this work creates** — the instance's working tree carries another session's uncommitted edits, which stay untouched.

## Out of scope (named so nobody infers them)

- Export-on-`/close` or any session hook.
- A design-assets registry replacing or extending `figma-assets.yaml`.
- Paper comment threads mirrored into HEARTBEAT tasks.
- Hermes / Berd / opencode MCP wiring beyond a documented, unverified snippet.
- Any flow of tokens from Paper back into brand.yaml.
- A framework-level `data/brand.yaml` template. refi-dao-os is the first instance with one; a second adopter is the trigger to generalise the shape into the data model.
- Shared token libraries across Paper files (Paper: "we're working on libraries") and theme modes for Cloud/Space (Paper roadmap, not shipped). Cloud-mode tokens are pushed as separate `*-cloud` names, exactly as brand.yaml already carries them.

## Constraints honored

- **Metered budget** — every script prints its cost; doctor is free; the skill carries a hard per-artifact stop.
- **No credentials** — loopback, unauthenticated; `.env` holds a file id, not a secret.
- **Licence** — Switzer files are installed locally, never committed or redistributed (ITF FFL; refi-dao-os `PROVENANCE.md` row "Switzer — licence").
- **Vault safety** — refi-dao-os commits stage explicit paths only; no stash, clean, or reset; the pre-existing dirty tree (including a deleted governance onboarding doc) is another session's and is left alone.
- **Framework thinking** — the package reads *any* brand.yaml-shaped token map with a prefix; nothing in it knows the ReFi palette. The per-org class table lives in the instance.
