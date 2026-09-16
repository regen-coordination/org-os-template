#!/usr/bin/env node
/**
 * clone-framework.mjs — generate a new org-os instance from this framework.
 *
 * Stages (each can be inspected with --dry):
 *   1. Validate target directory is empty (or --force)
 *   2. Copy tracked framework files under declared top-level entries, minus the deny-list
 *   3. Strip framework-only registries (instances.yaml, packages-matrix, skills-matrix)
 *   4. Reset markdown placeholders (IDENTITY, MASTERPLAN, MEMORY, HEARTBEAT, README)
 *   5. Materialize packages + skills per config (sync-packages with --enabled)
 *   6. Write federation.yaml with instance identity + lineage stamp
 *   7. Render README + GETTING-STARTED + CLAUDE.md from templates
 *   8. Git init + initial commit (skip with --no-git)
 *
 * Usage:
 *   node scripts/clone-framework.mjs --target ../my-org --config config.yaml
 *   node scripts/clone-framework.mjs --target /tmp/test --config tests/fixtures/instance-config.yaml --dry --no-git
 *
 * Non-interactive only in v3.5; --interactive (clack-based) deferred.
 *
 * Returns exit 0 on success, 1 on any error. Idempotent only with --force.
 */

import {
  readFileSync, writeFileSync, appendFileSync, readdirSync, statSync, existsSync,
  mkdirSync, copyFileSync, rmSync, lstatSync, realpathSync,
} from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { render } from "../templates/render.mjs";
import { isExcluded, isPathExcluded, topLevelDecision } from "./lib/clone-excludes.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frameworkRoot = path.resolve(__dirname, "..");

function getArg(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const targetArg = getArg("--target");
const configArg = getArg("--config");
const dry = process.argv.includes("--dry");
const force = process.argv.includes("--force");
const noGit = process.argv.includes("--no-git");

if (!targetArg) {
  console.error("✗ --target <dir> is required");
  process.exit(1);
}
if (!configArg) {
  console.error("✗ --config <file.yaml> is required (interactive mode not yet supported)");
  process.exit(1);
}

const target = path.resolve(targetArg);
const configPath = path.resolve(configArg);

if (!existsSync(configPath)) {
  console.error(`✗ Config file not found: ${configPath}`);
  process.exit(1);
}

const config = yaml.load(readFileSync(configPath, "utf-8")) || {};
if (!config.org || !config.org.name || !config.org.type) {
  console.error("✗ Config must include org.name and org.type");
  process.exit(1);
}

function log(stage, msg) {
  console.log(`[${stage}] ${msg}`);
}

// === Stage 1: target validation ===
log("stage 1", `target: ${target}`);
if (existsSync(target)) {
  const entries = readdirSync(target);
  if (entries.length > 0 && !force) {
    console.error(`✗ Target not empty: ${target}. Use --force to overwrite.`);
    process.exit(1);
  }
}

// === Stage 2: copy framework, exclude framework-only state ===
//
// The copy set is built from what the framework TRACKS, not from what happens
// to be on disk. Seven leaks were patched one deny-list entry at a time while
// this walked the filesystem; a deny-list cannot see content that does not
// exist yet, and one basename regex was the only thing between a clone and
// .npmrc / .netrc / *.pem / credentials.json. Now:
//   1. `git ls-files` is the source set — untracked and gitignored files are
//      structurally uncopyable.
//   2. every top-level entry must be declared (TOP_LEVEL_ALLOW / _DENY); an
//      undeclared one is skipped and logged by name.
//   3. the deny-list (isPathExcluded) prunes framework-only subpaths.
// Rules + reasons live in scripts/lib/clone-excludes.mjs.
function gitTrackedFiles(root) {
  const probe = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, encoding: "utf-8" });
  if (probe.status !== 0) return null;
  let top;
  try {
    top = realpathSync(probe.stdout.trim());
  } catch {
    return null;
  }
  // A framework unpacked from a zip INSIDE some other repository is not a
  // work tree of its own; that repository's index says nothing about it.
  if (top !== realpathSync(root)) return null;
  const r = spawnSync("git", ["ls-files", "-z", "--cached"], {
    cwd: root, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) return null;
  return r.stdout.split("\0").filter(Boolean);
}

