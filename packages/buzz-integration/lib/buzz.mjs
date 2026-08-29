#!/usr/bin/env node
// buzz.mjs — thin wrapper around the pinned buzz-cli. ALL protocol work
// happens in the CLI; this file only builds argv, spawns, parses JSON.
// CLI_MAP mirrors packages/buzz-integration/VERIFIED.md — change it ONLY
// to match a re-verified pin.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

// intent → argv builder. Defaults are the Task-1-verified invocations.
const CLI_MAP = {
  post: (c, { content, tags }) => [
    "post",
    "--channel",
    c.channel,
    "--content",
    content,
    ...Object.entries(tags ?? {}).flatMap(([k, v]) => ["--tag", `${k}=${v}`]),
    "--json",
  ],
  read: (c, { since }) => [
    "read",
    "--channel",
    c.channel,
    ...(since ? ["--since", String(since)] : []),
    "--json",
  ],
  status: (c) => ["status", "--relay", c.relayUrl, "--json"],
};

// Parse one raw .env value: if it opens with a quote, take everything up to
// the matching closing quote (leaving any "#" inside untouched, and
// discarding anything — including a trailing comment — after the close).
// Otherwise strip from the first "#" onward (dotenv treats "#" as a comment
// marker whether or not it's preceded by whitespace) and trim.
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

// Parse .env text into a flat key→value map. Never throws on malformed
// content — unmatched lines (blank, comments, garbage) are simply skipped.
function parseEnvFile(text) {
  const fileVars = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\r$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) fileVars[m[1]] = parseEnvValue(m[2]);
  }
  return fileVars;
}

export function loadConfig({ root = ROOT, env = process.env } = {}) {
  let fileVars = {};
  try {
    const envPath = path.join(root, ".env");
    if (existsSync(envPath))
      fileVars = parseEnvFile(readFileSync(envPath, "utf8"));
  } catch {
    // Any read failure (EISDIR, EACCES, etc.) is treated as "no .env" —
    // loadConfig must never throw; safe defaults / env vars still apply.
    fileVars = {};
  }
  const get = (k, dflt) => env[k] ?? fileVars[k] ?? dflt;
  return {
    relayUrl: get("BUZZ_RELAY_URL", "ws://localhost:3000"),
    channel: get("BUZZ_CHANNEL", "org-os-dev"),
    nsec: get("BUZZ_NSEC", ""),
    bin: get("BUZZ_CLI_BIN", "buzz-cli"),
  };
}

function invoke(intent, args, cfg) {
  try {
    const c = cfg ?? loadConfig();
    const r = spawnSync(c.bin, CLI_MAP[intent](c, args), {
      encoding: "utf8",
      timeout: 15000,
      env: { ...process.env, BUZZ_RELAY_URL: c.relayUrl, BUZZ_NSEC: c.nsec },
    });
    if (r.error || r.status !== 0)
      return {
        ok: false,
        error: r.error?.message ?? r.stderr?.trim() ?? `exit ${r.status}`,
      };
    return { ok: true, ...JSON.parse(r.stdout) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export function postEvent(args, cfg) {
  if (!args?.content) return { ok: false, error: "content is required" };
  return invoke("post", args, cfg);
}
export const readChannel = (args, cfg) => invoke("read", args, cfg);
export function status(cfg) {
  try {
    const c = cfg ?? loadConfig();
    // key/channel are locally knowable from cfg alone — compute them before
    // the bin early-return so a missing binary never misreports a populated
    // key/channel as false (bin and relay legitimately need the CLI).
    const key = Boolean(c.nsec);
    const channel = Boolean(c.channel);
    const bin = !spawnSync(c.bin, ["--version"], {
      encoding: "utf8",
      timeout: 5000,
    }).error;
    if (!bin)
      return {
        ok: false,
        checks: { bin: false, relay: false, key, channel },
      };
    const relay = invoke("status", {}, c).ok;
    const checks = { bin, relay, key, channel };
    return { ok: Object.values(checks).every(Boolean), checks };
  } catch (e) {
    return {
      ok: false,
      error: e.message,
      checks: { bin: false, relay: false, key: false, channel: false },
    };
  }
}
