# Paper × org-os Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship module `org-os-paper` — a thin, tested bridge that pushes an org's brand tokens into a Paper design file and checks drift, plus the agent skill and docs for designing on the canvas — and prove it by building Tier-2 brief 02 (the GrowFi social card) on a Paper canvas from refi-dao-os's brand tokens under a 30-call budget.

**Architecture:** `packages/paper-integration/` speaks the MCP wire format (JSON-RPC 2.0 over HTTP, SSE-framed replies) directly to Paper Desktop's local server at `http://127.0.0.1:29979/mcp` — three methods, no SDK. A pure token planner maps a brand.yaml-shaped token map to Paper's ten token types; scripts wrap doctor (free), push, lint, and a generic `call` passthrough. Agents design through Paper's own tools following `skills/paper-design/SKILL.md`; the package never draws. refi-dao-os opts in with a committed `.mcp.json` and is the first adopter.

**Tech Stack:** Node ≥22 ESM (`.mjs`), `node:test` + `node:assert/strict`, `node:util` `parseArgs`, `js-yaml` (already a dependency), `node:http` for the fake server in tests, prettier (repo default config). No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-09-02-paper-integration-design.md`

## Global Constraints

- Paper pin: app `0.5.6`, server name `paper-desktop`, MCP protocol `2025-03-26`, URL `http://127.0.0.1:29979/mcp`. Mirrored in `lib/paper.mjs` `PIN` and in `VERIFIED.md`; the constant changes only to match a re-verified VERIFIED.md row.
- Free tier: **100 metered MCP tool calls per week.** `initialize` and `tools/list` are free; every `tools/call` is metered. Budgets: doctor **0**, push **≤3**, lint **1**, one artifact **≤25**, whole prototype **≤30**. Every script prints `metered calls: N` to stderr on exit.
- Token names are preserved verbatim: `--<prefix><name>`, e.g. `--refi-color-blue`. Tokens flow **one way**, brand.yaml → Paper. Nothing writes brand.yaml.
- Every `tools/call` passes `fileId` explicitly. Never rely on Paper's sticky file.
- Never call Paper's image generation. Never write a literal colour on the canvas — every colour is `var(--<prefix>-*)`.
- Font files are never committed or redistributed (Switzer: ITF Free Font License). Install locally only, and ask the operator before installing.
- refi-dao-os commits stage **explicit paths only** (`git add <path>…`), on its current branch. Never `git stash`, `git clean`, `git reset --hard`, never `git add -A`. The instance's pre-existing dirty tree belongs to another session.
- New files pass `npx prettier --check <file>` before commit. Existing tests stay green: `npm test`, `npm run validate:structure`, `npm --prefix site test`.
- Dates: run `date +%Y-%m-%d` before stamping anything (today is 2026-09-02 at plan time).
- Authoritative token counts for `refi-dao-os/data/brand.yaml` v2.0 (derived from the file 2026-09-02, and the numbers every task's assertions use): **79** tokens in the file → **75** planned Paper tokens · **4** skipped (`glass-blur`, `glass-shadow`, `glow-blue`, `glow-green`) · **31** converted. By Paper type: color 35 · spacing 14 · fontSize 12 · radius 6 · fontWeight 5 · fontFamily 3. Spot values: `--refi-text-base` `14px` · `--refi-text-5xl` `56px` · `--refi-text-hero` `86px` at canvas width 1080. If the instance file has changed since, recompute and update the assertions rather than forcing these numbers.
- `PAPER_ENV_ROOT` overrides the framework root that `.env` is read from. It exists only so tests are hermetic — this repo has a real `.env`, and Task 7 adds `PAPER_FILE_ID` to it. Never set it in production.

---

## File structure

**org-os (framework), branch `luizfernando`:**

| path                                                   | responsibility                                                                                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/paper-integration/lib/paper.mjs`             | wire client (`initialize` / `listTools` / `call`), SSE + JSON reply parsing, `PaperError`, metered counter, `.env` config, `PIN`, `REQUIRED_TOOLS`, `extractTokens` |
| `packages/paper-integration/lib/tokens.mjs`            | pure planner: `loadBrand`, `planTokens`, `diffTokens`, `normalizeValue`, `toPx`, `isColor`                                                                          |
| `packages/paper-integration/scripts/doctor.mjs`        | four free checks, exit 0/2                                                                                                                                          |
| `packages/paper-integration/scripts/push-tokens.mjs`   | plan → diff → `create_tokens` / `set_tokens`; `--dry-run`, `--prune`                                                                                                |
| `packages/paper-integration/scripts/lint-tokens.mjs`   | `get_tokens` → compare → exit 0/1                                                                                                                                   |
| `packages/paper-integration/scripts/call.mjs`          | generic `tools/call` passthrough for agents and the prototype (`--args-file`, `--out`)                                                                              |
| `packages/paper-integration/VERIFIED.md`               | the contract with reality (Task 7)                                                                                                                                  |
| `modules/org-os-paper/module.yaml`                     | module manifest (`type: integration`)                                                                                                                               |
| `skills/paper-design/SKILL.md`                         | the agent method                                                                                                                                                    |
| `docs/integrations/paper.md`                           | operator runbook                                                                                                                                                    |
| `docs/MODULES.md`, `site/src/data/modules.yaml`        | catalog entry + mirror                                                                                                                                              |
| `data/packages-matrix.yaml`, `data/skills-matrix.yaml` | registry rows                                                                                                                                                       |
| `package.json`, `.env.example`                         | scripts, env placeholders                                                                                                                                           |
| `tests/paper-integration/helpers/fake-paper.mjs`       | in-process fake Paper MCP server (`node:http`) + `runScript`                                                                                                        |
| `tests/paper-integration/*.test.mjs`                   | lib, planner, doctor, push, lint, call                                                                                                                              |
| `tests/fixtures/paper/brand.refi-dao.yaml`             | `stylesheet:` + `tokens:` blocks copied from refi-dao-os                                                                                                            |

**refi-dao-os (instance), current branch `feat/graphify-knowledge-pilot` unless the operator names another:**

| path                                                                                                    | responsibility                                                 |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `.mcp.json`                                                                                             | registers `paper` (http) for Claude Code                       |
| `TOOLS.md`                                                                                              | new `## Paper (design canvas)` section                         |
| `.claude/skills/refi-dao-brand/SKILL.md`                                                                | new `## Canvas (Paper)` route + social-card class→inline table |
| `.env` (gitignored, not committed)                                                                      | `PAPER_FILE_ID`                                                |
| `docs/brand/eval/out/02-growfi-social-card.paper.png` · `.paper.html` · `PAPER-PROTOTYPE-2026-09-02.md` | prototype outputs + report                                     |
| `DECISIONS.md`, `memory/2026-09-02.md`                                                                  | record                                                         |

---

### Task 1: Wire client — `lib/paper.mjs`

**Files:**

- Create: `packages/paper-integration/lib/paper.mjs`
- Test: `tests/paper-integration/paper-lib.test.mjs`

**Interfaces:**

- Produces:
  - `export const DEFAULT_URL = "http://127.0.0.1:29979/mcp"`
  - `export const PIN = { app: "0.5.6", server: "paper-desktop", protocol: "2025-03-26" }`
  - `export const REQUIRED_TOOLS = ["get_tokens", "create_tokens", "set_tokens", "export", "write_html"]`
  - `export class PaperError extends Error { code: "unreachable"|"rpc"|"quota"|"badreply"; data?: unknown }`
  - `export function parseEnvFile(text): Record<string,string>`
  - `export function loadConfig({ root?, env?, tokensPath?, file? }): { url: string, fileId: string|undefined }` — framework root is `root ?? env.PAPER_ENV_ROOT ?? <repo root>`
  - `export function parseReply(text: string): object` — accepts SSE (`data:` lines) or plain JSON; returns the JSON-RPC envelope
  - `export function createClient({ url?, fetch?, timeoutMs? = 15000 }): { initialize(), listTools(), call(name, args), metered: number, url }`
  - `export function extractTokens(result): Array<{ type, name, value, description? }>` — accepts `result.content[0].text` JSON that is either an array or `{ tokens: [...] }`, or a structured `result.tokens`

- [ ] **Step 1: Write the failing tests**

```js
// tests/paper-integration/paper-lib.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEFAULT_URL,
  PIN,
  REQUIRED_TOOLS,
  PaperError,
  parseEnvFile,
  loadConfig,
  parseReply,
  createClient,
  extractTokens,
} from "../../packages/paper-integration/lib/paper.mjs";

const sse = (obj) => `event: message\ndata: ${JSON.stringify(obj)}\n\n`;
const rpcOk = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcErr = (id, code, message, data) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message, data },
});

// A fetch double: records requests, replies from a queue of {status, body, contentType}.
function fakeFetch(replies) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const r = replies.shift();
    if (r instanceof Error) throw r;
    return {
      ok: r.status < 400,
      status: r.status,
      headers: {
        get: (h) => (h.toLowerCase() === "content-type" ? r.contentType : null),
      },
      text: async () => r.body,
    };
  };
  fn.calls = calls;
  return fn;
}

test("constants: pin and required tools match the spec", () => {
  assert.equal(DEFAULT_URL, "http://127.0.0.1:29979/mcp");
  assert.deepEqual(PIN, {
    app: "0.5.6",
    server: "paper-desktop",
    protocol: "2025-03-26",
  });
  assert.deepEqual(REQUIRED_TOOLS, [
    "get_tokens",
    "create_tokens",
    "set_tokens",
    "export",
    "write_html",
  ]);
});

test("parseReply: SSE-framed envelope", () => {
  const env = parseReply(sse(rpcOk(1, { a: 1 })));
  assert.deepEqual(env.result, { a: 1 });
});

test("parseReply: plain JSON envelope", () => {
  const env = parseReply(JSON.stringify(rpcOk(2, { b: 2 })));
  assert.deepEqual(env.result, { b: 2 });
});

test("parseReply: garbage → PaperError badreply", () => {
  assert.throws(
    () => parseReply("<html>nope</html>"),
    (e) => e instanceof PaperError && e.code === "badreply",
  );
});

test("client.initialize: sends protocolVersion + clientInfo, returns serverInfo, not metered", async () => {
  const f = fakeFetch([
    {
      status: 200,
      contentType: "text/event-stream",
      body: sse(
        rpcOk(1, {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "paper-desktop", version: "0.5.6" },
        }),
      ),
    },
  ]);
  const c = createClient({ url: DEFAULT_URL, fetch: f });
  const info = await c.initialize();
  assert.equal(info.serverInfo.name, "paper-desktop");
  assert.equal(info.protocolVersion, "2025-03-26");
  assert.equal(f.calls[0].body.method, "initialize");
  assert.equal(f.calls[0].body.params.protocolVersion, "2025-03-26");
  assert.equal(
    f.calls[0].body.params.clientInfo.name,
    "org-os-paper-integration",
  );
  assert.equal(c.metered, 0);
});

test("client.listTools: returns tools array, not metered", async () => {
  const f = fakeFetch([
    {
      status: 200,
      contentType: "text/event-stream",
      body: sse(rpcOk(1, { tools: [{ name: "get_tokens", inputSchema: {} }] })),
    },
  ]);
  const c = createClient({ fetch: f });
  const tools = await c.listTools();
  assert.deepEqual(
    tools.map((t) => t.name),
    ["get_tokens"],
  );
  assert.equal(f.calls[0].body.method, "tools/list");
  assert.equal(c.metered, 0);
});

test("client.call: sends tools/call with name+arguments, returns result, increments metered", async () => {
  const f = fakeFetch([
    {
      status: 200,
      contentType: "text/event-stream",
      body: sse(rpcOk(1, { content: [{ type: "text", text: "[]" }] })),
    },
    {
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        rpcOk(2, { content: [{ type: "text", text: "ok" }] }),
      ),
    },
  ]);
  const c = createClient({ fetch: f });
  const r1 = await c.call("get_tokens", { fileId: "F1" });
  const r2 = await c.call("finish_working_on_nodes", { fileId: "F1" });
  assert.deepEqual(r1.content[0], { type: "text", text: "[]" });
  assert.equal(r2.content[0].text, "ok");
  assert.equal(f.calls[0].body.method, "tools/call");
  assert.deepEqual(f.calls[0].body.params, {
    name: "get_tokens",
    arguments: { fileId: "F1" },
  });
  assert.equal(c.metered, 2);
});

test("client.call: JSON-RPC error → PaperError rpc with code/message/data", async () => {
  const f = fakeFetch([
    {
      status: 200,
      contentType: "text/event-stream",
      body: sse(rpcErr(1, -32602, "Invalid params", { field: "tokens" })),
    },
  ]);
  const c = createClient({ fetch: f });
  await assert.rejects(
    c.call("create_tokens", {}),
    (e) =>
      e instanceof PaperError &&
      e.code === "rpc" &&
      /Invalid params/.test(e.message) &&
      e.data.field === "tokens",
  );
});

test("client.call: quota-shaped error → PaperError quota", async () => {
  const f = fakeFetch([
    {
      status: 429,
      contentType: "application/json",
      body: JSON.stringify(
        rpcErr(1, -32000, "MCP tool call limit reached for this week"),
      ),
    },
  ]);
  const c = createClient({ fetch: f });
  await assert.rejects(
    c.call("get_tokens", {}),
    (e) => e instanceof PaperError && e.code === "quota",
  );
});

test("client: connection refused → PaperError unreachable", async () => {
  const err = Object.assign(new Error("fetch failed"), {
    cause: { code: "ECONNREFUSED" },
  });
  const c = createClient({ fetch: fakeFetch([err]) });
  await assert.rejects(
    c.initialize(),
    (e) => e instanceof PaperError && e.code === "unreachable",
  );
});

test("parseEnvFile: quotes, comments, export prefix", () => {
  const vars = parseEnvFile(
    `# c\nexport PAPER_FILE_ID=abc123 # trailing\nPAPER_MCP_URL="http://h/p#frag"\nBROKEN LINE\n`,
  );
  assert.deepEqual(vars, {
    PAPER_FILE_ID: "abc123",
    PAPER_MCP_URL: "http://h/p#frag",
  });
});

test("loadConfig: precedence file flag > env > root .env > instance .env beside tokens", () => {
  const root = mkdtempSync(path.join(tmpdir(), "paper-root-"));
  const inst = mkdtempSync(path.join(tmpdir(), "paper-inst-"));
  writeFileSync(path.join(root, ".env"), "PAPER_FILE_ID=from-root\n");
  writeFileSync(
    path.join(inst, ".env"),
    "PAPER_FILE_ID=from-instance\nPAPER_MCP_URL=http://127.0.0.1:1/mcp\n",
  );
  const tokensPath = path.join(inst, "data", "brand.yaml"); // need not exist for config resolution

  assert.equal(
    loadConfig({ root, env: {}, tokensPath, file: "flag" }).fileId,
    "flag",
  );
  assert.equal(
    loadConfig({ root, env: { PAPER_FILE_ID: "from-env" }, tokensPath }).fileId,
    "from-env",
  );
  assert.equal(loadConfig({ root, env: {}, tokensPath }).fileId, "from-root");
  writeFileSync(path.join(root, ".env"), "\n");
  const c = loadConfig({ root, env: {}, tokensPath });
  assert.equal(c.fileId, "from-instance");
  assert.equal(c.url, "http://127.0.0.1:1/mcp");
  assert.equal(loadConfig({ root, env: {} }).url, DEFAULT_URL);
});

test("loadConfig: PAPER_ENV_ROOT overrides the framework root (test isolation)", () => {
  const elsewhere = mkdtempSync(path.join(tmpdir(), "paper-elsewhere-"));
  writeFileSync(path.join(elsewhere, ".env"), "PAPER_FILE_ID=from-env-root\n");
  assert.equal(
    loadConfig({ env: { PAPER_ENV_ROOT: elsewhere } }).fileId,
    "from-env-root",
  );
  const empty = mkdtempSync(path.join(tmpdir(), "paper-empty-"));
  assert.equal(
    loadConfig({ env: { PAPER_ENV_ROOT: empty } }).fileId,
    undefined,
  );
});

test("extractTokens: text-content array, text-content {tokens}, structured", () => {
  const arr = [{ type: "color", name: "--refi-color-blue", value: "#4571E1" }];
  assert.deepEqual(
    extractTokens({ content: [{ type: "text", text: JSON.stringify(arr) }] }),
    arr,
  );
  assert.deepEqual(
    extractTokens({
      content: [{ type: "text", text: JSON.stringify({ tokens: arr }) }],
    }),
    arr,
  );
  assert.deepEqual(extractTokens({ tokens: arr }), arr);
  assert.deepEqual(
    extractTokens({
      content: [{ type: "text", text: "No design tokens in this file." }],
    }),
    [],
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/paper-integration/paper-lib.test.mjs`
Expected: FAIL — `Cannot find module '.../packages/paper-integration/lib/paper.mjs'`

- [ ] **Step 3: Implement `lib/paper.mjs`**

```js
#!/usr/bin/env node
// paper.mjs — thin MCP wire client for Paper Desktop's local server.
// Three JSON-RPC methods (initialize, tools/list, tools/call), SSE or JSON
// replies, typed errors, a metered-call counter. No SDK. PIN mirrors
// packages/paper-integration/VERIFIED.md — change it ONLY to match a
// re-verified row.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

export const DEFAULT_URL = "http://127.0.0.1:29979/mcp";
export const PIN = {
  app: "0.5.6",
  server: "paper-desktop",
  protocol: "2025-03-26",
};
export const REQUIRED_TOOLS = [
  "get_tokens",
  "create_tokens",
  "set_tokens",
  "export",
  "write_html",
];
const CLIENT_INFO = { name: "org-os-paper-integration", version: "0.1.0" };

export class PaperError extends Error {
  constructor(code, message, data) {
    super(message);
    this.name = "PaperError";
    this.code = code; // "unreachable" | "rpc" | "quota" | "badreply"
    this.data = data;
  }
}

// --- .env ---------------------------------------------------------------
// Same rules as packages/buzz-integration/lib/buzz.mjs (kept local on purpose:
// that file changes only against a re-verified Buzz pin).
function parseEnvValue(raw) {
  const v = raw.trim();
  const first = v[0];
  if (first === '"' || first === "'") {
    const closeIdx = v.indexOf(first, 1);
    if (closeIdx !== -1) return v.slice(1, closeIdx);
  }
  const hashIdx = v.indexOf("#");
  return (hashIdx === -1 ? v : v.slice(0, hashIdx)).trim();
}

export function parseEnvFile(text) {
  const vars = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\r$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) vars[m[1]] = parseEnvValue(m[2]);
  }
  return vars;
}

function readEnv(file) {
  try {
    return existsSync(file) ? parseEnvFile(readFileSync(file, "utf8")) : {};
  } catch {
    return {};
  }
}

// Precedence: explicit flag > process env > <root>/.env > <instance>/.env,
// where <instance> is the parent of the directory holding the tokens file
// (data/brand.yaml → the instance root). loadConfig never throws.
// PAPER_ENV_ROOT overrides the framework root the `.env` is read from. It
// exists so tests are hermetic: this repo has a real `.env`, and once it
// carries PAPER_FILE_ID the "no target file" paths would silently pass.
// Never set in production.
export function loadConfig({ root, env = process.env, tokensPath, file } = {}) {
  const base = root ?? env.PAPER_ENV_ROOT ?? ROOT;
  const rootVars = readEnv(path.join(base, ".env"));
  const instVars = tokensPath
    ? readEnv(path.resolve(path.dirname(tokensPath), "..", ".env"))
    : {};
  const pick = (k) => env[k] || rootVars[k] || instVars[k] || undefined;
  return {
    url: pick("PAPER_MCP_URL") || DEFAULT_URL,
    fileId: file || pick("PAPER_FILE_ID"),
  };
}

// --- wire ---------------------------------------------------------------
export function parseReply(text) {
  const t = String(text ?? "").trim();
  let payload = t;
  if (t.startsWith("event:") || t.startsWith("data:")) {
    payload = t
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .join("");
  }
  try {
    const env = JSON.parse(payload);
    if (typeof env !== "object" || env === null || !("jsonrpc" in env))
      throw new Error("not a JSON-RPC envelope");
    return env;
  } catch (e) {
    throw new PaperError("badreply", `unparseable reply: ${e.message}`, {
      head: t.slice(0, 200),
    });
  }
}

function classifyError(status, error) {
  const msg = String(error?.message ?? "");
  if (status === 429 || /limit|quota|exceeded/i.test(msg))
    return new PaperError("quota", msg || "quota exceeded", error?.data);
  return new PaperError(
    "rpc",
    msg || `JSON-RPC error ${error?.code}`,
    error?.data,
  );
}

export function createClient({
  url = DEFAULT_URL,
  fetch = globalThis.fetch,
  timeoutMs = 15000,
} = {}) {
  let nextId = 1;
  const client = { url, metered: 0 };

  async function rpc(method, params) {
    const id = nextId++;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: ctl.signal,
      });
    } catch (e) {
      throw new PaperError(
        "unreachable",
        `Paper MCP not reachable at ${url} (${e?.cause?.code || e.message})`,
      );
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let env;
    try {
      env = parseReply(text);
    } catch (e) {
      if (!res.ok)
        throw new PaperError(
          res.status === 429 ? "quota" : "rpc",
          `HTTP ${res.status}`,
          { head: text.slice(0, 200) },
        );
      throw e;
    }
    if (env.error) throw classifyError(res.status, env.error);
    return env.result;
  }

  client.initialize = () =>
    rpc("initialize", {
      protocolVersion: PIN.protocol,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    });
  client.listTools = async () => (await rpc("tools/list", {})).tools ?? [];
  client.call = async (name, args = {}) => {
    const result = await rpc("tools/call", { name, arguments: args });
    client.metered += 1;
    return result;
  };
  return client;
}

// get_tokens replies have not been observed yet (VERIFIED.md row); accept
// the three plausible shapes and let the prototype pin the real one.
export function extractTokens(result) {
  if (Array.isArray(result?.tokens)) return result.tokens;
  const text = result?.content?.find((c) => c.type === "text")?.text;
  if (typeof text !== "string") return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.tokens)) return parsed.tokens;
  } catch {
    /* prose reply such as "No design tokens in this file." */
  }
  return [];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/paper-integration/paper-lib.test.mjs`
Expected: PASS, 14 tests

- [ ] **Step 5: Format and commit**

```bash
npx prettier --write packages/paper-integration/lib/paper.mjs tests/paper-integration/paper-lib.test.mjs
node --test tests/paper-integration/paper-lib.test.mjs
git add packages/paper-integration/lib/paper.mjs tests/paper-integration/paper-lib.test.mjs
git commit -m "feat(paper): MCP wire client — initialize/tools-list/tools-call, SSE+JSON replies, typed errors, metered counter"
```

---

### Task 2: Token planner — `lib/tokens.mjs`

**Files:**

- Create: `packages/paper-integration/lib/tokens.mjs`
- Create: `tests/fixtures/paper/brand.refi-dao.yaml`
- Test: `tests/paper-integration/paper-plan-tokens.test.mjs`

**Interfaces:**

- Produces:
  - `export const PAPER_TYPES = ["breakpoint","color","container","fontFamily","fontSize","fontWeight","letterSpacing","lineHeight","radius","spacing"]`
  - `export function loadBrand(yamlPath): { prefix: string, tokens: Record<string,string>, source: string }` — throws `Error` with a clear message if `tokens:` or `stylesheet.prefix` is missing
  - `export function isColor(value): boolean`
  - `export function toPx(value, { width = 1080, rootPx = 16 }): { px: string, converted: boolean, from?: string } | null`
  - `export function planTokens(brand, { canvasWidth = 1080 } = {}): { tokens: Array<{type,name,value,description}>, skipped: Array<{name, reason}>, converted: Array<{name, from, to}> }`
  - `export function normalizeValue(type, value): string`
  - `export function diffTokens(planned, existing, { prefix }): { create: Token[], update: Array<{name, value, description}>, unchanged: string[], extra: string[] }`

- [ ] **Step 1: Create the fixture from refi-dao-os brand.yaml (verbatim blocks)**

```bash
SRC="../refi-dao-os/data/brand.yaml"
mkdir -p tests/fixtures/paper
{
  echo "# Fixture: stylesheet + tokens blocks copied verbatim from refi-dao-os data/brand.yaml (v2.0, 2026-09-02)."
  echo "# Regenerate with the awk pair in docs/superpowers/plans/2026-09-02-paper-integration.md Task 2."
  awk '/^stylesheet:/{f=1;print;next} f&&/^[a-z_]+:/{f=0} f' "$SRC"
  awk '/^tokens:/{f=1;print;next} f&&/^[a-z_]+:/{f=0} f' "$SRC"
} > tests/fixtures/paper/brand.refi-dao.yaml
grep -c "^  [a-z]" tests/fixtures/paper/brand.refi-dao.yaml
```

Expected: the count is `83` (4 stylesheet keys + 79 tokens). If refi-dao-os brand.yaml has changed, the count differs — update the assertions in Step 2 accordingly and note it in the commit message.

- [ ] **Step 2: Write the failing tests**

```js
// tests/paper-integration/paper-plan-tokens.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PAPER_TYPES,
  loadBrand,
  isColor,
  toPx,
  planTokens,
  normalizeValue,
  diffTokens,
} from "../../packages/paper-integration/lib/tokens.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(
  __dirname,
  "../fixtures/paper/brand.refi-dao.yaml",
);
const brand = loadBrand(FIXTURE);
const plan = planTokens(brand, { canvasWidth: 1080 });
const byName = Object.fromEntries(plan.tokens.map((t) => [t.name, t]));

