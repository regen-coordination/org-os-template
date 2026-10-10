// docs-drift.mjs — which docs pages describe code that changed after the
// page was verified (spec §5.5). For each manifest page with `covers`, lists
// the paths changed between its `verified` commit and HEAD. It is a report:
// it always exits 0, in CI and locally. Run from site/ (`npm run drift`).
import { execFileSync } from "node:child_process";
import { PAGES } from "../src/data/docs-manifest.mjs";
import { REPO_ROOT } from "../src/lib/repo.mjs";
import { pagesToCheck, formatDriftReport } from "../src/lib/drift.mjs";

function changedPaths(verified, covers) {
  const out = execFileSync("git", ["diff", "--name-only", `${verified}..HEAD`, "--", ...covers], {
    cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
  });
  return out.split("\n").filter(Boolean);
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
