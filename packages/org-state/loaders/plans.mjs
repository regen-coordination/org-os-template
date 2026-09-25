export const QUEUE_PATHS = ["docs/agent-plans/QUEUE.md", "docs/plans/QUEUE.md"];

export function loadQueue(files) {
  for (const path of QUEUE_PATHS) if (files[path]) return { path, text: files[path] };
  return null;
}
