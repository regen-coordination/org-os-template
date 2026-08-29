#!/usr/bin/env node
// post-digest.mjs — publish the /close session digest as a signed Buzz event,
// tagged with the commit SHA it describes. Fail-open: never blocks a close.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { postEvent, loadConfig } from "../lib/buzz.mjs";

const argv = process.argv.slice(2);
const flagValue = (n) => {
  const i = argv.indexOf(n);
  return i !== -1 ? argv[i + 1] : undefined;
};

let content = "";
try {
  content = flagValue("--file")
    ? readFileSync(flagValue("--file"), "utf8")
    : readFileSync(0, "utf8"); // stdin
} catch {
  /* fall through to empty check */
}

if (!content.trim()) {
  console.log("buzz: empty digest — skipped");
  process.exit(0);
}

let sha = "unknown";
try {
  sha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
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
