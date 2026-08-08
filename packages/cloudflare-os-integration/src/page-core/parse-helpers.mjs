import yaml from "js-yaml";

// Verbatim port of scripts/initialize.mjs:60-102.
export function extractCheckboxes(markdownContent) {
  const lines = markdownContent.split("\n");
  const items = [];
  let currentCategory = "";

  for (const line of lines) {
    const categoryMatch = line.match(/^#{2,3}\s+(.+)/);
    if (categoryMatch) {
      currentCategory = categoryMatch[1].trim();
      continue;
    }

    const checkboxMatch = line.match(/^-\s+\[([ xX])\]\s+(.+)/);
    if (checkboxMatch) {
      const done = checkboxMatch[1] !== " ";
      let text = checkboxMatch[2].trim();

      const dueMatch = text.match(/\(due:\s*(\d{4}-\d{2}-\d{2})\)/i);
      const due = dueMatch ? dueMatch[1] : null;

      const assigneeMatch = text.match(/@(\w+)/);
      const assignee = assigneeMatch ? assigneeMatch[1] : null;

      text = text
        .replace(/\(due:\s*\d{4}-\d{2}-\d{2}\)/i, "")
        .replace(/@\w+/g, "")
        .replace(/\s+/g, " ")
        .trim();

      if (text.startsWith("_(") && text.endsWith(")_")) continue;

      items.push({
        text,
        done,
        category: currentCategory,
        due,
        assignee,
      });
    }
  }

  return items;
}

// Port of scripts/initialize.mjs:104-117, with `now` injected instead of `new Date()`
// so the module stays pure and deterministic under test / inside a Worker.
export function getRelativeAge(dateStr, now) {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return `${Math.floor(diffDays / 7)}w ago`;
}

// Port of scripts/initialize.mjs:128-135, with `now` injected instead of `new Date()`.
// Copies `now` before mutating with setHours so the caller's Date object is untouched.
export function daysUntil(dateStr, now) {
  if (!dateStr) return Infinity;
  const date = new Date(dateStr);
  const n = new Date(now);
  n.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return Math.ceil((date - n) / 86400000);
}

export function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { data: {}, content: text };
  let data = {};
  try { data = yaml.load(m[1]) || {}; } catch { /* malformed fm → empty */ }
  return { data, content: m[2] };
}
