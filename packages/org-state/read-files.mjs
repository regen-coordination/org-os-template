// The only fs-touching module in org-state: reads a workspace into the flat
// { "relative/path": "content" } map every other module consumes.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const ROOT_FILES = [
  "package.json",
  "federation.yaml",
  "HEARTBEAT.md",
  "MEMORY.md",
  "DECISIONS.md",
  "docs/agent-plans/QUEUE.md",
  "docs/plans/QUEUE.md",
  "data/projects.yaml",
  "data/instances.yaml",
  "data/events.yaml",
  "data/meetings.yaml",
  "data/funding-opportunities.yaml",
];

export const WATCH_PATHS = [
  "data",
  "memory",
  "HEARTBEAT.md",
  "MEMORY.md",
  "DECISIONS.md",
  "federation.yaml",
  "docs/agent-plans/QUEUE.md",
  "docs/plans/QUEUE.md",
];

export const MEMORY_LIMIT = 60;

function listDir(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

export function listMemoryFiles(root, limit = MEMORY_LIMIT) {
  return listDir(join(root, "memory"))
    .filter((n) => /^\d{4}-\d{2}-\d{2}.*\.md$/.test(n))
    .sort()
    .reverse()
    .slice(0, limit)
    .map((n) => `memory/${n}`);
}

export function listProjectFiles(root) {
  return listDir(join(root, "packages", "operations", "projects"))
    .filter((n) => n.endsWith(".md"))
    .map((n) => `packages/operations/projects/${n}`);
}

export function readWorkspaceFiles(root, { memoryLimit = MEMORY_LIMIT } = {}) {
  const files = {};
  const errors = [];
  const paths = [...ROOT_FILES, ...listMemoryFiles(root, memoryLimit), ...listProjectFiles(root)];
  for (const rel of paths) {
    const abs = join(root, rel);
    if (!existsSync(abs)) continue;
    try {
      files[rel] = readFileSync(abs, "utf8");
    } catch (e) {
      errors.push(`${rel}: ${e.message}`);
    }
  }
  return { files, errors };
}
