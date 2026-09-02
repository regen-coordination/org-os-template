# paper-integration — VERIFIED

**Status:** VERIFIED (2026-09-02) — every Paper-facing behaviour in `lib/paper.mjs` and `lib/tokens.mjs`
mirrors a row below, observed against a live Paper Desktop. The working rule (inherited from the Buzz
lane): this file changes **only** to record a new observation, and the code changes **only** to match a
row here — never to track documentation, never speculatively.

Observed by: `npm run paper:doctor` · `paper:push-tokens` · `paper:lint-tokens` · `paper:call` against
file `01M1HBY7KM0GVK88D5MMC54Y7D` ("ReFi DAO — Brand canvas"), pushing the 75 planned tokens from
`refi-dao-os/data/brand.yaml` v2.0. **Total metered cost of this verification: 15 calls.**

## Pin

| what            | value                                                                                                                                     | observed                                |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Paper Desktop   | `0.5.6` (bundle `com.todesktop.2601167vjw8xe`)                                                                                            | 2026-09-02, `initialize` → `serverInfo` |
| MCP server name | `paper-desktop`                                                                                                                           | 2026-09-02                              |
| MCP protocol    | `2025-03-26`                                                                                                                              | 2026-09-02                              |
| Endpoint        | `http://127.0.0.1:29979/mcp`, POST, `Accept: application/json, text/event-stream`                                                         | 2026-09-02                              |
| Reply framing   | `text/event-stream`, one `event: message` + `data: <envelope>`                                                                            | 2026-09-02                              |
| Auth            | none (loopback)                                                                                                                           | 2026-09-02                              |
| Tools           | **34** — full list below. (The public docs page lists 24; an earlier draft of our spec claimed 36, which was an estimate, never a count.) | 2026-09-02                              |

## Observed facts

| #   | fact                                                                                                                       | verdict                                                                                                                                                                                                                                                                                                                                                                                                                 | how                         |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| 1   | `GET /mcp` → 404; only POST JSON-RPC is served                                                                             | ✅                                                                                                                                                                                                                                                                                                                                                                                                                      | curl                        |
| 2   | `initialize` and `tools/list` do not count toward the metered weekly quota                                                 | ⚠️ **inferred, not measured** — from Paper's pricing wording ("MCP tool calls") and `/docs/mcp`. No tool reports quota usage, so it cannot be confirmed from here                                                                                                                                                                                                                                                       | pricing page                |
| 3   | `create_tokens` accepts a batch of **75** in one call                                                                      | ✅ all 75 created in a single call                                                                                                                                                                                                                                                                                                                                                                                      | push #1                     |
| 4   | `fontFamily` value: a single family name is accepted (`"Switzer"`)                                                         | ✅ round-trips                                                                                                                                                                                                                                                                                                                                                                                                          | push + `get_tokens`         |
| 5   | `fontWeight` value: a number is accepted (`600`)                                                                           | ✅ round-trips                                                                                                                                                                                                                                                                                                                                                                                                          | push + `get_tokens`         |
| 6   | size values as px strings are accepted                                                                                     | ✅ — every `spacing`, `radius`, `fontSize` token round-trips exactly. rem was never sent (the planner converts first), so rem's acceptance is **untested**                                                                                                                                                                                                                                                              | push + lint                 |
| 7   | `get_tokens` json reply shape                                                                                              | ✅ `content[0].text` is JSON: `{ "contentHash": { "tokens": "<hash>" }, "tokens": [ { name, type, value, description }, … ] }`. `extractTokens`' `{tokens:[…]}` branch handles it                                                                                                                                                                                                                                       | raw `paper:call get_tokens` |
| 8   | **colour values do NOT round-trip verbatim**                                                                               | ❌ **Paper canonicalises legacy `rgba()` into modern CSS syntax.** `rgba(255,255,255,0.03)` → `rgb(255 255 255 / 3%)`; `rgba(17,24,29,0.9)` → `rgb(17 24 29 / 90%)`; `rgba(113,227,186,0.5)` → `rgb(113 227 186 / 50%)`. **Hex is untouched** (`#F1F0FF` verbatim). Exactly the 7 rgba-valued tokens were affected: `bg-surface`, `bg-elevated`, `text-muted`, `text-subtle`, `border`, `border-hover`, `border-active` | push #2 + lint              |
| 9   | `description` round-trips intact                                                                                           | ✅ `"brand.yaml color-cloud"` returned verbatim                                                                                                                                                                                                                                                                                                                                                                         | `get_tokens`                |
| 10  | `set_tokens` `{name, value}` updates an existing token                                                                     | ✅                                                                                                                                                                                                                                                                                                                                                                                                                      | perturb + restore           |
| 11  | a token changed in Paper is visible to the next `get_tokens` immediately                                                   | ✅ no cache lag observed                                                                                                                                                                                                                                                                                                                                                                                                | perturb → lint              |
| 12  | quota-exceeded error shape                                                                                                 | not observed (nowhere near 100 calls)                                                                                                                                                                                                                                                                                                                                                                                   | —                           |
| 12b | does a **rejected** tool call still count against the quota?                                                               | **unmeasurable from here** — none of the 34 tools reports usage and there is no readable counter. Structural answer adopted instead: a call that reached the server and returned a response is counted, which errs conservative. See row 14                                                                                                                                                                             | —                           |
| 13  | `export` reply shape                                                                                                       | pending — Task 10                                                                                                                                                                                                                                                                                                                                                                                                       | —                           |
| 14  | **tool errors arrive as `{content:[…], isError:true}` inside a _successful_ JSON-RPC envelope**, not as a JSON-RPC `error` | ✅ observed twice (bad `fileId`; see also row 15). Consequences: the metered counter correctly counts them, since a response did come back; and any caller that keys off the JSON-RPC `error` field alone will read a failure as a success                                                                                                                                                                              | failed `create_file`        |
| 15  | `create_file` takes **no** `fileId` and rejects one                                                                        | ✅ `Invalid fileId "placeholder"`. `scripts/call.mjs` always injects `fileId`, so it **cannot** invoke `create_file`, `list_files`, or any other file-less tool. Use `lib/paper.mjs` directly for those                                                                                                                                                                                                                 | first create attempt        |
| 16  | inline `<svg>` with `<filter><feTurbulence>` renders on the canvas                                                         | pending — Task 10                                                                                                                                                                                                                                                                                                                                                                                                       | —                           |
| 17  | `write_html` accepts `<img src="data:image/svg+xml;base64,…">`                                                             | pending — Task 10                                                                                                                                                                                                                                                                                                                                                                                                       | —                           |
| 18  | `get_jsx` `format` enum is `"tailwind"` \| `"inline-styles"`                                                               | ✅ from the live `tools/list` schema                                                                                                                                                                                                                                                                                                                                                                                    | `tools/list`                |

