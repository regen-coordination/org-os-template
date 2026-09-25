export function displayWidth(s: string): number {
  return Bun.stringWidth(s);
}

export function truncate(s: string, max: number): string {
  if (max <= 0) return "";
  if (displayWidth(s) <= max) return s;
  let out = "";
  let w = 0;
  for (const ch of s) {
    const cw = displayWidth(ch);
    if (w + cw > max - 1) break;
    out += ch;
    w += cw;
  }
  return out + "…";
}

export function pad(s: string, n: number): string {
  const t = truncate(s, n);
  return t + " ".repeat(Math.max(0, n - displayWidth(t)));
}

export function padLine(left: string, right: string, width: number): string {
  if (!right) return pad(left, width);
  const r = truncate(right, Math.max(0, width - 2));
  const l = truncate(left, Math.max(0, width - displayWidth(r) - 1));
  return l + " ".repeat(Math.max(1, width - displayWidth(l) - displayWidth(r))) + r;
}

export function formatTable(columns: string[], rows: string[][], maxWidth: number): { header: string; lines: string[] } {
  const gap = 2;
  const widths = columns.map((c, i) => Math.max(displayWidth(c), ...rows.map((r) => displayWidth(r[i] ?? ""))));
  let total = widths.reduce((a, b) => a + b, 0) + gap * (columns.length - 1);
  while (total > maxWidth) {
    const widest = Math.max(...widths);
    if (widest <= 4) break;
    widths[widths.indexOf(widest)]--;
    total--;
  }
  const line = (cells: string[]) => cells.map((c, i) => pad(c ?? "", widths[i])).join(" ".repeat(gap)).trimEnd();
  return { header: line(columns), lines: rows.map(line) };
}
