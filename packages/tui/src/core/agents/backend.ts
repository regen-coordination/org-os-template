import type { GateDecision, GateRequest } from "../gate";
import type { AgentEvent, WorkspaceInfo } from "../types";

export type GateLike = { check(req: GateRequest): Promise<GateDecision> };

export interface AgentSession {
  readonly id: string;
  readonly backend: "pi" | "claude" | "opencode";
  readonly model?: string;
  /** Resolves when the run settles. `display` is what the transcript shows (e.g. "/close"). */
  prompt(text: string, display?: string): Promise<void>;
  abort(): Promise<void>;
  subscribe(fn: (e: AgentEvent) => void): () => void;
  dispose(): Promise<void>;
}

export interface AgentBackend {
  readonly id: "pi" | "claude" | "opencode";
  available(): Promise<{ ok: true } | { ok: false; reason: string }>;
  open(opts: { workspace: WorkspaceInfo; resume: "continue" | "new"; gate: GateLike }): Promise<AgentSession>;
}
