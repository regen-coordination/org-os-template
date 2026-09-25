export type MdLine = {
  kind: "h1" | "h2" | "h3" | "bullet" | "code" | "quote" | "rule" | "body" | "blank";
  text: string;
  depth?: number;
};

export function inline(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(^|[^*\w])\*([^*]+)\*/g, "$1$2");
}

// A deliberately small renderer: OpenTUI's <markdown> needs a tree-sitter
// style to draw anything (VERIFIED.md T1), and pages only need structure.
export function markdownToLines(text: string): MdLine[] {
  const out: MdLine[] = [];
  let inCode = false;
  for (const raw of String(text ?? "").replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*```/.test(raw)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push({ kind: "code", text: raw });
      continue;
    }
    const line = raw.trimEnd();
    if (!line.trim()) {
      if (out.length && out[out.length - 1].kind !== "blank") out.push({ kind: "blank", text: "" });
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      const level = m[1].length;
      out.push({ kind: level === 1 ? "h1" : level === 2 ? "h2" : "h3", text: inline(m[2]) });
    } else if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push({ kind: "rule", text: "" });
    } else if ((m = line.match(/^(\s*)[-*+]\s+(.*)$/))) {
      out.push({ kind: "bullet", text: inline(m[2]), depth: Math.floor(m[1].length / 2) });
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      out.push({ kind: "quote", text: inline(m[1]) });
    } else {
      out.push({ kind: "body", text: inline(line.trim()) });
    }
  }
  return out;
}
