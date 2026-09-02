# Paper Integration — Design Canvas

**Status:** module #5 `org-os-paper`, catalogued **in-dev** — package and tests ship; the token round trip is verified live end-to-end against a real Paper file, 15 metered calls total ([`packages/paper-integration/VERIFIED.md`](../../packages/paper-integration/VERIFIED.md)); the refi-dao-os prototype — actually drawing a composition on the canvas, not just moving tokens — is the remaining gate to `pilot`
**Spec:** [`docs/superpowers/specs/2026-09-02-paper-integration-design.md`](../superpowers/specs/2026-09-02-paper-integration-design.md) · plan [`2026-09-02-paper-integration.md`](../superpowers/plans/2026-09-02-paper-integration.md)
**Pin:** Paper Desktop `0.5.6` · MCP `2025-03-26` · `http://127.0.0.1:29979/mcp` (loopback, no auth, started by the app when a file is open) · 34 tools

## What Paper is

[Paper](https://paper.design) is "the connected canvas for teams shipping with agents": a free-form design canvas (web + desktop) whose every element is real HTML/CSS, so a design exports as code with no translation step. Its agent surface is **Paper MCP** — read tools (`get_basic_info`, `get_tree_summary`, `get_screenshot`, `get_jsx`, `get_computed_styles`, `find_nodes`…), write tools (`create_artboard`, `write_html`, `update_styles`, `set_text_content`, `move_nodes`, `duplicate_nodes`, `delete_nodes`), file-level **design tokens** (`get_tokens` / `create_tokens` / `set_tokens`, ten types, `var()` aliasing), `export` (png/jpg/svg/webp/avif/pdf/mp4), and comment threads — **34 tools observed live** (the public docs page lists 24; an earlier draft of the design spec estimated 36, which was never a count). Free tier: **100 metered tool calls/week**; Pro $20/editor/month for 1M. No shared token libraries and no theme modes yet (both on Paper's roadmap).

## The lane in one paragraph

An org's `data/brand.yaml` `tokens:` are the source of truth. `npm run paper:push-tokens` mirrors them into a Paper file as design tokens — names verbatim (`--refi-color-blue`), rem→px, one way, diffed and idempotent (a no-change run costs one call). `npm run paper:lint-tokens` catches drift the way the instance's `lint:brand` does. With the tokens in place, an agent following [`skills/paper-design/SKILL.md`](../../skills/paper-design/SKILL.md) drafts a DESIGN.md composition onto an artboard using only `var(--…)` colours, a human refines it by hand in Paper, and PNG/JSX exports flow back into the repo. **org-os never draws** — the package wraps only health, token sync and drift; everything visual goes through Paper's own tools. Paper is **not a session lane**: nothing in `/initialize` or `/close` depends on it.

## Verified live (2026-09-02)

The token round trip has been run end to end against a real Paper file — `01M1HBY7KM0GVK88D5MMC54Y7D`, "ReFi DAO — Brand canvas" — pushing the 75 planned tokens from `refi-dao-os/data/brand.yaml` v2.0:

| step                           | result                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------- |
| `paper:doctor`                 | 4/4 green, target file recognised — 0 calls                                   |
| push #1                        | 75 tokens created in one batch — 2 calls                                      |
| push #2 (before the row-8 fix) | not idempotent: 7 tokens rewritten every run — 2 calls                        |
| push #3 (after the fix)        | `created: 0 · updated: 0 · pruned: 0 · unchanged: 75` — 1 call                |
| `paper:lint-tokens`            | `in sync (75 checked)`, exit 0 — 1 call                                       |
| perturb `--refi-color-blue`    | simulate a hand edit via `set_tokens` — 1 call                                |
| `paper:lint-tokens`            | `DRIFT — 0 missing · 1 changed · 0 extra`, both values shown, exit 1 — 1 call |
| push (restore)                 | `updated: 1 · unchanged: 74` — 2 calls                                        |
| `paper:lint-tokens`            | back `in sync (75 checked)`, exit 0 — 1 call                                  |

**Total metered cost of that verification: 15 calls.** Full detail, including the exact tool list and every observed fact, lives in [`packages/paper-integration/VERIFIED.md`](../../packages/paper-integration/VERIFIED.md) — the module stays `in-dev` because that round trip proves the token lane, not the drawing lane (Task 10's prototype).

## Operating

### Verbs (run from the framework repo; `--tokens` points at the instance)

- `npm run paper:doctor [-- --file <id>]` — four checks, **zero metered calls**: server answers and is `paper-desktop`; version vs pin (warns on drift); the five required tools present; a target file configured. Exit 0 ready, 2 not.
- `npm run paper:push-tokens -- --tokens ../<instance>/data/brand.yaml [--dry-run] [--prune] [--canvas-width 1080]` — `--dry-run` prints the plan for free; a real run is `get_tokens` + `create_tokens` (new) + `set_tokens` (changed) ≤ 3 calls. `--prune` deletes Paper tokens carrying the org's prefix that brand.yaml no longer has — opt-in, never touches other prefixes.
- `npm run paper:lint-tokens -- --tokens ../<instance>/data/brand.yaml [--strict]` — one call; exit 1 on missing/changed; extras reported, failing only with `--strict`.
- `npm run paper:call -- <tool> ['<json>'] [--args-file p] [--out p]` — generic passthrough for agents in a shell (`--out` saves base64 image content, e.g. screenshots). Two behaviors worth knowing before you hit them live:
  - **Always injects `fileId`.** It therefore **cannot invoke `create_file`, `list_files`, or any other file-less tool** — the first live attempt to call `create_file` through it cost a metered call just to learn that Paper rejects the injected `fileId` (`Invalid fileId "placeholder"`, VERIFIED.md row 15). Reach for `lib/paper.mjs` directly for those tools.
  - **Exits 1 on a rejected tool call.** Paper reports a tool failure as a _successful_ JSON-RPC envelope carrying `isError: true`, not as a JSON-RPC error (VERIFIED.md row 14) — `call.mjs` checks `result.isError` itself and exits 1 so a script driving the canvas one element at a time doesn't read a rejection as success.

### Config

`.env` (gitignored; placeholders in `.env.example`): `PAPER_MCP_URL` (default `http://127.0.0.1:29979/mcp`) and `PAPER_FILE_ID` (bare id, `/file/<id>`, or full URL). Resolution order: `--file` flag → process env → framework `.env` → the instance `.env` beside the `--tokens` file (`<instance>/.env`). No credential exists in this integration.

### Registration (per instance, opt-in)

Claude Code — commit `.mcp.json` at the instance root:

```json
{
  "mcpServers": {
    "paper": { "type": "http", "url": "http://127.0.0.1:29979/mcp" }
  }
}
```

Other hosts (documented by Paper, **unverified here**): Cursor `/add-plugin paper-desktop`; Claude Desktop via `npx mcp-remote http://127.0.0.1:29979/mcp`; Copilot `.vscode/mcp.json` `{"servers":{"paper":{"type":"http","url":"…"}}}`; OpenCode `{"mcp":{"paper":{"type":"remote","url":"…","enabled":true}}}`. Hermes and Berd: no wiring yet — the scripts above work from any shell regardless.

### Token mapping (what `push-tokens` does)

Type by value first, family second: any colour value → `color`; `font-*` → `fontFamily` (first family of the stack, full stack in the token description); `weight-*` → `fontWeight` (number); `space-*` → `spacing`, `radius-*` → `radius`, `text-*` → `fontSize` (rem→px at 16; `clamp()` evaluated at `--canvas-width`, flagged). `glow-*`, `glass-*` are **skipped and listed** — Paper has no shadow/blur token type. Every conversion is written into the token's description so it shows in Paper's Theme panel.

**Colour values do not round-trip verbatim.** Paper canonicalises legacy `rgba()` syntax into modern CSS on write: `rgba(255,255,255,0.03)` reads back as `rgb(255 255 255 / 3%)` (hex values, e.g. `#F1F0FF`, are untouched). The first live push exposed this the expensive way — 7 rgba-valued tokens were rewritten on every run (2 metered calls instead of 1, permanently) and `lint` reported false drift forever, exit 1 on a file that was actually in sync. The fix canonicalises `rgb()`/`rgba()` in either separator style, decimal or percentage alpha, before comparing (scoped to rgb/rgba only — `hsl`/`oklch` are not canonicalised, since Paper hasn't been observed rewriting them; drift there would surface loudly instead of being silently hidden). See VERIFIED.md's reconciliation log for the full account — it's the kind of thing worth reading once so it isn't rediscovered.

### Fonts

Paper resolves fonts from the machine and Google Fonts. A brand face that is on neither must be installed locally before designing; the skill checks with `get_font_family_info` and halts otherwise. Font files are never committed.

### The contract: VERIFIED.md

[`packages/paper-integration/VERIFIED.md`](../../packages/paper-integration/VERIFIED.md) is the lane's contract with reality: every Paper-facing behaviour in `lib/paper.mjs` and `lib/tokens.mjs` (`PIN`, `REQUIRED_TOOLS`, `extractTokens`, `normalizeValue`, exit codes) mirrors a row observed there against a live Paper Desktop. The working rule, inherited from the Buzz lane:

1. VERIFIED.md changes **only** to record a new observation; the code changes **only** to match a row there — never to track documentation, never speculatively.
2. `paper:doctor` warns when the running Paper version differs from the pin. On any bump: re-run the round-trip table in VERIFIED.md first, update the Pin and any changed rows, and only then reconcile `PIN`, `REQUIRED_TOOLS`, `extractTokens`, `normalizeValue` and their tests to what was observed — never the other way round.
3. `modules/org-os-paper/module.yaml` asserts VERIFIED.md exists via a `file-exists` check — do not delete or rename it.

## What is NOT verified

- **The refi-dao-os prototype (Task 10)** — actually drawing a DESIGN.md composition on the canvas, not just moving tokens. This is the remaining gate to `pilot`. VERIFIED.md rows 13 (`export` reply shape), 16 (inline `<svg>`/`<filter><feTurbulence>` rendering on the canvas), and 17 (`write_html` accepting a base64 data-URI `<img>`) are observed there, not before.
- **The quota-exceeded error shape** (VERIFIED.md row 12) — nowhere near 100 calls has been spent yet.
- **Whether a rejected tool call is still billed against the quota** (VERIFIED.md row 12b) — genuinely unmeasurable from here: none of the 34 tools reports usage and there is no readable counter. The client adopts the conservative structural answer instead (a call that reached the server and returned any response, success or error, counts) rather than assert a fact nobody has observed.
- **Whether `initialize`/`tools/list` are truly unmetered** (VERIFIED.md row 2) — inferred from Paper's pricing wording ("MCP tool calls") and its docs page, not measured, for the same reason: no tool reports quota usage.
- **Any host other than Claude Code and the shell scripts.** The Cursor/Claude Desktop/Copilot/OpenCode registration snippets above are transcribed from Paper's own docs, never exercised here.
- **The human review loop** (comment threads) — designed in `skills/paper-design/SKILL.md`, unexercised until an operator leaves the first comment on a real artboard.

## Re-verification note

`paper:doctor` warns when the running Paper version differs from the pin. On any bump, follow VERIFIED.md → Re-verification protocol before trusting `push`/`lint`.