function walkFiles(root, rel = "") {
  const out = [];
  for (const entry of readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    if (isExcluded(r, entry.name, entry.isDirectory())) continue;
    if (entry.isDirectory()) out.push(...walkFiles(root, r));
    else if (entry.isFile()) out.push(r);
  }
  return out;
}

/**
 * @returns {{ mode: "git"|"filesystem", files: string[], undeclared: string[] }}
 */
function selectSourceFiles(root) {
  const tracked = gitTrackedFiles(root);
  const mode = tracked ? "git" : "filesystem";
  const candidates = tracked ?? walkFiles(root);
  const undeclared = new Set();
  const files = [];
  for (const rel of candidates) {
    const top = rel.split("/")[0];
    const decision = topLevelDecision(top);
    if (decision !== "allow") {
      if (decision === "undeclared" && !isExcluded(top, top, rel.includes("/"))) undeclared.add(top);
      continue;
    }
    if (isPathExcluded(rel)) continue;
    // Tracked but deleted in the working tree, or a gitlink (submodule).
    const abs = path.join(root, rel);
    if (!existsSync(abs) || !lstatSync(abs).isFile()) continue;
    files.push(rel);
  }
  return { mode, files, undeclared: [...undeclared].sort() };
}

const source = selectSourceFiles(frameworkRoot);
if (source.mode === "filesystem") {
  console.warn([
    "",
    "⚠⚠⚠ WARNING: the framework root is not a git work tree (downloaded as a zip?).",
    "⚠   Falling back to a filesystem walk + deny-list. The secret-safety guarantee",
    "⚠   DOES NOT HOLD in this mode: any untracked file not on the deny-list (local",
    "⚠   credentials, tokens, caches) will be copied into the instance. Inspect the",
    "⚠   target before committing or publishing it, or clone the framework with git.",
    "",
  ].join("\n"));
}
for (const top of source.undeclared) {
  log("stage 2", `skipped undeclared top-level entry: ${top}`);
}
log("stage 2", `copying ${source.files.length} ${source.mode === "git" ? "tracked" : "on-disk"} framework files → target${dry ? " (dry)" : ""}`);
if (!dry) {
  mkdirSync(target, { recursive: true });
  for (const rel of source.files) {
    const d = path.join(target, rel);
    mkdirSync(path.dirname(d), { recursive: true });
    copyFileSync(path.join(frameworkRoot, rel), d);
  }
}

// === Stage 3: strip framework-only registries ===
// instances.yaml stays in the framework (instance doesn't need it).
// skills-matrix.yaml + packages-matrix.yaml are framework-only; instance starts fresh.
const STRIP_FILES = [
  "data/instances.yaml",
  "data/skills-matrix.yaml",
  "data/packages-matrix.yaml",
  // SKILLS.md and CHANGELOG.md used to be stripped here; both are now declared
  // top-level denies in clone-excludes.mjs and never copied in the first place.
];

// Every published .well-known/*.json is generated FROM framework data, so
// shipping them hands the instance the framework's identity, members and
// projects. The .json.template files are kept — they are what regeneration
// reads. dao.json is rendered for the instance in stage 6c; the rest come back
// on the operator's first `npm run generate:schemas`.
const STRIP_WELL_KNOWN_JSON = true;
log("stage 3", `stripping ${STRIP_FILES.length} framework-only files`);
if (!dry) {
  for (const f of STRIP_FILES) {
    const p = path.join(target, f);
    if (existsSync(p)) rmSync(p, { force: true });
  }
  const wellKnown = path.join(target, ".well-known");
  if (STRIP_WELL_KNOWN_JSON && existsSync(wellKnown)) {
    let stripped = 0;
    for (const f of readdirSync(wellKnown)) {
      if (f.endsWith(".json") && !f.endsWith(".json.template")) {
        rmSync(path.join(wellKnown, f), { force: true });
        stripped++;
      }
    }
    log("stage 3", `stripped ${stripped} framework-generated .well-known/*.json`);
  }
}

