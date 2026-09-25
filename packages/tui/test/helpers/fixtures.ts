import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function writeTree(root: string, files: Record<string, string>) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
}

export function makeWorkspace(root: string, name: string, extra: Record<string, string> = {}) {
  mkdirSync(join(root, "data"), { recursive: true });
  mkdirSync(join(root, "memory"), { recursive: true });
  writeTree(root, {
    "package.json": JSON.stringify({ name, scripts: { initialize: "node -e 1", "validate:schemas": "node -e 1" } }),
    "federation.yaml": `identity:\n  name: "${name}"\n  type: "LocalNode"\n`,
    ...extra,
  });
}

export function makeFleetFixture() {
  const hub = mkdtempSync(join(tmpdir(), "ck-hub-"));
  makeWorkspace(hub, "Hub");
  const fw = join(hub, "libs", "fw");
  makeWorkspace(fw, "Framework", {
    "data/instances.yaml": [
      "instances:",
      '  - id: "inst-a"',
      '    name: "Instance A"',
      '    local_path: "../inst-a"',
      "    drift: [a, b]",
      '  - id: "ghost"',
      '    local_path: "../ghost"',
      '  - id: "no-path"',
      "",
    ].join("\n"),
    ".claude/commands/close.md": "---\ndescription: close\n---\nClose the session for $ARGUMENTS now.\n",
  });
  const instA = join(hub, "libs", "inst-a");
  makeWorkspace(instA, "Instance A", {
    "HEARTBEAT.md": "# HB\n\n## Funding\n- [ ] Grant report (due: 2020-01-01)\n- [ ] Budget\n\n## Tech\n- [x] Done thing\n",
    "DECISIONS.md": "# D\n\n## 2026-09-20 · Pick the cockpit\n\n- **Status:** active\n\nBecause.\n",
    "memory/2026-09-24.md": "# 2026-09-24 — Day\n\n**Focus:** fixtures\n",
    "data/projects.yaml": 'projects:\n  - title: "Cockpit"\n    status: "Develop"\n    lead: "luiz"\n',
  });
  return { hub, fw, instA };
}
