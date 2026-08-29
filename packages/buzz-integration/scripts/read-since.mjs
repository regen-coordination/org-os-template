#!/usr/bin/env node
// read-since.mjs — "what happened in #org-os-dev since my last session".
// Fail-open by design: any failure prints a skip line and exits 0.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
if (r.events.length === 0)
  console.log(`buzz: #${cfg.channel} — no new messages since last session`);
else {
  console.log(`### Buzz #${cfg.channel} since last session\n`);
  for (const e of r.events)
    console.log(
      `- [${new Date(e.created_at * 1000).toISOString()}] ${e.content}`,
    );
}
if (!argv.includes("--no-advance"))
  writeFileSync(
    STATE,
    JSON.stringify({ lastRead: Math.floor(Date.now() / 1000) }),
  );
