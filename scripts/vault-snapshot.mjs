#!/usr/bin/env node
// vault-snapshot.mjs — capture the workspace working tree to a permanent git ref.
//
// Creates `refs/snapshots/<timestamp>-<slug>` containing the working tree
// (tracked + untracked; not gitignored files), without disturbing the tree,
// the index or the stash list. Snapshots are recoverable indefinitely via
// `git ls-tree` and `git cat-file` (they survive `git gc`).
//
// 2026-11-07: before this date the script called `git stash create -u`, but
// `stash create` takes no options: `-u` became part of the message and no
// untracked file was ever captured. Snapshots made before the fix hold the
// tracked tree only.
//
// "Vault" in the name preserves the original Obsidian-flavored vocabulary;
// the script applies to any workspace where untracked content is precious
// (org-os instances, knowledge bases, daily-note systems, etc.).
//
// Usage:
//   npm run vault:snapshot                    # default reason "manual"
//   npm run vault:snapshot -- "before merge"  # custom reason

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const reason = process.argv.slice(2).join(" ").trim() || "manual";
const slug = reason
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 60) || "manual";

const ts = new Date()
  .toISOString()
  .replace(/[-:]/g, "")
  .replace(/\.\d+Z$/, "Z")
  .replace("T", "-");

const refName = `refs/snapshots/${ts}-${slug}`;

function git(args, env) {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    cwd: root,
    env: env ?? process.env,
  }).trim();
}

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

// Stage the whole working tree into a throwaway index (GIT_INDEX_FILE), write
// it as a tree and wrap it in a commit on HEAD. The real index, the working
// tree and the stash list are never touched — never use `git stash push` in a
// workspace with precious untracked content.
const tmp = mkdtempSync(join(tmpdir(), "vault-snapshot-"));
let stashHash;
try {
  const env = { ...process.env, GIT_INDEX_FILE: join(tmp, "index") };
  const head = git(["rev-parse", "HEAD"]);
  git(["read-tree", head], env);
  git(["-c", "advice.addEmbeddedRepo=false", "add", "-A", "--", "."], env);
  const tree = git(["write-tree"], env);
  stashHash = git(["commit-tree", tree, "-p", head, "-m", `vault-snapshot: ${reason}`]);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

git(["update-ref", refName, stashHash]);

// Count root-level content notes — fast, and the metric `vault:audit` uses.
const rootNotes = git(["-c", "core.quotePath=false", "ls-tree", "--name-only", stashHash])
  .split("\n")
  .filter((f) => /\.(md|canvas|base|ya?ml)$/i.test(f)).length;

console.log(`✓ Workspace snapshot saved`);
console.log(`  ref:        ${refName}`);
console.log(`  commit:     ${stashHash.slice(0, 12)}`);
console.log(`  root notes: ${rootNotes}`);
console.log(``);
console.log(`Recover one file:`);
console.log(`  git cat-file -p ${refName}:"<filename>" > "<filename>"`);
console.log(``);
console.log(`List snapshots:`);
console.log(`  git for-each-ref refs/snapshots/`);
