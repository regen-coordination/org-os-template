// scripts/lib/clone-excludes.mjs
//
// What never travels from the framework to a generated instance.
//
// The framework runs org-os on itself, so its tree holds its OWN operational
// content — session log, plan queue, specs, research, knowledge graph,
// renders, integration state — plus local secrets. None of that is a
// template. Verified 2026-09-13 (luizfernando genesis spike): a clone without
// these rules carried 10 framework memory days, a 7.7 MB graph, 284 tracked
// framework files and a copy of the framework's .env with live keys. The
// 2026-07-26 luizfernando scaffold stripped the same leakage by hand in three
// commits (ff61a69, 28fa4ba, ff24018); this module makes it structural.
//
// Kept separate from clone-framework.mjs so the rules are unit-testable
// without running a clone.

export const EXCLUDE_DIRS = new Set([
  // git + deps + worktrees + host-local config
  ".git", "node_modules", ".worktrees", ".claude/worktrees", ".hermes",
  // framework operational content (its own history, not a template)
  "memory/reports",
  "graphify-out",
  "renders",
  "docs/agent-plans",
  "docs/superpowers",
  ".superpowers",
  ".agents",
  "data/federation/frontier",
  // framework-only test suites — need framework env/fixtures, meaningless in an instance
  "tests/buzz-integration",
  "tests/paper-integration",
  "tests/instance-doctor",
]);

export const EXCLUDE_FILES = new Set([
  ".gitignore.test",
  ".claude/scheduled_tasks.lock",
  "README.md", // rendered fresh in stage 7
  "MASTERPROMPT.md", // framework-only
  ".buzz-state.json", // Buzz lane read-marker — machine-local state
  ".DS_Store",
  "data/knowledge-gaps.yaml", // the framework's own graph gaps
  "PAPERCLIP_DEPLOYMENT_GUIDE.md", // another project's strategy material
  "RESEARCH_INTELLIGENCE_PLAN.md",
  // Generator tests: they exercise clone-framework AS the framework (fixtures,
  // instance-doctor package). Inside an instance the package is filtered out
  // by stage 5 and the tests have no meaning.
  "tests/clone-genesis.test.mjs",
  "tests/clone-framework.test.mjs",
  "tests/clone-framework-health.test.mjs",
]);

// Reset in stage 4 (so don't bother copying).
export const PLACEHOLDER_FILES = new Set([
  "MEMORY.md", "HEARTBEAT.md", "IDENTITY.md", "MASTERPLAN.md",
]);

/**
 * @param {string} rel   posix path relative to the framework root
 * @param {string} name  basename of the entry
 * @param {boolean} isDir
 */
export function isExcluded(rel, name, isDir) {
  if (EXCLUDE_DIRS.has(rel) || EXCLUDE_DIRS.has(name)) return true;
  if (EXCLUDE_FILES.has(rel) || EXCLUDE_FILES.has(name)) return true;
  if (PLACEHOLDER_FILES.has(rel)) return true;
  // Secrets never travel: .env and every .env.* variant except the example.
  if (!isDir && /^\.env(\..+)?$/.test(name) && name !== ".env.example") return true;
  // The framework's session log stays with the framework. The directory is
  // kept (stage 6e writes memory/.gitkeep); every file inside it is skipped.
  if (!isDir && rel.startsWith("memory/")) return true;
  return false;
}
