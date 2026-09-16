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
// Three layers, outermost first (see selectSourceFiles in clone-framework.mjs):
//
//   1. SOURCE SET — only files `git ls-files` reports are candidates. Anything
//      untracked or gitignored (.env, *.pem, .npmrc, .netrc, credential files,
//      caches, node_modules, machine-local state) cannot be copied at all.
//      The filesystem walk is a warned fallback for non-git checkouts only.
//   2. TOP LEVEL — every top-level entry is DECLARED: TOP_LEVEL_ALLOW (copied)
//      or TOP_LEVEL_DENY (not copied, with a reason). An undeclared entry is
//      not copied and is logged by name, so a new top-level directory in the
//      framework becomes visible instead of silently leaking or vanishing.
//   3. DENY-LIST — within allowed top-level entries, isExcluded() prunes
//      framework-only subpaths. isPathExcluded() applies it to every ancestor
//      directory of a file path, since git lists files, not directories.
//
// Kept separate from clone-framework.mjs so the rules are unit-testable
// without running a clone.

/**
 * Top-level entries a brand-new organisation's instance receives. Criterion:
 * template machinery an instance needs to run. One reason per entry.
 */
export const TOP_LEVEL_ALLOW = new Map([
  [".claude", "slash commands + settings.json guard hook the session lifecycle runs on"],
  [".cursor", "the same slash commands for Cursor"],
  [".opencode", "the same slash commands + opencode.json for OpenCode (agents/ pruned below)"],
  [".github", "pre-commit hook + generic schema CI (framework-only workflows pruned below)"],
  [".well-known", "EIP-4824 *.json.template files generate:schemas renders from"],
  [".env.example", "documents the env vars scripts read; holds no values"],
  [".gitignore", "keeps secrets, deps and scratch out of the instance's own history"],
  [".prettierignore", "config for the `format` / `check` scripts"],
  ["AGENTS.md", "the agent runtime protocol every session reads"],
  ["BOOTSTRAP.md", "the first-session bootstrap sequence a new instance follows"],
  ["LICENSE", "MIT notice must travel with the copied framework code"],
  ["data", "registry files (instance-owned ones reset in stage 4b)"],
  ["docs", "operator + protocol documentation (framework history pruned below)"],
  ["package.json", "scripts + deps (rewritten in 6b, dangling scripts dropped in 6d)"],
  ["package-lock.json", "reproducible install of the same deps"],
  ["packages", "package sources, filtered to the enabled set in stage 5"],
  ["repos", "home for linked-repo clones (README only; clones are gitignored)"],
  ["repos.manifest.json", "schema for clone:repos (reset to an empty list at genesis)"],
  ["schemas", "JSON-LD / JSON schemas the validators read"],
  ["scripts", "the machinery every npm script runs"],
  ["skills", "skill definitions, filtered to the selected set in stage 5"],
  ["templates", "render.mjs + templates render:templates reads"],
  ["tests", "the instance's own day-one test suite (framework-only suites pruned below)"],
]);

/**
 * Top-level entries deliberately NOT copied. Either the framework's own
 * operational content / history / self-description, or a file the generator
 * writes itself (listed in GENERATED_FILES).
 */
export const TOP_LEVEL_DENY = new Map([
  [".agents", "the framework's own agent roster and vendored research skills"],
  [".hermes", "the framework's Hermes runtime config (machine-local)"],
  ["CHANGELOG.md", "the framework's release history, not the instance's"],
  ["CLAUDE.md", "framework self-description — rendered from templates/CLAUDE.instance.md in stage 7"],
  ["DECISIONS.md", "the framework's decision log — written fresh in stage 6e"],
  ["HEARTBEAT.md", "framework task state — reset in stage 4"],
  ["IDENTITY.md", "framework identity — reset in stage 4"],
  ["MASTERPLAN.md", "framework mandate — reset in stage 4"],
  ["MEMORY.md", "framework decisions index — reset in stage 4"],
  ["SOUL.md", "framework values/voice — reset in stage 4b"],
  ["USER.md", "the framework operator's profile — reset in stage 4b"],
  ["TOOLS.md", "the framework's endpoints — reset in stage 4b"],
  ["README.md", "framework README — rendered from templates/README.instance.md in stage 7"],
  ["federation.yaml", "framework network topology — written fresh in stage 6"],
  ["knowledge", "framework knowledge-commons index — knowledge/INDEX.md stub written at genesis"],
  ["memory", "the framework's session log — memory/.gitkeep written at genesis"],
  ["SKILLS.md", "generated per instance by generate:skills"],
  ["VERSION.md", "the framework's release tracking; an instance's version lives in package.json + federation.yaml"],
  ["PAPERCLIP_DEPLOYMENT_GUIDE.md", "another project's strategy material"],
  ["RESEARCH_INTELLIGENCE_PLAN.md", "framework strategy document"],
  ["SYNC-GUIDE.md", "stale guide for `npm run sync`, a script no instance has"],
  ["dashboard.yaml", "tuned for the framework hub role; initialize.mjs falls back to all-sections defaults"],
  ["graphify-out", "the framework's own knowledge graph"],
  ["renders", "renders of the framework's federation"],
  ["site", "the framework's own Astro project website"],
  ["integrations", "framework-side integration workspace (no instance script reads it)"],
  ["modules", "framework-side module registry (scripts/modules.mjs calls it framework source)"],
  ["instances", "private per-instance configs of other organisations"],
]);

