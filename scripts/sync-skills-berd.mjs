#!/usr/bin/env node
// sync-skills-berd.mjs — materialize the curated org-os skills into Berd's
// project-local .agents/skills/ surface (third run of the sync-commands →
// sync-agents pattern; see modules/org-os-berd/module.yaml for the exposure
// list and docs/integrations/berd.md for the verified discovery surface).
//
// Copy = canonical dir, verbatim, EXCEPT SKILL.md gains one injected line —
// `managed_by: org-os` before the closing frontmatter fence. The marker is
// the overwrite permission for future runs; hand-authored targets are
// skipped (--adopt to take over). --check recomputes and byte-compares.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import yaml from "js-yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flagValue = (n) => {
  const i = argv.indexOf(n);
  return i !== -1 ? argv[i + 1] : undefined;
};
const MANIFEST =
  flagValue("--manifest") ??
  path.join(root, "modules", "org-os-berd", "module.yaml");
const SRC_ROOT = flagValue("--source-root") ?? path.join(root, "skills");
const TGT_ROOT =
  flagValue("--target-root") ?? path.join(root, ".agents", "skills");
const ADOPT = argv.includes("--adopt");
const DRY = argv.includes("--dry-run");
const CHECK = argv.includes("--check");

// Curation list = manifest files entries targeting .agents/skills/
const manifestFiles = yaml.load(fs.readFileSync(MANIFEST, "utf8"))?.files ?? {};
const exposure = Object.entries(manifestFiles)
  .filter(([, tgt]) => String(tgt).startsWith(".agents/skills/"))
  .map(([src]) => path.basename(src))
  .sort();

if (exposure.length === 0) {
  console.error("ERROR: manifest exposes no skills.");
  process.exit(1);
}

const injectMarker = (raw) => {
  const fence = raw.indexOf("\n---", 3); // end of frontmatter block
  if (fence === -1) return null;
  return raw.slice(0, fence) + "\nmanaged_by: org-os" + raw.slice(fence);
};

const listFiles = (dir) =>
  fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => path.relative(dir, path.join(d.parentPath ?? d.path, d.name)))
    .sort();

let failures = 0,
  drift = 0;
const counts = {};
const tally = (action, name, note = "") => {
  counts[action] = (counts[action] ?? 0) + 1;
  console.log(`  ${action.padEnd(13)} ${name}${note}`);
};

for (const name of exposure) {
  const srcDir = path.join(SRC_ROOT, name);
  const tgtDir = path.join(TGT_ROOT, name);
  if (!fs.existsSync(path.join(srcDir, "SKILL.md"))) {
    console.error(
      `ERROR: exposure entry "${name}" has no canonical skills/${name}/SKILL.md`,
    );
    failures++;
    continue;
  }
  // Build the expected materialized content in memory.
  let skillFailed = false;
  const expected = new Map();
  for (const rel of listFiles(srcDir)) {
    let content = fs.readFileSync(path.join(srcDir, rel), "utf8");
    if (rel === "SKILL.md") {
      const injected = injectMarker(content);
      if (!injected) {
        console.error(`ERROR: ${name}/SKILL.md has no frontmatter fence.`);
        failures++;
        skillFailed = true;
        content = null;
      } else content = injected;
    }
    if (content !== null) expected.set(rel, content);
  }
  if (skillFailed) continue;

  const tgtSkill = path.join(tgtDir, "SKILL.md");
  const exists = fs.existsSync(tgtSkill);
  const managed =
    exists &&
    matter(fs.readFileSync(tgtSkill, "utf8")).data.managed_by === "org-os";
  const inSync =
    exists &&
    listFiles(tgtDir).join("\n") === [...expected.keys()].join("\n") &&
    [...expected].every(
      ([rel, c]) => fs.readFileSync(path.join(tgtDir, rel), "utf8") === c,
    );

  if (CHECK) {
    if (!exists) {
      tally("missing", name);
      drift++;
    } else if (!managed) tally("hand-authored", name, "  (ignored by check)");
    else if (!inSync) {
      tally("drift", name);
      drift++;
    } else tally("in-sync", name);
    continue;
  }
  if (exists && !managed && !ADOPT) {
    tally("skipped", name, "  (hand-authored — rerun with --adopt)");
    continue;
  }
  if (inSync) {
    tally("unchanged", name);
    continue;
  }
  const action = !exists ? "install" : managed ? "update" : "adopt";
  if (DRY) {
    tally(`would ${action}`, name);
    continue;
  }
  fs.rmSync(tgtDir, { recursive: true, force: true });
  for (const [rel, c] of expected) {
    fs.mkdirSync(path.dirname(path.join(tgtDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(tgtDir, rel), c);
  }
  const PAST_TENSE = {
    install: "installed",
    update: "updated",
    adopt: "adopted",
  };
  tally(PAST_TENSE[action], name);
}

const summary = Object.entries(counts)
  .map(([a, n]) => `${n} ${a}`)
  .join(", ");
console.log(
  `\n${failures || drift ? "✗" : "✓"} ${exposure.length} curated skills → ${TGT_ROOT}${DRY ? "  (dry run)" : ""}\n  ${summary || "nothing to do"}`,
);
process.exit(failures || drift ? 1 : 0);
