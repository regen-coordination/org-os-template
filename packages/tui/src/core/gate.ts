// @ts-ignore — plain .mjs without types
import { runGuard } from "../../../harness-kit/guard-bridge.mjs";
import type { PermissionAnswer, PermissionRequest } from "./types";
import { firstLine } from "./util";

export const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);
export const SHELL_TOOLS = new Set(["bash", "powershell"]);
export const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;

export type GateRequest = { workspace: string; root: string; tool: string; input: Record<string, unknown> };
export type GateDecision = { allow: true } | { allow: false; reason: string };
export type GuardFn = (command: string, root: string) => { allow: boolean; reason?: string };

export function summarizeTool(tool: string, input: Record<string, unknown>): string {
  const pick = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : null);
  const primary = pick("command") ?? pick("path") ?? pick("file_path") ?? pick("pattern");
  return firstLine(primary ?? JSON.stringify(input), 80);
}

type Pending = { request: PermissionRequest; resolve: (d: GateDecision) => void; timer: ReturnType<typeof setTimeout> };

export class Gate {
  private sessionAllow = new Map<string, Set<string>>();
  private waiting = new Map<string, Pending>();
  private ask: (r: PermissionRequest) => void;
  private guard: GuardFn;
  private timeoutMs: number;
  private newId: () => string;
  private onSettle: (id: string) => void;

  constructor(opts: { ask: (r: PermissionRequest) => void; guard?: GuardFn; timeoutMs?: number; newId?: () => string; onSettle?: (id: string) => void }) {
    this.ask = opts.ask;
    this.onSettle = opts.onSettle ?? (() => {});
    this.guard = opts.guard ?? ((cmd, root) => runGuard(cmd, root));
    this.timeoutMs = opts.timeoutMs ?? APPROVAL_TIMEOUT_MS;
    this.newId = opts.newId ?? (() => crypto.randomUUID());
  }

  async check(req: GateRequest): Promise<GateDecision> {
    if (SHELL_TOOLS.has(req.tool)) {
      const command = typeof req.input.command === "string" ? req.input.command : "";
      let verdict: { allow: boolean; reason?: string };
      try {
        verdict = this.guard(command, req.root);
      } catch (e) {
        return { allow: false, reason: `org-os vault guard failed (${(e as Error).message}); blocking fail-closed` };
      }
      if (!verdict.allow) return { allow: false, reason: verdict.reason ?? "blocked by org-os vault guard" };
    }
    if (READ_ONLY_TOOLS.has(req.tool)) return { allow: true };
    if (this.sessionAllow.get(req.workspace)?.has(req.tool)) return { allow: true };
    return this.askOperator(req);
  }

  private askOperator(req: GateRequest): Promise<GateDecision> {
    const request: PermissionRequest = { id: this.newId(), workspace: req.workspace, tool: req.tool, summary: summarizeTool(req.tool, req.input), input: req.input };
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!this.waiting.delete(request.id)) return;
        resolve({ allow: false, reason: `no answer from the operator within ${Math.round(this.timeoutMs / 60000)} min — denied` });
        this.onSettle(request.id);
      }, this.timeoutMs);
      this.waiting.set(request.id, { request, resolve, timer });
      this.ask(request);
    });
  }

  answer(id: string, answer: PermissionAnswer): boolean {
    const p = this.waiting.get(id);
    if (!p) return false;
    this.waiting.delete(id);
    clearTimeout(p.timer);
    if (answer === "deny") {
      p.resolve({ allow: false, reason: "denied by the operator" });
      this.onSettle(id);
      return true;
    }
    if (answer === "session") {
      const set = this.sessionAllow.get(p.request.workspace) ?? new Set<string>();
      set.add(p.request.tool);
      this.sessionAllow.set(p.request.workspace, set);
    }
    p.resolve({ allow: true });
    this.onSettle(id);
    return true;
  }

  pending(): PermissionRequest[] {
    return [...this.waiting.values()].map((p) => p.request);
  }

  resetSession(workspace: string): void {
    this.sessionAllow.delete(workspace);
  }

  cancelAll(reason: string): void {
    for (const [id, p] of this.waiting) {
      clearTimeout(p.timer);
      this.waiting.delete(id);
      p.resolve({ allow: false, reason });
      this.onSettle(id);
    }
  }
}
