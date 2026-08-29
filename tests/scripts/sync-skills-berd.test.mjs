// tests/scripts/sync-skills-berd.test.mjs
//
// Tests for scripts/sync-skills-berd.mjs (Berd curated skills mirror). The
// fixture idiom is copied from tests/scripts/sync-agents.test.mjs: build a
// fake canonical `skills/` source dir, a fake `.agents/skills/` target dir,
// and a module.yaml manifest in a temp root, then spawn the real script
// with --manifest/--source-root/--target-root so nothing outside the
// fixture is touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  chmodSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ORG_ROOT } from "../helpers/repo-paths.mjs";

const SCRIPT = path.join(ORG_ROOT, "scripts", "sync-skills-berd.mjs");
const SKILL = (name, body = "Do the thing.") =>
  `---\nname: ${name}\ndescription: A ${name} skill.\n---\n\n${body}\n`;
const MIRRORED = (name, body = "Do the thing.") =>
  `---\nname: ${name}\ndescription: A ${name} skill.\nmanaged_by: org-os\n---\n\n${body}\n`;

function setup({
  skills = {},
  targets = {},
  exposure = Object.keys(skills),
} = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "sync-skills-"));
  const src = path.join(root, "skills");
  const tgt = path.join(root, "agents-skills");
  for (const [name, files] of Object.entries(skills)) {
    mkdirSync(path.join(src, name), { recursive: true });
    for (const [f, c] of Object.entries(files))
      writeFileSync(path.join(src, name, f), c);
  }
  for (const [name, files] of Object.entries(targets)) {
    mkdirSync(path.join(tgt, name), { recursive: true });
    for (const [f, c] of Object.entries(files))
      writeFileSync(path.join(tgt, name, f), c);
  }
  const manifest = path.join(root, "module.yaml");
  const lines = exposure
    .map((n) => `  skills/${n}: .agents/skills/${n}`)
    .join("\n");
  writeFileSync(
    manifest,
    `id: org-os-berd\nversion: 0.1.0\ntype: integration\ndescription: t\nfiles:\n${lines}\n`,
  );
  return { root, src, tgt, manifest };
}
const run = (f, ...flags) =>
  spawnSync(
    "node",
    [
      SCRIPT,
      "--manifest",
      f.manifest,
      "--source-root",
      f.src,
      "--target-root",
      f.tgt,
      ...flags,
    ],
    { encoding: "utf-8", cwd: ORG_ROOT },
  );

test("materializes a curated skill dir with marker injected into SKILL.md", () => {
  const f = setup({
    skills: { alpha: { "SKILL.md": SKILL("alpha"), "notes.md": "ref\n" } },
  });
  const r = run(f);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(
    readFileSync(path.join(f.tgt, "alpha", "SKILL.md"), "utf-8"),
    MIRRORED("alpha"),
  );
  assert.equal(
    readFileSync(path.join(f.tgt, "alpha", "notes.md"), "utf-8"),
    "ref\n",
  );
});

test("skills absent from the exposure list are not materialized", () => {
  const f = setup({
    skills: {
      alpha: { "SKILL.md": SKILL("alpha") },
      beta: { "SKILL.md": SKILL("beta") },
    },
    exposure: ["alpha"],
  });
  run(f);
  assert.ok(!existsSync(path.join(f.tgt, "beta")));
});

test("hand-authored target dir (no marker) is never touched", () => {
  const hand = "---\nname: alpha\ndescription: mine.\n---\n\nhand-authored\n";
  const f = setup({
    skills: { alpha: { "SKILL.md": SKILL("alpha") } },
    targets: { alpha: { "SKILL.md": hand } },
  });
  const r = run(f);
  assert.equal(r.status, 0);
  assert.equal(
    readFileSync(path.join(f.tgt, "alpha", "SKILL.md"), "utf-8"),
    hand,
  );
  assert.match(r.stdout, /skipped/);
});

test("--adopt takes over a hand-authored target", () => {
  const f = setup({
    skills: { alpha: { "SKILL.md": SKILL("alpha") } },
    targets: {
      alpha: { "SKILL.md": "---\nname: alpha\ndescription: mine.\n---\nold\n" },
    },
  });
  run(f, "--adopt");
  assert.equal(
    readFileSync(path.join(f.tgt, "alpha", "SKILL.md"), "utf-8"),
    MIRRORED("alpha"),
  );
});

