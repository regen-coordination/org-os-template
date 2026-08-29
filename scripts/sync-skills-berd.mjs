#!/usr/bin/env node
// sync-skills-berd.mjs — materialize the curated org-os skills into Berd's
// project-local .agents/skills/ surface (third run of the sync-commands →
// sync-agents pattern; see modules/org-os-berd/module.yaml for the exposure
// list and docs/integrations/berd.md for the verified discovery surface).
//
// Copy = canonical dir, verbatim (bytes + permission bits; symlinks are a
// hard error, not a silent drop), EXCEPT SKILL.md gains one injected line —
// `managed_by: org-os` before the closing frontmatter fence. The marker is
// the overwrite permission for future runs; hand-authored targets are
// skipped (--adopt to take over). --check recomputes and byte-compares.
//
// "Hand-authored" is a directory-content question, not a SKILL.md-existence
// question: an existing target dir that is empty (or absent) has nothing to
// protect and is installed into normally; an existing target dir that holds
// ANY file (with or without a root SKILL.md) that isn't a managed mirror is
// left untouched unless --adopt is passed.
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

// A SKILL.md must OPEN with a frontmatter fence, not merely contain a line
// that looks like one later on (an ordinary markdown thematic break, e.g.
// `---` under a heading, would otherwise fool a bare indexOf scan and splice
// the marker into the body instead of the frontmatter — silently, since the
// resulting file has no opening fence for `gray-matter` to parse either, so
// every later run sees it as "hand-authored" and `--check` calls it clean).
const injectMarker = (raw) => {
  if (!/^---\r?\n/.test(raw)) return null;
  const fence = raw.indexOf("\n---", 3); // end of frontmatter block
  if (fence === -1) return null;
  return raw.slice(0, fence) + "\nmanaged_by: org-os" + raw.slice(fence);
};

// Recursive, sorted directory listing as {rel, full, symlink} entries.
// Directories themselves are excluded; symlinks are INCLUDED (as `symlink:
// true`) so callers can decide whether to hard-error on them rather than
// have them silently vanish from the file set the way an `isFile()`-only
// filter would drop them.
const statEntries = (dir) =>
  fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() || d.isSymbolicLink())
    .map((d) => {
      const full = path.join(d.parentPath ?? d.path, d.name);
      return {
        rel: path.relative(dir, full),
        full,
        symlink: d.isSymbolicLink(),
      };
    })
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

// Plain file list (relative paths only, symlinks excluded) — used for target
// dirs, which we only ever populate ourselves and never with symlinks.
const listFiles = (dir) =>
  statEntries(dir)
    .filter((e) => !e.symlink)
    .map((e) => e.rel);

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

  // Build the expected materialized content in memory: Buffer + permission
  // bits per file, verbatim, except SKILL.md gains the marker. Read as raw
  // bytes (not "utf8") for everything but SKILL.md so binary files survive
  // the round trip losslessly.
  let skillFailed = false;
  const expected = new Map();
  for (const entry of statEntries(srcDir)) {
    if (entry.symlink) {
      console.error(
        `ERROR: ${name}/${entry.rel} is a symlink; canon must not contain symlinks.`,
      );
      failures++;
      skillFailed = true;
      continue;
    }
    const mode = fs.statSync(entry.full).mode & 0o777;
    if (entry.rel === "SKILL.md") {
      const injected = injectMarker(fs.readFileSync(entry.full, "utf8"));
      if (!injected) {
        console.error(`ERROR: ${name}/SKILL.md has no frontmatter fence.`);
        failures++;
        skillFailed = true;
        continue;
      }
      expected.set(entry.rel, { buf: Buffer.from(injected, "utf8"), mode });
    } else {
      expected.set(entry.rel, { buf: fs.readFileSync(entry.full), mode });
    }
  }
  if (skillFailed) continue;

  // "present" = the target dir exists AND holds at least one file. An
  // absent dir and an empty dir (e.g. detritus from an interrupted prior
  // run) are both "nothing to protect" and materialize normally; a dir
  // holding any file at all — with or without a root SKILL.md — that isn't
  // a fully in-sync managed mirror is hand-authored territory.
  const tgtFiles = fs.existsSync(tgtDir) ? listFiles(tgtDir) : [];
  const present = tgtFiles.length > 0;
  const tgtSkill = path.join(tgtDir, "SKILL.md");
  const managed =
    tgtFiles.includes("SKILL.md") &&
    matter(fs.readFileSync(tgtSkill, "utf8")).data.managed_by === "org-os";
  const expectedKeys = [...expected.keys()].sort();
  const inSync =
    present &&
    managed &&
    tgtFiles.join("\n") === expectedKeys.join("\n") &&
    [...expected].every(([rel, { buf, mode }]) => {
      const p = path.join(tgtDir, rel);
      return (
        fs.existsSync(p) &&
        Buffer.compare(fs.readFileSync(p), buf) === 0 &&
        (fs.statSync(p).mode & 0o777) === mode
      );
    });

  if (CHECK) {
    if (!present) {
      tally("missing", name);
      drift++;
    } else if (!managed) tally("hand-authored", name, "  (ignored by check)");
    else if (!inSync) {
      tally("drift", name);
      drift++;
    } else tally("in-sync", name);
    continue;
  }
  if (present && !managed && !ADOPT) {
    tally("skipped", name, "  (hand-authored — rerun with --adopt)");
    continue;
  }
  if (inSync) {
    tally("unchanged", name);
    continue;
  }
  const action = !present ? "install" : managed ? "update" : "adopt";
  if (DRY) {
    tally(`would ${action}`, name);
    continue;
  }
  fs.rmSync(tgtDir, { recursive: true, force: true });
  for (const [rel, { buf, mode }] of expected) {
    const dst = path.join(tgtDir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, buf);
    fs.chmodSync(dst, mode);
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
