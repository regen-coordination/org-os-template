import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { discoverSkills } from "../scripts/lib/discover-skills.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures");

test("discoverSkills returns empty arrays for an empty workspace", () => {
  const result = discoverSkills({
    workspaceDir: path.join(fixturesDir, "skills-empty"),
    userDir: null,
    pluginRoot: null,
  });
  assert.deepEqual(result.skills, []);
  assert.deepEqual(result.anomalies, []);
  assert.equal(result.totals.workspace, 0);
});

test("discoverSkills finds skills with valid SKILL.md", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "discover-skills-"));
  try {
    mkdirSync(path.join(dir, "skills", "alpha"), { recursive: true });
    writeFileSync(
      path.join(dir, "skills", "alpha", "SKILL.md"),
      "---\nname: alpha\ndescription: An alpha skill.\n---\n\nBody.",
    );

    const result = discoverSkills({ workspaceDir: dir });
    assert.equal(result.skills.length, 1);
    assert.equal(result.skills[0].id, "alpha");
    assert.equal(result.skills[0].source, "workspace");
    assert.equal(result.skills[0].frontmatter.description, "An alpha skill.");
    assert.equal(result.anomalies.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("discoverSkills flags missing SKILL.md as anomaly", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "discover-skills-"));
  try {
    mkdirSync(path.join(dir, "skills", "broken"), { recursive: true });

    const result = discoverSkills({ workspaceDir: dir });
    assert.equal(result.skills.length, 0);
    assert.equal(result.anomalies.length, 1);
    assert.equal(result.anomalies[0].kind, "missing-skill-md");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("discoverSkills detects duplicates across sources", () => {
  const dir1 = mkdtempSync(path.join(tmpdir(), "discover-ws-"));
  const dir2 = mkdtempSync(path.join(tmpdir(), "discover-user-"));
  try {
    for (const d of [dir1, dir2]) {
      mkdirSync(path.join(d, "skills", "shared"), { recursive: true });
      writeFileSync(
        path.join(d, "skills", "shared", "SKILL.md"),
        "---\nname: shared\ndescription: dup.\n---\n",
      );
    }
    const result = discoverSkills({ workspaceDir: dir1, userDir: dir2 });
    assert.equal(result.skills.length, 2);
    const dupAnomaly = result.anomalies.find((a) => a.kind === "duplicate-id");
    assert.ok(dupAnomaly, "expected duplicate-id anomaly");
  } finally {
    rmSync(dir1, { recursive: true, force: true });
    rmSync(dir2, { recursive: true, force: true });
  }
});

test("discoverSkills falls back to dir name when frontmatter is missing", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "discover-skills-"));
  try {
    mkdirSync(path.join(dir, "skills", "no-frontmatter"), { recursive: true });
    writeFileSync(
      path.join(dir, "skills", "no-frontmatter", "SKILL.md"),
      "Body only, no frontmatter.",
    );

    const result = discoverSkills({ workspaceDir: dir });
    assert.equal(result.skills.length, 1);
    assert.equal(result.skills[0].id, "no-frontmatter");
    assert.equal(result.skills[0].hasIssues, true);
    assert.ok(result.anomalies.find((a) => a.kind === "no-frontmatter"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
