---
name: paper-design
version: 0.1.0
description: Design an org's DESIGN.md compositions on a Paper canvas from its brand tokens, under a metered-call budget; pull Paper designs back into the repo as PNG/SVG/JSX. Use when asked to draft, refine or export a visual artifact (social card, poster, deck slide, page mock) in Paper.
author: organizational-os
category: operations
triggers:
  - "design this in Paper"
  - "put it on the canvas"
  - "export from Paper"
  - "social card in Paper"
  - "paper canvas"
inputs:
  - the org's DESIGN.md (or equivalent visual system) and the composition to build
  - brand tokens already pushed (npm run paper:lint-tokens passes)
  - PAPER_FILE_ID (instance .env) — the target Paper file
outputs:
  - artboard(s) in the Paper file, working indicators released
  - PNG export (2x) and inline-styles JSX in the instance's designated output directory
  - a metered-call count for the session
dependencies:
  - frontend-design
tier: core
metadata:
  openclaw:
    requires:
      env: [PAPER_FILE_ID]
      bins: [node]
      config: [.mcp.json]
---

# Paper Design

Paper (https://paper.design) is a canvas whose every element is real HTML/CSS. Its MCP server runs
locally from Paper Desktop (`http://127.0.0.1:29979/mcp`) and exposes read tools, write tools, tokens,
export and comment threads. **This skill is the method; the drawing happens through Paper's own tools.**
`packages/paper-integration/` only guarantees health, token sync and token drift — read
`docs/integrations/paper.md` for the runbook and the module's current status.

## When to Use

- Asked to draft, refine, or export a visual artifact on a Paper canvas — a social card, poster, deck
  slide, page mock, or any composition already described in the org's DESIGN.md.
- Brand tokens are already pushed to the target Paper file (`npm run paper:lint-tokens` passes), or can
  be pushed first with `paper:push-tokens`.
- A human has left comments on an existing artboard that need addressing — see The review loop, below.

## When NOT to Use

- For an org whose tokens are not the ones currently pushed to the target Paper file — never use another
  org's artifact as the style reference.
- To pick a colour, size, or weight that has no token. Derive it into the org's own stylesheet and push
  the token first; this skill draws from tokens, it does not invent brand values.
- Past the 25-call per-artifact budget. Export what exists and stop — see Budget, below.

## Budget — read first

The free tier allows **100 metered MCP tool calls per week**. `initialize`/`tools/list` are free; every
`tools/call` is metered — including one that Paper rejects, since a response still came back. **Per
artifact: 25 calls, hard stop.** At 25, export what exists, release working indicators, report — do not
"finish quickly". Typical spend for one composition:

| step                                                                             | calls |
| -------------------------------------------------------------------------------- | ----- |
| `get_basic_info` · `get_font_family_info([brand face])` · `create_artboard`      | 3     |
| `write_html`, one visual group each                                              | 6–10  |
| `get_screenshot` (max 3) · targeted `update_styles` / `set_text_content` (max 3) | ≤6    |
| `find_nodes` colour audit · `export` · `get_jsx` · `finish_working_on_nodes`     | 4     |

Paper's own guide asks for a screenshot after every section and a `write_html` every ~15 lines. Keep its
small-writes discipline (the human watches the canvas build) and **override the screenshot cadence** to
fit the budget — say so if asked, rather than silently following Paper's guide into a blown budget. Never
invoke Paper's AI image generation (`paper-gen://` URLs) unless the operator has explicitly asked for a
generated image: Paper's own MCP guide says plainly that "generation counts against the user's usage"
(VERIFIED.md row 19) — it competes with the artifact's own 25-call budget for no design reason. Use
Paper's own named alternative instead: plain placeholders — solid fills, SVG shapes — composed from
tokens, the same as every other element on the canvas.

## Preconditions

1. `npm run paper:doctor` → `paper: canvas ready` (free).
2. `npm run paper:lint-tokens -- --tokens <instance>/data/brand.yaml` → `in sync` (1 call). If not, run
   `paper:push-tokens` first. Tokens are named exactly as in the org's stylesheet
   (`--<prefix>-color-*`, `--<prefix>-text-*`, …).
3. `get_font_family_info(["<brand face>"])` says the face is available (1 call). If not, **stop before
   `create_artboard`** — a missing face is a broken design, and the fix (installing the font locally) is
   the operator's.

## Procedure

1. **Read the composition**, not the stylesheet. Open the org's DESIGN.md, pick the composition
   (social card, poster, deck slide, page, chart, doc page), and note: canvas size, world (light/dark),
   the one object, the type roles, the never-do line.
2. **Translate class vocabulary into inline styles that reference tokens.** Paper's canvas does not load
   the org's CSS; classes mean nothing there. Every class the composition names becomes inline CSS whose
   colours, sizes, weights and families are `var(--<prefix>-*)`. The per-org translation table lives in
   the instance's own brand skill (its Canvas / Paper section) — if that skill has no table yet, or the
   table lacks the composition, derive the inline styles from the org's stylesheet class definitions and
   add the row to that table as part of the work. This skill carries no organisation's palette or
   composition table itself; it is the same method for every instance.
3. **Ground first.** `create_artboard` with the canvas size and the world's background token; then the
   surface treatments the world demands (e.g. a radial glow layer and a grain layer) as the first
   `write_html` groups. A flat dark background where the system says "grained" is a rendering error.
4. **One visual group per `write_html`**, `mode: "insert-children"` on the artboard id. Inline SVG is
   allowed and takes `var()` in `fill`/`stroke`. Large assets (a logomark SVG) go through
   `npm run paper:call -- write_html --args-file <json>` so the shell never chokes on the payload — but
   `paper:call` always injects `fileId` and so cannot invoke `create_file`, `list_files`, or any other
   file-less tool; that's fine here (the target file already exists), just don't reach for it outside
   this skill's scope.
5. **Review at checkpoints, not after every group.** One `get_screenshot` after the ground + object, one
   after the type, one final. Fix with `update_styles` / `set_text_content` / `move_nodes` — never delete
   the artboard and start over.
6. **Audit colours.** `find_nodes` with a `styleValue` of each canonical hex confirms usages resolve to a
   `var(--…)` (the reply reports token-bound usages as the var reference). Anything literal gets an
   `update_styles` to the token.
7. **Export and release.** `export` the artboard as PNG at `"2x"` into the instance's designated
   output directory; `get_jsx` with `format: "inline-styles"` for the code twin; `finish_working_on_nodes`.
   Screenshots verify; exports ship. Never build code from a screenshot.
8. **Report** — calls spent, what Paper rejected or rendered unexpectedly (each is a VERIFIED.md
   candidate row), and the verdicts the operator still owes.

## Error handling

| Situation                                                                 | Action                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brand face not available (`get_font_family_info`)                         | Stop before `create_artboard`. Report; installing the font is the operator's job.                                                                                                                                                                  |
| `write_html`/any tool call fails                                          | Paper returns a **successful envelope with `isError: true`**, not a JSON-RPC error — read the message in the reply, don't assume success. Through `paper:call` this exits 1; through direct MCP tool use, check the result for `isError` yourself. |
| 25-call artifact budget reached                                           | Export what exists now, `finish_working_on_nodes`, report — never push past the stop to "just finish this section".                                                                                                                                |
| Quota-exceeded response                                                   | Shape unobserved (VERIFIED.md row 12) — stop, report the raw error, do not guess a retry strategy.                                                                                                                                                 |
| A composition's translation table is missing or incomplete for this class | Derive the inline styles from the org's stylesheet directly and add the row — don't invent a colour by eye while you wait for the table.                                                                                                           |

## The review loop with a human

The human refines by hand in Paper and leaves comments. On a later session:
`list_comment_threads({ status: "open" })` → for each thread, read `get_comment_thread`, make the change,
then `set_comment_thread_status({ status: "resolved" })`. Never resolve a thread you did not act on;
never resolve to tidy up. A thread that asks a question stays open with a reply until answered.

## Hard rules

- Every colour on the canvas is a `var(--<prefix>-*)`. No literal hex, no `rgba()`, no colour picked by
  eye. If the system itself hardcodes a helper colour (a white highlight, a tinted glow), compose it from
  a token plus `opacity` on its own layer.
- Never take another org's artifact as the style target.
- Never call `open_file` on a file you were not given; never rely on Paper's sticky file — pass `fileId`.
- Font sizes in px (Paper requirement); tokens already are (the push-tokens planner converts rem→px).
- Nothing font-related is committed; fonts install locally under their licence.

## Pulling a Paper design into code

Use `get_jsx` (`inline-styles`), `get_computed_styles`, `get_fill_image` for exact values; translate into
the codebase's own conventions (classes and tokens from the org's stylesheet and `data/brand.yaml`).