test("loadBrand: prefix and token count from the fixture", () => {
  assert.equal(brand.prefix, "refi-");
  assert.equal(Object.keys(brand.tokens).length, 79);
});

test("loadBrand: missing tokens block throws a readable error", () => {
  assert.throws(
    () =>
      loadBrand(path.resolve(__dirname, "../fixtures/instance-config.yaml")),
    /tokens/,
  );
});

test("isColor", () => {
  for (const v of [
    "#4571E1",
    "#fff",
    "rgba(255,255,255,0.03)",
    "rgb(1,2,3)",
    "hsl(1 2% 3%)",
    "oklch(0.5 0.1 200)",
  ])
    assert.equal(isColor(v), true, v);
  for (const v of [
    "0.875rem",
    "20px",
    "300",
    '"Switzer", sans-serif',
    "0 8px 32px rgba(0,0,0,0.3)",
  ])
    assert.equal(isColor(v), false, v);
});

test("toPx: rem, px, zero, clamp at width, unconvertible", () => {
  assert.deepEqual(toPx("0.875rem", {}), {
    px: "14px",
    converted: true,
    from: "0.875rem",
  });
  assert.deepEqual(toPx("9999px", {}), { px: "9999px", converted: false });
  assert.deepEqual(toPx("0", {}), { px: "0px", converted: true, from: "0" });
  assert.deepEqual(toPx("clamp(3rem, 8vw, 6rem)", { width: 1080 }), {
    px: "86px",
    converted: true,
    from: "clamp(3rem, 8vw, 6rem)",
  });
  assert.deepEqual(toPx("clamp(3rem, 8vw, 6rem)", { width: 400 }), {
    px: "48px",
    converted: true,
    from: "clamp(3rem, 8vw, 6rem)",
  });
  assert.equal(toPx("auto", {}), null);
});

test("planTokens: every token type is a Paper type; names are prefixed and pattern-valid", () => {
  for (const t of plan.tokens) {
    assert.ok(PAPER_TYPES.includes(t.type), `${t.name} has type ${t.type}`);
    assert.match(t.name, /^--refi-[a-zA-Z0-9_-]+$/);
  }
});

test("planTokens: colours pass through as-is (hex and rgba)", () => {
  assert.deepEqual(byName["--refi-color-blue"], {
    type: "color",
    name: "--refi-color-blue",
    value: "#4571E1",
    description: "brand.yaml color-blue",
  });
  assert.equal(byName["--refi-bg-surface"].type, "color");
  assert.equal(byName["--refi-bg-surface"].value, "rgba(255,255,255,0.03)");
  assert.equal(byName["--refi-text-muted"].type, "color");
  assert.equal(byName["--refi-border-active"].type, "color");
  assert.equal(byName["--refi-series-6"].type, "color");
  assert.equal(byName["--refi-text"].type, "color"); // value-first: "text" family but hex value
});

test("planTokens: font sizes rem→px, hero clamp evaluated at 1080 and flagged", () => {
  assert.equal(byName["--refi-text-base"].type, "fontSize");
  assert.equal(byName["--refi-text-base"].value, "14px");
  assert.equal(byName["--refi-text-5xl"].value, "56px");
  assert.equal(byName["--refi-text-hero"].value, "86px");
  assert.match(
    byName["--refi-text-hero"].description,
    /from clamp\(3rem, 8vw, 6rem\) at 1080px/,
  );
  assert.ok(
    plan.converted.some(
      (c) => c.name === "--refi-text-hero" && c.to === "86px",
    ),
  );
});

test("planTokens: spacing and radius rem→px, zero → 0px, 9999px kept", () => {
  assert.deepEqual(
    [byName["--refi-space-4"].type, byName["--refi-space-4"].value],
    ["spacing", "16px"],
  );
  assert.equal(byName["--refi-space-0"].value, "0px");
  assert.deepEqual(
    [byName["--refi-radius-lg"].type, byName["--refi-radius-lg"].value],
    ["radius", "16px"],
  );
  assert.equal(byName["--refi-radius-full"].value, "9999px");
});

test("planTokens: weights become numbers", () => {
  assert.deepEqual(
    [
      byName["--refi-weight-semibold"].type,
      byName["--refi-weight-semibold"].value,
    ],
    ["fontWeight", 600],
  );
});

test("planTokens: font families → first family, full stack in description", () => {
  const f = byName["--refi-font-sans"];
  assert.equal(f.type, "fontFamily");
  assert.equal(f.value, "Switzer");
  assert.match(f.description, /stack: "Switzer", "Inter"/);
  assert.equal(byName["--refi-font-mono"].value, "ui-monospace");
});

test("planTokens: glow and glass are skipped with a reason, never silently", () => {
  const skippedNames = plan.skipped.map((s) => s.name).sort();
  assert.deepEqual(skippedNames, [
    "--refi-glass-blur",
    "--refi-glass-shadow",
    "--refi-glow-blue",
    "--refi-glow-green",
  ]);
  for (const s of plan.skipped) assert.match(s.reason, /no Paper token type/);
  assert.equal(plan.tokens.length + plan.skipped.length, 79);
});

test("normalizeValue: hex case, rgba whitespace, numeric weights, px trim", () => {
  assert.equal(
    normalizeValue("color", "#4571e1"),
    normalizeValue("color", "#4571E1"),
  );
  assert.equal(
    normalizeValue("color", "rgba(255, 255, 255, 0.03)"),
    normalizeValue("color", "rgba(255,255,255,0.03)"),
  );
  assert.equal(
    normalizeValue("fontWeight", "600"),
    normalizeValue("fontWeight", 600),
  );
  assert.equal(normalizeValue("spacing", " 16px "), "16px");
});