## Verified round trip (the acceptance evidence)

| step                                                     | result                                                                                                         | metered |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------- |
| `paper:doctor`                                           | 4/4 green, target file recognised                                                                              | 0       |
| `paper:push-tokens --dry-run`                            | `plan: 75 tokens · 4 skipped · 31 converted`                                                                   | 0       |
| push #1                                                  | `created: 75` in one batch                                                                                     | 2       |
| push #2 (before the row-8 fix)                           | ❌ `updated: 7` — not idempotent                                                                               | 2       |
| push #3 (after the fix)                                  | ✅ `created: 0 · updated: 0 · pruned: 0`, `unchanged: 75`                                                      | 1       |
| `paper:lint-tokens`                                      | ✅ `paper tokens: in sync (75 checked)`, exit 0                                                                | 1       |
| perturb `--refi-color-blue` → `#FF0000` via `set_tokens` | (simulates a hand edit in the Theme tab)                                                                       | 1       |
| `paper:lint-tokens`                                      | ✅ `changed: --refi-color-blue paper=#FF0000 brand=#4571E1`, `DRIFT — 0 missing · 1 changed · 0 extra`, exit 1 | 1       |
| push (restore)                                           | ✅ `updated: 1`, `unchanged: 74`                                                                               | 2       |
| `paper:lint-tokens`                                      | ✅ back `in sync (75 checked)`, exit 0                                                                         | 1       |

## Tool list (34, sorted)

```
create_artboard  create_file  create_page  create_tokens  delete_nodes
duplicate_nodes  export  export_combined_pdf  find_nodes  finish_working_on_nodes
get_basic_info  get_children  get_comment_thread  get_computed_styles  get_fill_image
get_font_family_info  get_guide  get_jsx  get_node_info  get_screenshot
get_selection  get_tokens  get_tree_summary  list_comment_thread_authors
list_comment_threads  list_files  move_nodes  open_file  rename_nodes
set_comment_thread_status  set_text_content  set_tokens  update_styles  write_html
```

## Reconciliation log

- **2026-09-02 — row 8, the one that mattered.** `normalizeValue` in `lib/tokens.mjs` compared colour
  strings after lowercasing and stripping whitespace, which cannot equate `rgba(255,255,255,0.03)` with
  `rgb(255 255 255 / 3%)`. Live push #2 exposed it: 7 tokens rewritten on every run (2 metered calls
  instead of 1, permanently) and `lint` reporting false drift with exit 1 forever — a check that always
  fails is a check an operator stops reading. Fixed by canonicalising `rgb()`/`rgba()` in either
  separator style, with decimal or percentage alpha, before comparison (`f972a1c`). Scope held to
  rgb/rgba: `hsl`/`oklch` are **not** canonicalised, because Paper has not been observed rewriting them
  and lint will surface any such drift loudly rather than hide it. No unit test could have caught this —
  nothing in the repo knew Paper's normalisation until the live push.
- **2026-09-02 — row 14/15, recorded not yet fixed.** `scripts/call.mjs` exits **0** on a tool error,
  because Paper reports tool failures inside a successful envelope. Tracked as a fix before Task 10,
  which drives the canvas through that script.
- **2026-09-02 — pin.** The tool count in the design spec (36) was an estimate. Measured twice
  independently: 34.

## Re-verification protocol

`paper:doctor` warns when the running Paper version differs from the pin. On any Paper Desktop update:
re-run the round-trip table above **first**, update the Pin and any changed rows, and only then
reconcile `PIN`, `REQUIRED_TOOLS`, `extractTokens`, `normalizeValue` and their tests to what you saw.
Never the other way round.
