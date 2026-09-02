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