// === Stage 4: reset markdown placeholders ===
const placeholders = {
  "IDENTITY.md": `# IDENTITY.md — ${config.org.name}\n\n- **Name:** ${config.org.name}\n- **Type:** ${config.org.type}\n${config.org.emoji ? `- **Emoji:** ${config.org.emoji}\n` : ""}- **Short description:** ${config.org.short_description || ""}\n\n_Generated by clone-framework on ${new Date().toISOString().slice(0, 10)}. Edit freely._\n`,
  "MASTERPLAN.md": `# MASTERPLAN.md — ${config.org.name}\n\n## Mandate\n\nTODO: define\n\n## Activations\n\n- TODO\n\n## Character\n\nTODO\n\n_Bootstrapped by clone-framework on ${new Date().toISOString().slice(0, 10)}._\n`,
  "MEMORY.md": `# MEMORY.md — ${config.org.name}\n\n## Key Decisions\n\n- ${new Date().toISOString().slice(0, 10)}: Instance bootstrapped from org-os framework via clone-framework.\n\n## Active Context\n\nFresh start.\n`,
  "HEARTBEAT.md": `# HEARTBEAT.md — ${config.org.name}\n\n## Active Tasks\n\n- [ ] Complete bootstrap interview (populate data/*.yaml)\n- [ ] Edit IDENTITY.md, SOUL.md, MASTERPLAN.md\n- [ ] Customize federation.yaml peers\n- [ ] Run \`npm run validate:structure\` and \`npm run selftest\`\n\n## System Health\n\nFresh bootstrap.\n`,
};
log("stage 4", `resetting ${Object.keys(placeholders).length} placeholder files`);
if (!dry) {
  for (const [name, content] of Object.entries(placeholders)) {
    writeFileSync(path.join(target, name), content);
  }
}

