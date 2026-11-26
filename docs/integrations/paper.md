# Paper Integration

**Module:** `org-os-paper`, catalogued `in-dev` ([manifest](../../modules/org-os-paper/module.yaml), [catalogue entry](../MODULES.md)). Built, and the token round trip is verified against a live Paper file; not in production use. Design: [Paper integration design](../superpowers/specs/2026-09-02-paper-integration-design.md), plan [Paper integration plan](../superpowers/plans/2026-09-02-paper-integration.md).

[Paper](https://paper.design) is a design canvas, on the web and as a desktop app, whose every element is real HTML and CSS. Paper Desktop runs a local MCP server that an agent can read and draw through. This module connects an instance's brand tokens to a Paper file: `data/brand.yaml` is the source, the tokens are pushed into the Paper file, and a lint reports drift. An agent following [`skills/paper-design/SKILL.md`](../../skills/paper-design/SKILL.md) then drafts compositions on an artboard using only `var(--...)` colours, a person refines them by hand in Paper, and exports come back into the repository.

org-os never draws. The package wraps health checks, token sync and drift detection; everything visual goes through Paper's own tools. Paper is not a session lane: nothing in `/initialize` or `/close` depends on it.

## What is verified, and what is not

| Level | State |
|---|---|
| Built | A wire client (`lib/paper.mjs`), a pure token planner (`lib/tokens.mjs`), four scripts, the `paper-design` skill. The 57 tests in `tests/paper-integration/` pass on this branch; they run against a stub server, not Paper. |
| Verified against a live service | 2026-09-02, against Paper Desktop 0.5.6 (MCP protocol 2025-03-26, 34 tools observed): the token round trip on a real Paper file with 75 tokens from an instance's `brand.yaml`. `doctor` was green (0 metered calls); the first push created 75 tokens in one batch; after a normalisation fix a repeat push was idempotent (`unchanged: 75`, 1 call); `lint-tokens` reported in sync, then reported drift with both values after a deliberate edit, then in sync again after a restore push. Total metered cost: 15 calls. A composition was also built on a real artboard that day, which settled `VERIFIED.md` rows 13, 16, 16b, 17 and 20 to 24 (see below). |
| Not verified | The error shape when the weekly quota is exceeded (never approached). Whether a rejected call is billed (unmeasurable: no tool reports usage). Whether `initialize` and `tools/list` are unmetered (inferred from Paper's pricing wording). The comment-thread review loop. Every MCP host other than Claude Code and the shell scripts. The correct parameter shape of `set_text_content` (the shape tried returned an error; `write_html` with `mode: "replace"` is the working route). |
| In production use | No. The catalogue keeps the module `in-dev`; the repository does not record a signed-off acceptance of the instance prototype (brief 02) that is the gate to `pilot`. |

## What it connects to

**Paper Desktop**, installed on the operator's machine and running with a file open. It serves MCP at `http://127.0.0.1:29979/mcp` (loopback, POST only, no authentication, no credential anywhere in this integration). The app starts the server only once some file is open, so a person must have Paper running with a file open before any script works.

Plan limits matter: Paper's free tier is said to allow 100 metered tool calls a week (Paper's pricing, not checked here). `paper:doctor` spends none, a push spends at most 3, a lint 1, and the skill budgets one artifact at 25. Every script prints `metered calls: N` on standard error.

## Setup

1. Install Paper Desktop and open a file.
2. Set the target file in the instance's `.env` (placeholders in `.env.example`): `PAPER_FILE_ID` (the bare id, the `/file/<id>` path, or the whole `https://app.paper.design/file/<id>` URL) and optionally `PAPER_MCP_URL` (default above). Lookup order: `--file` flag, process environment, the framework's `.env`, then the `.env` one directory above the `--tokens` file (`<instance>/.env` for `<instance>/data/brand.yaml`).
3. Register the server for your agent host. For Claude Code, commit a `.mcp.json` at the instance root:

   ```json
   {
     "mcpServers": {
       "paper": { "type": "http", "url": "http://127.0.0.1:29979/mcp" }
     }
   }
   ```

   Registration for Cursor, Claude Desktop, Copilot and OpenCode is described in Paper's own documentation and has not been exercised here. The npm scripts work from any shell regardless.
4. If a brand font is on neither the machine nor Google Fonts, install it locally before designing. Paper caches its font list at launch, so quit and reopen Paper afterwards. Font files are never committed.

A first-time operator gets a file id by creating or opening a file in Paper and reading it from the URL. An agent can create one with `create_file`, but not through `paper:call` (below); call the client library directly:

```bash
node -e 'import("./packages/paper-integration/lib/paper.mjs").then(async ({createClient}) => {
  const c = createClient();
  console.log(await c.call("create_file", { name: "My Org Brand canvas" }));
});'
```

The reply carries `{ fileId, url }` as JSON in `content[0].text`. One metered call.

## Commands

Run from the framework root; `--tokens` points at the instance's brand file.

```bash
npm run paper:doctor [-- --file <id>]
npm run paper:push-tokens -- --tokens <instance>/data/brand.yaml [--dry-run] [--prune] [--canvas-width 1080]
npm run paper:lint-tokens -- --tokens <instance>/data/brand.yaml [--strict]
npm run paper:call -- <tool> ['<json>'] [--args-file <path>] [--out <path>]
```

- **`paper:doctor`** makes four checks without spending a metered call: the server answers and identifies as `paper-desktop`; the running version against the pinned 0.5.6 (a mismatch warns, it does not fail); the five required tools (`get_tokens`, `create_tokens`, `set_tokens`, `export`, `write_html`) are present; a target file is configured. Exit 0 ready, 2 not.
- **`paper:push-tokens`** reads `brand.yaml`, diffs it against Paper's tokens and writes only the difference: `get_tokens`, then `create_tokens` for new ones and `set_tokens` for changed ones, at most three calls. A run with no change costs one. `--dry-run` prints the plan and spends nothing. `--prune` deletes tokens in Paper that carry the org's prefix and are no longer in `brand.yaml`; other prefixes are never touched.
- **`paper:lint-tokens`** costs one call. It exits 1 when tokens are missing or changed, showing both values; tokens only in Paper are reported and fail only with `--strict`. Run it the way an instance runs `lint:brand`.
- **`paper:call`** is a passthrough for an agent in a shell; `--out` saves base64 image content such as screenshots. It always injects `fileId`, so it cannot call `create_file`, `list_files` or any other file-less tool: Paper rejects the injected id. It exits 1 when Paper reports a tool failure, which arrives as a successful JSON-RPC reply carrying `isError: true`, so a script is not misled. `export` does not fit `--out`: it writes a file into the user's Downloads folder and returns the path.

## Token mapping

By value first, then by name family: any colour becomes `color`; `font-*` becomes `fontFamily` (the first family of the stack, the full stack in the token description); `weight-*` becomes `fontWeight`; `space-*` becomes `spacing`, `radius-*` becomes `radius`, `text-*` becomes `fontSize`, all with rem converted to px at 16, and `clamp()` evaluated at `--canvas-width`. Names are kept verbatim (for example `--example-color-blue`), and the sync is one way. `glow-*` and `glass-*` tokens are skipped and listed, because Paper has no shadow or blur token type. Every conversion is written into the token's description, so it shows in Paper's Theme panel.

Paper rewrites legacy colour syntax on write: `rgba(255,255,255,0.03)` reads back as `rgb(255 255 255 / 3%)`; hex values are untouched. The planner canonicalises `rgb()` and `rgba()` (either separator style, decimal or percentage alpha) before comparing. It does not canonicalise `hsl` or `oklch`, since Paper has not been seen rewriting them; any such drift would show up in the lint instead of being hidden.

## What it writes and where

- **In Paper:** design tokens in the target file. The push is the only script that writes tokens; `paper:call` writes whatever tool you call.
- **In the repository:** nothing, from these scripts. Exports and any `.mcp.json` you add are yours to commit.

## The contract with the real app

[`packages/paper-integration/VERIFIED.md`](../../packages/paper-integration/VERIFIED.md) records what Paper does, row by row. Facts from live use worth knowing before drawing: inline `<svg>` with `<filter><feTurbulence>` is accepted but renders nothing; a `url("data:image/svg+xml;utf8,...")` background corrupts Paper's HTML parse; a `write_html` `<img src="data:image/svg+xml;base64,...">` works and is the route for grain; `create_artboard` accepts `var()` references in `backgroundColor`, `color` and `fontFamily`; image generation exists and is billed.

The working rule is the Buzz lane's: `VERIFIED.md` changes only to record an observation, and the code (`PIN`, `REQUIRED_TOOLS`, `extractTokens`, `normalizeValue`, the tests) changes only to match a row. On any Paper Desktop update, re-run the round-trip table first, update the pin, then reconcile the code. `modules/org-os-paper/module.yaml` checks that `VERIFIED.md` exists; do not rename it.