test("diffTokens: create / update / unchanged / extra (prefix-scoped)", () => {
  const planned = [
    {
      type: "color",
      name: "--refi-color-blue",
      value: "#4571E1",
      description: "d",
    },
    {
      type: "spacing",
      name: "--refi-space-4",
      value: "16px",
      description: "d",
    },
    {
      type: "fontWeight",
      name: "--refi-weight-bold",
      value: 700,
      description: "d",
    },
  ];
  const existing = [
    { type: "color", name: "--refi-color-blue", value: "#4571e1" }, // same after normalisation
    { type: "spacing", name: "--refi-space-4", value: "12px" }, // changed
    { type: "color", name: "--refi-old-thing", value: "#000" }, // extra, our prefix
    { type: "color", name: "--color-primary", value: "#111" }, // not ours — ignored
  ];
  const d = diffTokens(planned, existing, { prefix: "refi-" });
  assert.deepEqual(
    d.create.map((t) => t.name),
    ["--refi-weight-bold"],
  );
  assert.deepEqual(d.update, [
    { name: "--refi-space-4", value: "16px", description: "d" },
  ]);
  assert.deepEqual(d.unchanged, ["--refi-color-blue"]);
  assert.deepEqual(d.extra, ["--refi-old-thing"]);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test tests/paper-integration/paper-plan-tokens.test.mjs`
Expected: FAIL — cannot find `lib/tokens.mjs`

- [ ] **Step 4: Implement `lib/tokens.mjs`**

```js
// tokens.mjs — pure planner: a brand.yaml-shaped token map → Paper design
// tokens. No I/O beyond loadBrand. Nothing here knows any org's palette.
import { readFileSync } from "node:fs";
import yaml from "js-yaml";

export const PAPER_TYPES = [
  "breakpoint",
  "color",
  "container",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "letterSpacing",
  "lineHeight",
  "radius",
  "spacing",
];

// Families Paper has no token type for. Listed, never silently dropped.
const UNSUPPORTED_FAMILIES = new Set(["glow", "glass"]);
const FAMILY_TYPE = {
  font: "fontFamily",
  weight: "fontWeight",
  space: "spacing",
  radius: "radius",
  text: "fontSize",
};

export function loadBrand(yamlPath) {
  const doc = yaml.load(readFileSync(yamlPath, "utf8"));
  const tokens = doc?.tokens;
  const prefix = doc?.stylesheet?.prefix;
  if (!tokens || typeof tokens !== "object")
    throw new Error(`${yamlPath}: no top-level \`tokens:\` map`);
  if (typeof prefix !== "string")
    throw new Error(`${yamlPath}: no \`stylesheet.prefix\``);
  return {
    prefix,
    tokens: Object.fromEntries(
      Object.entries(tokens).map(([k, v]) => [k, String(v)]),
    ),
    source: yamlPath,
  };
}

export function isColor(value) {
  const v = String(value).trim();
  return (
    /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) ||
    /^(rgba?|hsla?|oklch|oklab|color)\(/i.test(v)
  );
}

function lengthToPx(term, { width, rootPx }) {
  const t = term.trim();
  let m;
  if ((m = t.match(/^(-?[\d.]+)px$/))) return Number(m[1]);
  if ((m = t.match(/^(-?[\d.]+)rem$/))) return Number(m[1]) * rootPx;
  if ((m = t.match(/^(-?[\d.]+)vw$/))) return (Number(m[1]) * width) / 100;
  if (/^-?[\d.]+$/.test(t)) return Number(t);
  return null;
}

const fmt = (n) => `${Math.round(n * 100) / 100}px`;

export function toPx(value, { width = 1080, rootPx = 16 } = {}) {
  const v = String(value).trim();
  if (/^-?[\d.]+px$/.test(v)) return { px: v, converted: false };
  const clamp = v.match(/^clamp\((.+),(.+),(.+)\)$/);
  if (clamp) {
    const [lo, mid, hi] = clamp
      .slice(1)
      .map((t) => lengthToPx(t, { width, rootPx }));
    if ([lo, mid, hi].some((n) => n === null)) return null;
    return {
      px: `${Math.round(Math.min(Math.max(mid, lo), hi))}px`,
      converted: true,
      from: v,
    };
  }
  const n = lengthToPx(v, { width, rootPx });
  if (n === null) return null;
  return { px: fmt(n), converted: true, from: v };
}

function firstFamily(stack) {
  const first = String(stack).split(",")[0].trim();
  return first.replace(/^["']|["']$/g, "");
}

export function planTokens(brand, { canvasWidth = 1080 } = {}) {
  const tokens = [];
  const skipped = [];
  const converted = [];
  for (const [shortName, rawValue] of Object.entries(brand.tokens)) {
    const name = `--${brand.prefix}${shortName}`;
    const family = shortName.split("-")[0];
    const base = `brand.yaml ${shortName}`;
    if (UNSUPPORTED_FAMILIES.has(family)) {
      skipped.push({
        name,
        reason: `no Paper token type for shadow/blur values (${rawValue})`,
      });
      continue;
    }
    if (isColor(rawValue)) {
      tokens.push({ type: "color", name, value: rawValue, description: base });
      continue;
    }
    const type = FAMILY_TYPE[family];
    if (type === "fontFamily") {
      tokens.push({
        type,
        name,
        value: firstFamily(rawValue),
        description: `${base} · stack: ${rawValue}`,
      });
      continue;
    }
    if (type === "fontWeight") {
      const n = Number(rawValue);
      if (!Number.isFinite(n)) {
        skipped.push({
          name,
          reason: `fontWeight must be numeric (${rawValue})`,
        });
        continue;
      }
      tokens.push({ type, name, value: n, description: base });
      continue;
    }
    if (type === "spacing" || type === "radius" || type === "fontSize") {
      const px = toPx(rawValue, { width: canvasWidth });
      if (!px) {
        skipped.push({ name, reason: `unconvertible length (${rawValue})` });
        continue;
      }
      const description = px.converted
        ? `${base} · from ${px.from}${px.from.startsWith("clamp(") ? ` at ${canvasWidth}px` : ""}`
        : base;
      if (px.converted) converted.push({ name, from: px.from, to: px.px });
      tokens.push({ type, name, value: px.px, description });
      continue;
    }
    skipped.push({
      name,
      reason: `unclassified family "${family}" (${rawValue})`,
    });
  }
  return { tokens, skipped, converted };
}

export function normalizeValue(type, value) {
  if (type === "fontWeight") return String(Number(value));
  let v = String(value).trim();
  if (type === "color") {
    v = v.toLowerCase().replace(/\s+/g, "");
    if (/^#[0-9a-f]{3}$/.test(v))
      v = "#" + [...v.slice(1)].map((c) => c + c).join("");
  }
  return v;
}

export function diffTokens(planned, existing, { prefix }) {
  const byName = new Map(existing.map((t) => [t.name, t]));
  const create = [];
  const update = [];
  const unchanged = [];
  const plannedNames = new Set();
  for (const t of planned) {
    plannedNames.add(t.name);
    const cur = byName.get(t.name);
    if (!cur) create.push(t);
    else if (
      normalizeValue(t.type, cur.value) !== normalizeValue(t.type, t.value)
    )
      update.push({ name: t.name, value: t.value, description: t.description });
    else unchanged.push(t.name);
  }
  const extra = existing
    .map((t) => t.name)
    .filter((n) => n.startsWith(`--${prefix}`) && !plannedNames.has(n));
  return { create, update, unchanged, extra };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/paper-integration/paper-plan-tokens.test.mjs`
Expected: PASS, 13 tests. If `--refi-text-5xl` is not `56px`, check `rootPx` (3.5rem × 16 = 56).

- [ ] **Step 6: Format and commit**

```bash
npx prettier --write packages/paper-integration/lib/tokens.mjs tests/paper-integration/paper-plan-tokens.test.mjs tests/fixtures/paper/brand.refi-dao.yaml
node --test tests/paper-integration/paper-plan-tokens.test.mjs
git add packages/paper-integration/lib/tokens.mjs tests/paper-integration/paper-plan-tokens.test.mjs tests/fixtures/paper/brand.refi-dao.yaml
git commit -m "feat(paper): pure token planner — brand.yaml tokens → Paper types, rem/clamp→px, skips listed, prefix-scoped diff"
```

---

### Task 3: Fake Paper server helper, `doctor.mjs`, `call.mjs`

**Files:**

- Create: `tests/paper-integration/helpers/fake-paper.mjs`
- Create: `packages/paper-integration/scripts/doctor.mjs`
- Create: `packages/paper-integration/scripts/call.mjs`
- Modify: `package.json` (scripts)
- Test: `tests/paper-integration/paper-doctor.test.mjs`, `tests/paper-integration/paper-call.test.mjs`

**Interfaces:**

- Consumes: `createClient`, `loadConfig`, `PIN`, `REQUIRED_TOOLS`, `PaperError` from Task 1.
- Produces:
  - helper `startFakePaper({ serverInfo?, tools?, handlers?, framing? = "sse" }): Promise<{ url, calls: Array<{method, params}>, close(): Promise<void> }>` — `handlers[toolName](args) → result` (default: `{ content: [{ type: "text", text: "ok" }] }`)
  - helper `runScript(scriptPath, args, env): Promise<{ status, stdout, stderr }>` (async spawn — the fake server lives in the test process and must keep serving)
  - `npm run paper:doctor` → exit 0 / 2
  - `npm run paper:call -- <tool> [json] [--file <id>] [--args-file <path>] [--out <path>] [--tokens <brand.yaml>]` → prints the `result` JSON to stdout, `metered calls: 1` to stderr; `--out` writes the first `content[].type === "image"` `data` (base64) to the path

- [ ] **Step 1: Write the fake server helper**

```js
// tests/paper-integration/helpers/fake-paper.mjs
// An in-process stand-in for Paper Desktop's MCP server: JSON-RPC over HTTP,
// SSE-framed replies by default, canned per-tool handlers, and a call log.
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const okText = (text) => ({ content: [{ type: "text", text }] });

export async function startFakePaper({
  serverInfo = { name: "paper-desktop", version: "0.5.6" },
  tools = [
    "get_tokens",
    "create_tokens",
    "set_tokens",
    "export",
    "write_html",
    "get_basic_info",
  ],
  handlers = {},
  framing = "sse",
} = {}) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const msg = JSON.parse(body);
      calls.push({ method: msg.method, params: msg.params });
      let reply;
      if (msg.method === "initialize") {
        reply = {
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            protocolVersion: "2025-03-26",
            capabilities: { tools: {} },
            serverInfo,
          },
        };
      } else if (msg.method === "tools/list") {
        reply = {
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            tools: tools.map((name) => ({
              name,
              inputSchema: { type: "object" },
            })),
          },
        };
      } else if (msg.method === "tools/call") {
        const h = handlers[msg.params.name];
        try {
          const result = h ? h(msg.params.arguments ?? {}) : okText("ok");
          reply =
            result instanceof Error
              ? {
                  jsonrpc: "2.0",
                  id: msg.id,
                  error: { code: -32000, message: result.message },
                }
              : { jsonrpc: "2.0", id: msg.id, result };
        } catch (e) {
          reply = {
            jsonrpc: "2.0",
            id: msg.id,
            error: { code: -32603, message: e.message },
          };
        }
      } else {
        reply = {
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32601, message: "Method not found" },
        };
      }
      if (framing === "sse") {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(`event: message\ndata: ${JSON.stringify(reply)}\n\n`);
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(reply));
      }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    calls,
    close: () => new Promise((r) => server.close(r)),
  };
}

// PAPER_ENV_ROOT points every script at an empty directory so it never reads
// this repo's real `.env` (which carries PAPER_FILE_ID after Task 7); the two
// PAPER_* keys are cleared so an exported shell value cannot leak in either.
// Node's spawn drops env entries whose value is undefined.
const ISOLATED_ROOT = mkdtempSync(path.join(tmpdir(), "paper-env-root-"));

export function runScript(scriptPath, args = [], env = {}) {
  return new Promise((resolve) => {
    const child = spawn("node", [scriptPath, ...args], {
      env: {
        ...process.env,
        PAPER_MCP_URL: undefined,
        PAPER_FILE_ID: undefined,
        PAPER_ENV_ROOT: ISOLATED_ROOT,
        ...env,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}
```

Two isolation channels, both required: `undefined` env entries are dropped by Node's spawn (so an exported `PAPER_FILE_ID` in the developer's shell cannot leak in), and `PAPER_ENV_ROOT` points `loadConfig` at an empty temp directory instead of this repo's real `.env` — which gains `PAPER_FILE_ID` in Task 7 and would otherwise make the "no target file" tests pass for the wrong reason.

- [ ] **Step 2: Write the failing doctor tests**

```js
// tests/paper-integration/paper-doctor.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFakePaper, runScript } from "./helpers/fake-paper.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(
  __dirname,
  "../../packages/paper-integration/scripts/doctor.mjs",
);

test("doctor: all green → exit 0, four ✓ lines, zero metered calls", async () => {
  const fake = await startFakePaper();
  try {
    const r = await runScript(SCRIPT, [], {
      PAPER_MCP_URL: fake.url,
      PAPER_FILE_ID: "F1",
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(
      r.stdout.split("\n").filter((l) => l.trim().startsWith("✓")).length,
      4,
    );
    assert.match(r.stdout, /paper: canvas ready/);
    assert.match(r.stderr, /metered calls: 0/);
    assert.ok(
      fake.calls.every((c) => c.method !== "tools/call"),
      "doctor must not spend metered calls",
    );
  } finally {
    await fake.close();
  }
});

test("doctor: unreachable → exit 2, first check ✗ with the fix line", async () => {
  const r = await runScript(SCRIPT, [], {
    PAPER_MCP_URL: "http://127.0.0.1:1/mcp",
    PAPER_FILE_ID: "F1",
  });
  assert.equal(r.status, 2);
  assert.match(r.stdout, /✗ Paper Desktop MCP/);
  assert.match(r.stdout, /open a file in Paper Desktop/);
  assert.match(r.stdout, /paper: canvas not ready/);
});

test("doctor: wrong server name → exit 2", async () => {
  const fake = await startFakePaper({
    serverInfo: { name: "something-else", version: "0.5.6" },
  });
  try {
    const r = await runScript(SCRIPT, [], {
      PAPER_MCP_URL: fake.url,
      PAPER_FILE_ID: "F1",
    });
    assert.equal(r.status, 2);
    assert.match(r.stdout, /✗ Paper Desktop MCP/);
  } finally {
    await fake.close();
  }
});

test("doctor: newer version → still exit 0 but WARN re-verify", async () => {
  const fake = await startFakePaper({
    serverInfo: { name: "paper-desktop", version: "0.6.0" },
  });
  try {
    const r = await runScript(SCRIPT, [], {
      PAPER_MCP_URL: fake.url,
      PAPER_FILE_ID: "F1",
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /⚠ .*0\.6\.0.*pinned 0\.5\.6/);
  } finally {
    await fake.close();
  }
});

test("doctor: missing required tool → exit 2 naming it", async () => {
  const fake = await startFakePaper({
    tools: ["get_tokens", "create_tokens", "export", "write_html"],
  });
  try {
    const r = await runScript(SCRIPT, [], {
      PAPER_MCP_URL: fake.url,
      PAPER_FILE_ID: "F1",
    });
    assert.equal(r.status, 2);
    assert.match(r.stdout, /✗ required tools.*set_tokens/);
  } finally {
    await fake.close();
  }
});

test("doctor: no file id → exit 2 with the fix line; --file satisfies it", async () => {
  const fake = await startFakePaper();
  try {
    const r1 = await runScript(SCRIPT, [], { PAPER_MCP_URL: fake.url });
    assert.equal(r1.status, 2);
    assert.match(r1.stdout, /✗ target file.*set PAPER_FILE_ID/);
    const r2 = await runScript(SCRIPT, ["--file", "abc"], {
      PAPER_MCP_URL: fake.url,
    });
    assert.equal(r2.status, 0);
  } finally {
    await fake.close();
  }
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test tests/paper-integration/paper-doctor.test.mjs`
Expected: FAIL — cannot find `scripts/doctor.mjs`

- [ ] **Step 4: Implement `scripts/doctor.mjs`**

```js
#!/usr/bin/env node
// doctor.mjs — is the Paper canvas ready? Exit 0 green, 2 not-ready.
// ZERO metered calls: only `initialize` and `tools/list`.
import { parseArgs } from "node:util";
import {
  createClient,
  loadConfig,
  PIN,
  REQUIRED_TOOLS,
} from "../lib/paper.mjs";

const { values } = parseArgs({
  options: { file: { type: "string" }, tokens: { type: "string" } },
  strict: false,
});
const cfg = loadConfig({ tokensPath: values.tokens, file: values.file });
const client = createClient({ url: cfg.url, timeoutMs: 5000 });

const checks = []; // { ok, label, fix?, warn? }
let info = null;
try {
  info = await client.initialize();
  const nameOk = info?.serverInfo?.name === PIN.server;
  checks.push({
    ok: nameOk,
    label: `Paper Desktop MCP at ${cfg.url}${nameOk ? ` (${info.serverInfo.name} ${info.serverInfo.version})` : ` answered as "${info?.serverInfo?.name}"`}`,
    fix: nameOk
      ? null
      : "expected paper-desktop — is something else on port 29979?",
  });
} catch (e) {
  checks.push({
    ok: false,
    label: `Paper Desktop MCP at ${cfg.url}`,
    fix: "open a file in Paper Desktop — the app starts the MCP server on file open",
  });
}

if (info) {
  const v = info.serverInfo?.version;
  const same = v === PIN.app;
  checks.push({
    ok: true,
    warn: same
      ? null
      : `running ${v}, pinned ${PIN.app} — re-observe VERIFIED.md before trusting the client`,
    label: `version ${v}${same ? " matches pin" : ""}`,
  });
  try {
    const names = new Set((await client.listTools()).map((t) => t.name));
    const missing = REQUIRED_TOOLS.filter((t) => !names.has(t));
    checks.push({
      ok: missing.length === 0,
      label: `required tools ${missing.length ? `missing: ${missing.join(", ")}` : `present (${REQUIRED_TOOLS.length}/${REQUIRED_TOOLS.length} of ${names.size})`}`,
      fix: missing.length
        ? "Paper surface drifted — update VERIFIED.md, then REQUIRED_TOOLS"
        : null,
    });
  } catch (e) {
    checks.push({
      ok: false,
      label: "required tools",
      fix: `tools/list failed: ${e.message}`,
    });
  }
} else {
  checks.push({ ok: false, label: "version (unknown — server unreachable)" });
  checks.push({
    ok: false,
    label: "required tools (unknown — server unreachable)",
  });
}

checks.push({
  ok: Boolean(cfg.fileId),
  label: `target file ${cfg.fileId ? cfg.fileId : "not configured"}`,
  fix: cfg.fileId
    ? null
    : "set PAPER_FILE_ID in .env (instance or framework) or pass --file <id>",
});

for (const c of checks) {
  console.log(
    ` ${c.ok ? (c.warn ? "⚠" : "✓") : "✗"} ${c.label}${c.warn ? ` — ${c.warn}` : ""}${!c.ok && c.fix ? ` — ${c.fix}` : ""}`,
  );
}
const ok = checks.every((c) => c.ok);
console.log(ok ? "paper: canvas ready" : "paper: canvas not ready");
console.error(`metered calls: ${client.metered}`);
process.exit(ok ? 0 : 2);
```

- [ ] **Step 5: Run doctor tests to verify they pass**

Run: `node --test tests/paper-integration/paper-doctor.test.mjs`
Expected: PASS, 6 tests

- [ ] **Step 6: Write the failing call tests**

```js
// tests/paper-integration/paper-call.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFakePaper, runScript } from "./helpers/fake-paper.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(
  __dirname,
  "../../packages/paper-integration/scripts/call.mjs",
);

test("call: forwards tool + args + fileId, prints result JSON, metered 1", async () => {
  const fake = await startFakePaper({
    handlers: {
      get_basic_info: (a) => ({
        content: [
          {
            type: "text",
            text: JSON.stringify({ file: a.fileId, artboards: [] }),
          },
        ],
      }),
    },
  });
  try {
    const r = await runScript(SCRIPT, ["get_basic_info", "{}"], {
      PAPER_MCP_URL: fake.url,
      PAPER_FILE_ID: "F9",
    });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(
      out.content[0].text,
      JSON.stringify({ file: "F9", artboards: [] }),
    );
    assert.match(r.stderr, /metered calls: 1/);
    const call = fake.calls.find((c) => c.method === "tools/call");
    assert.deepEqual(call.params, {
      name: "get_basic_info",
      arguments: { fileId: "F9" },
    });
  } finally {
    await fake.close();
  }
});

test("call: --args-file supplies large arguments; --out writes base64 image content", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "paper-call-"));
  const argsFile = path.join(dir, "args.json");
  writeFileSync(argsFile, JSON.stringify({ nodeId: "N1", scale: 1 }));
  const png = Buffer.from("fake-png-bytes").toString("base64");
  const fake = await startFakePaper({
    handlers: {
      get_screenshot: () => ({
        content: [{ type: "image", mimeType: "image/png", data: png }],
      }),
    },
  });
  try {
    const out = path.join(dir, "shot.png");
    const r = await runScript(
      SCRIPT,
      ["get_screenshot", "--args-file", argsFile, "--out", out],
      { PAPER_MCP_URL: fake.url, PAPER_FILE_ID: "F9" },
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(out, "utf8"), "fake-png-bytes");
    assert.match(r.stderr, /wrote .*shot\.png/);
    const call = fake.calls.find((c) => c.method === "tools/call");
    assert.deepEqual(call.params.arguments, {
      nodeId: "N1",
      scale: 1,
      fileId: "F9",
    });
  } finally {
    await fake.close();
  }
});

test("call: no file id → exit 2 before any metered call", async () => {
  const fake = await startFakePaper();
  try {
    const r = await runScript(SCRIPT, ["get_basic_info"], {
      PAPER_MCP_URL: fake.url,
    });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /PAPER_FILE_ID/);
    assert.ok(!fake.calls.some((c) => c.method === "tools/call"));
  } finally {
    await fake.close();
  }
});

test("call: rpc error → exit 1 with the message", async () => {
  const fake = await startFakePaper({
    handlers: { write_html: () => new Error("targetNodeId not found") },
  });
  try {
    const r = await runScript(
      SCRIPT,
      [
        "write_html",
        '{"html":"<div/>","targetNodeId":"X","mode":"insert-children"}',
      ],
      { PAPER_MCP_URL: fake.url, PAPER_FILE_ID: "F9" },
    );
    assert.equal(r.status, 1);
    assert.match(r.stderr, /targetNodeId not found/);
  } finally {
    await fake.close();
  }
});
```

- [ ] **Step 7: Run call tests to verify they fail**

Run: `node --test tests/paper-integration/paper-call.test.mjs`
Expected: FAIL — cannot find `scripts/call.mjs`

- [ ] **Step 8: Implement `scripts/call.mjs`**

```js
#!/usr/bin/env node
// call.mjs — generic `tools/call` passthrough. For agents driving the canvas
// from a shell (and for the prototype). Always passes fileId. Prints the
// result JSON on stdout and `metered calls: N` on stderr.
//   node scripts/call.mjs <tool> [json-args] [--args-file p] [--file id] [--out p] [--tokens brand.yaml]
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync } from "node:fs";
import { createClient, loadConfig, PaperError } from "../lib/paper.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    file: { type: "string" },
    tokens: { type: "string" },
    "args-file": { type: "string" },
    out: { type: "string" },
  },
});
const [tool, inlineJson] = positionals;
if (!tool) {
  console.error(
    "usage: call.mjs <tool> [json-args] [--args-file p] [--file id] [--out p]",
  );
  process.exit(2);
}
const cfg = loadConfig({ tokensPath: values.tokens, file: values.file });
if (!cfg.fileId) {
  console.error(
    "paper: no target file — set PAPER_FILE_ID in .env or pass --file <id>",
  );
  process.exit(2);
}
let args = {};
if (values["args-file"])
  args = JSON.parse(readFileSync(values["args-file"], "utf8"));
