// Workspace detection shared by every org-os host (cockpit, Pi, future hosts).
// Dependency-free on purpose: hosts load this before any npm install has run.
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export const WORKSPACE_MARKERS = ["package.json", "federation.yaml", "data", "memory"];

export function isWorkspace(dir) {
  return WORKSPACE_MARKERS.every((m) => existsSync(join(dir, m)));
}

// identity.name from federation.yaml without a YAML parser: the first `name:`
// among the direct children of the top-level `identity:` key.
export function readWorkspaceName(dir) {
  let text;
  try {
    text = readFileSync(join(dir, "federation.yaml"), "utf8");
  } catch {
    return basename(dir);
  }
  let inIdentity = false;
  let childIndent = null;
  for (const line of text.split("\n")) {
    if (!inIdentity) {
      if (/^identity:\s*(#.*)?$/.test(line)) inIdentity = true;
      continue;
    }
    if (/^\S/.test(line)) break;
    const indent = line.match(/^(\s+)\S/);
    if (!indent) continue;
    if (childIndent === null) childIndent = indent[1].length;
    if (indent[1].length !== childIndent) continue;
    const m = line.match(/^\s+name:\s*(.*?)\s*(?:#.*)?$/);
    if (m) {
      const value = m[1].replace(/^["']|["']$/g, "").trim();
      return value || basename(dir);
    }
  }
  return basename(dir);
}

export function findWorkspace(cwd) {
  let dir = resolve(cwd);
  for (;;) {
    if (isWorkspace(dir)) return { root: dir, name: readWorkspaceName(dir) };
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function findEnclosingWorkspace(root) {
  const self = resolve(root);
  const parent = dirname(self);
  if (parent === self) return null;
  return findWorkspace(parent);
}
