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
// commits in the luizfernando instance repo (03 Libraries/luizfernando: ff61a69,
// 28fa4ba, ff24018); this module makes it structural.
//
// Kept separate from clone-framework.mjs so the rules are unit-testable
// without running a clone.

export const EXCLUDE_ANYWHERE = new Set([
  // git + deps + worktrees + host-local config — matched at ANY depth
  ".git", "node_modules", ".worktrees", ".claude/worktrees", ".DS_Store",
]);

export const EXCLUDE_DIRS = new Set([
  // framework operational content (its own history, not a template)
  "memory/reports",
  "graphify-out",
  "renders",
  "docs/agent-plans",
  "docs/superpowers",
  ".superpowers",
  ".agents",
  ".hermes",
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
  "data/knowledge-gaps.yaml", // the framework's own graph gaps
  "PAPERCLIP_DEPLOYMENT_GUIDE.md", // another project's strategy material
  "RESEARCH_INTELLIGENCE_PLAN.md",
  // Generator tests: they exercise clone-framework AS the framework (fixtures,
  // instance-doctor package). Inside an instance the package is filtered out
  // by stage 5 and the tests have no meaning.
  "tests/clone-genesis.test.mjs",
  "tests/clone-framework.test.mjs",
  "tests/clone-framework-health.test.mjs",
  // Guards modules/ — "Framework-side home of org-os modules" (modules/README.md);
  // scripts/modules.mjs itself calls modules/*/module.yaml "framework registry
  // source". No instance consumes it (no data/modules.yaml; the v5 module engine
  // this feeds is framework-only, unbuilt Phase 1+ work). One of its manifests
  // (org-os-berd) claims .agents/agents, which is itself framework operational
  // content excluded above — meaningless to validate against a copy.
  "tests/scripts/module-manifests.test.mjs",
  // Exercises validate-identity.mjs's --target flag, added solely so the
  // framework-only packages/instance-doctor (excluded above) can point the
  // framework's validator at a sibling instance. One case also hardcodes a
  // /org-os/ match against the no-arg (self-checkout) path — true only when
  // the checkout being validated IS the framework.
  "tests/scripts/validate-identity-target.test.mjs",
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
  // git, deps, worktrees, .DS_Store: excluded at any depth.
  if (EXCLUDE_ANYWHERE.has(rel) || EXCLUDE_ANYWHERE.has(name)) return true;
  // Framework dirs and files: root-anchored only.
  if (EXCLUDE_DIRS.has(rel)) return true;
  if (EXCLUDE_FILES.has(rel)) return true;
  if (PLACEHOLDER_FILES.has(rel)) return true;
  // Secrets never travel: .env and every .env.* variant except the example.
  if (!isDir && /^\.env(\..+)?$/.test(name) && name !== ".env.example") return true;
  // The framework's session log stays with the framework. The directory is
  // kept (stage 6e writes memory/.gitkeep); every file inside it is skipped.
  if (!isDir && rel.startsWith("memory/")) return true;
  return false;
}
