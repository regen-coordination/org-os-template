import type { TranscriptEntry } from "../core/transcript";
import { displayWidth } from "./format";

export type TLine = { text: string; style: "user" | "assistant" | "tool-running" | "tool-ok" | "tool-error" | "info" | "warn" | "error" | "dim" };

export function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    if (!para) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of para.split(/\s+/)) {
      let w = word;
      while (displayWidth(w) > width) {
        if (line) {
          out.push(line);
          line = "";
        }
        out.push(w.slice(0, width));
        w = w.slice(width);
      }
      if (!w) continue;
      const candidate = line ? `${line} ${w}` : w;
      if (displayWidth(candidate) > width) {
        out.push(line);
        line = w;
      } else line = candidate;
    }
    if (line) out.push(line);
  }
  return out;
}

export function transcriptLines(entries: TranscriptEntry[], width: number): TLine[] {
  const w = Math.max(10, width);
  const out: TLine[] = [];
  for (const e of entries) {
    switch (e.kind) {
      case "user":
        wrap(e.text, w - 2).forEach((l, i) => out.push({ text: `${i ? "  " : "› "}${l}`, style: "user" }));
        break;
      case "assistant": {
        const lines = wrap(e.text + (e.streaming ? "▍" : ""), w);
        lines.forEach((l) => out.push({ text: l, style: "assistant" }));
        break;
      }
      case "tool": {
        const mark = e.status === "running" ? "…" : e.status === "ok" ? "✓" : "✗";
        out.push({ text: `${mark} ${e.tool} ${e.summary}`.slice(0, w * 2), style: e.status === "running" ? "tool-running" : e.status === "ok" ? "tool-ok" : "tool-error" });
        if (e.status === "error" && e.result) out.push({ text: `  ${e.result}`, style: "dim" });
        break;
      }
      case "notice":
        wrap(e.text, w - 2).forEach((l, i) => out.push({ text: `${i ? "  " : e.level === "error" ? "✗ " : e.level === "warn" ? "! " : "· "}${l}`, style: e.level }));
        break;
    }
  }
  return out;
}
