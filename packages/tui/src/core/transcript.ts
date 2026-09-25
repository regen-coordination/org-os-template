import type { AgentEvent, NoticeLevel } from "./types";

export type TranscriptEntry =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; streaming: boolean }
  | { kind: "tool"; callId: string; tool: string; summary: string; status: "running" | "ok" | "error"; result?: string }
  | { kind: "notice"; level: NoticeLevel; text: string };

export const TRANSCRIPT_LIMIT = 500;

const cap = (entries: TranscriptEntry[]) => (entries.length > TRANSCRIPT_LIMIT ? entries.slice(entries.length - TRANSCRIPT_LIMIT) : entries);

export function reduceTranscript(entries: TranscriptEntry[], e: AgentEvent): TranscriptEntry[] {
  const last = entries[entries.length - 1];
  switch (e.type) {
    case "user":
      return cap([...entries, { kind: "user", text: e.text }]);
    case "text_delta":
      if (last?.kind === "assistant" && last.streaming) return [...entries.slice(0, -1), { ...last, text: last.text + e.delta }];
      return cap([...entries, { kind: "assistant", text: e.delta, streaming: true }]);
    case "assistant_end":
      if (last?.kind === "assistant" && last.streaming) return [...entries.slice(0, -1), { kind: "assistant", text: e.text || last.text, streaming: false }];
      return e.text ? cap([...entries, { kind: "assistant", text: e.text, streaming: false }]) : entries;
    case "tool_start":
      return cap([...entries, { kind: "tool", callId: e.callId, tool: e.tool, summary: e.summary, status: "running" }]);
    case "tool_end":
      return entries.map((x) => (x.kind === "tool" && x.callId === e.callId ? { ...x, status: e.ok ? "ok" : "error", result: e.summary } : x));
    case "notice":
      return cap([...entries, { kind: "notice", level: e.level, text: e.text }]);
    default:
      return entries;
  }
}