// === Stage 4b: reset instance-owned registries + operator files ===
// The copy in stage 2 brings the framework's LIVE data with it — members,
// projects, ideas, ecosystems, relationships, the operator profile, tool
// endpoints and the federation frontier cache. None of that is the new org's.
// Verified 2026-08-29 (WS-I recipe run): without this stage a fresh instance
// carried the maintainer's member entry, 13 framework projects and the
// framework's own SOUL — the Harbor Bakery B4/B5 leak, surviving in the
// recommended path. Identity has to be stripped by construction, not by
// operator diligence; tests/clone-framework-health.test.mjs pins it.
const today = new Date().toISOString().slice(0, 10);
const operatorName = config.operator?.name || "TODO: operator name";
const registryResets = {
  "data/members.yaml": `schema_version: "2.0"\n\n# Members Registry — seeded with the bootstrap operator; add your team.\n\nmembers:\n  - id: "operator"\n    name: ${JSON.stringify(operatorName)}\n    role: "Operator"\n    layer: "core"\n    status: "active"\n    joined: "${today}"\n`,
  "data/projects.yaml": `schema_version: "2.0"\n\n# Projects Registry — fill via the bootstrap-interviewer skill (BOOTSTRAP.md Phase 1).\n\nprojects: []\n`,
  "data/ideas.yaml": `schema_version: "2.0"\n\nideas: []\n`,
  "data/relationships.yaml": `schema_version: "2.0"\n\nrelationships: []\n`,
  "data/ecosystems.yaml": `ecosystems: []\n`,
  "data/governance.yaml": `schema_version: "2.0"\n\n# Governance Registry — ${config.org.name}\n# Decisions are recorded in DECISIONS.md; ratified ones that need a machine-readable\n# record (EIP-4824 proposals) are mirrored here.\n\ngovernance:\n  model: "solo-maintainer"     # solo-maintainer | steward-council | multisig | assembly | conviction\n  current_phase: "bootstrap"   # bootstrap | transition | active | sunset\n  infrastructure:\n    safe: null\n    hats_tree: null\n    gardens: null\n    snapshot: null\n  decisions: []\n  elections: []\n`,
  "SOUL.md": `# SOUL.md — Who We Are\n\n_This file defines the character, values, and voice of ${config.org.name}. It grounds the agent in the org's shared identity._\n\n---\n\n## Mission\n\n${config.org.short_description || "TODO: what this organization exists to do."}\n\n## Values\n\n- TODO\n\n## Voice\n\n- TODO\n\n_Seeded by clone-framework on ${today}; the bootstrap-interviewer pass (BOOTSTRAP.md Phase 1) gives this substance._\n`,
  "USER.md": `# USER.md — About Your Operator\n\n_The person you're helping. Update as preferences surface through working together._\n\n---\n\n- **Name:** ${operatorName}\n${config.operator?.email ? `- **Email:** ${config.operator.email}\n` : ""}- **Role:** Operator\n\n_Seeded by clone-framework on ${today}._\n`,
  "TOOLS.md": `# TOOLS.md — Local Tool Notes\n\n_Skills define how tools work. This file is for your specifics — the setup unique to this node. Never put credentials here — reference where they're stored._\n\n---\n\n## API Endpoints\n\n_(none configured yet)_\n\n## Channels\n\n_(none configured yet)_\n`,
};
log("stage 4b", `resetting ${Object.keys(registryResets).length} instance-owned registries + operator files`);
if (!dry) {
  for (const [name, content] of Object.entries(registryResets)) {
    const p = path.join(target, name);
    if (existsSync(path.dirname(p))) writeFileSync(p, content);
  }
  // The frontier cache is the FRAMEWORK's view of its peers, not the instance's.
  const frontier = path.join(target, "data", "federation", "frontier");
  if (existsSync(frontier)) rmSync(frontier, { recursive: true, force: true });
  // memory/ is a declared top-level deny (the framework's own session log), so
  // stage 2 never creates it. The instance gets the empty directory.
  mkdirSync(path.join(target, "memory"), { recursive: true });
  writeFileSync(path.join(target, "memory", ".gitkeep"), "");

  // The framework's manifest lists OTHER organisations' repositories, so
  // `npm run clone:repos` on day one cloned strangers' repos into a new
  // instance. Same schema, empty list.
  const manifestPath = path.join(target, "repos.manifest.json");
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, repositories: [] }, null, 2) + "\n");
  }

  // knowledge/ is a declared top-level deny (its INDEX.md describes the
  // framework's own knowledge commons); the instance gets an empty index.
  mkdirSync(path.join(target, "knowledge"), { recursive: true });
  writeFileSync(
    path.join(target, "knowledge", "INDEX.md"),
    `# Knowledge Index — ${config.org.name}\n\n_Navigation for this instance's knowledge base. Domains are declared in \`data/knowledge-manifest.yaml\`; \`npm run knowledge\` compiles pages and refreshes the indexes._\n\n_(no domains yet)_\n`,
  );
}

