// DECISIONS.md sections look like `## 2026-09-20 · Title` (also `—`, `–`, `-`),
// with a `**Status:** active` line (bulleted or not).
const HEADING = /^## (\d{4}-\d{2}-\d{2})\s*[·—–-]\s*(.+)$/gm;

export function parseDecisions(text) {
  if (!text) return [];
  const heads = [...text.matchAll(HEADING)];
  return heads.map((m, i) => {
    const start = m.index;
    const hardEnd = i + 1 < heads.length ? heads[i + 1].index : text.length;
    let body = text.slice(start, hardEnd);
    const nextH2 = body.slice(3).search(/^## /m);
    if (nextH2 >= 0) body = body.slice(0, nextH2 + 3);
    const status = (body.match(/\*\*Status:?\*\*:?\s*([A-Za-z-]+)/) || [])[1] ?? null;
    return { n: i + 1, date: m[1], title: m[2].trim(), status: status ? status.toLowerCase() : null, body: body.trim() };
  });
}
