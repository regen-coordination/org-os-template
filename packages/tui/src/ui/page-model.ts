import { markdownToLines } from "../core/markdown";
import type { PageData, PageRef } from "../core/types";
import { formatTable, padLine } from "./format";

export type LineStyle =
  | "heading" | "header" | "row" | "item" | "kv" | "h1" | "h2" | "h3" | "bullet" | "code" | "quote" | "rule" | "body" | "blank"
  | "info" | "warn" | "error";
export type PageLine = { key: string; text: string; style: LineStyle; target?: PageRef };

export function pageLines(page: PageData, width: number): PageLine[] {
  const out: PageLine[] = [];
  page.blocks.forEach((b, bi) => {
    if (bi > 0) out.push({ key: `gap${bi}`, text: "", style: "blank" });
    switch (b.kind) {
      case "kv": {
        if (b.heading) out.push({ key: `h${bi}`, text: b.heading, style: "heading" });
        const kw = Math.max(0, ...b.pairs.map(([k]) => k.length));
        b.pairs.forEach(([k, v], i) => out.push({ key: `kv${bi}-${i}`, text: `${k.padEnd(kw)}  ${v}`, style: "kv" }));
        break;
      }
      case "list":
        if (b.heading) out.push({ key: `h${bi}`, text: b.heading, style: "heading" });
        for (const it of b.items) {
          const left = `${it.target ? "▸" : " "} ${it.label}${it.detail ? `  ${it.detail}` : ""}`;
          out.push({ key: `i${bi}-${it.key}`, text: padLine(left, it.badge ?? "", width), style: "item", ...(it.target ? { target: it.target } : {}) });
        }
        break;
      case "table": {
        if (b.heading) out.push({ key: `h${bi}`, text: b.heading, style: "heading" });
        const t = formatTable(b.columns, b.rows.map((r) => r.cells), width - 2);
        out.push({ key: `th${bi}`, text: `  ${t.header}`, style: "header" });
        b.rows.forEach((r, i) => out.push({ key: `r${bi}-${r.key}`, text: `${r.target ? "▸" : " "} ${t.lines[i]}`, style: "row", ...(r.target ? { target: r.target } : {}) }));
        break;
      }
      case "markdown":
        markdownToLines(b.text).forEach((m, i) => {
          const text =
            m.kind === "bullet" ? `${"  ".repeat(m.depth ?? 0)}• ${m.text}` : m.kind === "rule" ? "─".repeat(Math.min(width, 40)) : m.kind === "code" ? `  ${m.text}` : m.text;
          out.push({ key: `md${bi}-${i}`, text, style: m.kind });
        });
        break;
      case "notice":
        out.push({ key: `n${bi}`, text: `${b.level === "error" ? "✗" : b.level === "warn" ? "!" : "·"} ${b.text}`, style: b.level });
        break;
    }
  });
  return out;
}

export function selectableIndexes(lines: PageLine[]): number[] {
  return lines.flatMap((l, i) => (l.target ? [i] : []));
}

export function navCount(lines: PageLine[]): number {
  const sel = selectableIndexes(lines).length;
  return sel || lines.length;
}

export function selectedLineIndex(lines: PageLine[], cursor: number): number {
  const sel = selectableIndexes(lines);
  return sel.length ? sel[Math.max(0, Math.min(cursor, sel.length - 1))] : -1;
}

export function windowFor(lines: PageLine[], cursor: number, height: number): number {
  const total = lines.length;
  if (total <= height) return 0;
  const selected = selectedLineIndex(lines, cursor);
  if (selected < 0) return Math.max(0, Math.min(cursor, total - height));
  // keep the selection visible with the least scrolling: it rides the bottom edge going down
  return Math.max(0, Math.min(selected, total - height, Math.max(0, selected - height + 1)));
}

export function targetAt(lines: PageLine[], cursor: number): PageRef | undefined {
  const i = selectedLineIndex(lines, cursor);
  return i >= 0 ? lines[i].target : undefined;
}