// === Stage 5: materialize packages + skills per config ===
// Packages: filter packages/<id>/ to only enabled ones from config.packages
const enabledPackages = config.packages || {};
log("stage 5", `materializing packages (${Object.entries(enabledPackages).filter(([_, v]) => v).map(([k]) => k).join(", ") || "none"})`);
if (!dry) {
  const targetPackagesDir = path.join(target, "packages");
  if (existsSync(targetPackagesDir)) {
    for (const entry of readdirSync(targetPackagesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (enabledPackages[entry.name] !== true) {
        rmSync(path.join(targetPackagesDir, entry.name), { recursive: true, force: true });
      }
    }
  }
}

// Skills: filter skills/<id>/ to only those in config.skills (if specified)
// Some skills ship machinery outside skills/<name>/ that hard-depends on the
// skill's own files. scripts/symbient-hatch.mjs reads
// skills/symbient/SEED.template.md unconditionally, so an instance that did
// not select `symbient` shipped a script that crashes with ENOENT on first use
// and a test suite that failed 10 subtests from the day it was generated.
const SKILL_COUPLED_ARTIFACTS = {
  symbient: [
    "scripts/symbient-hatch.mjs",
    "scripts/lib/symbient-gates.mjs",
    "tests/symbient-hatch.test.mjs",
    "tests/symbient-gates.test.mjs",
  ],
};
if (Array.isArray(config.skills) && config.skills.length > 0) {
  const enabledSkills = new Set(config.skills);
  log("stage 5", `materializing skills (${config.skills.length} enabled)`);
  if (!dry) {
    const targetSkillsDir = path.join(target, "skills");
    if (existsSync(targetSkillsDir)) {
      for (const entry of readdirSync(targetSkillsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (!enabledSkills.has(entry.name)) {
          rmSync(path.join(targetSkillsDir, entry.name), { recursive: true, force: true });
        }
      }
    }
    // A skill that was not materialized above takes its coupled artifacts
    // with it — before stage 6d, so a matching npm script entry (none exist
    // for symbient today) would be cleaned up there for free.
    for (const [skill, artifacts] of Object.entries(SKILL_COUPLED_ARTIFACTS)) {
      if (enabledSkills.has(skill)) continue;
      for (const rel of artifacts) {
        rmSync(path.join(target, rel), { recursive: true, force: true });
      }
    }
  }
}

// === Stage 6: write federation.yaml ===
//
// The framework version is READ, never hardcoded. This file used to write
// `3.5` literally, so every instance cloned after the 2026-06-17 re-baseline
// was born claiming a version the framework had already left.
const frameworkVersion = JSON.parse(
  readFileSync(path.join(frameworkRoot, "package.json"), "utf-8"),
).version;
const frameworkMajorMinor = (frameworkVersion.match(/^(\d+)\.(\d+)/) || [])[0];

// The canonical framework repository. Six other spellings circulate in the
// wild (see packages/instance-doctor KNOWN_WRONG_UPSTREAMS); a clone must not
// enshrine one of them just because a config file offered it.
const CANONICAL_UPSTREAM_URL = "https://github.com/regen-coordination/org-os-template.git";

const genesisCommit = (() => {
  try {
    return execSync("git rev-list --max-parents=0 HEAD | tail -1", {
      cwd: frameworkRoot,
      encoding: "utf-8",
    }).trim();
  } catch {
    return null;
  }
})();

// A configured upstream is honoured only when it is the canonical repository.
// Anything else (the five legacy spellings, a personal fork) is replaced and
// the substitution is logged rather than done silently.
const configuredUpstream = config.network?.upstream_url || null;
const upstreamIsCanonical =
  configuredUpstream &&
  configuredUpstream.replace(/\.git$/, "").endsWith("regen-coordination/org-os-template");
const upstreamUrl = upstreamIsCanonical ? configuredUpstream : CANONICAL_UPSTREAM_URL;
if (configuredUpstream && !upstreamIsCanonical) {
  log("stage 6", `upstream_url "${configuredUpstream}" is not the canonical framework repo — using ${CANONICAL_UPSTREAM_URL}`);
}

const fedYaml = `# federation.yaml — ${config.org.name}
# Generated by clone-framework on ${new Date().toISOString().slice(0, 10)}.

version: "${frameworkMajorMinor}"
spec: "organizational-os/${frameworkMajorMinor}"

identity:
  name: "${config.org.name}"
  type: "${config.org.type}"
  short_description: "${config.org.short_description || ""}"
${config.org.emoji ? `  emoji: "${config.org.emoji}"\n` : ""}
network: "${config.network?.name || ""}"

peers: []
upstream:
  - id: "org-os-template"
    url: "${upstreamUrl}"
    last_sync: "${new Date().toISOString().slice(0, 10)}"
downstream: []

agent:
  runtime: "claude-code"
  skills: ${JSON.stringify(config.skills || [])}

packages:
${Object.entries(enabledPackages).map(([k, v]) => `  ${k}: ${v}`).join("\n") || "  {}"}

metadata:
  framework_version: "${frameworkMajorMinor}"
  bootstrap_date: "${new Date().toISOString().slice(0, 10)}"
  bootstrap_operator: "${config.operator?.name || ""}"
  genesis_commit: ${genesisCommit ? `"${genesisCommit}"` : "null"}
  last_sync_commit: null
`;

log("stage 6", `writing federation.yaml`);
if (!dry) {
  writeFileSync(path.join(target, "federation.yaml"), fedYaml);
}

// === Stage 6b: rewrite package.json with instance identity ===
const fwPkgPath = path.join(target, "package.json");
if (existsSync(fwPkgPath) && !dry) {
  const fwPkg = JSON.parse(readFileSync(fwPkgPath, "utf-8"));
  const instancePkg = {
    ...fwPkg,
    name: config.org.name.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
    description: config.org.short_description || fwPkg.description,
    version: "0.1.0", // instance starts at pre-release; framework version pinned in federation.yaml.metadata
    private: true,
  };
  // Drop framework-only fields
  delete instancePkg.bin;
  delete instancePkg.repository;
  writeFileSync(fwPkgPath, JSON.stringify(instancePkg, null, 2) + "\n");
  log("stage 6b", `rewrote package.json (name=${instancePkg.name}, version=0.1.0)`);
}

// === Stage 6c: render the instance's OWN .well-known/dao.json ===
//
// This is the defect that made bread-coop-os publish `name: "org-os"` from the
// day it was bootstrapped: the clone shipped the framework's dao.json and
// nothing ever replaced it, so a new organization served the FRAMEWORK as its
// public EIP-4824 identity while every validator stayed green.
if (!dry) {
  const wellKnownDir = path.join(target, ".well-known");
  mkdirSync(wellKnownDir, { recursive: true });

  const orgName = config.org.name;
  const orgDescription = config.org.short_description || `${orgName} — an org-os instance`;
  const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  // {{BASE_URL}} is a bare HOST: the template owns the `https://` scheme, and
  // generate-all-schemas.mjs (new URL(daoURI).host) and setup-org-os.mjs both
  // substitute a host. Passing a full URL here published `https://https://…`
  // in every URI field. Accept config.org.base_url with or without a scheme.
  const configuredBase = config.org.base_url || `${slug}.example.org`;
  let baseUrl;
  try {
    baseUrl = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(configuredBase) ? configuredBase : `https://${configuredBase}`).host;
  } catch {
    baseUrl = `${slug}.example.org`;
  }

  const templatePath = path.join(wellKnownDir, "dao.json.template");
  let dao;
  if (existsSync(templatePath)) {
    const raw = readFileSync(templatePath, "utf-8")
      .replace(/\{\{ORGANIZATION_NAME\}\}/g, orgName)
      .replace(/\{\{ORGANIZATION_DESCRIPTION\}\}/g, orgDescription)
      .replace(/\{\{BASE_URL\}\}/g, baseUrl);
    try {
      dao = JSON.parse(raw);
    } catch {
      dao = null; // template carries unfilled placeholders — fall through
    }
  }
  if (!dao) {
    dao = {
      "@context": "http://www.daostar.org/schemas",
      type: config.org.type === "DAO" ? "DAO" : "Organization",
      name: orgName,
      description: orgDescription,
    };
  }
  // Never let a template's own defaults reintroduce the framework's identity.
  dao.name = orgName;
  dao.description = orgDescription;

  writeFileSync(path.join(wellKnownDir, "dao.json"), JSON.stringify(dao, null, 2) + "\n");
  log("stage 6c", `rendered .well-known/dao.json (name="${orgName}")`);
}

// === Stage 6d: drop scripts whose target file the instance did not receive ===
//
// The instance gets a subset of the framework (packages are materialized per
// config), so some inherited npm scripts point at files that are simply not
// there. They exit non-zero the first time an operator tries them, which reads
// as "this framework is broken" on day one. Same rule the instance doctor's
// machinery check applies, kept deliberately in sync with it.
if (!dry && existsSync(fwPkgPath)) {
  const pkg = JSON.parse(readFileSync(fwPkgPath, "utf-8"));
  const dropped = [];
  for (const [name, cmd] of Object.entries(pkg.scripts || {})) {
    if (typeof cmd !== "string" || /--prefix\b/.test(cmd)) continue;
    const m = /(?:^|\s)((?:\.\/)?[\w.@/-]+\.(?:mjs|js|cjs))(?:\s|$)/.exec(cmd);
    if (!m) continue;
    const file = m[1].replace(/^\.\//, "");
    if (file.includes("*")) continue;
    if (!existsSync(path.join(target, file))) {
      delete pkg.scripts[name];
      dropped.push(name);
    }
  }
  if (dropped.length > 0) {
    writeFileSync(fwPkgPath, JSON.stringify(pkg, null, 2) + "\n");
    log("stage 6d", `dropped ${dropped.length} script(s) with no target in this instance: ${dropped.join(", ")}`);
  }
}

// === Stage 6e: the instance's own planning structure + command repointing ===
//
// Stage 2 no longer copies the framework's plans, specs, research or session
// log — they are org-os's own history, not a template. The instance needs the
// EMPTY structure in their place, following the convention refi-bcn-os
// settled on: docs/plans/ (strategic, multi-session, indexed by QUEUE.md) ·
// docs/superpowers/{specs,plans,research}/ (tactical) · docs/temp/ (untracked
// scratch). And its commands must point at ITS queue — the framework's
// /close and /initialize name docs/agent-plans/QUEUE.md, which the 2026-07-26
// luizfernando scaffold had to repoint by hand (52f78da).
if (!dry) {
  for (const d of [
    "docs/plans", "docs/superpowers/specs", "docs/superpowers/plans",
    "docs/superpowers/research",
  ]) {
    mkdirSync(path.join(target, d), { recursive: true });
    writeFileSync(path.join(target, d, ".gitkeep"), "");
  }

  writeFileSync(
    path.join(target, "docs", "plans", "QUEUE.md"),
    `# Plan Queue — ${config.org.name}

> Strategic (multi-session) plans live in \`docs/plans/*.md\` with YAML frontmatter and are indexed here.
> Tactical (session-scoped) plans live in \`docs/superpowers/plans/\`; their specs in \`docs/superpowers/specs/\`.
> Untracked scratch, drafts and handoffs go in \`docs/temp/\` (gitignored).
> \`/close\` updates this file when a plan changes status.

## Active

_(none)_

## Queued

_(none)_

## Backlog

_(none)_

## Completed

_(none)_
`,
  );

  writeFileSync(
    path.join(target, "DECISIONS.md"),
    `# DECISIONS.md — Key Decisions Log

_Append-only log of significant decisions for ${config.org.name}. Most recent at top. Detailed session notes live in \`memory/YYYY-MM-DD.md\`. This file is the **authoritative source** for the agent's context on "what was decided and why" — \`MEMORY.md\` indexes; \`DECISIONS.md\` records._

## Conventions

Each decision is a section with these fields:

- **Status** — \`active\` (in force) · \`superseded\` (replaced by a later decision) · \`withdrawn\` (rolled back) · \`proposed\` (under discussion, not yet ratified)
- **Scope** — which area(s): identity / governance / federation / data-model / agent-runtime / publishing / etc.
- **Decision** — the call, in one or two sentences
- **Why** — the rationale, including alternatives considered and what made them lose
- **Refs** — commits, files, plans, related decisions, session memory

When a decision is superseded, mark it \`superseded\` and add a \`Superseded by:\` link to the newer decision. Do not delete; the trail is the value.

---

## ${today} · Instance bootstrapped from org-os ${frameworkMajorMinor}

- **Status:** active
- **Scope:** identity
- **Decision** — ${config.org.name} is generated from the org-os framework (v${frameworkVersion}) via \`clone-framework\`; lineage is stamped in \`federation.yaml.metadata\`.
- **Why** — one honest setup path; the instance starts with its own empty registries, memory and plan queue, none of the framework's.
- **Refs** — \`federation.yaml\`, \`docs/plans/QUEUE.md\`
`,
  );

  const gitignorePath = path.join(target, ".gitignore");
  if (existsSync(gitignorePath) && !readFileSync(gitignorePath, "utf-8").includes("docs/temp/")) {
    appendFileSync(gitignorePath, "\n# Untracked scratch, drafts and handoffs (instance convention)\ndocs/temp/\n");
  }

  let repointed = 0;
  const repoint = (file) => {
    const src = readFileSync(file, "utf-8");
    const out = src.replaceAll("docs/agent-plans/", "docs/plans/");
    if (out !== src) {
      writeFileSync(file, out);
      repointed++;
    }
  };
  for (const dir of [".claude/commands", ".cursor/commands", ".opencode/commands"]) {
    const abs = path.join(target, dir);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs)) if (f.endsWith(".md")) repoint(path.join(abs, f));
  }
  // Hermes command-skills carry the same bodies (generated by sync-commands).
  const cmdSkills = path.join(target, "skills", "commands");
  if (existsSync(cmdSkills)) {
    for (const s of readdirSync(cmdSkills)) {
      const p = path.join(cmdSkills, s, "SKILL.md");
      if (existsSync(p)) repoint(p);
    }
  }
  log("stage 6e", `scaffolded planning structure; repointed ${repointed} command file(s) to docs/plans/`);
}

