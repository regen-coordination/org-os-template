import { extractCheckboxes } from "../parse-helpers.mjs";

export function loadHeartbeat(files) {
  const text = files["HEARTBEAT.md"];
  if (!text) return { present: false, sections: [], open: 0, done: 0 };
  const items = extractCheckboxes(text);
  const sections = [];
  const byHeading = new Map();
  for (const item of items) {
    const heading = item.category || "Tasks";
    if (!byHeading.has(heading)) {
      const section = { heading, items: [] };
      byHeading.set(heading, section);
      sections.push(section);
    }
    byHeading.get(heading).items.push(item);
  }
  const done = items.filter((i) => i.done).length;
  return { present: true, sections, open: items.length - done, done };
}