else if (inlineJson) args = JSON.parse(inlineJson);
args = { ...args, fileId: cfg.fileId };

const client = createClient({ url: cfg.url, timeoutMs: 60000 });
try {
  const result = await client.call(tool, args);
  if (values.out) {
    const img = result?.content?.find((c) => c.type === "image" && c.data);
    if (img) {
      writeFileSync(values.out, Buffer.from(img.data, "base64"));
      console.error(`wrote ${values.out} (${img.mimeType ?? "image"})`);
    } else {
      console.error(
        `--out given but the reply carries no image content; result printed instead`,
      );
    }
  }
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  console.error(`metered calls: ${client.metered}`);
  process.exit(0);
} catch (e) {
  console.error(`metered calls: ${client.metered}`);
  if (e instanceof PaperError) {
    console.error(`paper: ${e.code} — ${e.message}`);
    process.exit(e.code === "unreachable" ? 2 : 1);
  }
  throw e;
}
```

- [ ] **Step 9: Run call tests to verify they pass**

Run: `node --test tests/paper-integration/paper-call.test.mjs`
Expected: PASS, 4 tests

- [ ] **Step 10: Add npm scripts**

In `package.json` `scripts`, directly after the `"buzz:read"` line, add:

```json
    "paper:doctor": "node packages/paper-integration/scripts/doctor.mjs",
    "paper:call": "node packages/paper-integration/scripts/call.mjs",
```

Run: `npm run paper:doctor` (with Paper closed or open — either way it must print four check lines and exit 0 or 2, never throw). Expected: check lines + `paper: canvas …` + `metered calls: 0`.

- [ ] **Step 11: Format and commit**

```bash
npx prettier --write packages/paper-integration/scripts/doctor.mjs packages/paper-integration/scripts/call.mjs tests/paper-integration/helpers/fake-paper.mjs tests/paper-integration/paper-doctor.test.mjs tests/paper-integration/paper-call.test.mjs package.json
node --test tests/paper-integration/
git add packages/paper-integration/scripts/doctor.mjs packages/paper-integration/scripts/call.mjs tests/paper-integration/helpers/fake-paper.mjs tests/paper-integration/paper-doctor.test.mjs tests/paper-integration/paper-call.test.mjs package.json
git commit -m "feat(paper): doctor (four free checks, exit 0/2) + generic call passthrough; in-process fake Paper server for tests"
```

---

### Task 4: `push-tokens.mjs`

**Files:**

- Create: `packages/paper-integration/scripts/push-tokens.mjs`
- Modify: `package.json` (script)
- Test: `tests/paper-integration/paper-push-tokens.test.mjs`

**Interfaces:**

- Consumes: `loadBrand`, `planTokens`, `diffTokens` (Task 2); `createClient`, `loadConfig`, `extractTokens`, `PaperError` (Task 1); `startFakePaper`, `runScript` (Task 3).
- Produces: `npm run paper:push-tokens -- --tokens <brand.yaml> [--file <id>] [--canvas-width 1080] [--dry-run] [--prune]`. Exit 0 ok · 1 Paper rejected a write · 2 not-ready/usage. Stdout summary lines: `plan: N tokens · S skipped · C converted`, `create: n`, `update: n`, `unchanged: n`, `extra: n (use --prune to delete)`, then `skipped: <name> — <reason>` lines, then on real runs `created: n · updated: n · pruned: n`.

- [ ] **Step 1: Write the failing tests**

```js
// tests/paper-integration/paper-push-tokens.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFakePaper, runScript } from "./helpers/fake-paper.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(
  __dirname,
  "../../packages/paper-integration/scripts/push-tokens.mjs",
);
const FIXTURE = path.resolve(
  __dirname,
  "../fixtures/paper/brand.refi-dao.yaml",
);
const text = (obj) => ({
  content: [{ type: "text", text: JSON.stringify(obj) }],
});

// A fake Paper with a mutable token store so create/set/delete are observable.
function tokenStore(initial = []) {
  const store = new Map(initial.map((t) => [t.name, t]));
  const handlers = {
    get_tokens: () => text([...store.values()]),
    create_tokens: ({ tokens }) => {
      for (const t of tokens) store.set(t.name, t);
      return text(tokens.map((t) => ({ name: t.name, result: "created" })));
    },
    set_tokens: ({ tokens }) => {
      for (const t of tokens) {
        if (t.delete) store.delete(t.name);
        else store.set(t.name, { ...store.get(t.name), ...t });
      }
      return text(
        tokens.map((t) => ({
          name: t.name,
          result: t.delete ? "deleted" : "updated",
        })),
      );
    },
  };
  return { store, handlers };
}

const metered = (fake) => fake.calls.filter((c) => c.method === "tools/call");