// === Stage 7: render README + GETTING-STARTED ===
const templatesDir = path.join(frameworkRoot, "templates");
const partialsDir = path.join(templatesDir, "partials");
const renderData = {
  org: {
    name: config.org.name,
    tagline: config.org.tagline || "",
    short_description: config.org.short_description || "",
    type: config.org.type,
    framework_version: frameworkMajorMinor,
    status: "bootstrap",
    license: config.org.license || "MIT",
    network_purpose: config.network?.name ? `the ${config.network.name} network` : "this network",
  },
  framework: {
    url: upstreamUrl.replace(/\.git$/, ""),
  },
  federation: {
    network: config.network?.name || "",
    peers: [],
  },
  identity: { body: "See `IDENTITY.md` for the canonical identity." },
  systems_map: "",
  today: new Date().toISOString().slice(0, 10),
};

const readmeTmpl = readFileSync(path.join(templatesDir, "README.instance.md"), "utf-8");
const gettingStartedTmpl = readFileSync(path.join(templatesDir, "GETTING-STARTED.md"), "utf-8");
// The framework's CLAUDE.md tells every session it is in "the org-os
// framework"; an instance gets its own, rendered like README.md.
const claudeTmpl = readFileSync(path.join(templatesDir, "CLAUDE.instance.md"), "utf-8");

