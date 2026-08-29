#!/usr/bin/env node
// read-since.mjs — "what happened in #org-os-dev since my last session".
// Fail-open by design: any failure prints a skip line and exits 0.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readChannel, loadConfig } from "../lib/buzz.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const argv = process.argv.slice(2);
const flagValue = (n) => {
  const i = argv.indexOf(n);
  return i !== -1 ? argv[i + 1] : undefined;
};
const STATE = flagValue("--state") ?? path.join(ROOT, ".buzz-state.json");
const DAY = 24 * 60 * 60;

let since = Math.floor(Date.now() / 1000) - DAY; // fallback window
try {
  since = JSON.parse(readFileSync(STATE, "utf8")).lastRead ?? since;
} catch {
  /* fall back */
}

const cfg = loadConfig();
const r = readChannel({ since }, cfg);
if (!r.ok) {
  console.log(`buzz: relay unreachable — skipped (${r.error})`);
  process.exit(0);
}
// C1: `r.events` comes straight from parsed CLI/relay JSON — never assume
// it is a well-formed array, or that its entries are well-formed objects.
// A field rename, a relay proxy returning `{}`, or a malformed entry must
// never crash this script.
const events = Array.isArray(r.events) ? r.events : [];
if (events.length === 0)
  console.log(`buzz: #${cfg.channel} — no new messages since last session`);
else {
  console.log(`### Buzz #${cfg.channel} since last session\n`);
  for (const e of events) {
    const createdAt =
      e && typeof e === "object" && Number.isFinite(e.created_at)
        ? e.created_at
        : null;
    const ts =
      createdAt !== null
        ? new Date(createdAt * 1000).toISOString()
        : "unknown-time";
    const content =
      e && typeof e === "object" && typeof e.content === "string"
        ? e.content
        : String(e ?? "");
    console.log(`- [${ts}] ${content}`);
  }
}
// C2: a `--state` path the process can't write to (missing parent dir,
// a directory instead of a file, permissions) must not crash the script
// after the events above have already been printed — skip the marker
// update and say so instead.
if (!argv.includes("--no-advance")) {
  try {
    writeFileSync(
      STATE,
      JSON.stringify({ lastRead: Math.floor(Date.now() / 1000) }),
    );
  } catch (err) {
    console.log(`buzz: could not save read marker — skipped (${err.message})`);
  }
}