test("push --dry-run: prints the plan, spends zero metered calls", async () => {
  const fake = await startFakePaper(tokenStore());
  try {
    const r = await runScript(SCRIPT, ["--tokens", FIXTURE, "--dry-run"], {
      PAPER_MCP_URL: fake.url,
      PAPER_FILE_ID: "F1",
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /plan: 75 tokens · 4 skipped · 31 converted/);
    assert.match(r.stdout, /skipped: --refi-glow-blue — no Paper token type/);
    assert.match(r.stdout, /dry-run: nothing sent/);
    assert.equal(metered(fake).length, 0);
    assert.match(r.stderr, /metered calls: 0/);
  } finally {
    await fake.close();
  }
});

test("push: empty file → 1 get + 1 create batch with fileId; second run costs 1 call and changes nothing", async () => {
  const ts = tokenStore();
  const fake = await startFakePaper(ts);
  try {
    const r1 = await runScript(SCRIPT, ["--tokens", FIXTURE], {
      PAPER_MCP_URL: fake.url,
      PAPER_FILE_ID: "F1",
    });
    assert.equal(r1.status, 0, r1.stderr);
    const m1 = metered(fake);
    assert.deepEqual(
      m1.map((c) => c.params.name),
      ["get_tokens", "create_tokens"],
    );
    assert.equal(m1[1].params.arguments.fileId, "F1");
    assert.equal(m1[1].params.arguments.tokens.length, 75);
    assert.match(r1.stdout, /created: 75 · updated: 0 · pruned: 0/);
    assert.match(r1.stderr, /metered calls: 2/);
    assert.equal(ts.store.get("--refi-weight-bold").value, 700);
    assert.equal(ts.store.get("--refi-text-hero").value, "86px");

    fake.calls.length = 0;
    const r2 = await runScript(SCRIPT, ["--tokens", FIXTURE], {
      PAPER_MCP_URL: fake.url,
      PAPER_FILE_ID: "F1",
    });
    assert.equal(r2.status, 0);
    assert.deepEqual(
      metered(fake).map((c) => c.params.name),
      ["get_tokens"],
    );
    assert.match(r2.stdout, /created: 0 · updated: 0 · pruned: 0/);
    assert.match(r2.stderr, /metered calls: 1/);
  } finally {
    await fake.close();
  }
});

test("push: changed value → set_tokens only for the changed names; extras reported not deleted", async () => {
  const ts = tokenStore([
    { type: "color", name: "--refi-color-blue", value: "#000000" },
    { type: "color", name: "--refi-legacy", value: "#123456" },
    { type: "color", name: "--color-primary", value: "#ffffff" },
  ]);
  const fake = await startFakePaper(ts);
  try {
    const r = await runScript(SCRIPT, ["--tokens", FIXTURE], {
      PAPER_MCP_URL: fake.url,
      PAPER_FILE_ID: "F1",
    });
    assert.equal(r.status, 0, r.stderr);
    const names = metered(fake).map((c) => c.params.name);
    assert.deepEqual(names, ["get_tokens", "create_tokens", "set_tokens"]);
    const set = metered(fake)[2].params.arguments.tokens;
    assert.deepEqual(set, [
      {
        name: "--refi-color-blue",
        value: "#4571E1",
        description: "brand.yaml color-blue",
      },
    ]);
    assert.match(r.stdout, /extra: 1 \(use --prune to delete\)/);
    assert.ok(ts.store.has("--refi-legacy"));
    assert.ok(ts.store.has("--color-primary"));
  } finally {
    await fake.close();
  }
});

test("push --prune: deletes only prefix-carrying extras", async () => {
  const ts = tokenStore([
    { type: "color", name: "--refi-legacy", value: "#123456" },
    { type: "color", name: "--color-primary", value: "#ffffff" },
  ]);
  const fake = await startFakePaper(ts);
  try {
    const r = await runScript(SCRIPT, ["--tokens", FIXTURE, "--prune"], {
      PAPER_MCP_URL: fake.url,
      PAPER_FILE_ID: "F1",
    });
    assert.equal(r.status, 0, r.stderr);
    const set = metered(fake).find((c) => c.params.name === "set_tokens").params
      .arguments.tokens;
    assert.deepEqual(set, [{ name: "--refi-legacy", delete: true }]);
    assert.ok(!ts.store.has("--refi-legacy"));
    assert.ok(ts.store.has("--color-primary"));
    assert.match(r.stdout, /pruned: 1/);
  } finally {
    await fake.close();
  }
});

test("push: unreachable → exit 2; missing --tokens → exit 2 usage", async () => {
  const r1 = await runScript(SCRIPT, ["--tokens", FIXTURE], {
    PAPER_MCP_URL: "http://127.0.0.1:1/mcp",
    PAPER_FILE_ID: "F1",
  });
  assert.equal(r1.status, 2);
  assert.match(r1.stderr, /unreachable/);
  const r2 = await runScript(SCRIPT, [], { PAPER_FILE_ID: "F1" });
  assert.equal(r2.status, 2);
  assert.match(r2.stderr, /--tokens/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/paper-integration/paper-push-tokens.test.mjs`
Expected: FAIL — cannot find `scripts/push-tokens.mjs`

- [ ] **Step 3: Implement `scripts/push-tokens.mjs`**

```js
#!/usr/bin/env node
// push-tokens.mjs — brand.yaml `tokens:` → Paper design tokens. One way.
// get_tokens (1) → diff → create_tokens (≤1) → set_tokens (≤1). --dry-run is free.
import { parseArgs } from "node:util";
import {
  createClient,
  loadConfig,
  extractTokens,
  PaperError,
} from "../lib/paper.mjs";
import { loadBrand, planTokens, diffTokens } from "../lib/tokens.mjs";

const { values } = parseArgs({
  options: {
    tokens: { type: "string" },
    file: { type: "string" },
    "canvas-width": { type: "string", default: "1080" },
    "dry-run": { type: "boolean", default: false },
    prune: { type: "boolean", default: false },
  },
});
if (!values.tokens) {
  console.error(
    "usage: push-tokens.mjs --tokens <brand.yaml> [--file <id>] [--canvas-width 1080] [--dry-run] [--prune]",
  );
  process.exit(2);
}
const brand = loadBrand(values.tokens);
const plan = planTokens(brand, { canvasWidth: Number(values["canvas-width"]) });
console.log(
  `plan: ${plan.tokens.length} tokens · ${plan.skipped.length} skipped · ${plan.converted.length} converted (prefix --${brand.prefix}, source ${brand.source})`,
);
for (const s of plan.skipped) console.log(`skipped: ${s.name} — ${s.reason}`);

const cfg = loadConfig({ tokensPath: values.tokens, file: values.file });
const client = createClient({ url: cfg.url });

if (values["dry-run"]) {
  for (const c of plan.converted)
    console.log(`converted: ${c.name} ${c.from} → ${c.to}`);
  console.log("dry-run: nothing sent");
  console.error(`metered calls: ${client.metered}`);
  process.exit(0);
}
if (!cfg.fileId) {
  console.error(
    "paper: no target file — set PAPER_FILE_ID in .env or pass --file <id>",
  );
  process.exit(2);
}

try {
  const existing = extractTokens(
    await client.call("get_tokens", { fileId: cfg.fileId }),
  );
  const diff = diffTokens(plan.tokens, existing, { prefix: brand.prefix });
  console.log(`create: ${diff.create.length}`);
  console.log(`update: ${diff.update.length}`);
  console.log(`unchanged: ${diff.unchanged.length}`);
  console.log(
    `extra: ${diff.extra.length}${diff.extra.length && !values.prune ? " (use --prune to delete)" : ""}`,
  );

  let created = 0;
  let updated = 0;
  let pruned = 0;
  if (diff.create.length) {
    await client.call("create_tokens", {
      fileId: cfg.fileId,
      tokens: diff.create,
    });
    created = diff.create.length;
  }
  const sets = [...diff.update];
  if (values.prune)
    for (const name of diff.extra) sets.push({ name, delete: true });
  if (sets.length) {
    await client.call("set_tokens", { fileId: cfg.fileId, tokens: sets });
    updated = diff.update.length;
    pruned = values.prune ? diff.extra.length : 0;
  }
  console.log(`created: ${created} · updated: ${updated} · pruned: ${pruned}`);
  console.error(`metered calls: ${client.metered}`);
  process.exit(0);
} catch (e) {
  console.error(`metered calls: ${client.metered}`);
  if (e instanceof PaperError) {
    console.error(`paper: ${e.code} — ${e.message}`);
    process.exit(e.code === "unreachable" ? 2 : 1);
  }
  throw e;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/paper-integration/paper-push-tokens.test.mjs`
Expected: PASS, 5 tests. If `plan: 75 tokens` mismatches, recount: 79 fixture tokens − 4 skipped = 75.

- [ ] **Step 5: Add npm script, format, commit**

In `package.json` after `"paper:call"`:

```json
    "paper:push-tokens": "node packages/paper-integration/scripts/push-tokens.mjs",
```

```bash
npx prettier --write packages/paper-integration/scripts/push-tokens.mjs tests/paper-integration/paper-push-tokens.test.mjs package.json
node --test tests/paper-integration/
git add packages/paper-integration/scripts/push-tokens.mjs tests/paper-integration/paper-push-tokens.test.mjs package.json
git commit -m "feat(paper): push-tokens — diffed, idempotent brand.yaml → Paper token sync; --dry-run free, --prune prefix-scoped"
```

---

### Task 5: `lint-tokens.mjs`

**Files:**

- Create: `packages/paper-integration/scripts/lint-tokens.mjs`
- Modify: `package.json` (script)
- Test: `tests/paper-integration/paper-lint-tokens.test.mjs`

**Interfaces:**

- Consumes: Task 1, 2, 3 exports as in Task 4.
- Produces: `npm run paper:lint-tokens -- --tokens <brand.yaml> [--file <id>] [--canvas-width 1080] [--strict]`. Exit 0 in sync · 1 drift · 2 not-ready. Lines: `missing: <name>` · `changed: <name> paper=<v> brand=<v>` · `extra: <name>` · final `paper tokens: in sync (75 checked)` or `paper tokens: DRIFT — m missing · c changed · e extra`.

- [ ] **Step 1: Write the failing tests**

```js
// tests/paper-integration/paper-lint-tokens.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFakePaper, runScript } from "./helpers/fake-paper.mjs";
import {
  loadBrand,
  planTokens,
} from "../../packages/paper-integration/lib/tokens.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(
  __dirname,
  "../../packages/paper-integration/scripts/lint-tokens.mjs",
);
const FIXTURE = path.resolve(
  __dirname,
  "../fixtures/paper/brand.refi-dao.yaml",
);
const text = (obj) => ({
  content: [{ type: "text", text: JSON.stringify(obj) }],
});
const synced = () =>
  planTokens(loadBrand(FIXTURE)).tokens.map(({ type, name, value }) => ({
    type,
    name,
    value,
  }));

test("lint: in sync → exit 0, one metered call", async () => {
  const fake = await startFakePaper({
    handlers: { get_tokens: () => text(synced()) },
  });
  try {
    const r = await runScript(SCRIPT, ["--tokens", FIXTURE], {
      PAPER_MCP_URL: fake.url,
      PAPER_FILE_ID: "F1",
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /paper tokens: in sync \(75 checked\)/);
    assert.match(r.stderr, /metered calls: 1/);
  } finally {
    await fake.close();
  }
});

test("lint: missing and changed → exit 1 naming each", async () => {
  const tokens = synced().filter((t) => t.name !== "--refi-space-4");
  tokens.find((t) => t.name === "--refi-color-blue").value = "#000000";
  const fake = await startFakePaper({
    handlers: { get_tokens: () => text(tokens) },
  });
  try {
    const r = await runScript(SCRIPT, ["--tokens", FIXTURE], {
      PAPER_MCP_URL: fake.url,
      PAPER_FILE_ID: "F1",
    });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /missing: --refi-space-4/);
    assert.match(
      r.stdout,
      /changed: --refi-color-blue paper=#000000 brand=#4571E1/,
    );
    assert.match(
      r.stdout,
      /paper tokens: DRIFT — 1 missing · 1 changed · 0 extra/,
    );
  } finally {
    await fake.close();
  }
});

test("lint: extras are reported but pass unless --strict", async () => {
  const tokens = [
    ...synced(),
    { type: "color", name: "--refi-rogue", value: "#ff0000" },
  ];
  const fake = await startFakePaper({
    handlers: { get_tokens: () => text(tokens) },
  });
  try {
    const r1 = await runScript(SCRIPT, ["--tokens", FIXTURE], {
      PAPER_MCP_URL: fake.url,
      PAPER_FILE_ID: "F1",
    });
    assert.equal(r1.status, 0);
    assert.match(r1.stdout, /extra: --refi-rogue/);
    const r2 = await runScript(SCRIPT, ["--tokens", FIXTURE, "--strict"], {
      PAPER_MCP_URL: fake.url,
      PAPER_FILE_ID: "F1",
    });
    assert.equal(r2.status, 1);
  } finally {
    await fake.close();
  }
});

test("lint: unreachable → exit 2", async () => {
  const r = await runScript(SCRIPT, ["--tokens", FIXTURE], {
    PAPER_MCP_URL: "http://127.0.0.1:1/mcp",
    PAPER_FILE_ID: "F1",
  });
  assert.equal(r.status, 2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/paper-integration/paper-lint-tokens.test.mjs`
Expected: FAIL — cannot find `scripts/lint-tokens.mjs`

- [ ] **Step 3: Implement `scripts/lint-tokens.mjs`**

```js
#!/usr/bin/env node
// lint-tokens.mjs — is the Paper file's token set in sync with brand.yaml?
// Exactly one metered call. Exit 0 in sync, 1 drift, 2 not-ready.
import { parseArgs } from "node:util";
import {
  createClient,
  loadConfig,
  extractTokens,
  PaperError,
} from "../lib/paper.mjs";
import { loadBrand, planTokens, diffTokens } from "../lib/tokens.mjs";

const { values } = parseArgs({
  options: {
    tokens: { type: "string" },
    file: { type: "string" },
    "canvas-width": { type: "string", default: "1080" },
    strict: { type: "boolean", default: false },
  },
});
if (!values.tokens) {
  console.error(
    "usage: lint-tokens.mjs --tokens <brand.yaml> [--file <id>] [--canvas-width 1080] [--strict]",
  );
  process.exit(2);
}
const brand = loadBrand(values.tokens);
const plan = planTokens(brand, { canvasWidth: Number(values["canvas-width"]) });
const cfg = loadConfig({ tokensPath: values.tokens, file: values.file });
if (!cfg.fileId) {
  console.error(
    "paper: no target file — set PAPER_FILE_ID in .env or pass --file <id>",
  );
  process.exit(2);
}
const client = createClient({ url: cfg.url });
try {
  const existing = extractTokens(
    await client.call("get_tokens", { fileId: cfg.fileId }),
  );
  const byName = new Map(existing.map((t) => [t.name, t]));
  const diff = diffTokens(plan.tokens, existing, { prefix: brand.prefix });
  for (const t of diff.create) console.log(`missing: ${t.name}`);
  for (const u of diff.update)
    console.log(
      `changed: ${u.name} paper=${byName.get(u.name).value} brand=${u.value}`,
    );
  for (const n of diff.extra) console.log(`extra: ${n}`);
  const drift =
    diff.create.length +
    diff.update.length +
    (values.strict ? diff.extra.length : 0);
  if (drift === 0)
    console.log(
      `paper tokens: in sync (${plan.tokens.length} checked)${diff.extra.length ? ` · ${diff.extra.length} extra tolerated (--strict to fail)` : ""}`,
    );
  else
    console.log(
      `paper tokens: DRIFT — ${diff.create.length} missing · ${diff.update.length} changed · ${diff.extra.length} extra`,
    );
  console.error(`metered calls: ${client.metered}`);
  process.exit(drift === 0 ? 0 : 1);
} catch (e) {
  console.error(`metered calls: ${client.metered}`);
  if (e instanceof PaperError) {
    console.error(`paper: ${e.code} — ${e.message}`);
    process.exit(e.code === "unreachable" ? 2 : 1);
  }
  throw e;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/paper-integration/paper-lint-tokens.test.mjs`
Expected: PASS, 4 tests

- [ ] **Step 5: Add npm script, run the whole suite, format, commit**

In `package.json` after `"paper:push-tokens"`:

```json
    "paper:lint-tokens": "node packages/paper-integration/scripts/lint-tokens.mjs",
```

```bash
npx prettier --write packages/paper-integration/scripts/lint-tokens.mjs tests/paper-integration/paper-lint-tokens.test.mjs package.json
npm test
git add packages/paper-integration/scripts/lint-tokens.mjs tests/paper-integration/paper-lint-tokens.test.mjs package.json
git commit -m "feat(paper): lint-tokens — one-call drift check, Paper-side twin of lint:brand"
```

Expected: `npm test` green including all prior suites.

---

### Task 6: Module manifest, catalog entries, registry rows, env placeholders

**Files:**

- Create: `modules/org-os-paper/module.yaml`
- Modify: `docs/MODULES.md` (insert after the `org-os-buzz` section, before `## The v5 core tranche`)
- Modify: `site/src/data/modules.yaml` (add row after `org-os-buzz`)
- Modify: `data/packages-matrix.yaml` (add after the `buzz-integration` entry)
- Modify: `.env.example` (append)

**Interfaces:**

- Consumes: nothing new. Produces the catalog surface Task 11 flips from `in-dev` to `pilot`.

- [ ] **Step 1: Write the manifest**

```yaml
# modules/org-os-paper/module.yaml
# org-os-paper — the Paper design-canvas integration (module #5).
#
# An IN-PLACE module: everything it owns already sits at its canonical path.
# The external dependency (Paper Desktop 0.5.6, MCP 2025-03-26) is recorded in
# packages/paper-integration/VERIFIED.md, not here — the v5 schema models
# module-to-module deps only.
id: org-os-paper
version: 0.1.0
type: integration
description: >-
  Paper design canvas — an org's brand.yaml tokens are pushed into a Paper
  file (one way, diffed, idempotent) and linted for drift, so agents design
  DESIGN.md compositions on a human-editable canvas without inventing a
  colour. Thin JSON-RPC client over Paper Desktop's local MCP server; agents
  use Paper's own tools for the drawing. Free-tier metered-call budget is a
  first-class constraint (doctor spends zero).
dependencies:
  - org-os-standards
files:
  packages/paper-integration: packages/paper-integration
checks:
  - file-exists: packages/paper-integration/lib/paper.mjs
  - file-exists: packages/paper-integration/VERIFIED.md
```

Run: `node --test tests/scripts/module-manifests.test.mjs`
Expected: PASS. Note `tests/scripts/module-manifests.test.mjs:55` asserts every `files:` target **already exists on disk** — which is why this manifest claims only `packages/paper-integration` (created in Task 1). Task 8 adds the `skills/paper-design` mapping when it creates that directory. `checks:` entries are "reserved for Phase 3" and are not executed, so naming `VERIFIED.md` (Task 7) here is safe.

- [ ] **Step 2: Add the MODULES.md entry**

Insert immediately before the line `## The v5 core tranche` (currently line 156):

```markdown
### org-os-paper — Paper Design Canvas

**What it is.** A human-editable design canvas for on-brand artifacts. An agent asked for a
social card today writes a self-contained HTML file; a steward who wants to nudge the headline
edits CSS. With [Paper](https://paper.design) — a canvas whose every element is real HTML/CSS —
the agent drafts the composition from the org's brand tokens, the human refines it by hand, and
PNG/SVG/JSX exports flow back into the repo.

**How it works.** `packages/paper-integration/` speaks the MCP wire format directly to Paper
Desktop's local server (`http://127.0.0.1:29979/mcp`, three JSON-RPC methods, no SDK). A pure
planner maps a brand.yaml-shaped token map onto Paper's ten token types — names preserved
verbatim (`--refi-color-blue`), rem→px, one-way — and `paper:push-tokens` syncs it diffed and
idempotently in ≤3 metered calls; `paper:lint-tokens` is the Paper-side twin of an instance's
`lint:brand`. `paper:doctor` spends zero metered calls. **org-os never draws:** agents design
through Paper's own tools following `skills/paper-design/SKILL.md`, under a per-artifact call
budget (the free tier allows 100 metered calls a week). Registration is instance-level opt-in via
a committed `.mcp.json`.

**Status.** `in-dev` — package and tests ship; live verification against Paper 0.5.6 and the
refi-dao-os prototype (Tier-2 brief 02, the GrowFi social card, ≤30 metered calls) are the
acceptance gate to `pilot`. See `docs/integrations/paper.md`.

**Links:** [manifest](../modules/org-os-paper/module.yaml) ·
[runbook](integrations/paper.md) ·
[design](superpowers/specs/2026-09-02-paper-integration-design.md) ·
package `packages/paper-integration/`

---
```

- [ ] **Step 3: Add the site mirror row**

In `site/src/data/modules.yaml`, after the `org-os-buzz` block, add:

```yaml
- id: org-os-paper
  name: Paper Design Canvas
  status: in-dev
  summary: Brand tokens pushed into a Paper design file, drift-linted; agents draft on-brand compositions a human refines by hand. Package built, live verification pending.
  link: /docs/modules
```

- [ ] **Step 4: Add the packages-matrix row**

After the `buzz-integration` entry in `data/packages-matrix.yaml`:

```yaml
- id: "paper-integration"
  owner: "framework"
  instances_using: []
  in_framework: true
  promotion_status: "evaluating"
  lifecycle_status: "active"
  notes: "@paper-integration — thin MCP wire client (lib/paper.mjs) over Paper Desktop's local server + pure token planner (lib/tokens.mjs). npm run paper:doctor (zero metered calls) / paper:push-tokens (brand.yaml → Paper tokens, diffed, ≤3 calls) / paper:lint-tokens (1 call) / paper:call (passthrough). Ships modules/org-os-paper/module.yaml as module #5. Live verification and the refi-dao-os brief-02 prototype pending (VERIFIED.md)."
```

- [ ] **Step 5: Append to `.env.example`**

```bash
cat >> .env.example <<'EOF'

# Paper design canvas — runbook: docs/integrations/paper.md (spec: docs/superpowers/specs/2026-09-02-paper-integration-design.md)
# The MCP server is started by Paper Desktop when a file is open; loopback, unauthenticated, no credential exists.
# PAPER_MCP_URL only needs setting to override the default shown.
# PAPER_FILE_ID: the target Paper file — bare id, /file/<id> path, or full URL. Per operator, so it lives here, not in TOOLS.md.
# Free tier = 100 metered MCP tool calls/week. doctor spends 0, push ≤3, one artifact ≤25.
PAPER_MCP_URL=http://127.0.0.1:29979/mcp
PAPER_FILE_ID=
EOF
```

- [ ] **Step 6: Verify every gate, format, commit**

```bash
node --test tests/scripts/module-manifests.test.mjs
npm --prefix site test
npm run validate:structure
npx prettier --write modules/org-os-paper/module.yaml docs/MODULES.md site/src/data/modules.yaml data/packages-matrix.yaml
git add modules/org-os-paper/module.yaml docs/MODULES.md site/src/data/modules.yaml data/packages-matrix.yaml .env.example
git commit -m "feat(modules): org-os-paper manifest (module #5, in-dev) + catalog entry, site mirror, packages-matrix row, env placeholders"
```

Expected: manifest test PASS; site test PASS (`org-os-paper` present in MODULES.md with the em-dash heading); validate:structure `0 failed`.

---

### Task 7: Live verification against Paper 0.5.6 — VERIFIED.md

**Files:**

- Create: `packages/paper-integration/VERIFIED.md`
- Possibly modify: `packages/paper-integration/lib/paper.mjs` (`extractTokens` shape), `lib/tokens.mjs` (value rules), and their tests — **only to match an observed row**.

**Interfaces:**

- Consumes: everything in Tasks 1–5, a running Paper Desktop with a target file.
- Produces: the pinned truth for `doctor`, `push`, `lint`; the `PAPER_FILE_ID` used by Tasks 9–10.

**Operator prerequisite (free):** open Paper Desktop, create a new file named `ReFi DAO — Brand canvas`, copy its id or URL from the address bar / share sheet. Put it in **org-os** `.env` as `PAPER_FILE_ID=…` for this task (Task 9 puts it in refi-dao-os `.env` too). Budget for this task: **≤ 8 metered calls** (get_tokens ×3, create_tokens ×1, set_tokens ×2 for the hand-edit round trip, get_basic_info ×1, one spare).

- [ ] **Step 1: Doctor, free**

Run: `npm run paper:doctor`
Expected: four `✓` lines, `paper: canvas ready`, `metered calls: 0`. Record `serverInfo.version` and the tool count printed in the third line.

- [ ] **Step 2: Observe the live tool list (free) and diff against the pin**

```bash
node -e '
import("./packages/paper-integration/lib/paper.mjs").then(async ({ createClient }) => {
  const c = createClient(); const t = await c.listTools();
  console.log(t.length, "tools"); console.log(t.map(x => x.name).sort().join("\n"));
});'
```

Expected: 36 tools including the five in `REQUIRED_TOOLS`. Save the sorted list for VERIFIED.md.

- [ ] **Step 3: Dry-run the push (free), then push for real (2 calls)**

```bash
npm run paper:push-tokens -- --tokens ../refi-dao-os/data/brand.yaml --dry-run
npm run paper:push-tokens -- --tokens ../refi-dao-os/data/brand.yaml
```

Expected dry-run: `plan: 75 tokens · 4 skipped · 31 converted`, four `skipped:` lines (glass-blur, glass-shadow, glow-blue, glow-green), `dry-run: nothing sent`, `metered calls: 0`.
Expected push: `create: 75 … created: 75 · updated: 0 · pruned: 0`, `metered calls: 2`.

**If `create_tokens` errors** (exit 1, `paper: rpc — …`): read the message. Likely causes and the rule for each:

- value rejected for `fontFamily` (full stack vs single family) → the planner already sends the first family; if Paper wants quoting, adjust `firstFamily` in `lib/tokens.mjs` **and** its test, and record the row.
- `fontWeight` wants a string → change the planner's weight branch to `String(n)`, update the test expecting `600`, record the row.
- a batch-size limit → split `diff.create` into chunks of the observed limit in `push-tokens.mjs`; add a test with a fake handler that rejects >N; record the row.
  Re-run the push after any fix and confirm the second run is `metered calls: 1` with zeros.

- [ ] **Step 4: Observe the `get_tokens` reply shape (1 call) and the idempotent second push (1 call)**

```bash
npm run paper:call -- get_tokens '{"format":"json"}' | head -c 1200; echo
npm run paper:push-tokens -- --tokens ../refi-dao-os/data/brand.yaml
```

Expected: the first prints the raw reply — note whether tokens arrive as `content[0].text` JSON array, `{tokens:[…]}`, or structured; note how colours come back (case, format) and whether `description` round-trips. If the shape is not one of the three `extractTokens` accepts, extend `extractTokens` + its test to the observed shape (and only that). The second push must print `created: 0 · updated: 0 · pruned: 0` and `metered calls: 1`.

- [ ] **Step 5: Lint passes, then fails on a hand edit, then passes again (3 calls)**

```bash
npm run paper:lint-tokens -- --tokens ../refi-dao-os/data/brand.yaml
```

Expected: `paper tokens: in sync (75 checked)`, exit 0.

Now in Paper Desktop's **Theme** tab, change `--refi-color-blue` to any other colour by hand. Then:

```bash
npm run paper:lint-tokens -- --tokens ../refi-dao-os/data/brand.yaml; echo "exit $?"
npm run paper:push-tokens -- --tokens ../refi-dao-os/data/brand.yaml
```

Expected: lint prints `changed: --refi-color-blue paper=… brand=#4571E1` and `exit 1`; the push prints `updated: 1` and restores it (`metered calls: 2`).

- [ ] **Step 6: Check Switzer visibility from Paper's side? — No.** `get_font_family_info` is metered and belongs to the prototype session (Task 10), after the font is installed (Task 9). Skip here.

- [ ] **Step 7: Write `VERIFIED.md`**

```markdown
# paper-integration — VERIFIED

**Status:** VERIFIED (2026-09-02) — every CLI-facing behaviour in `lib/paper.mjs` and `lib/tokens.mjs`
mirrors a row below observed against a live Paper Desktop. The working rule (from Buzz): the client
changes **only** to match a re-verified row — never to track documentation, never speculatively.

## Pin

| what            | value                                                                             | observed                                |
| --------------- | --------------------------------------------------------------------------------- | --------------------------------------- |
| Paper Desktop   | `0.5.6` (bundle `com.todesktop.2601167vjw8xe`)                                    | 2026-09-02, `initialize` → `serverInfo` |
| MCP server name | `paper-desktop`                                                                   | 2026-09-02                              |
| MCP protocol    | `2025-03-26`                                                                      | 2026-09-02                              |
| Endpoint        | `http://127.0.0.1:29979/mcp`, POST, `Accept: application/json, text/event-stream` | 2026-09-02                              |
| Reply framing   | `text/event-stream`, one `event: message` + `data: <envelope>`                    | 2026-09-02                              |
| Auth            | none (loopback)                                                                   | 2026-09-02                              |
| Tools           | 36 (public docs page lists 24) — list below                                       | 2026-09-02                              |

## Observed facts

| #   | fact                                                                           | observed                                                                                           | how                        |
| --- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | -------------------------- |
| 1   | `GET /mcp` → 404; only POST JSON-RPC is served                                 | ✅ 2026-09-02                                                                                      | curl                       |
| 2   | `initialize` and `tools/list` do **not** count toward the metered weekly quota | ⚠ inferred from Paper's pricing wording ("MCP tool calls"), not observed against the quota counter | pricing page + `/docs/mcp` |
| 3   | `create_tokens` accepts a batch of 75 in one call                              | ⟨fill: ✅ / ❌ + limit⟩                                                                            | Task 7 Step 3              |
| 4   | `fontFamily` value: single family name accepted (`"Switzer"`)                  | ⟨fill⟩                                                                                             | Step 3                     |
| 5   | `fontWeight` value: number accepted (`600`)                                    | ⟨fill⟩                                                                                             | Step 3                     |
| 6   | size values must be px strings; rem rejected                                   | ⟨fill: tested? only px was sent⟩                                                                   | Step 3                     |
| 7   | `get_tokens` json reply shape                                                  | ⟨fill: e.g. `content[0].text` = JSON array of `{type,name,value,description}`⟩                     | Step 4                     |
| 8   | colour values round-trip verbatim (case preserved / normalised to …)           | ⟨fill⟩                                                                                             | Step 4                     |
| 9   | `description` round-trips through get_tokens                                   | ⟨fill⟩                                                                                             | Step 4                     |
| 10  | `set_tokens` `{name, value}` updates; `{name, delete:true}` deletes            | ⟨fill⟩                                                                                             | Step 5                     |
| 11  | a hand edit in the Theme tab is visible to `get_tokens` immediately            | ⟨fill⟩                                                                                             | Step 5                     |
| 12  | quota-exceeded error shape                                                     | not observed                                                                                       | —                          |
| 13  | `export` reply shape (base64 `content[].type:"image"` vs file path)            | pending — Task 10                                                                                  | —                          |
| 14  | `get_jsx` `format` enum: `"tailwind"` \| `"inline-styles"`                     | ✅ 2026-09-02                                                                                      | tools/list schema          |
| 15  | inline `<svg>` with `<filter><feTurbulence>` renders on the canvas             | pending — Task 10                                                                                  | —                          |
| 16  | `write_html` accepts `<img src="data:image/svg+xml;base64,…">`                 | pending — Task 10                                                                                  | —                          |

Replace every `⟨fill⟩` with what you saw, including the exact error text for anything rejected.

## Tool list (36, sorted)

⟨paste the sorted list from Step 2⟩

## Reconciliation log

- 2026-09-02 — initial verification. ⟨one line per client/planner change made to match a row, or "no reconciliation needed".⟩

## Re-verification protocol

On any Paper Desktop update (`paper:doctor` warns `running X, pinned 0.5.6`): re-run Steps 1–5 of plan Task 7, update the Pin and any changed rows first, then reconcile `PIN`, `REQUIRED_TOOLS`, `extractTokens`, the planner, and their tests.
```

Fill every `⟨fill⟩` from what Steps 1–5 actually showed. No placeholder survives the commit.

- [ ] **Step 8: Run the suite, format, commit**

```bash
npm test
npx prettier --write packages/paper-integration/VERIFIED.md
git add packages/paper-integration/VERIFIED.md packages/paper-integration/lib tests/paper-integration
git commit -m "verify(paper): VERIFIED.md — live observation against Paper 0.5.6 (tokens push/lint round trip, reply shapes); reconcile client to observed rows"
```

Also record the metered calls this task spent (target ≤ 8) — Task 10's report needs the running total.

---

### Task 8: `skills/paper-design/SKILL.md`, `docs/integrations/paper.md`, skills-matrix row

**Files:**

- Create: `skills/paper-design/SKILL.md`
- Create: `docs/integrations/paper.md`
- Modify: `data/skills-matrix.yaml` (add after the `capital-flow` entry)

**Interfaces:**

- Consumes: script names and flags from Tasks 3–5; observed facts from Task 7 (quote them, don't re-guess).
- Produces: the method Task 10 follows; the runbook Task 11 flips to `pilot`.

- [ ] **Step 1: Write the skill**

```markdown
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
`docs/integrations/paper.md` for the runbook.

## Budget — read first

The free tier allows **100 metered MCP tool calls per week**. `initialize`/`tools/list` are free; every
tool call is metered. **Per artifact: 25 calls, hard stop.** At 25, export what exists, release working
indicators, report — do not "finish quickly". Typical spend for one composition:

| step                                                                             | calls |
| -------------------------------------------------------------------------------- | ----- |
| `get_basic_info` · `get_font_family_info([brand face])` · `create_artboard`      | 3     |
| `write_html`, one visual group each                                              | 6–10  |
| `get_screenshot` (max 3) · targeted `update_styles` / `set_text_content` (max 3) | ≤6    |
| `find_nodes` colour audit · `export` · `get_jsx` · `finish_working_on_nodes`     | 4     |

Paper's own guide asks for a screenshot after every section. Keep its small-writes discipline (the human
watches the canvas build) and **override the screenshot cadence** to fit the budget. Never call image
generation (`paper-gen://`): metered and off-brand.

## Preconditions

1. `npm run paper:doctor` → `paper: canvas ready` (free).
2. `npm run paper:lint-tokens -- --tokens <instance>/data/brand.yaml` → `in sync` (1 call). If not, run
   `paper:push-tokens` first. Tokens are named exactly as in the org's stylesheet (`--refi-color-blue`).
3. `get_font_family_info(["<brand face>"])` says the face is available (1 call). If not, **stop before
   `create_artboard`** — a missing face is a broken design, and the fix (installing the font locally) is
   the operator's.

## Method

1. **Read the composition**, not the stylesheet. Open the org's DESIGN.md, pick the composition
   (social card, poster, deck slide, page, chart, doc page), and note: canvas size, world (light/dark),
   the one object, the type roles, the never-do line.
2. **Translate class vocabulary into inline styles that reference tokens.** Paper's canvas does not load
   the org's CSS; classes mean nothing there. Every class the composition names becomes inline CSS whose
   colours, sizes, weights and families are `var(--<prefix>-*)`. The per-org translation table lives in
   the instance's brand skill (refi-dao-os: `.claude/skills/refi-dao-brand/SKILL.md` → Canvas). If the
   table lacks the composition, derive the inline styles from the stylesheet's class definitions and add
   the row to that table as part of the work.
3. **Ground first.** `create_artboard` with the canvas size and the world's background token; then the
   surface treatments the world demands (e.g. a radial glow layer and a grain layer) as the first
   `write_html` groups. A flat dark background where the system says "grained" is a rendering error.
4. **One visual group per `write_html`**, `mode: "insert-children"` on the artboard id. Inline SVG is
   allowed and takes `var()` in `fill`/`stroke`. Large assets (a logomark SVG) go through
   `npm run paper:call -- write_html --args-file <json>` so the shell never chokes on the payload.
5. **Review at checkpoints, not after every group.** One `get_screenshot` after the ground + object, one
   after the type, one final. Fix with `update_styles` / `set_text_content` / `move_nodes` — never delete
   the artboard and start over.
6. **Audit colours.** `find_nodes` with a `styleValue` of each canonical hex confirms usages resolve to a
   `var(--…)` (the reply reports token-bound usages as the var reference). Anything literal gets an
   `update_styles` to the token.
7. **Export and release.** `export` the artboard as PNG at `"2x"` into the instance's designated
   output directory (refi-dao-os: `docs/brand/eval/out/`); `get_jsx` with `format: "inline-styles"` for
   the code twin; `finish_working_on_nodes`. Screenshots verify; exports ship. Never build code from a
   screenshot.
8. **Report** — calls spent, what Paper rejected or rendered unexpectedly (each is a VERIFIED.md row),
   and the verdicts the operator still owes.

## The review loop with a human

The human refines by hand in Paper and leaves comments. On a later session:
`list_comment_threads({ status: "open" })` → for each thread, read `get_comment_thread`, make the change,
then `set_comment_thread_status({ status: "resolved" })`. Never resolve a thread you did not act on;
never resolve to tidy up. A thread that asks a question stays open with a reply until answered.

## Hard rules

- Every colour on the canvas is a `var(--<prefix>-*)`. No literal hex, no `rgba()`, no colour picked by
  eye. If the system itself hardcodes a helper colour (a white highlight, a tinted glow), compose it from a
  token plus `opacity` on its own layer.
- Never take another org's artifact as the style target.
- Never call `open_file` on a file you were not given; never rely on Paper's sticky file — pass `fileId`.
- Font sizes in px (Paper requirement); tokens already are.
- Nothing font-related is committed; fonts install locally under their licence.

## Pulling a Paper design into code

Use `get_jsx` (`inline-styles`), `get_computed_styles`, `get_fill_image` for exact values; translate into
the codebase's conventions (for refi-dao-os: classes from `brand.css`, tokens from `brand.yaml`).
```

- [ ] **Step 2: Write the runbook**

````markdown
# Paper Integration — Design Canvas

**Status:** module #5 `org-os-paper`, catalogued **in-dev** — package and tests ship; live token round-trip verified 2026-09-02 against Paper 0.5.6 ([`packages/paper-integration/VERIFIED.md`](../../packages/paper-integration/VERIFIED.md)); the refi-dao-os prototype (brief 02) is the gate to `pilot`
**Spec:** [`docs/superpowers/specs/2026-09-02-paper-integration-design.md`](../superpowers/specs/2026-09-02-paper-integration-design.md) · plan [`2026-09-02-paper-integration.md`](../superpowers/plans/2026-09-02-paper-integration.md)
**Pin:** Paper Desktop `0.5.6` · MCP `2025-03-26` · `http://127.0.0.1:29979/mcp` (loopback, no auth, started by the app when a file is open) · 36 tools

## What Paper is

[Paper](https://paper.design) is "the connected canvas for teams shipping with agents": a free-form design canvas (web + desktop) whose every element is real HTML/CSS, so a design exports as code with no translation step. Its agent surface is **Paper MCP** — read tools (`get_basic_info`, `get_tree_summary`, `get_screenshot`, `get_jsx`, `get_computed_styles`, `find_nodes`…), write tools (`create_artboard`, `write_html`, `update_styles`, `set_text_content`, `move_nodes`, `duplicate_nodes`, `delete_nodes`), file-level **design tokens** (`get_tokens` / `create_tokens` / `set_tokens`, ten types, `var()` aliasing), `export` (png/jpg/svg/webp/avif/pdf/mp4), and comment threads. Free tier: **100 metered tool calls/week**; Pro $20/editor/month for 1M. No shared token libraries and no theme modes yet (both on Paper's roadmap).

## The lane in one paragraph

An org's `data/brand.yaml` `tokens:` are the source of truth. `npm run paper:push-tokens` mirrors them into a Paper file as design tokens — names verbatim (`--refi-color-blue`), rem→px, one way, diffed and idempotent (a no-change run costs one call). `npm run paper:lint-tokens` catches drift the way the instance's `lint:brand` does. With the tokens in place, an agent following [`skills/paper-design/SKILL.md`](../../skills/paper-design/SKILL.md) drafts a DESIGN.md composition onto an artboard using only `var(--…)` colours, a human refines it by hand in Paper, and PNG/JSX exports flow back into the repo. **org-os never draws** — the package wraps only health, token sync and drift; everything visual goes through Paper's own tools. Paper is **not a session lane**: nothing in `/initialize` or `/close` depends on it.

## Operating

### Verbs (run from the framework repo; `--tokens` points at the instance)

- `npm run paper:doctor [-- --file <id>]` — four checks, **zero metered calls**: server answers and is `paper-desktop`; version vs pin (warns on drift); the five required tools present; a target file configured. Exit 0 ready, 2 not.
- `npm run paper:push-tokens -- --tokens ../<instance>/data/brand.yaml [--dry-run] [--prune] [--canvas-width 1080]` — `--dry-run` prints the plan for free; a real run is `get_tokens` + `create_tokens` (new) + `set_tokens` (changed) ≤ 3 calls. `--prune` deletes Paper tokens carrying the org's prefix that brand.yaml no longer has — opt-in, never touches other prefixes.
- `npm run paper:lint-tokens -- --tokens ../<instance>/data/brand.yaml [--strict]` — one call; exit 1 on missing/changed; extras reported, failing only with `--strict`.
- `npm run paper:call -- <tool> ['<json>'] [--args-file p] [--out p]` — generic passthrough for agents in a shell (always passes `fileId`; `--out` saves base64 image content, e.g. screenshots).

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
````

Other hosts (documented by Paper, **unverified here**): Cursor `/add-plugin paper-desktop`; Claude Desktop via `npx mcp-remote http://127.0.0.1:29979/mcp`; Copilot `.vscode/mcp.json` `{"servers":{"paper":{"type":"http","url":"…"}}}`; OpenCode `{"mcp":{"paper":{"type":"remote","url":"…","enabled":true}}}`. Hermes and Berd: no wiring yet — the scripts above work from any shell regardless.

### Token mapping (what `push-tokens` does)

Type by value first, family second: any colour value → `color`; `font-*` → `fontFamily` (first family of the stack, full stack in the token description); `weight-*` → `fontWeight` (number); `space-*` → `spacing`, `radius-*` → `radius`, `text-*` → `fontSize` (rem→px at 16; `clamp()` evaluated at `--canvas-width`, flagged). `glow-*`, `glass-*` are **skipped and listed** — Paper has no shadow/blur token type. Every conversion is written into the token's description so it shows in Paper's Theme panel.

### Fonts

Paper resolves fonts from the machine and Google Fonts. A brand face that is on neither (refi-dao-os: Switzer, distributed by Fontshare under the ITF Free Font License) must be installed locally before designing; the skill checks with `get_font_family_info` and halts otherwise. Font files are never committed.

## What is NOT verified

- The refi-dao-os prototype (brief 02) — the gate to `pilot`. Rows 13, 15, 16 of VERIFIED.md (export reply shape, SVG filters on canvas, data-URI SVG images) are observed there.
- The quota-exceeded error shape (VERIFIED.md row 12).
- Whether `initialize`/`tools/list` are truly unmetered (row 2 is inferred from pricing wording).
- Any host other than Claude Code and the shell scripts.
- The human review loop (comment threads) — designed, unexercised until the operator leaves the first comment.

## Re-verification note

`paper:doctor` warns when the running Paper version differs from the pin. On any bump, follow VERIFIED.md → Re-verification protocol before trusting `push`/`lint`.

````

- [ ] **Step 3: Add the skills-matrix row**

After the `capital-flow` entry in `data/skills-matrix.yaml`:

```yaml
  - id: "paper-design"
    owner: "framework"
    instances_using: []
    in_framework: true
    promotion_status: "evaluating"
    notes: "Design DESIGN.md compositions on a Paper canvas from pushed brand tokens under a metered-call budget; export back as PNG/JSX. Module org-os-paper. First adopter: refi-dao-os (brief-02 prototype pending)."
````

- [ ] **Step 4: Verify, format, commit**

```bash
npm run validate:structure
npx prettier --write skills/paper-design/SKILL.md docs/integrations/paper.md data/skills-matrix.yaml
git add skills/paper-design/SKILL.md docs/integrations/paper.md data/skills-matrix.yaml
git commit -m "docs(paper): paper-design skill (method + budget), integrations runbook, skills-matrix row"
```

Expected: validate:structure counts 37 skills, `0 failed`.

---

### Task 9: refi-dao-os wiring — `.mcp.json`, TOOLS.md, brand-skill Canvas route, `.env`, Switzer

**Files (all in `../refi-dao-os`):**

- Create: `.mcp.json`
- Modify: `TOOLS.md` (new section after `## Notion Integration`, before `## On-Chain Addresses`)
- Modify: `.claude/skills/refi-dao-brand/SKILL.md` (append section)
- Create (not committed): `.env` line `PAPER_FILE_ID=…`

**Interfaces:**

- Consumes: the file id from Task 7; the skill from Task 8.
- Produces: the instance-side translation table Task 10 builds from.

- [ ] **Step 1: Confirm branch and the untouched dirty tree**

```bash
cd ../refi-dao-os && git branch --show-current && git status --short | wc -l
```

Expected: `feat/graphify-knowledge-pilot` (or the branch the operator named) and a non-zero count of pre-existing changes. Nothing here is stashed, checked out, or reset. Only the paths this task creates are ever staged.

- [ ] **Step 2: Write `.mcp.json`**

```json
{
  "mcpServers": {
    "paper": {
      "type": "http",
      "url": "http://127.0.0.1:29979/mcp"
    }
  }
}
```

- [ ] **Step 3: Add the TOOLS.md section** (insert before `## On-Chain Addresses`)

```markdown
## Paper (design canvas)

- **What:** [Paper](https://paper.design) — the agent design canvas for on-brand artifacts. Framework module
  `org-os-paper`; runbook `org-os/docs/integrations/paper.md`; method `org-os/skills/paper-design/SKILL.md`;
  our translation table: `.claude/skills/refi-dao-brand/SKILL.md` → Canvas (Paper).
- **Server:** Paper Desktop starts it on file open — `http://127.0.0.1:29979/mcp`, loopback, no credential.
  Registered for Claude Code in `.mcp.json`.
- **File:** `ReFi DAO — Brand canvas` — id in `.env` as `PAPER_FILE_ID` (per operator; the file lives in the
  operator's personal Paper account, free tier). Tokens pushed from `data/brand.yaml` 2026-09-02:
  ⟨n⟩ created, 4 skipped (`glow-*`, `glass-*` — no Paper token type) — use the numbers the push actually printed. Drift check from the framework repo:
  `npm run paper:lint-tokens -- --tokens ../refi-dao-os/data/brand.yaml`.
- **Budget:** free tier = 100 metered MCP tool calls/week. One artifact ≤ 25. Doctor is free.
- **Fonts:** Switzer must be installed locally (Fontshare, ITF Free Font License — never commit the files):
  `curl -L https://api.fontshare.com/v2/fonts/download/switzer -o /tmp/switzer.zip`, unzip, copy the OTF files
  into `~/Library/Fonts/`, restart Paper.
- **Assets:** the logomark is `repos/repos/ReFi-DAO-Website/site/assets/ReFi_Logomark.svg` (92 KB, embeds a
  raster); the 25 MB `logo-*.svg` files are not canvas-safe.
```

- [ ] **Step 4: Append the Canvas route to the brand skill**

Append to `.claude/skills/refi-dao-brand/SKILL.md`:

```markdown
## Canvas (Paper) — `paper-design`

Route any request to build a ReFi DAO artifact _in Paper_ through the framework skill `paper-design`
(`org-os/skills/paper-design/SKILL.md`). Tokens are already in the file as `--refi-*` (same names as
`brand.css`). Paper does not load `brand.css`, so every class becomes inline CSS over tokens. The table
below is that translation for the compositions exercised so far — extend it as compositions are built.

### Social card (DESIGN.md §5) — 1080 × 1350 (4:5), world Space

| brand.css                  | on the Paper canvas (inline, tokens only)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.refi-page` (Space)       | artboard `background: var(--refi-bg); color: var(--refi-text); font-family: var(--refi-font-sans); position: relative; overflow: hidden`                                                                                                                                                                                                                                                                                                                                                                                               |
| `.refi-grain` glow         | a full-bleed layer `background: radial-gradient(ellipse at 50% 0%, var(--refi-color-blue), transparent 60%); opacity: 0.18`                                                                                                                                                                                                                                                                                                                                                                                                            |
| `.refi-grain::after` grain | a full-bleed inline `<svg>` with `<filter><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.18 0"/></filter><rect width="100%" height="100%" filter="url(#g)"/></svg>` and `mix-blend-mode: overlay` (fallback: the same SVG as a `background-image` data URI, exactly as brand.css does)                                                                                                                                        |
| `.refi-orb` (sphere)       | `aspect-ratio: 1; border-radius: 50%; background: conic-gradient(from 210deg, var(--refi-color-yellow), var(--refi-color-pink), var(--refi-color-blue), var(--refi-color-green), var(--refi-color-blue-light), var(--refi-color-yellow)); filter: saturate(1.05); overflow: hidden` + a child highlight layer `background: radial-gradient(circle at 32% 28%, var(--refi-color-cloud), transparent 42%); opacity: 0.35` + a child noise `<svg>` (baseFrequency 0.9, 2 octaves, alpha 0.35) at `opacity: 0.55; mix-blend-mode: overlay` |
| logomark (Orb ring)        | the real asset `repos/repos/ReFi-DAO-Website/site/assets/ReFi_Logomark.svg` inline (or as `<img src="data:image/svg+xml;base64,…">`), 84 × 84, inset `var(--refi-space-4)` top-left                                                                                                                                                                                                                                                                                                                                                    |
| `.refi-heading-1`          | `font-size: var(--refi-text-5xl); font-weight: var(--refi-weight-semibold); line-height: 62px; letter-spacing: -0.02em; color: var(--refi-text); margin: 0`                                                                                                                                                                                                                                                                                                                                                                            |
| `.refi-caption`            | `font-size: var(--refi-text-sm); color: var(--refi-text-subtle); margin: 0`                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| padding                    | `var(--refi-space-16)`; gap between heading and caption `var(--refi-space-6)`                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

Never: a literal hex, a recoloured Orb, flat Space, a paragraph, a partner's palette (DESIGN.md §6).
```

- [ ] **Step 5: Put the file id in the instance `.env` (not committed)**

```bash
cd ../refi-dao-os && grep -q '^PAPER_FILE_ID=' .env 2>/dev/null || printf '\n# Paper design canvas (TOOLS.md → Paper)\nPAPER_FILE_ID=<id from Task 7>\n' >> .env
git check-ignore -q .env && echo ".env ignored — good"
```

Replace `<id from Task 7>` with the real id. Expected: `.env ignored — good`.

- [ ] **Step 6: Install Switzer locally — ASK THE OPERATOR FIRST**

Say what will happen: download `Switzer_Complete.zip` from Fontshare's API into the scratchpad, unzip, copy the OTF files into `~/Library/Fonts/`, nothing committed. On a yes:

```bash
SP="${SCRATCHPAD:-/tmp}/switzer"; mkdir -p "$SP" && cd "$SP"
curl -L -o Switzer_Complete.zip https://api.fontshare.com/v2/fonts/download/switzer
unzip -o -q Switzer_Complete.zip
find . -iname "*.otf" | head -20
find . -iname "*.otf" -exec cp {} ~/Library/Fonts/ \;
ls ~/Library/Fonts | grep -i switzer | wc -l
```

Expected: ≥ 6 Switzer OTF files listed in `~/Library/Fonts`. Then quit and reopen Paper Desktop so it re-scans fonts. (If the zip carries only TTF, copy `*.ttf` instead — macOS installs both.)

- [ ] **Step 7: Run the instance's brand lint (brand.yaml was only read) and commit explicit paths**

```bash
cd ../refi-dao-os
npm run lint:brand
git add .mcp.json TOOLS.md .claude/skills/refi-dao-brand/SKILL.md
git commit -m "feat(brand): Paper design canvas wiring — .mcp.json, TOOLS.md section, Canvas route + social-card token table in refi-dao-brand"
git status --short | grep -E "^(M|D|A) " | head -3
```

Expected: `lint:brand` green; the commit contains exactly three paths; the third command shows the other session's changes still uncommitted (untouched).

---

### Task 10: The prototype — brief 02 on the canvas (≤ 25 calls for the artifact)

**Files (in `../refi-dao-os`):**

- Create: `docs/brand/eval/out/02-growfi-social-card.paper.png`
- Create: `docs/brand/eval/out/02-growfi-social-card.paper.html`
- Create: `docs/brand/eval/out/PAPER-PROTOTYPE-2026-09-02.md`
- Modify (org-os): `packages/paper-integration/VERIFIED.md` rows 13, 15, 16

**Interfaces:**

- Consumes: `npm run paper:call` (Task 3), the translation table (Task 9), `PAPER_FILE_ID`.
- Produces: the acceptance evidence Task 11 judges.

Work from the **framework repo** so `npm run paper:call` resolves; pass `--tokens ../refi-dao-os/data/brand.yaml` so the instance `.env` supplies `PAPER_FILE_ID`. Keep a running tally: write every call's name into `$SP/calls.log`.

- [ ] **Step 1: Preconditions (2 calls)**

```bash
export T="--tokens ../refi-dao-os/data/brand.yaml"; SP="${SCRATCHPAD:-/tmp}/paper-proto"; mkdir -p "$SP"
npm run paper:doctor -- $T
npm run paper:lint-tokens -- $T
npm run paper:call -- get_font_family_info '{"familyNames":["Switzer"]}' $T | head -40
```

Expected: doctor ready (0 calls); lint in sync (1); the font reply shows Switzer available with weights 300–800 (1). **If Switzer is unavailable, stop** — return to Task 9 Step 6.

- [ ] **Step 2: Context + artboard (2 calls)**

```bash
npm run paper:call -- get_basic_info '{}' $T | tee "$SP/basic.json" | head -60
npm run paper:call -- create_artboard '{"name":"02 GrowFi × ReFi DAO — social card 4:5","styles":{"width":"1080px","height":"1350px","position":"relative","overflow":"hidden","backgroundColor":"var(--refi-bg)","color":"var(--refi-text)","fontFamily":"var(--refi-font-sans)","display":"flex","flexDirection":"column","padding":"var(--refi-space-16)","boxSizing":"border-box"}}' $T | tee "$SP/artboard.json"
```

Read the artboard node id from the reply and export it: `export AB=<id>`. Note in the report whether `backgroundColor: var(--refi-bg)` was accepted on `create_artboard` (the schema allows arbitrary string styles).

- [ ] **Step 3: Ground — glow layer, then grain layer (2 calls)**

```bash
cat > "$SP/glow.json" <<'EOF'
{"targetNodeId":"__AB__","mode":"insert-children","html":"<div data-layer=\"glow\" style=\"position:absolute; inset:0; background: radial-gradient(ellipse at 50% 0%, var(--refi-color-blue), transparent 60%); opacity:0.18; pointer-events:none;\"></div>"}
EOF
cat > "$SP/grain.json" <<'EOF'
{"targetNodeId":"__AB__","mode":"insert-children","html":"<svg data-layer=\"grain\" xmlns=\"http://www.w3.org/2000/svg\" style=\"position:absolute; inset:0; width:100%; height:100%; mix-blend-mode:overlay; pointer-events:none;\"><filter id=\"g\"><feTurbulence type=\"fractalNoise\" baseFrequency=\"0.8\" numOctaves=\"3\" stitchTiles=\"stitch\"/><feColorMatrix values=\"0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.18 0\"/></filter><rect width=\"100%\" height=\"100%\" filter=\"url(#g)\"/></svg>"}
EOF
sed -i '' "s/__AB__/$AB/" "$SP/glow.json" "$SP/grain.json"
npm run paper:call -- write_html --args-file "$SP/glow.json" $T | head -5
npm run paper:call -- write_html --args-file "$SP/grain.json" $T | head -5
```

- [ ] **Step 4: The Orb (1 call) and the logomark (1 call)**

```bash
cat > "$SP/orb.json" <<'EOF'
{"targetNodeId":"__AB__","mode":"insert-children","html":"<div data-layer=\"orb\" style=\"position:absolute; left:50%; top:42%; transform:translate(-50%,-50%); width:626px; height:626px; border-radius:50%; overflow:hidden; filter:saturate(1.05); background: conic-gradient(from 210deg, var(--refi-color-yellow), var(--refi-color-pink), var(--refi-color-blue), var(--refi-color-green), var(--refi-color-blue-light), var(--refi-color-yellow));\"><div style=\"position:absolute; inset:0; border-radius:50%; background: radial-gradient(circle at 32% 28%, var(--refi-color-cloud), transparent 42%); opacity:0.35;\"></div><svg xmlns=\"http://www.w3.org/2000/svg\" style=\"position:absolute; inset:0; width:100%; height:100%; opacity:0.55; mix-blend-mode:overlay;\"><filter id=\"n\"><feTurbulence type=\"fractalNoise\" baseFrequency=\"0.9\" numOctaves=\"2\" stitchTiles=\"stitch\"/><feColorMatrix values=\"0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.35 0\"/></filter><rect width=\"100%\" height=\"100%\" filter=\"url(#n)\"/></svg></div>"}
EOF
sed -i '' "s/__AB__/$AB/" "$SP/orb.json"
npm run paper:call -- write_html --args-file "$SP/orb.json" $T | head -5

# Logomark: the real asset, inlined. Build the JSON with node so the 92 KB SVG is escaped correctly.
node -e '
const fs=require("fs");
const svg=fs.readFileSync("../refi-dao-os/repos/repos/ReFi-DAO-Website/site/assets/ReFi_Logomark.svg","utf8").replace(/^<\?xml[^>]*>/,"").replace(/<svg /,"<svg data-layer=\"logomark\" style=\"position:absolute; top:var(--refi-space-4); left:var(--refi-space-4); width:84px; height:84px;\" ");
fs.writeFileSync(process.argv[1], JSON.stringify({targetNodeId:process.argv[2],mode:"insert-children",html:svg}));
' "$SP/logomark.json" "$AB"
npm run paper:call -- write_html --args-file "$SP/logomark.json" $T | head -5
```

**If the inline SVG is rejected or renders blank** (the embedded `<image>` + `<pattern>` is the risk — VERIFIED row 16), fall back once:

```bash
node -e '
const fs=require("fs");
const b64=fs.readFileSync("../refi-dao-os/repos/repos/ReFi-DAO-Website/site/assets/ReFi_Logomark.svg").toString("base64");
fs.writeFileSync(process.argv[1], JSON.stringify({targetNodeId:process.argv[2],mode:"insert-children",html:`<img data-layer="logomark" alt="" src="data:image/svg+xml;base64,${b64}" style="position:absolute; top:var(--refi-space-4); left:var(--refi-space-4); width:84px; height:84px;">`}));
' "$SP/logomark-img.json" "$AB"
npm run paper:call -- write_html --args-file "$SP/logomark-img.json" $T | head -5
```

- [ ] **Step 5: Type — heading and caption (1 call)**

```bash
cat > "$SP/type.json" <<'EOF'
{"targetNodeId":"__AB__","mode":"insert-children","html":"<div data-layer=\"copy\" style=\"position:relative; z-index:2; margin-top:auto; display:flex; flex-direction:column; gap:var(--refi-space-6);\"><h1 style=\"margin:0; font-family:var(--refi-font-sans); font-size:var(--refi-text-5xl); font-weight:var(--refi-weight-semibold); line-height:62px; letter-spacing:-0.02em; color:var(--refi-text);\">GrowFi × ReFi DAO · first onboarding call · Thu 17 Sep</h1><p style=\"margin:0; font-family:var(--refi-font-sans); font-size:var(--refi-text-sm); font-weight:var(--refi-weight-regular); line-height:18px; color:var(--refi-text-subtle);\">@_refidao — time in bio</p></div>"}
EOF
sed -i '' "s/__AB__/$AB/" "$SP/type.json"
npm run paper:call -- write_html --args-file "$SP/type.json" $T | head -5
```

- [ ] **Step 6: Checkpoint screenshot (1 call), then at most two targeted fixes (≤ 2 calls)**

```bash
npm run paper:call -- get_screenshot "{\"nodeId\":\"$AB\",\"scale\":1}" --out "$SP/shot-1.png" $T > /dev/null
```

Open `$SP/shot-1.png` (Read tool) and run DESIGN.md Pass four: reads in three seconds · grain visible (not flat) · Orb untouched · one heading line · caption present · logomark in the corner · nothing clipped. Expected issues and their one-call fixes:

- **Heading wraps to two lines.** The brief demands one line at heading-1 scale; at 1080 px wide with 64 px padding, 55 characters at 56 px Switzer semibold will not fit. Do **not** shrink below `--refi-text-5xl` and do not widen the artboard. Shorten the copy once via `set_text_content` to `GrowFi × ReFi DAO · onboarding call · 17 Sep`; if it still wraps, leave it on two lines and log **finding F-1**: the brief's "one line" and "heading-1 scale" constraints conflict on a 1080 canvas — a document finding, per `docs/brand/eval/README.md`.
- **Grain not visible.** Log VERIFIED row 15 as ❌ and apply the fallback: `update_styles` on the grain node replacing the SVG approach with `backgroundImage: url("data:image/svg+xml;utf8,<svg …feTurbulence…>")` exactly as `brand.css` `.refi-grain::after` does; re-screenshot only if a fix was applied.
- **Layer order wrong** (Orb under the glow, copy under the Orb) → one `move_nodes`.

- [ ] **Step 7: Colour audit (≤ 2 calls)**

```bash
npm run paper:call -- find_nodes "{\"nodeId\":\"$AB\",\"filters\":[{\"styleName\":\"*\",\"styleValue\":\"#*\"}]}" $T | head -40
```

Expected: every match is reported as a `var(--refi-…)` reference (Paper reports token-bound usages as the var). Any literal hex or rgba → one `update_styles` to the token, then log it.

- [ ] **Step 8: Export, JSX, release (3 calls)**

```bash
npm run paper:call -- export "{\"type\":\"image\",\"nodes\":{\"$AB\":[{\"format\":\"png\",\"scale\":\"2x\"}]}}" --out "$SP/export.png" $T | tee "$SP/export.json" | head -30
```

Read the reply. **Row 13:** if `--out` wrote a file (base64 content) → `cp "$SP/export.png" ../refi-dao-os/docs/brand/eval/out/02-growfi-social-card.paper.png`. If the reply carries a file path instead → `cp "<that path>" …/02-growfi-social-card.paper.png`. If it carries neither, the reply text says where Paper saved it (Downloads) — copy from there. Record what happened.

```bash
npm run paper:call -- get_jsx "{\"nodeId\":\"$AB\",\"format\":\"inline-styles\"}" $T > "$SP/jsx.json"
node -e '
const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
const jsx=(r.content||[]).filter(c=>c.type==="text").map(c=>c.text).join("\n");
const html=`<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>GrowFi × ReFi DAO — Paper export (inline styles)</title>\n<link rel="stylesheet" href="https://knowledge.refidao.com/brand.css">\n<style>html,body{margin:0;background:var(--refi-color-space,#172027)} body{display:flex;justify-content:center;padding:24px}</style></head>\n<body>\n<!-- Exported from Paper via get_jsx(format: inline-styles) on 2026-09-02. Tokens resolve through brand.css. -->\n${jsx}\n</body></html>\n`;
require("fs").writeFileSync(process.argv[2],html);
' "$SP/jsx.json" ../refi-dao-os/docs/brand/eval/out/02-growfi-social-card.paper.html
npm run paper:call -- finish_working_on_nodes '{}' $T | head -3
```

Note: `get_jsx` returns JSX, not HTML — `className`/`style={{…}}` may need no change for a browser to _display_ roughly, but the file's job is a record of exact values, not a runnable page; say so in its comment if the output is JSX-only.

- [ ] **Step 9: Tally and write the report**

Count `tools/call` lines you ran (Steps 1–8; doctor and dry-runs are free). Then write `../refi-dao-os/docs/brand/eval/out/PAPER-PROTOTYPE-2026-09-02.md`:

```markdown
# Paper prototype — brief 02 on the canvas (2026-09-02)

Framework module `org-os-paper` (org-os `docs/superpowers/specs/2026-09-02-paper-integration-design.md`),
first exercised here: Tier-2 brief 02 built as a Paper artboard from `data/brand.yaml` tokens, exported back.
Outputs: `02-growfi-social-card.paper.png` (2x export) · `02-growfi-social-card.paper.html` (inline-styles JSX).
Compare against the no-context HTML run `02-growfi-social-card.html`.

## Metered calls

| phase                                                      | calls                |
| ---------------------------------------------------------- | -------------------- |
| token push + lint round trip (org-os Task 7, this file id) | ⟨n⟩                  |
| preconditions (lint, font)                                 | 2                    |
| context + artboard                                         | 2                    |
| ground, Orb, logomark, type                                | ⟨5–6⟩                |
| screenshot(s) + fixes                                      | ⟨n⟩                  |
| colour audit                                               | ⟨n⟩                  |
| export, jsx, finish                                        | 3                    |
| **total this prototype**                                   | **⟨n⟩ / ceiling 30** |

## What Paper did

- ⟨row 13: export reply shape → what was done⟩
- ⟨row 15: SVG feTurbulence grain — rendered / not; fallback used?⟩
- ⟨row 16: inline logomark SVG with embedded raster — rendered / fell back to data-URI img⟩
- ⟨create_artboard accepted var() in backgroundColor: yes/no⟩
- ⟨anything else rejected or surprising, with the exact message⟩

## Findings (document-level, per eval README)

- **F-1** ⟨heading one-line vs heading-1 scale at 1080 — hit / not hit; what was done⟩
- ⟨F-2…⟩

## Acceptance (spec §Prototype → pilot)

| #   | criterion                                                             | result               |
| --- | --------------------------------------------------------------------- | -------------------- |
| 1   | `paper:doctor` green                                                  | ⟨✅/❌⟩              |
| 2   | second push = 1 call, 0 changes                                       | ⟨✅/❌⟩              |
| 3   | lint passes after push, fails after a hand edit, passes after re-push | ⟨✅/❌⟩              |
| 4   | colour audit: zero off-token literals                                 | ⟨✅/❌ + what⟩       |
| 5   | export shows visible grain (not flat Space)                           | ⟨✅/❌⟩              |
| 6   | passes brief Must / Must-not + DESIGN.md §6 **at operator review**    | ⟨pending — operator⟩ |
| 7   | total metered calls ≤ 30                                              | ⟨✅ n / ❌ n⟩        |

## Verdict needed from the operator

Same table shape as `VERDICTS.md`: accept / cosmetic / reject for the Paper card, and whether the canvas
version should replace the HTML run as the reference output for brief 02.

| scenario                        | verdict (accept / cosmetic / reject) | note |
| ------------------------------- | ------------------------------------ | ---- |
| 02 — GrowFi social card (Paper) | —                                    |      |

## Next

Hand-refine in Paper; leave at least one comment thread. A later session lists, addresses and resolves it
(`paper-design` → The review loop) — that is the `pilot` → `live` step.
```

Fill every `⟨…⟩`. Then update org-os `packages/paper-integration/VERIFIED.md` rows 13, 15, 16 with what was observed.

- [ ] **Step 10: Commit both repos (explicit paths)**

```bash
cd ../refi-dao-os
git add docs/brand/eval/out/02-growfi-social-card.paper.png docs/brand/eval/out/02-growfi-social-card.paper.html docs/brand/eval/out/PAPER-PROTOTYPE-2026-09-02.md
git commit -m "test(brand): Paper prototype — brief 02 built on a Paper canvas from brand.yaml tokens; export, inline-styles JSX, call tally + findings"
cd ../org-os
npx prettier --write packages/paper-integration/VERIFIED.md
git add packages/paper-integration/VERIFIED.md
git commit -m "verify(paper): rows 13/15/16 from the refi-dao-os prototype — export shape, SVG filters, data-URI images"
```

---

### Task 11: Acceptance and status flip

**Files:**

- Modify (org-os): `docs/MODULES.md` (org-os-paper Status paragraph), `site/src/data/modules.yaml` (status + summary), `docs/integrations/paper.md` (Status line + "What is NOT verified"), `data/skills-matrix.yaml` (`instances_using`), `data/packages-matrix.yaml` (notes), `DECISIONS.md`, `memory/2026-09-02.md`, `HEARTBEAT.md`
- Modify (refi-dao-os): `DECISIONS.md`, `memory/2026-09-02.md`

- [ ] **Step 1: Judge criteria 1–5 and 7 from the report; criterion 6 is the operator's**

If any of 1–5, 7 is ❌: the module stays `in-dev`; record why in `docs/integrations/paper.md` → "What is NOT verified" and in HEARTBEAT.md as a task; skip Steps 2–3; do Step 4 anyway.

- [ ] **Step 2: Flip to `pilot` (only if 1–5 and 7 hold)**

- `docs/MODULES.md` org-os-paper **Status** paragraph → `` `pilot` — built and verified live against Paper 0.5.6 (token round trip 2026-09-02) and exercised end-to-end in refi-dao-os (brief 02 on the canvas, ⟨n⟩ metered calls, `docs/brand/eval/out/PAPER-PROTOTYPE-2026-09-02.md`). Not yet `live`: the operator's verdict on the card and the first comment-thread review loop are pending. ``
- `site/src/data/modules.yaml` → `status: pilot`, summary `Brand tokens pushed into a Paper design file, drift-linted; a brief-02 social card built on the canvas from tokens in refi-dao-os — operator review and the comment loop pending.`
- `docs/integrations/paper.md` Status line → `pilot`; move the exercised rows out of "What is NOT verified".
- `data/skills-matrix.yaml` `paper-design` → `instances_using: ["refi-dao-os"]`; `data/packages-matrix.yaml` `paper-integration` → `instances_using: ["refi-dao-os"]`, notes gain "brief-02 prototype passed ⟨n⟩ calls 2026-09-02".

- [ ] **Step 3: Verify the gates**

```bash
npm test && npm --prefix site test && npm run validate:structure
```

Expected: all green.

- [ ] **Step 4: Record — both repos**

org-os `DECISIONS.md` (follow the file's existing entry format; date from `date +%Y-%m-%d`): _Paper adopted as the agent design canvas (module #5 `org-os-paper`); tokens flow one way from brand.yaml; free-tier budget is a design constraint; registration is instance opt-in; status ⟨pilot / in-dev + why⟩._
org-os `memory/2026-09-02.md`: append a session block — what shipped, calls spent, VERIFIED rows learned, what is pending. `HEARTBEAT.md`: add _"Paper prototype — operator verdict on the brief-02 card + first comment-thread loop"_ under the appropriate section.
refi-dao-os `DECISIONS.md`: _Paper canvas wired for the brand system (`.mcp.json`, tokens pushed 2026-09-02); operator's personal free-tier account; verdict on the canvas card pending._ refi-dao-os `memory/2026-09-02.md`: append the same facts from the instance's side.

```bash
cd ../org-os
npx prettier --write docs/MODULES.md site/src/data/modules.yaml docs/integrations/paper.md data/skills-matrix.yaml data/packages-matrix.yaml
git add docs/MODULES.md site/src/data/modules.yaml docs/integrations/paper.md data/skills-matrix.yaml data/packages-matrix.yaml DECISIONS.md memory/2026-09-02.md HEARTBEAT.md
git commit -m "chore(paper): acceptance — org-os-paper → pilot (or: stays in-dev, reasons recorded); decisions, memory, heartbeat"
cd ../refi-dao-os
git add DECISIONS.md memory/2026-09-02.md
git commit -m "docs: record Paper canvas adoption for the brand system (tokens pushed 2026-09-02, verdict pending)"
```

Expected: both commits contain only the listed paths; refi-dao-os's other uncommitted changes remain as they were.

---

## Self-review (done at plan time)

**Spec coverage.** Client + config (Task 1) · planner + mapping table (Task 2) · doctor zero-metered, `call` passthrough (Task 3) · push idempotent/dry-run/prune/fileId (Task 4) · lint (Task 5) · manifest, catalog, mirror, matrix rows, `.env.example` (Task 6) · VERIFIED.md + reconciliation rule (Task 7) · skill with budget + review loop + hard rules, runbook with registration snippets, skills-matrix (Task 8) · `.mcp.json`, TOOLS.md, brand-skill Canvas table, `.env`, Switzer with ask-first (Task 9) · prototype protocol with call budget, real logomark, outputs, report, VERIFIED rows 13/15/16 (Task 10) · acceptance criteria 1–7 and the flip, DECISIONS/memory in both repos (Task 11). Out-of-scope items are not planned, by design.

**Placeholder scan.** The only angle-bracket fills are in VERIFIED.md and the prototype report, where the plan requires observed values to replace them before commit — those are observation slots, not plan gaps.

**Type consistency.** `createClient` returns `{ initialize, listTools, call, metered, url }` everywhere; `loadConfig({ root, env, tokensPath, file })` → `{ url, fileId }` everywhere; `planTokens` → `{ tokens, skipped, converted }`; `diffTokens` → `{ create, update, unchanged, extra }`; `extractTokens(result)`; `startFakePaper({ serverInfo, tools, handlers, framing })` → `{ url, calls, close }`; `runScript(scriptPath, args, env)` → `{ status, stdout, stderr }`. Script exit codes: 0 ok · 1 error/drift · 2 not-ready/usage across all four scripts.
