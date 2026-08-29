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
// supposed to guard. Read stdin asynchronously instead — override via
// BUZZ_STDIN_TIMEOUT_MS / BUZZ_STDIN_TOTAL_TIMEOUT_MS for tests.
//
// NEW-2: the timeout must never discard content already buffered. A total
// (one-shot) budget throws away a complete digest just because the
// producer held the pipe open afterward, and truncates a legitimately
// slow-but-completing stream mid-flight. An *idle* timer — rearmed on each
// `data` event, and resolving with whatever has been buffered so far
// rather than nothing — keeps the hang guard (a producer that sends
// nothing at all still times out) without the loss.
//
// NEW-A: the idle timer alone has no upper bound — a producer that never
// goes idle for `idleTimeoutMs` (one byte every second, forever) can keep
// re-arming it indefinitely, turning the hang guard back into a hang. A
// second, never-rearmed total-deadline timer runs alongside it; whichever
// fires first ends the read. Default 15000ms matches lib/buzz.mjs's own
// invoke() CLI timeout, so nothing in this pipeline blocks more than 15s;
// real /close invocations complete in well under a second per the plan's
// own timing audit (0.11-0.39s), so this should only ever engage against a
// stalled or adversarial producer.
//
// NEW-B: either timer firing with data already buffered means the read
// ended before natural EOF — the content may or may not be everything the
// producer intended to send. `truncated: true` on that result lets the
// caller say so instead of reporting a plain, unqualified success.
const STDIN_TIMEOUT_MS = Number(process.env.BUZZ_STDIN_TIMEOUT_MS) || 3000;
const STDIN_TOTAL_TIMEOUT_MS =
  Number(process.env.BUZZ_STDIN_TOTAL_TIMEOUT_MS) || 15000;

function readStdin(idleTimeoutMs, totalTimeoutMs) {
  return new Promise((resolve) => {
    let data = "";
    let settled = false;
    let idleTimer;
    let totalTimer;

    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(idleTimer);
      clearTimeout(totalTimer);
      process.stdin.pause();
      process.stdin.removeAllListeners();
      resolve(result);
    };

    // Only a genuinely empty read (nothing ever arrived) counts as a real
    // timeout; anything already buffered gets posted as-is, flagged.
    const onTimeout = () => {
      settle(data ? { data, truncated: true } : { timedOut: true });
    };

    const armIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(onTimeout, idleTimeoutMs);
    };

    totalTimer = setTimeout(onTimeout, totalTimeoutMs);

    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
      armIdleTimer(); // more data just arrived — reset the idle window
    });
    process.stdin.on("end", () => settle({ data }));
    process.stdin.on("error", (error) => settle({ error }));

    armIdleTimer(); // start the idle window even before any data arrives
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
let truncated = false;

if (filePath) {
  try {
    content = readFileSync(filePath, "utf8");
  } catch (err) {
    readError = err;
  }
} else {
  const result = await readStdin(STDIN_TIMEOUT_MS, STDIN_TOTAL_TIMEOUT_MS);
  if (result.timedOut) {
    console.log("buzz: stdin read timed out — skipped");
    process.exit(0);
  }
  if (result.error) readError = result.error;
  else {
    content = result.data;
    truncated = Boolean(result.truncated);
  }
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
    ? `buzz: digest posted (sha ${sha}, event ${r.id ?? "?"})${
        // NEW-B: flag the timer path — we can't tell "producer finished,
        // held the pipe open" from "producer stalled mid-digest", so say so
        // rather than reporting an unqualified clean success.
        truncated
          ? " — stdin read stopped before EOF; content may be truncated"
          : ""
      }`
    : `buzz: post failed — skipped (${r.error})`,
);
process.exit(0);
