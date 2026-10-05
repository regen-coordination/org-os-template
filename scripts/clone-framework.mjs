#!/usr/bin/env node
/**
 * clone-framework.mjs — generate a new org-os instance from this framework.
 *
 * Stages (each can be inspected with --dry):
 *   1. Validate target directory is empty (or --force)
 *   2. Copy COMMITTED (HEAD) framework files under declared top-level entries, minus the deny-list
 *   3. Strip framework-only registries (instances.yaml, packages-matrix, skills-matrix)
 *   4. Reset markdown placeholders (IDENTITY, MASTERPLAN, MEMORY, HEARTBEAT, README) from templates/scaffold/
 *   5. Materialize packages + skills per config (sync-packages with --enabled)
 *   6. Write federation.yaml with instance identity + lineage stamp
 *   7. Render README + GETTING-STARTED + CLAUDE.md + AGENTS.md from templates
 *
 * Language: an optional `org.language` in the config (BCP-47, e.g. `pt-BR`; default
 * `en`). Every template, partial, scaffold file and short string is looked up as
 * templates/<lang>/<file> first and the English templates/<file> otherwise.
 *   7b. With a `kms:` block in the config: stamp kms.yaml + the self card (org-os-kms init)
 *   8. Git init + initial commit (skip with --no-git; skipped in non-git fallback unless --commit-unverified)
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
  mkdirSync, copyFileSync, rmSync, realpathSync,
} from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { render } from "../templates/render.mjs";
import {
  isExcluded, isPathExcluded, topLevelDecision, isOtherLanguageTemplate, LANGUAGE_TAG,
} from "./lib/clone-excludes.mjs";

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
// Non-git fallback only: make the genesis commit even though the copy was not
// limited to committed content.
const commitUnverified = process.argv.includes("--commit-unverified");

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

// A `kms:` block asks for an instance that is born a knowledge system (the org-os-kms
// profile). Checked here, before stage 1, so a config that cannot work writes nothing.
const kmsConfig = config.kms || null;
const kmsExtensions = Array.isArray(kmsConfig?.extensions) ? kmsConfig.extensions : [];
if (kmsConfig) {
  const enabled = config.packages || {};
  const missing = ["toolkit-framework", "org-os-kms"].filter((p) => enabled[p] !== true);
  if (missing.length) {
    console.error(`✗ Config has a kms block but packages.${missing.join(" and packages.")} ${missing.length > 1 ? "are" : "is"} not enabled — org-os-kms and toolkit-framework must both be vendored, side by side`);
    process.exit(1);
  }
  const plane = kmsConfig.public_plane;
  if (plane !== undefined) {
    const canonName = kmsConfig.instance
      || config.org.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (!plane || typeof plane.instance !== "string" || !/^[a-z0-9][a-z0-9._-]*$/i.test(plane.instance)) {
      console.error("✗ kms.public_plane.instance must be a plain name (letters, digits, . _ -) — it becomes the directory repos/<instance>");
      process.exit(1);
    }
    if (plane.instance === canonName) {
      console.error(`✗ kms.public_plane.instance is "${plane.instance}", the canon's own name — the public plane is a different instance`);
      process.exit(1);
    }
  }
  const absent = kmsExtensions.filter((e) => enabled[e] !== true);
  if (absent.length) {
    console.error(`✗ kms.extensions names ${absent.join(", ")}, which ${absent.length > 1 ? "are" : "is"} not enabled under packages — an extension pack is vendored like any other package`);
    process.exit(1);
  }
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
// Every framework byte an instance receives comes from HEAD. Seven leaks were patched one deny-list entry
// at a time while this walked the filesystem; a deny-list cannot see content
// that does not exist yet. Now:
//   1. the source set is the tree of HEAD (`git ls-tree -r HEAD`), and every
//      file is written from its committed blob (`git cat-file --batch`), never
//      read from the working tree. The same holds for what is not copied but
//      USED: the templates and partials stage 7 renders and the package.json
//      version stage 6 stamps are read from HEAD through readFrameworkFile(). Untracked, gitignored, staged-but-uncommitted,
//      intent-to-add (`git add -N`) and skip-worktree edits cannot reach an
//      instance, and neither can a symlink swapped in on disk for a committed
//      directory. Symlinks (mode 120000) and gitlinks (submodules) are skipped;
//      the executable bit is taken from the tree mode.
//   2. every top-level entry must be declared (TOP_LEVEL_ALLOW / _DENY); an
//      undeclared one is skipped and logged by name.
//   3. the deny-list (isPathExcluded) prunes framework-only subpaths.
//   4. tests/clone-manifest.txt pins the exact path set a fresh clone contains.
// Rules + reasons live in scripts/lib/clone-excludes.mjs. The generator's own
// code and rules (this file, scripts/lib/clone-excludes.mjs, templates/render.mjs)
// are executed from disk — they are the program, not content that ships.
//
// A NEW framework file therefore does not reach instances until it is
// committed — the same rule an operator needs when a template file "doesn't
// appear".
function gitHeadEntries(root) {
  const probe = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, encoding: "utf-8" });
  if (probe.status !== 0) return null;
  let top;
  try {
    top = realpathSync(probe.stdout.trim());
  } catch {
    return null;
  }
  // A framework unpacked from a zip INSIDE some other repository is not a
  // work tree of its own; that repository's HEAD says nothing about it.
  if (top !== realpathSync(root)) return null;
  const r = spawnSync("git", ["ls-tree", "-r", "-z", "--full-tree", "HEAD"], {
    cwd: root, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) return null; // e.g. no commits yet
  const entries = [];
  for (const rec of r.stdout.split("\0")) {
    if (!rec) continue;
    const tab = rec.indexOf("\t");
    const [mode, type, sha] = rec.slice(0, tab).split(" ");
    entries.push({ mode, type, sha, rel: rec.slice(tab + 1) });
  }
  return entries;
}

/** Read many blobs in one `git cat-file --batch` process. @returns {Map<sha, Buffer>} */
function readBlobs(root, shas) {
  const unique = [...new Set(shas)];
  const blobs = new Map();
  if (unique.length === 0) return blobs;
  const r = spawnSync("git", ["cat-file", "--batch"], {
    cwd: root, input: unique.join("\n") + "\n", maxBuffer: 2 * 1024 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`git cat-file --batch failed: ${r.stderr}`);
  const out = r.stdout;
  let pos = 0;
  for (let k = 0; k < unique.length; k++) {
    const nl = out.indexOf(0x0a, pos);
    const [sha, type, size] = out.subarray(pos, nl).toString("utf-8").split(" ");
    if (type !== "blob") throw new Error(`expected blob for ${unique[k]}, got "${type}"`);
    const start = nl + 1;
    const end = start + Number(size);
    blobs.set(sha, out.subarray(start, end));
    pos = end + 1; // trailing LF after each object
  }
  return blobs;
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
 * @returns {{ mode: "git"|"filesystem", files: Array<{rel, sha?, executable?}>, undeclared: string[] }}
 */
function selectSourceFiles(root) {
  const head = gitHeadEntries(root);
  const mode = head ? "git" : "filesystem";
  const candidates = head
    ? head.filter((e) => e.type === "blob" && e.mode !== "120000")
    : walkFiles(root).map((rel) => ({ rel }));
  const undeclared = new Set();
  const files = [];
  for (const entry of candidates) {
    const { rel } = entry;
    const top = rel.split("/")[0];
    const decision = topLevelDecision(top);
    if (decision !== "allow") {
      if (decision === "undeclared" && !isExcluded(top, top, rel.includes("/"))) undeclared.add(top);
      continue;
    }
    if (isPathExcluded(rel)) continue;
    files.push({ rel, sha: entry.sha, executable: entry.mode === "100755" });
  }
  return { mode, files, undeclared: [...undeclared].sort(), head };
}

const FALLBACK_WARNING = [
  "",
  "⚠⚠⚠ WARNING: the framework root is not a git work tree with commits (downloaded as a zip?).",
  "⚠   Fell back to a filesystem walk + deny-list. The secret-safety guarantee",
  "⚠   DOES NOT HOLD in this mode: any file on disk not on the deny-list (local",
  "⚠   credentials, tokens, caches) may have been copied into the instance.",
  "⚠   No genesis commit was made. Inspect the target before committing or",
  "⚠   publishing it — or clone the framework with git and re-run. Pass",
  "⚠   --commit-unverified to commit anyway.",
  "",
].join("\n");

const source = selectSourceFiles(frameworkRoot);
const headIndex = source.head ? new Map(source.head.filter((e) => e.type === "blob").map((e) => [e.rel, e])) : null;

/**
 * A framework file the generator USES without copying (templates, partials,
 * package.json). Git mode: its committed blob at HEAD — a file missing from
 * HEAD is an error, never silently read from disk. Fallback mode: disk,
 * consistent with the rest of that (warned) mode.
 */
function readFrameworkFile(rel) {
  if (!headIndex) return readFileSync(path.join(frameworkRoot, rel), "utf-8");
  const entry = headIndex.get(rel);
  if (!entry || entry.mode === "120000") {
    throw new Error(`${rel} is not committed at HEAD — only committed framework content is used; commit it and re-run`);
  }
  return readBlobs(frameworkRoot, [entry.sha]).get(entry.sha).toString("utf-8");
}

/** Every committed (or, in fallback, on-disk) file directly under a framework directory. */
function listFrameworkDir(relDir) {
  if (!headIndex) {
    const abs = path.join(frameworkRoot, relDir);
    return existsSync(abs)
      ? readdirSync(abs, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => `${relDir}/${e.name}`)
      : [];
  }
  return [...headIndex.keys()].filter((k) => k.startsWith(`${relDir}/`) && !k.slice(relDir.length + 1).includes("/"));
}

// === Language ===
//
// `org.language` names the language the organisation works in. What the
// generator writes is looked up per language: templates/<lang>/<file> when the
// framework has it, the English templates/<file> otherwise — the four
// templates, their partials, the scaffold files (templates/scaffold/, what
// stages 4, 4b and 6e write) and the short strings (templates/strings.yaml,
// merged key by key). All of it is read from HEAD like any other template.
//
//   - no `org.language`, or `en`: English, and nothing about language is
//     written anywhere — the output is what it was before languages existed.
//   - a language the framework has templates for: its set, the language
//     recorded in federation.yaml, agents told (in that language) to work in it.
//   - a well-formed tag with no templates: English files, with a note; the
//     language is still recorded and agents are still told, in English.
//   - anything that is not a tag: English, with a note, nothing recorded. The
//     value never reaches a path (LANGUAGE_TAG admits letters, digits and `-`).
function frameworkHas(rel) {
  if (!headIndex) return existsSync(path.join(frameworkRoot, rel));
  const entry = headIndex.get(rel);
  return Boolean(entry) && entry.mode !== "120000";
}

/** The language directories under templates/, as the framework spells them. */
function templateLanguages() {
  if (!headIndex) {
    const abs = path.join(frameworkRoot, "templates");
    return existsSync(abs)
      ? readdirSync(abs, { withFileTypes: true }).filter((e) => e.isDirectory() && LANGUAGE_TAG.test(e.name)).map((e) => e.name)
      : [];
  }
  const dirs = new Set();
  for (const rel of headIndex.keys()) {
    const parts = rel.split("/");
    if (parts.length >= 3 && parts[0] === "templates" && LANGUAGE_TAG.test(parts[1])) dirs.add(parts[1]);
  }
  return [...dirs];
}

/** `pt-br` → `pt-BR`, `ZH-hant-tw` → `zh-Hant-TW`: the conventional BCP-47 casing. */
function canonicalTag(tag) {
  return tag.split("-").map((part, i) => {
    if (i === 0) return part.toLowerCase();
    if (part.length === 2) return part.toUpperCase();
    if (part.length === 4) return part[0].toUpperCase() + part.slice(1).toLowerCase();
    return part.toLowerCase();
  }).join("-");
}

let language = "en"; // what the organisation works in, as recorded
let templateLanguage = null; // the templates/<dir> its files come from, when the framework has one
{
  const requested = config.org.language;
  if (requested != null && requested !== "") {
    const tag = String(requested).trim();
    if (!LANGUAGE_TAG.test(tag)) {
      log("language", `org.language "${tag}" is not a language tag (BCP-47, e.g. pt-BR) — using English`);
    } else if (tag.toLowerCase() !== "en") {
      const dir = templateLanguages().find((d) => d.toLowerCase() === tag.toLowerCase());
      if (dir) {
        language = templateLanguage = dir;
        log("language", `${language}: templates, scaffold files and strings from templates/${dir}/ (English where a file is missing)`);
      } else {
        language = canonicalTag(tag);
        log("language", `no templates for "${language}" — files are written in English; the language is recorded and agents are told to work in it`);
      }
    }
  }
}
// Empty for English: every `{{#if org.language}}` in a template is then inert.
const instanceLanguage = language === "en" ? "" : language;

// An instance carries the English base and its own language's set, no other.
source.files = source.files.filter((f) => !isOtherLanguageTemplate(f.rel, templateLanguage || "en"));

/** The instance-language version of a framework template path, or the path itself. */
function localized(rel) {
  if (!templateLanguage) return rel;
  const candidate = `templates/${templateLanguage}/${rel.slice("templates/".length)}`;
  return frameworkHas(candidate) ? candidate : rel;
}

// Short strings: the English catalogue, overridden key by key.
const strings = {
  ...yaml.load(readFrameworkFile("templates/strings.yaml")),
  ...(localized("templates/strings.yaml") !== "templates/strings.yaml"
    ? yaml.load(readFrameworkFile(localized("templates/strings.yaml")))
    : {}),
};
const str = (key, data = {}) => render(String(strings[key] ?? ""), data);

const today = new Date().toISOString().slice(0, 10);
const operatorName = config.operator?.name || str("operator_name_todo");
// What the scaffold files (templates/scaffold/, mirroring the instance root) are rendered with.
const scaffoldData = {
  org: {
    name: config.org.name,
    type: config.org.type,
    emoji: config.org.emoji,
    has_emoji: Boolean(config.org.emoji),
    short_description: config.org.short_description || "",
    language: instanceLanguage,
  },
  operator: {
    name: operatorName,
    name_json: JSON.stringify(operatorName),
    email: config.operator?.email,
    has_email: Boolean(config.operator?.email),
  },
  soul: { mission: config.org.short_description || str("soul_mission_todo") },
  today,
};
const scaffold = (rel, extra = {}) =>
  render(readFrameworkFile(localized(`templates/scaffold/${rel}`)), { ...scaffoldData, ...extra });

if (source.mode === "filesystem") console.warn(FALLBACK_WARNING);
for (const top of source.undeclared) {
  log("stage 2", `skipped undeclared top-level entry: ${top}`);
}
log("stage 2", `copying ${source.files.length} ${source.mode === "git" ? "committed (HEAD)" : "on-disk"} framework files → target${dry ? " (dry)" : ""}`);
if (!dry) {
  mkdirSync(target, { recursive: true });
  const blobs = source.mode === "git" ? readBlobs(frameworkRoot, source.files.map((f) => f.sha)) : null;
  for (const f of source.files) {
    const d = path.join(target, f.rel);
    mkdirSync(path.dirname(d), { recursive: true });
    if (blobs) {
      writeFileSync(d, blobs.get(f.sha), { mode: f.executable ? 0o755 : 0o644 });
    } else {
      copyFileSync(path.join(frameworkRoot, f.rel), d);
    }
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
// The text lives in templates/scaffold/ (and templates/<lang>/scaffold/).
const placeholders = Object.fromEntries(
  ["IDENTITY.md", "MASTERPLAN.md", "MEMORY.md", "HEARTBEAT.md"].map((name) => [name, scaffold(name)]),
);
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
// Registries with no prose in them stay inline; the rest are scaffold files.
const registryResets = {
  "data/members.yaml": scaffold("data/members.yaml"),
  "data/projects.yaml": scaffold("data/projects.yaml"),
  "data/ideas.yaml": `schema_version: "2.0"\n\nideas: []\n`,
  "data/relationships.yaml": `schema_version: "2.0"\n\nrelationships: []\n`,
  "data/ecosystems.yaml": `ecosystems: []\n`,
  "data/governance.yaml": scaffold("data/governance.yaml"),
  "SOUL.md": scaffold("SOUL.md"),
  "USER.md": scaffold("USER.md"),
  "TOOLS.md": scaffold("TOOLS.md"),
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

  // dashboard.yaml is a declared top-level deny: the framework's copy is tuned
  // for its hub role and its custom sections read registries stripped in
  // stage 3. The instance gets every default section, documented, matching
  // loadDashboardConfig() in scripts/initialize.mjs (which is also what
  // /initialize does when the file is absent).
  writeFileSync(path.join(target, "dashboard.yaml"), scaffold("dashboard.yaml"));

  // knowledge/ is a declared top-level deny (its INDEX.md describes the
  // framework's own knowledge commons); the instance gets an empty index.
  mkdirSync(path.join(target, "knowledge"), { recursive: true });
  writeFileSync(path.join(target, "knowledge", "INDEX.md"), scaffold("knowledge/INDEX.md"));
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
// Read from HEAD (readFrameworkFile), like everything copied in stage 2: an
// uncommitted version bump must not be stamped onto HEAD's content.
const frameworkVersion = JSON.parse(readFrameworkFile("package.json")).version;
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
# ${str("federation_header", { today: new Date().toISOString().slice(0, 10) })}

version: "${frameworkMajorMinor}"
spec: "organizational-os/${frameworkMajorMinor}"

identity:
  name: "${config.org.name}"
  type: "${config.org.type}"
  short_description: "${config.org.short_description || ""}"
${config.org.emoji ? `  emoji: "${config.org.emoji}"\n` : ""}${instanceLanguage ? `  language: "${instanceLanguage}"\n` : ""}
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
  const orgDescription = config.org.short_description || str("dao_description", { org: { name: orgName } });
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
    if (typeof cmd !== "string") continue;
    // Directory forms: `npm … --prefix <dir>` and `cd <dir> && …`. These point
    // at a package or another repository (build:site used to `cd` into another
    // organisation's knowledge repo); drop when the directory is absent.
    const dirRefs = [
      ...[...cmd.matchAll(/--prefix[=\s]+([\w.@/-]+)/g)].map((m) => m[1]),
      ...[...cmd.matchAll(/(?:^|&&|;|\|\|)\s*cd\s+([\w.@/-]+)/g)].map((m) => m[1]),
    ];
    // `cd -`, absolute paths (and `cd ~…`, which the pattern cannot match) do
    // not name a directory inside the clone — never drop on their account.
    const inClone = dirRefs.filter((d) => d !== "-" && !d.startsWith("/"));
    if (inClone.some((d) => !existsSync(path.join(target, d)))) {
      delete pkg.scripts[name];
      dropped.push(name);
      continue;
    }
    if (dirRefs.length > 0) continue;
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

  writeFileSync(path.join(target, "docs", "plans", "QUEUE.md"), scaffold("docs/plans/QUEUE.md"));

  writeFileSync(
    path.join(target, "DECISIONS.md"),
    scaffold("DECISIONS.md", { framework: { version: frameworkVersion, major_minor: frameworkMajorMinor } }),
  );

  const gitignorePath = path.join(target, ".gitignore");
  if (existsSync(gitignorePath) && !readFileSync(gitignorePath, "utf-8").includes("docs/temp/")) {
    appendFileSync(gitignorePath, `\n${str("gitignore_comment")}\ndocs/temp/\n`);
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
  // Instance-bound documentation names the same directory (docs/PLANS.md,
  // docs/VERSIONING.md, docs/SKILL-PROMOTION.md, …). The framework's own
  // copies are untouched; only the clone's docs/ is rewritten.
  const walkMd = (abs) => {
    if (!existsSync(abs)) return;
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const p = path.join(abs, entry.name);
      if (entry.isDirectory()) walkMd(p);
      else if (entry.name.endsWith(".md")) repoint(p);
    }
  };
  walkMd(path.join(target, "docs"));
  // Hermes command-skills carry the same bodies (generated by sync-commands).
  const cmdSkills = path.join(target, "skills", "commands");
  if (existsSync(cmdSkills)) {
    for (const s of readdirSync(cmdSkills)) {
      const p = path.join(cmdSkills, s, "SKILL.md");
      if (existsSync(p)) repoint(p);
    }
  }
  log("stage 6e", `scaffolded planning structure; repointed ${repointed} command/doc file(s) to docs/plans/`);
}

// === Stage 7: render README + GETTING-STARTED ===
// Templates and partials come from HEAD (readFrameworkFile), not the working
// tree: an uncommitted template edit — or a secret pasted into one — must not
// reach an instance or its genesis commit.
// Partials: the English set, each replaced by the instance language's when it has one.
const partials = Object.fromEntries(
  [...listFrameworkDir("templates/partials"), ...(templateLanguage ? listFrameworkDir(`templates/${templateLanguage}/partials`) : [])]
    .filter((rel) => rel.endsWith(".md"))
    .map((rel) => [path.posix.basename(rel, ".md"), readFrameworkFile(rel)]),
);
const renderData = {
  org: {
    name: config.org.name,
    tagline: config.org.tagline || "",
    short_description: config.org.short_description || "",
    type: config.org.type,
    framework_version: frameworkMajorMinor,
    status: "bootstrap",
    license: config.org.license || "MIT",
    network_purpose: config.network?.name
      ? str("network_purpose_named", { network: { name: config.network.name } })
      : str("network_purpose_default"),
    language: instanceLanguage,
    is_hub: config.org.type === "Hub",
  },
  framework: {
    url: upstreamUrl.replace(/\.git$/, ""),
  },
  federation: {
    network: config.network?.name || "",
    peers: [],
  },
  identity: { body: str("identity_body") },
  systems_map: "",
  today: new Date().toISOString().slice(0, 10),
};

const readmeTmpl = readFrameworkFile(localized("templates/README.instance.md"));
const gettingStartedTmpl = readFrameworkFile(localized("templates/GETTING-STARTED.md"));
// The framework's CLAUDE.md tells every session it is in "the org-os
// framework"; an instance gets its own, rendered like README.md.
const claudeTmpl = readFrameworkFile(localized("templates/CLAUDE.instance.md"));
// AGENTS.md is where CLAUDE.md sends every session; the framework's copy calls
// the workspace "the upstream framework", so it is rendered for instances too.
const agentsTmpl = readFrameworkFile(localized("templates/AGENTS.instance.md"));

log("stage 7", `rendering README.md + GETTING-STARTED.md + CLAUDE.md + AGENTS.md`);
if (!dry) {
  writeFileSync(path.join(target, "README.md"), render(readmeTmpl, renderData, { partials }));
  writeFileSync(path.join(target, "GETTING-STARTED.md"), render(gettingStartedTmpl, renderData, { partials }));
  writeFileSync(path.join(target, "CLAUDE.md"), render(claudeTmpl, renderData, { partials }));
  writeFileSync(path.join(target, "AGENTS.md"), render(agentsTmpl, renderData, { partials }));
}

// === Stage 7b: the knowledge system (only with a `kms:` block) ===
// Stamps kms.yaml and the instance's own source-system card through org-os-kms's
// `init`, so the result is identical to running it by hand. The framework's copy of
// the CLI is used: the new instance has no node_modules yet. `init` knows nothing of
// extension packs or store policy, so those are merged into kms.yaml afterwards.
if (kmsConfig) {
  const instanceName = kmsConfig.instance
    || config.org.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  log("stage 7b", `knowledge system: instance "${instanceName}"${kmsExtensions.length ? `, extensions ${kmsExtensions.join(", ")}` : ""}`);
  if (!dry) {
    const cli = path.join(frameworkRoot, "packages", "org-os-kms", "src", "cli.mjs");
    // Run from inside the instance: `init --dir <absolute>` writes an absolute self_ref.
    const r = spawnSync("node", [cli, "init", "--name", instanceName], { cwd: target, encoding: "utf-8" });
    if (r.status !== 0) {
      console.error(`✗ org-os-kms init failed:\n${r.stderr || r.stdout}`);
      process.exit(1);
    }
    const kmsPath = path.join(target, "kms.yaml");
    const kms = yaml.load(readFileSync(kmsPath, "utf-8"));
    if (kmsExtensions.length) kms.extensions = kmsExtensions;
    if (kmsConfig.store) kms.store = kmsConfig.store;
    if (kmsConfig.federation_namespace) kms.federation_namespace = kmsConfig.federation_namespace;
    // The public plane, when asked for: named in the canon's kms.yaml, and scaffolded as an
    // instance of its own under repos/ (gitignored by the canon — it is a separate repository).
    // It carries the same packs, so the types it opts into are known to it, and no gate.
    const plane = kmsConfig.public_plane;
    if (plane) kms.planes = { public: { instance: plane.instance } };
    writeFileSync(kmsPath, yaml.dump(kms));
    if (plane) {
      // A canon's own card must say what the publication gate needs of every source card: which
      // corpus path it claims and whether that may publish. `init` cannot know it is stamping a
      // canon, so its card claims nothing and the gate refuses every export as malformed control
      // data. The canon is private: it claims its own checkout and holds it internal-only.
      const cardsPath = path.join(target, "data", "kb", "source-system.yaml");
      const cards = yaml.load(readFileSync(cardsPath, "utf-8"));
      const selfSlug = String(kms.self_ref).split("#")[1];
      Object.assign(cards.entries[selfSlug], {
        container_role: "self",
        origin_prefixes: [`repos/${instanceName}/`],
        public_use: "internal-only",
      });
      writeFileSync(cardsPath, yaml.dump(cards));

      const planeDir = path.join(target, "repos", plane.instance);
      mkdirSync(planeDir, { recursive: true });
      const pr = spawnSync("node", [cli, "init", "--name", plane.instance], { cwd: planeDir, encoding: "utf-8" });
      if (pr.status !== 0) {
        console.error(`✗ org-os-kms init failed for the public plane:\n${pr.stderr || pr.stdout}`);
        process.exit(1);
      }
      const planeKmsPath = path.join(planeDir, "kms.yaml");
      const planeKms = yaml.load(readFileSync(planeKmsPath, "utf-8"));
      if (kmsExtensions.length) planeKms.extensions = kmsExtensions;
      // The static surface needs a base URL; without one it stays off rather than failing every publish.
      planeKms.publish = {
        ...(plane.types_opt_in ? { types_opt_in: plane.types_opt_in } : {}),
        ...(plane.url ? { static: true, base_url: plane.url } : { static: false }),
        apply: false,
      };
      // It says what it is and whose it is: `publish` here re-gates against that canon before writing,
      // and `ingest` is refused (packages/org-os-kms/src/planes/role.mjs).
      planeKms.planes = { role: "public", canon: instanceName };
      writeFileSync(planeKmsPath, yaml.dump(planeKms));
      // The plane's one card describes the commons itself and is PUBLISHED as it stands — the
      // export never rewrites it and the re-gate holds it to a public shape: a publishable
      // public_use, no maturity, no private field. `init`'s draft card is none of those, so the
      // card is written here from the config, with the operator's words where given.
      const planeCardsPath = path.join(planeDir, "data", "kb", "source-system.yaml");
      writeFileSync(planeCardsPath, yaml.dump({
        entries: {
          [plane.instance]: {
            title: plane.title || config.org.name,
            type: "knowledge-garden",
            ...(plane.url ? { url: plane.url } : {}),
            steward: plane.steward || config.org.name,
            return_path: plane.return_path || str("public_plane_return_path"),
            public_use: "ok-with-caveat",
          },
        },
      }));
      log("stage 7b", `public plane: repos/${plane.instance} (instance "${plane.instance}")`);
      if (!noGit) {
        spawnSync("git", ["init", "-q"], { cwd: planeDir });
        spawnSync("git", ["add", "-A"], { cwd: planeDir });
        spawnSync("git", ["commit", "-q", "-m", str("public_plane_commit")], { cwd: planeDir });
      }
    }
  }
}

// === Stage 8: git init + initial commit ===
// In fallback mode the copy was NOT limited to committed content, so a
// genesis commit would enshrine whatever was on disk. Skip it unless the
// operator explicitly opts in.
const skipGenesisCommit = source.mode === "filesystem" && !commitUnverified;
if (!noGit && !dry && !skipGenesisCommit) {
  log("stage 8", `git init + initial commit`);
  try {
    execSync("git init -q", { cwd: target });
    execSync("git add .", { cwd: target });
    // An argument, not a shell string: the message comes from the strings catalogue.
    const committed = spawnSync(
      "git",
      ["-c", "user.email=clone-framework@org-os", "-c", "user.name=clone-framework", "commit", "-q", "-m", str("genesis_commit")],
      { cwd: target, encoding: "utf-8" },
    );
    if (committed.status !== 0) throw new Error(committed.stderr || "git commit failed");
    log("stage 8", `initial commit created`);
  } catch (e) {
    console.warn(`⚠ git init/commit failed: ${e.message}`);
  }
} else {
  log("stage 8", noGit ? "skipped (--no-git)" : dry ? "skipped (--dry)" : "skipped (non-git fallback — pass --commit-unverified to commit anyway)");
}

console.log(`\n✓ ${dry ? "dry-run completed" : "instance bootstrapped"}: ${target}`);
console.log(`  Next:`);
console.log(`    cd ${path.relative(process.cwd(), target)}`);
console.log(`    npm install`);
console.log(`    npm run generate:schemas`);
console.log(`    npm run validate:structure`);
console.log(`    npm run selftest`);
console.log(`    # Edit IDENTITY.md, SOUL.md, MASTERPLAN.md, federation.yaml.peers, data/*.yaml`);
// Repeated last so it is the final thing the operator reads, not scrolled away.
if (source.mode === "filesystem") console.warn(FALLBACK_WARNING);
