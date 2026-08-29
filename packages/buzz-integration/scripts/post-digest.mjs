#!/usr/bin/env node
// post-digest.mjs — publish the /close session digest as a signed Buzz event,
// tagged with the commit SHA it describes. Fail-open: never blocks a close.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { postEvent, loadConfig } from "../lib/buzz.mjs";

// M3: derive provenance from this script's own repo, never from whatever
// directory happened to invoke it — a caller running from elsewhere (e.g.
// the enclosing vault) must not tag the event with a foreign HEAD.
const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const argv = process.argv.slice(2);
const flagValue = (n) => {
  const i = argv.indexOf(n);
  return i !== -1 ? argv[i + 1] : undefined;
};

// I1: `readFileSync(0)` blocks the event loop forever if stdin never sends
// EOF (an interactive TTY, a stuck upstream pipe, a FIFO left open) — a
// silent hang is worse than any non-zero exit for something fail-open is
// supposed to guard. Read stdin asynchronously with a bounded timeout
// instead; override via BUZZ_STDIN_TIMEOUT_MS for tests.
const STDIN_TIMEOUT_MS = Number(process.env.BUZZ_STDIN_TIMEOUT_MS) || 3000;

function readStdin(timeoutMs) {
  return new Promise((resolve) => {
    let data = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      process.stdin.pause();
      process.stdin.removeAllListeners();
      resolve({ timedOut: true });
    }, timeoutMs);
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => settle({ data }));
    process.stdin.on("error", (error) => settle({ error }));
  });
}

// I4: a bad --file (missing, a directory, or given with no value at all)
// is a read/usage failure, not an "empty digest" — they need different
// operator-facing messages so a typo'd path isn't silently mistaken for a
// genuinely empty session.
const fileFlagPresent = argv.includes("--file");
const filePath = flagValue("--file");

if (fileFlagPresent && !filePath) {
  console.log("buzz: --file requires a path — skipped");
  process.exit(0);
}

let content = "";
let readError = null;

if (filePath) {
  try {
    content = readFileSync(filePath, "utf8");
  } catch (err) {
    readError = err;
  }
} else {
  const result = await readStdin(STDIN_TIMEOUT_MS);
  if (result.timedOut) {
    console.log("buzz: stdin read timed out — skipped");
    process.exit(0);
  }
  if (result.error) readError = result.error;
  else content = result.data;
}

if (readError) {
  console.log(
    `buzz: could not read digest${filePath ? ` from --file ${filePath}` : ""} — skipped (${readError.message})`,
  );
  process.exit(0);
}

if (!content.trim()) {
  console.log("buzz: empty digest — skipped");
  process.exit(0);
}

let sha = "unknown";
try {
  // M2: don't let git's own stderr (e.g. "fatal: not a git repository")
  // leak into this script's output ahead of the correct fail-open result.
  sha = execSync("git rev-parse --short HEAD", {
    encoding: "utf8",
    cwd: ROOT,
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
} catch {
  /* keep unknown */
}

const r = postEvent(
  { content: content.trim(), tags: { sha, source: "org-os-session" } },
  loadConfig(),
);
console.log(
  r.ok
    ? `buzz: digest posted (sha ${sha}, event ${r.id ?? "?"})`
    : `buzz: post failed — skipped (${r.error})`,
);
process.exit(0);