test("managed target is updated when canon changes", () => {
  const f = setup({
    skills: { alpha: { "SKILL.md": SKILL("alpha", "v2") } },
    targets: { alpha: { "SKILL.md": MIRRORED("alpha", "v1") } },
  });
  const r = run(f);
  assert.match(r.stdout, /updated/);
  assert.equal(
    readFileSync(path.join(f.tgt, "alpha", "SKILL.md"), "utf-8"),
    MIRRORED("alpha", "v2"),
  );
});

test("--dry-run reports but writes nothing", () => {
  const f = setup({ skills: { alpha: { "SKILL.md": SKILL("alpha") } } });
  const r = run(f, "--dry-run");
  assert.match(r.stdout, /would install/);
  assert.ok(!existsSync(path.join(f.tgt, "alpha")));
});

test("--check passes when mirror matches, fails on drift", () => {
  const f = setup({ skills: { alpha: { "SKILL.md": SKILL("alpha") } } });
  run(f);
  assert.equal(run(f, "--check").status, 0);
  writeFileSync(
    path.join(f.tgt, "alpha", "SKILL.md"),
    MIRRORED("alpha", "tampered"),
  );
  const r = run(f, "--check");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /drift/);
});

test("exposure entry with no canonical skill dir is a hard error", () => {
  const f = setup({ skills: {}, exposure: ["ghost"] });
  assert.equal(run(f).status, 1);
});

// --- Fix-round covering tests (review findings on commit 9e81a00) ---

// Guard-rail, not a Finding-1 RED: an empty target dir passes against BOTH
// the pre-fix and post-fix `exists` definitions (the pre-fix code keyed
// "exists" on SKILL.md, which is already absent here too), so this test is
// vacuous as evidence for the Finding-1 fix. It still earns its place by
// locking down the naive "directory exists → skip" repair that a careless
// fix could reach for instead — that version would silently skip all five
// curated skills the first time Task 4 runs against the five empty dirs
// already sitting in .agents/skills/ from an earlier interrupted attempt.
test("guard-rail: existing empty target directory is treated as absent and installs normally", () => {
  const f = setup({ skills: { alpha: { "SKILL.md": SKILL("alpha") } } });
  mkdirSync(path.join(f.tgt, "alpha"), { recursive: true });
  const r = run(f);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /installed/);
  assert.equal(
    readFileSync(path.join(f.tgt, "alpha", "SKILL.md"), "utf-8"),
    MIRRORED("alpha"),
  );
});

// Finding 1: a target dir with real, unmanaged content but no root
// SKILL.md must be skipped like any other hand-authored target — not
// treated as "absent" and blown away by the blanket rmSync.
test("target dir with unmanaged files but no SKILL.md is skipped, not destroyed", () => {
  const f = setup({ skills: { alpha: { "SKILL.md": SKILL("alpha") } } });
  const alphaDir = path.join(f.tgt, "alpha");
  mkdirSync(path.join(alphaDir, "notes"), { recursive: true });
  writeFileSync(path.join(alphaDir, "README.md"), "precious\n");
  writeFileSync(path.join(alphaDir, "notes", "precious.md"), "do not delete\n");
  const r = run(f);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /skipped/);
  assert.equal(
    readFileSync(path.join(alphaDir, "README.md"), "utf-8"),
    "precious\n",
  );
  assert.equal(
    readFileSync(path.join(alphaDir, "notes", "precious.md"), "utf-8"),
    "do not delete\n",
  );
  assert.ok(!existsSync(path.join(alphaDir, "SKILL.md")));
});

// Finding 2: a SKILL.md that never opens with a frontmatter fence — even
// if it contains an unrelated markdown thematic break (`---`) later in the
// body — must be a hard error, not a corrupted mirror.
test("a SKILL.md with no opening frontmatter fence is a hard error, not a corrupted mirror", () => {
  const noFence = "# Alpha\n\nIntro paragraph.\n\n---\n\n## Section two\n";
  const f = setup({ skills: { alpha: { "SKILL.md": noFence } } });
  const r = run(f);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no frontmatter fence/);
  assert.ok(!existsSync(path.join(f.tgt, "alpha")));
});

// Finding 3: binary files must round-trip byte-for-byte — not through a
// lossy utf8 decode/encode, which corrupts invalid-utf8 byte sequences.
test("binary files are copied byte-for-byte, not lossily decoded through utf8", () => {
  const bin = Buffer.from([0x00, 0xff, 0xfe, 0x80, 0xc3, 0x28, 0x10]);
  const f = setup({ skills: { alpha: { "SKILL.md": SKILL("alpha") } } });
  writeFileSync(path.join(f.src, "alpha", "blob.bin"), bin);
  const r = run(f);
  assert.equal(r.status, 0, r.stderr);
  const mirrored = readFileSync(path.join(f.tgt, "alpha", "blob.bin"));
  assert.ok(
    mirrored.equals(bin),
    "binary content must round-trip byte-for-byte",
  );
});