log("stage 7", `rendering README.md + GETTING-STARTED.md + CLAUDE.md`);
if (!dry) {
  writeFileSync(path.join(target, "README.md"), render(readmeTmpl, renderData, { partialsDir }));
  writeFileSync(path.join(target, "GETTING-STARTED.md"), render(gettingStartedTmpl, renderData, { partialsDir }));
  writeFileSync(path.join(target, "CLAUDE.md"), render(claudeTmpl, renderData, { partialsDir }));
}

// === Stage 8: git init + initial commit ===
if (!noGit && !dry) {
  log("stage 8", `git init + initial commit`);
  try {
    execSync("git init -q", { cwd: target });
    execSync("git add .", { cwd: target });
    execSync(
      `git -c user.email=clone-framework@org-os -c user.name=clone-framework commit -q -m "chore: bootstrap from org-os framework (genesis)"`,
      { cwd: target },
    );
    log("stage 8", `initial commit created`);
  } catch (e) {
    console.warn(`⚠ git init/commit failed: ${e.message}`);
  }
} else {
  log("stage 8", noGit ? "skipped (--no-git)" : "skipped (--dry)");
}

console.log(`\n✓ ${dry ? "dry-run completed" : "instance bootstrapped"}: ${target}`);
console.log(`  Next:`);
console.log(`    cd ${path.relative(process.cwd(), target)}`);
console.log(`    npm install`);
console.log(`    npm run generate:schemas`);
console.log(`    npm run validate:structure`);
console.log(`    npm run selftest`);
console.log(`    # Edit IDENTITY.md, SOUL.md, MASTERPLAN.md, federation.yaml.peers, data/*.yaml`);
