import yaml from "js-yaml";
import { buildState } from "./build-state.mjs";
import { loadHeartbeat } from "./loaders/heartbeat.mjs";
import { listMemory } from "./loaders/memory.mjs";
import { parseDecisions } from "./loaders/decisions.mjs";
import { loadQueue } from "./loaders/plans.mjs";
import { loadFunding } from "./loaders/funding.mjs";

export { buildState, loadFederation } from "./build-state.mjs";
export { renderPage, SUPPORTED_PAGES } from "./render-page.mjs";
export { extractCheckboxes, daysUntil, getRelativeAge, parseFrontmatter } from "./parse-helpers.mjs";
export { readWorkspaceFiles, listMemoryFiles, listProjectFiles, ROOT_FILES, WATCH_PATHS, MEMORY_LIMIT } from "./read-files.mjs";
export { loadHeartbeat, listMemory, parseDecisions, loadQueue, loadFunding };
export { QUEUE_PATHS } from "./loaders/plans.mjs";

export function loadWorkspaceState(files, { now }) {
  return {
    ...buildState(files, { now }),
    heartbeat: loadHeartbeat(files),
    memory: listMemory(files),
    decisions: parseDecisions(files["DECISIONS.md"]),
    queue: loadQueue(files),
    funding: loadFunding(files, now),
  };
}

export function yamlErrors(files) {
  const errors = [];
  for (const [path, text] of Object.entries(files)) {
    if (!path.endsWith(".yaml") && !path.endsWith(".yml")) continue;
    try {
      yaml.load(text);
    } catch (e) {
      errors.push(`${path}: ${String(e.message).split("\n")[0]}`);
    }
  }
  return errors;
}
