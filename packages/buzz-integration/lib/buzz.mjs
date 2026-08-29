#!/usr/bin/env node
// buzz.mjs — thin wrapper around the pinned `buzz` binary. ALL protocol work
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

// intent → argv builder. Verified 2026-08-29 against a live relay — see
// packages/buzz-integration/VERIFIED.md. There is no `--json` flag (stdout
// is always JSON, unconditionally) and no `--tag` flag — provenance travels
// as a trailer appended to the message content itself (see
// scripts/post-digest.mjs), not as CLI-level tags.
const CLI_MAP = {
  post: (c, { content }) => [
    "messages",
    "send",
    "--channel",
    c.channel,
    "--content",
    content,
  ],
  read: (c, { since, limit } = {}) => [
    "messages",
    "get",
    "--channel",
    c.channel,
    ...(since ? ["--since", String(since)] : []),
    ...(limit ? ["--limit", String(limit)] : []),
  ],
  // There is no `status` subcommand. `channels list` is the verified
  // connectivity/auth probe (VERIFIED.md) — it needs no arguments.
  status: () => ["channels", "list"],
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
    relayUrl: get("BUZZ_RELAY_URL", "http://localhost:3000"),
    channel: get("BUZZ_CHANNEL", "org-os-dev"),
    key: get("BUZZ_PRIVATE_KEY", ""),
    bin: get("BUZZ_CLI_BIN", "buzz"),
  };
}

function invoke(intent, args, cfg) {
  try {
    const c = cfg ?? loadConfig();
    const r = spawnSync(c.bin, CLI_MAP[intent](c, args), {
      encoding: "utf8",
      timeout: 15000,
      env: {
        ...process.env,
        BUZZ_RELAY_URL: c.relayUrl,
        BUZZ_PRIVATE_KEY: c.key,
      },
    });
    if (r.error || r.status !== 0)
      return {
        ok: false,
        error: r.error?.message ?? r.stderr?.trim() ?? `exit ${r.status}`,
      };
    const parsed = JSON.parse(r.stdout);
    if (intent === "read") {
      // `messages get` returns a top-level JSON array. Anything else is an
      // unrecognized shape — return ok:true with NO `events` key so callers
      // (read-since.mjs) can tell "genuinely zero events" (events: []) apart
      // from "don't recognize this reply" and refuse to advance a read
      // marker past messages that couldn't actually be parsed.
      return Array.isArray(parsed)
        ? { ok: true, events: parsed }
        : { ok: true };
    }
    // `messages send` returns a top-level JSON object
    // ({accepted, event_id, mention_pubkeys, message}). Guard against an
    // unexpected array here too — spreading an array onto the result would
    // produce numeric-keyed junk, not a useful reply.
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      return { ok: true, ...parsed };
    return { ok: true };
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
    // any spawn so a missing binary or an unreachable relay never
    // misreports a populated key/channel as false (bin and relay
    // legitimately need the CLI to answer).
    const key = Boolean(c.key);
    const channel = Boolean(c.channel);
    // There is no `--version` flag (the CLI rejects it) and no `status`
    // subcommand. `channels list` is the verified, cheap connectivity/auth
    // probe (VERIFIED.md) — bounded at 5s (shorter than invoke()'s 15s) so
    // a hanging or slow-to-answer binary can't wedge a doctor check that
    // /initialize and /close both gate on.
    const r = spawnSync(c.bin, CLI_MAP.status(c), {
      encoding: "utf8",
      timeout: 5000,
      env: {
        ...process.env,
        BUZZ_RELAY_URL: c.relayUrl,
        BUZZ_PRIVATE_KEY: c.key,
      },
    });
    if (r.error)
      // Binary missing / not executable, or the 5s hang guard fired.
      return {
        ok: false,
        checks: { bin: false, relay: false, key, channel },
      };
    // Verified exit codes (VERIFIED.md): 0 success, 1 bad input, 2
    // relay/network error (retryable), 3 auth error. Real exit codes let
    // doctor report *which* of relay/key is the problem instead of
    // guessing from a single bundled probe.
    if (r.status === 3)
      return {
        ok: false,
        checks: { bin: true, relay: true, key: false, channel },
      };
    if (r.status !== 0)
      // 2 (relay/network error) and any other unexpected exit code — the
      // relay side is the only concrete signal available here.
      return {
        ok: false,
        checks: { bin: true, relay: false, key, channel },
      };
    const checks = { bin: true, relay: true, key, channel };
    return { ok: Object.values(checks).every(Boolean), checks };
  } catch (e) {
    return {
      ok: false,
      error: e.message,
      checks: { bin: false, relay: false, key: false, channel: false },
    };
  }
}
