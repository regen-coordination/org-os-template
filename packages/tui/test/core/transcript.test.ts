import { test, expect } from "bun:test";
import { reduceTranscript, TRANSCRIPT_LIMIT, type TranscriptEntry } from "../../src/core/transcript";
import type { AgentEvent } from "../../src/core/types";

const run = (events: AgentEvent[]) => events.reduce<TranscriptEntry[]>(reduceTranscript, []);

test("streams, finalizes, tracks tools, ignores status", () => {
  expect(run([
    { type: "user", text: "hi" },
    { type: "status", status: "working" },
    { type: "text_delta", delta: "Hel" },
    { type: "text_delta", delta: "lo" },
    { type: "assistant_end", text: "Hello" },
    { type: "tool_start", callId: "c1", tool: "bash", summary: "ls" },
    { type: "tool_end", callId: "c1", ok: false, summary: "blocked" },
    { type: "assistant_end", text: "" },
    { type: "notice", level: "error", text: "boom" },
  ])).toEqual([
    { kind: "user", text: "hi" },
    { kind: "assistant", text: "Hello", streaming: false },
    { kind: "tool", callId: "c1", tool: "bash", summary: "ls", status: "error", result: "blocked" },
    { kind: "notice", level: "error", text: "boom" },
  ]);
});

test("caps length", () => {
  const events: AgentEvent[] = Array.from({ length: TRANSCRIPT_LIMIT + 10 }, (_, i) => ({ type: "user", text: String(i) }));
  const out = run(events);
  expect(out.length).toBe(TRANSCRIPT_LIMIT);
  expect(out[0]).toEqual({ kind: "user", text: "10" });
});
