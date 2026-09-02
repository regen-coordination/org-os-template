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
