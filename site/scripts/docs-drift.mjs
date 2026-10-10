// docs-drift.mjs — which docs pages describe code that changed after the
// page was verified (spec §5.5). For each manifest page with `covers`, lists
// the paths changed between its `verified` commit and HEAD. It is a report:
// it always exits 0, in CI and locally. Run from site/ (`npm run drift`).
import { execFileSync } from "node:child_process";
import { PAGES } from "../src/data/docs-manifest.mjs";
import { REPO_ROOT } from "../src/lib/repo.mjs";
import { statSync } from "node:fs";
import { join } from "node:path";
import { pagesToCheck, formatDriftReport, splitCovers, DIR_EXCLUDES } from "../src/lib/drift.mjs";

const isDir = (p) => { try { return statSync(join(REPO_ROOT, p)).isDirectory(); } catch { return false; } };
const diff = (verified, pathspecs) => execFileSync("git", ["diff", "--name-only", `${verified}..HEAD`, "--", ...pathspecs], {
  cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
}).split("\n").filter(Boolean);

function changedPaths(verified, covers) {
  const { files, dirs } = splitCovers(covers, isDir);
  const found = new Set();
  if (files.length > 0) for (const f of diff(verified, files)) found.add(f);
  // Git has one exclude list per call, so directories go in a call of their own.
  if (dirs.length > 0) for (const f of diff(verified, [...dirs, ...DIR_EXCLUDES])) found.add(f);
  return [...found].sort();
}

const entries = pagesToCheck(PAGES).map((p) => {
  const base = { slug: p.slug, source: p.source, verified: p.verified, covers: p.covers };
  try {
    return { ...base, changed: changedPaths(p.verified, p.covers) };
  } catch (e) {
    return { ...base, changed: null, error: String(e.stderr || e.message).trim().split("\n")[0] };
  }
});

process.stdout.write(formatDriftReport(entries));
process.exit(0);
