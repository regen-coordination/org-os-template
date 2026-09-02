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

test("client.call: JSON-RPC error → PaperError rpc with code/message/data, still metered", async () => {
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
  // The call reached Paper and came back with a rejection — it likely got
  // billed, so it must still count against quota.
  assert.equal(c.metered, 1);
});

test("client.call: transport failure → PaperError unreachable, not metered", async () => {
  const err = Object.assign(new Error("fetch failed"), {
    cause: { code: "ECONNREFUSED" },
  });
  const c = createClient({ fetch: fakeFetch([err]) });
  await assert.rejects(
    c.call("get_tokens", {}),
    (e) => e instanceof PaperError && e.code === "unreachable",
  );
  // Nothing reached Paper — must not count.
  assert.equal(c.metered, 0);
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
