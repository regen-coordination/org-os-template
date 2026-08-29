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