/**
 * Files the generator writes itself, relative to the instance root. Together
 * with the tracked, allowed, non-excluded framework files this is the COMPLETE
 * set of files a fresh clone (--no-git) may contain; tests/clone-genesis.test.mjs
 * fails by name on anything else.
 */
export const GENERATED_FILES = new Set([
  "IDENTITY.md", "MASTERPLAN.md", "MEMORY.md", "HEARTBEAT.md",
  "SOUL.md", "USER.md", "TOOLS.md", "DECISIONS.md",
  "federation.yaml", "README.md", "GETTING-STARTED.md", "CLAUDE.md",
  ".well-known/dao.json", "memory/.gitkeep", "knowledge/INDEX.md",
  "docs/plans/QUEUE.md", "docs/plans/.gitkeep",
  "docs/superpowers/specs/.gitkeep", "docs/superpowers/plans/.gitkeep",
  "docs/superpowers/research/.gitkeep",
]);

/** @returns {"allow"|"deny"|"undeclared"} */
export function topLevelDecision(name) {
  if (TOP_LEVEL_ALLOW.has(name)) return "allow";
  if (TOP_LEVEL_DENY.has(name)) return "deny";
  return "undeclared";
}

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
  // The framework's history and self-description inside docs/.
  "docs/sessions",
  "docs/research",
  // The framework operator's own OpenCode agents (they describe a personal
  // notes vault, not an organisation). Commands + opencode.json stay.
  ".opencode/agents",
  // framework-only test suites — need framework env/fixtures, meaningless in an instance
  "tests/buzz-integration",
  "tests/paper-integration",
  "tests/instance-doctor",
  // The framework's own project website — package name "org-os-site",
  // "Framework website + docs + live federation", an Astro app that deploys
  // to regen-coordination.github.io/org-os-template (.github/workflows/deploy-pages.yml,
  // excluded below). Found 2026-09-13 during the luizfernando genesis: it
  // collided with that instance's OWN root-level site/ (a vendored Quartz
  // publishing pipeline, ported by hand from the 2026-07-26 scaffold), which
  // had to be deleted and re-ported around the leak. Root-anchored (EXCLUDE_DIRS,
  // not EXCLUDE_ANYWHERE) on purpose: an instance's own nested `site` directory
  // — or its own root `site/`, as here — is legitimate instance content, only
  // the framework's root `site/` is not.
  "site",
]);

export const EXCLUDE_FILES = new Set([
  ".gitignore.test",
  ".claude/scheduled_tasks.lock",
  "README.md", // rendered fresh in stage 7
  "MASTERPROMPT.md", // framework-only
  ".buzz-state.json", // Buzz lane read-marker — machine-local state
  "data/knowledge-gaps.yaml", // the framework's own graph gaps
  "docs/QUEUE.md", // the framework's task queue; the instance's is docs/plans/QUEUE.md
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
  // .github/workflows/ triaged file-by-file 2026-09-13 (fix round 1, Task 7):
  // framework-project workflows excluded by full path; generic CI stays.
  // - deploy-pages.yml: builds and deploys the framework's own site/ (Astro,
  //   excluded above) to regen-coordination.github.io/org-os-template; also
  //   installs packages/org-os-federation-map and packages/admin, neither of
  //   which an instance receives (stage 5 keeps only packages/operations).
  //   Excluding site/ without excluding this workflow would leave a workflow
  //   that fails on every push — not an argument for keeping it.
  // - drift.yml: runs `npm run analyze:instances` against data/instances.yaml,
  //   which no instance has (Task 4) — the framework's own federation-drift
  //   monitor, meaningless pointed at a single instance.
  // - validate.yml: same analyze:instances step, plus installs for
  //   packages/admin and packages/org-os-federation-map (neither present in
  //   an instance) and a site/ Astro build. Framework-only as a whole.
  // - generate-schemas.yml KEPT: runs only `npm run generate:schemas` against
  //   this instance's own data/*.yaml — generic CI any instance would want,
  //   no framework-only reference.
  ".github/workflows/deploy-pages.yml",
  ".github/workflows/drift.yml",
  ".github/workflows/validate.yml",
]);

// Reset in stage 4 (so don't bother copying).
export const PLACEHOLDER_FILES = new Set([
  "MEMORY.md", "HEARTBEAT.md", "IDENTITY.md", "MASTERPLAN.md",
]);

const SECRET_FILE = /^(\.npmrc|\.netrc|\.pgpass|\.mcp\.json|credentials(\.[\w-]+)?\.json|.*\.(pem|key|p12|pfx))$/i;

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
  // Credential-shaped files. The git source set already makes untracked ones
  // uncopyable; this is defence in depth for the non-git fallback walk.
  if (!isDir && SECRET_FILE.test(name)) return true;
  // The framework's session log stays with the framework. The directory is
  // kept (stage 6e writes memory/.gitkeep); every file inside it is skipped.
  if (!isDir && rel.startsWith("memory/")) return true;
  return false;
}

/**
 * isExcluded() for a FILE path whose ancestor directories were never visited
 * (git ls-files lists files only): an excluded directory excludes everything
 * beneath it, so every ancestor is checked as a directory before the file.
 * @param {string} rel posix file path relative to the framework root
 */
export function isPathExcluded(rel) {
  const parts = rel.split("/");
  for (let i = 1; i < parts.length; i++) {
    if (isExcluded(parts.slice(0, i).join("/"), parts[i - 1], true)) return true;
  }
  return isExcluded(rel, parts[parts.length - 1], false);
}
