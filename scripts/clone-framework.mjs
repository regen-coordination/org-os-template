#!/usr/bin/env node
/**
 * clone-framework.mjs — generate a new org-os instance from this framework.
 *
 * Stages (each can be inspected with --dry):
 *   1. Validate target directory is empty (or --force)
 *   2. Copy framework tree, excluding framework-only state
 *   3. Strip framework-only registries (instances.yaml, packages-matrix, skills-matrix)
 *   4. Reset markdown placeholders (IDENTITY, MASTERPLAN, MEMORY, HEARTBEAT, README)
 *   5. Materialize packages + skills per config (sync-packages with --enabled)
 *   6. Write federation.yaml with instance identity + lineage stamp
 *   7. Render README + GETTING-STARTED from templates
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
  readFileSync, writeFileSync, readdirSync, statSync, existsSync,
  mkdirSync, copyFileSync, rmSync,
} from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { render } from "../templates/render.mjs";

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

const EXCLUDE_DIRS = new Set([
  ".git", "node_modules", ".worktrees", ".claude/worktrees",
  "memory/reports", // framework-only drift reports
  ".hermes", // host-specific local config
]);
const EXCLUDE_FILES = new Set([
  ".gitignore.test", ".claude/scheduled_tasks.lock",
  "README.md", // rendered fresh in stage 7
  "MASTERPROMPT.md", // framework-only
]);
// Files that get reset in stage 4 (so don't bother copying)
const PLACEHOLDER_FILES = new Set([
  "MEMORY.md", "HEARTBEAT.md", "IDENTITY.md", "MASTERPLAN.md",
]);

function copyTree(src, dst, relPath = "") {
  if (!dry && !existsSync(dst)) mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const rel = path.posix.join(relPath, entry.name);
    if (EXCLUDE_DIRS.has(rel) || EXCLUDE_DIRS.has(entry.name)) continue;
    if (EXCLUDE_FILES.has(rel) || EXCLUDE_FILES.has(entry.name)) continue;
    if (PLACEHOLDER_FILES.has(rel)) continue;

    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyTree(s, d, rel);
    } else if (entry.isFile()) {
      if (!dry) copyFileSync(s, d);
    }
  }
}
log("stage 2", `copying framework tree → target${dry ? " (dry)" : ""}`);
copyTree(frameworkRoot, target);

// === Stage 3: strip framework-only registries ===
// instances.yaml stays in the framework (instance doesn't need it).
// skills-matrix.yaml + packages-matrix.yaml are framework-only; instance starts fresh.
const STRIP_FILES = [
  "data/instances.yaml",
  "data/skills-matrix.yaml",
  "data/packages-matrix.yaml",
  ".well-known/skills.json", // regenerated per instance
  "SKILLS.md", // regenerated per instance
  "memory/2026-04-24.md", // framework bootstrap memory
];
log("stage 3", `stripping ${STRIP_FILES.length} framework-only files`);
if (!dry) {
  for (const f of STRIP_FILES) {
    const p = path.join(target, f);
    if (existsSync(p)) rmSync(p, { force: true });
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
  }
}

// === Stage 6: write federation.yaml ===
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

const fedYaml = `# federation.yaml — ${config.org.name}
# Generated by clone-framework on ${new Date().toISOString().slice(0, 10)}.

version: "3.5"
spec: "organizational-os/3.5"

identity:
  name: "${config.org.name}"
  type: "${config.org.type}"
  short_description: "${config.org.short_description || ""}"
${config.org.emoji ? `  emoji: "${config.org.emoji}"\n` : ""}
network: "${config.network?.name || ""}"

peers: []
upstream:
  - id: "org-os-framework"
    url: "${config.network?.upstream_url || "https://github.com/organizational-os/organizational-os-template.git"}"
    last_sync: "${new Date().toISOString().slice(0, 10)}"
downstream: []

agent:
  runtime: "claude-code"
  skills: ${JSON.stringify(config.skills || [])}

packages:
${Object.entries(enabledPackages).map(([k, v]) => `  ${k}: ${v}`).join("\n") || "  {}"}

metadata:
  framework_version: "3.5"
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

// === Stage 7: render README + GETTING-STARTED ===
const templatesDir = path.join(frameworkRoot, "templates");
const partialsDir = path.join(templatesDir, "partials");
const renderData = {
  org: {
    name: config.org.name,
    tagline: config.org.tagline || "",
    short_description: config.org.short_description || "",
    type: config.org.type,
    framework_version: "3.5",
    status: "bootstrap",
    license: config.org.license || "MIT",
    network_purpose: config.network?.name ? `the ${config.network.name} network` : "this network",
  },
  framework: {
    url: config.network?.upstream_url || "https://github.com/organizational-os/organizational-os-template",
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

log("stage 7", `rendering README.md + GETTING-STARTED.md`);
if (!dry) {
  writeFileSync(path.join(target, "README.md"), render(readmeTmpl, renderData, { partialsDir }));
  writeFileSync(path.join(target, "GETTING-STARTED.md"), render(gettingStartedTmpl, renderData, { partialsDir }));
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
console.log(`    npm run validate:structure`);
console.log(`    npm run selftest`);
console.log(`    # Edit IDENTITY.md, SOUL.md, MASTERPLAN.md, federation.yaml.peers, data/*.yaml`);