// Finding 3: an executable canonical file must stay executable in the
// mirror — the copy must preserve permission bits, not just content.
test("executable file mode is preserved in the mirror", () => {
  const f = setup({ skills: { alpha: { "SKILL.md": SKILL("alpha") } } });
  const scriptPath = path.join(f.src, "alpha", "run.sh");
  writeFileSync(scriptPath, "#!/bin/sh\necho hi\n");
  chmodSync(scriptPath, 0o755);
  const r = run(f);
  assert.equal(r.status, 0, r.stderr);
  const mirroredMode =
    statSync(path.join(f.tgt, "alpha", "run.sh")).mode & 0o777;
  assert.equal(mirroredMode, 0o755);
});

// Finding 3: a symlink in canon must be a hard error, not silently dropped
// from the materialized mirror.
test("a symlink in canon is a hard error, not a silent drop", () => {
  const f = setup({ skills: { alpha: { "SKILL.md": SKILL("alpha") } } });
  writeFileSync(path.join(f.src, "alpha", "real.md"), "target content\n");
  symlinkSync(
    path.join(f.src, "alpha", "real.md"),
    path.join(f.src, "alpha", "link.md"),
  );
  const r = run(f);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /symlink/);
  assert.ok(!existsSync(path.join(f.tgt, "alpha")));
});

// --- Fix round 2 covering tests (re-review of commit a33669a) ---

// Finding A: a mirror that has lost its root SKILL.md but still holds other
// materialized files is never a legitimate hand-authored override — there
// is nothing there a human could have deliberately authored as a Berd
// skill. `--check` must call this "drift" (exit 1), not "hand-authored"
// (exit 0), or the broken mirror becomes invisible to the CI gate and
// self-perpetuating (a plain sync also refuses to repair a hand-authored
// target).
test("--check reports drift, not hand-authored, when a mirror loses its SKILL.md but keeps other files", () => {
  const f = setup({ skills: { alpha: { "SKILL.md": SKILL("alpha") } } });
  mkdirSync(path.join(f.src, "alpha", "references"), { recursive: true });
  writeFileSync(path.join(f.src, "alpha", "references", "data.yaml"), "k: v\n");
  const installed = run(f);
  assert.equal(installed.status, 0, installed.stderr);
  unlinkSync(path.join(f.tgt, "alpha", "SKILL.md"));
  const r = run(f, "--check");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /drift/);
  assert.doesNotMatch(r.stdout, /hand-authored/);
});

// Finding B: `--check` must not be blind to a symlink planted alongside a
// legitimately materialized mirror. The prior fix's target-side `listFiles`
// filtered symlinks out of the listing entirely, so an extra symlink never
// showed up as an unexpected entry and the mirror still read as in-sync.
test("--check reports drift when an extra symlink is planted in an otherwise in-sync mirror", () => {
  const f = setup({ skills: { alpha: { "SKILL.md": SKILL("alpha") } } });
  const installed = run(f);
  assert.equal(installed.status, 0, installed.stderr);
  symlinkSync("/etc/passwd", path.join(f.tgt, "alpha", "evil.md"));
  const r = run(f, "--check");
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /drift/);
});

// Finding C: `.agents/skills/<name>` existing as a plain file (not a
// directory) must be a per-skill hard error, not an uncaught readdirSync
// exception that aborts every remaining skill in the run. Two skills are
// named so the second (alphabetically later) skill's fate proves whether
// the crash aborted the whole process: pre-fix, the uncaught exception on
// "aaa" kills the process before "zzz" is ever reached.
test("a target path that exists as a plain file is a per-skill hard error, not a crash that aborts other skills", () => {
  const f = setup({
    skills: {
      aaa: { "SKILL.md": SKILL("aaa") },
      zzz: { "SKILL.md": SKILL("zzz") },
    },
  });
  mkdirSync(f.tgt, { recursive: true });
  writeFileSync(path.join(f.tgt, "aaa"), "not a directory\n");
  const r = run(f);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ERROR:.*not a directory/i);
  assert.equal(
    readFileSync(path.join(f.tgt, "zzz", "SKILL.md"), "utf-8"),
    MIRRORED("zzz"),
  );
});
