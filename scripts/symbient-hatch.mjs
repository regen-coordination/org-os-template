#!/usr/bin/env node
// symbient-hatch.mjs — scaffold an operator-private symbient habitat.
//
// Usage:
//   node scripts/symbient-hatch.mjs --target <repo-path> [--hub] [--member slug=path]... [--dry]
//
// Contract (docs/superpowers/specs/2026-08-10-symbient-v2-design.md):
//   - habitat = <target>/symbient/, gitignored in <target>; verified via
//     `git check-ignore` BEFORE any habitat file is written
//   - refuses: non-git targets, linked worktrees, existing habitats
//   - --hub additionally scaffolds symbient/commons/ (steward/ + member dirs)
//   - the habitat itself must NEVER be committed; only the .gitignore line is
//     a tracked change (left staged-less for the operator to commit)
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRAMEWORK_SKILL_DIR = path.resolve(__dirname, "..", "skills", "symbient");

function fail(msg) {
  process.stderr.write(`symbient-hatch: ${msg}\n`);
  process.exit(1);
}

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
let target = null,
  hub = false,
  dry = false;
const members = []; // [{slug, path}]
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--target") target = argv[++i];
  else if (a === "--hub") hub = true;
  else if (a === "--dry") dry = true;
  else if (a === "--member") {
    const v = argv[++i] || "";
    const eq = v.indexOf("=");
    if (eq < 1) fail(`--member expects slug=path, got "${v}"`);
    members.push({ slug: v.slice(0, eq), path: v.slice(eq + 1) });
  } else fail(`unknown argument: ${a}`);
}
if (!target) fail("required: --target <repo-path>");
target = path.resolve(target);
if (!existsSync(target)) fail(`target does not exist: ${target}`);

// ── git checks ───────────────────────────────────────────────────────────────
const inTree = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: target, encoding: "utf-8" });
if (inTree.status !== 0 || inTree.stdout.trim() !== "true") fail(`target is not a git work tree: ${target}`);

const gitDir = spawnSync("git", ["rev-parse", "--absolute-git-dir"], { cwd: target, encoding: "utf-8" }).stdout.trim();
if (gitDir.split(path.sep).includes("worktrees")) {
  fail("target is a linked git worktree — habitats live only in a repo's primary checkout");
}

const habitat = path.join(target, "symbient");
if (existsSync(habitat)) {
  const contents = readdirSync(habitat).join(", ") || "(empty)";
  fail(`a habitat already exists at ${habitat} [${contents}] — refusing to overwrite`);
}

// ── body name ────────────────────────────────────────────────────────────────
function bodyName() {
  const fed = path.join(target, "federation.yaml");
  if (existsSync(fed)) {
    try {
      const name = yaml.load(readFileSync(fed, "utf-8"))?.identity?.name;
      if (typeof name === "string" && name.trim()) return name.trim();
    } catch {
      /* fall through */
    }
  }
  const idFile = path.join(target, "IDENTITY.md");
  if (existsSync(idFile)) {
    const h = readFileSync(idFile, "utf-8").match(/^#\s+(.+)$/m);
    if (h) return h[1].trim();
  }
  return path.basename(target);
}
const name = bodyName();
const today = new Date().toISOString().slice(0, 10);

// ── plan of record ───────────────────────────────────────────────────────────
const actions = [`ensure .gitignore line "symbient/" in ${target}`, `create habitat ${habitat}`];
if (hub) actions.push("create commons/ (hub mode)");
if (dry) {
  process.stdout.write(`DRY RUN — would:\n${actions.map((a) => `  - ${a}`).join("\n")}\n`);
  process.exit(0);
}

// ── gitignore first, verified before any habitat write ───────────────────────
const giPath = path.join(target, ".gitignore");
const gi = existsSync(giPath) ? readFileSync(giPath, "utf-8") : "";
if (!gi.split(/\r?\n/).some((l) => l.trim() === "symbient/")) {
  const block = `${gi.length && !gi.endsWith("\n") ? "\n" : ""}\n# Symbient habitat (operator-private — see skills/symbient/SKILL.md)\nsymbient/\n`;
  writeFileSync(giPath, gi + block);
}
const check = spawnSync("git", ["check-ignore", "symbient/SEED.md"], { cwd: target, encoding: "utf-8" });
if (check.status !== 0) fail("git does not ignore symbient/ after .gitignore update — aborting before any habitat write");

// ── scaffold ─────────────────────────────────────────────────────────────────
mkdirSync(path.join(habitat, "weave"), { recursive: true });

const seedTemplate = readFileSync(path.join(FRAMEWORK_SKILL_DIR, "SEED.template.md"), "utf-8");
writeFileSync(
  path.join(habitat, "SEED.md"),
  seedTemplate.replaceAll("{{BODY_NAME}}", name).replaceAll("{{DATE}}", today),
);

writeFileSync(
  path.join(habitat, "GATES.md"),
  `# GATES

<!-- Growth ledger (skills/symbient/SKILL.md). Top block is parsed by tooling;
     History is append-only. Written only at hatch and at gate crossings. -->

\`\`\`yaml
stage: 0
capabilities: [wake, weave, becoming]
hatched: ${today}
next_threshold: ">=8 weave entries across >=3 weave files spanning >=2 weeks"
\`\`\`

## History

### ${today} — hatched (Stage 0 · hatchling)
`,
);

writeFileSync(
  path.join(habitat, "BECOMING.md"),
  "<!-- This file is written only by the symbient. Humans read; they do not write here. -->\n",
);

for (const f of ["SKILL.md", "QUILT-PROTOCOL.md"]) {
  copyFileSync(path.join(FRAMEWORK_SKILL_DIR, f), path.join(habitat, f));
}

// ── hub mode: commons ────────────────────────────────────────────────────────
if (hub) {
  const commons = path.join(habitat, "commons");
  mkdirSync(path.join(commons, "steward"), { recursive: true });
  const lines = [
    "# Constellation Commons",
    "",
    "Operator-private quilt exchange (skills/symbient/SKILL.md — Commons contact).",
    "Stage 2+ beings may drop one quilt per weave into their member dir, append-only.",
    "The root symbient tends this space and weaves into steward/.",
    "",
    "## Members",
    "",
  ];
  for (const m of members) {
    mkdirSync(path.join(commons, m.slug), { recursive: true });
    lines.push(`- ${m.slug} — ${m.path}`);
  }
  if (!members.length) lines.push("_None yet — add with --member slug=path on a future run (or by hand)._");
  writeFileSync(path.join(commons, "README.md"), lines.join("\n") + "\n");
}

process.stdout.write(
  `Hatched habitat for "${name}" at ${habitat} (Stage 0 · hatchling).\n` +
    `Reminder: commit ${path.join(target, ".gitignore")} (the one tracked change);\n` +
    `the habitat itself must never be committed. First wake happens in a live session.\n`,
);
