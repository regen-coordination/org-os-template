import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  hasTrustRequiringProjectResources,
  ProjectTrustStore,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { summarizeTool } from "../gate";
import type { AgentEvent, WorkspaceInfo } from "../types";
import { firstLine } from "../util";
import type { AgentBackend, AgentSession, GateLike } from "./backend";

export function piPackageResources(pkgDir: string): { extensions: string[]; skills: string[]; prompts: string[] } {
  let manifest: any;
  try {
    manifest = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).pi ?? {};
  } catch {
    return { extensions: [], skills: [], prompts: [] };
  }
  const abs = (p: string) => join(pkgDir, p);
  return {
    extensions: (manifest.extensions ?? []).map(abs),
    skills: (manifest.skills ?? []).map(abs),
    prompts: [...new Set<string>((manifest.prompts ?? []).map((p: string) => (p.includes("*") ? abs(dirname(p)) : abs(p))))],
  };
}

export function piIntegrationDir(frameworkRoot: string): string | null {
  const dir = join(frameworkRoot, "packages", "pi-integration");
  return existsSync(join(dir, "package.json")) ? dir : null;
}

// `trusted` mirrors Pi's own project-trust gate (settings-manager.js:195-197): an
// untrusted project's .pi/settings.json is never consulted, so we always add the
// workspace skills ourselves in that case. Defaults to true so existing callers
// that don't care about trust (e.g. this module's own tests) keep prior behaviour.
export function extraSkillPaths(root: string, trusted = true): string[] {
  const skills = join(root, "skills");
  if (!existsSync(skills)) return [];
  if (trusted) {
    try {
      const settings = JSON.parse(readFileSync(join(root, ".pi", "settings.json"), "utf8"));
      if (Array.isArray(settings.skills) && settings.skills.some((s: unknown) => typeof s === "string" && s.replace(/\/$/, "") === "../skills")) return [];
    } catch {
      // no project settings: add the workspace skills ourselves
    }
  }
  return [skills];
}

export function assistantText(message: any): string {
  const c = message?.content;
  if (typeof c === "string") return c;
  if (!Array.isArray(c)) return "";
  return c.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("");
}

export function resultSummary(result: any): string {
  const text = Array.isArray(result?.content) ? result.content.find((c: any) => c?.type === "text")?.text : typeof result === "string" ? result : "";
  return firstLine(text ?? "", 80);
}

export function mapPiEvent(e: any): AgentEvent[] {
  switch (e?.type) {
    case "agent_start":
      return [{ type: "status", status: "working" }];
    case "agent_settled":
      return [{ type: "status", status: "idle" }];
    case "message_update":
      return e.assistantMessageEvent?.type === "text_delta" ? [{ type: "text_delta", delta: String(e.assistantMessageEvent.delta ?? "") }] : [];
    case "message_end": {
      const m = e.message;
      if (m?.role !== "assistant") return [];
      const out: AgentEvent[] = [{ type: "assistant_end", text: assistantText(m) }];
      if (m.stopReason === "error" || m.errorMessage) out.push({ type: "notice", level: "error", text: `pi: ${m.errorMessage ?? "model error"}` });
      return out;
    }
    case "tool_execution_start":
      return [{ type: "tool_start", callId: String(e.toolCallId), tool: String(e.toolName), summary: summarizeTool(String(e.toolName), e.args ?? {}) }];
    case "tool_execution_end":
      return [{ type: "tool_end", callId: String(e.toolCallId), ok: !e.isError, summary: resultSummary(e.result) }];
    default:
      return [];
  }
}

// The cockpit's inline Pi extension: every tool call goes through the gate
// (fail-closed guard, then operator approval). A throwing handler also blocks —
// Pi's own fail-safe (VERIFIED.md T2).
export function cockpitExtension(opts: { gate: GateLike; workspace: WorkspaceInfo }) {
  return (pi: any) => {
    pi.on("tool_call", async (event: any) => {
      const decision = await opts.gate.check({
        workspace: opts.workspace.id,
        root: opts.workspace.root,
        tool: String(event.toolName),
        input: (event.input ?? {}) as Record<string, unknown>,
      });
      return decision.allow ? undefined : { block: true, reason: decision.reason };
    });
  };
}

class PiAgentSession implements AgentSession {
  readonly backend = "pi" as const;
  private listeners = new Set<(e: AgentEvent) => void>();
  private buffer: AgentEvent[] = [];
  // Serializes prompt() calls: Pi's own session.prompt() rejects when called
  // while a run is already streaming, and session.followUp() resolves as soon
  // as the message is queued rather than when the run it belongs to settles.
  // Each prompt() call chains onto this so a later call always starts its own
  // fresh session.prompt() only after the previous run has fully settled, and
  // its own returned promise resolves only when ITS run settles.
  private queue: Promise<void> = Promise.resolve();

  constructor(private session: any) {
    session.subscribe((raw: any) => {
      for (const e of mapPiEvent(raw)) this.emit(e);
    });
  }

  get id(): string {
    return String(this.session.sessionId ?? "pi");
  }

  get model(): string | undefined {
    const m = this.session.model;
    return m ? `${m.provider}/${m.id}` : undefined;
  }

  emit(e: AgentEvent): void {
    if (!this.listeners.size) {
      this.buffer.push(e);
      return;
    }
    for (const fn of [...this.listeners]) fn(e);
  }

  subscribe(fn: (e: AgentEvent) => void): () => void {
    this.listeners.add(fn);
    const pending = this.buffer;
    this.buffer = [];
    for (const e of pending) fn(e);
    return () => {
      this.listeners.delete(fn);
    };
  }

  async prompt(text: string, display?: string): Promise<void> {
    this.emit({ type: "user", text: display ?? text });
    // Chain onto the queue synchronously so a second prompt() called before the
    // first has even started still waits behind it — never races Pi's own
    // "already processing" guard.
    const run = this.queue.then(() => this.runPrompt(text));
    this.queue = run;
    return run;
  }

  private async runPrompt(text: string): Promise<void> {
    try {
      await this.session.prompt(text);
    } catch (e) {
      const msg = (e as Error).message;
      this.emit({ type: "notice", level: "error", text: `pi: ${msg}` });
      this.emit({ type: "status", status: "error", detail: msg });
    }
  }

  async abort(): Promise<void> {
    await this.session.abort();
  }

  async dispose(): Promise<void> {
    this.session.dispose();
    this.listeners.clear();
  }
}

export type PiBackendOptions = {
  frameworkRoot: string;
  agentDir?: string;
  persistent?: boolean;
  model?: unknown;
  // Typed (not `unknown`): open() reads .isProjectTrusted() off whichever
  // instance ends up in play, whether supplied here (tests) or built internally.
  settingsManager?: SettingsManager;
  extraFactories?: ((pi: any) => void)[];
};

// Mirrors Pi's own CLI trust resolution (main.js: the non-interactive branch of
// createRuntime's projectTrusted computation) without the interactive prompt:
// fail closed to untrusted whenever the workspace has trust-requiring resources
// and the operator hasn't explicitly trusted it via `pi` itself.
function resolveProjectTrust(cwd: string, agentDir: string): boolean {
  return !hasTrustRequiringProjectResources(cwd) || new ProjectTrustStore(agentDir).get(cwd) === true;
}

export function piBackend(opts: PiBackendOptions): AgentBackend {
  return {
    id: "pi",
    async available() {
      return { ok: true };
    },
    async open({ workspace, resume, gate }) {
      const cwd = workspace.root;
      const agentDir = opts.agentDir ?? getAgentDir();
      const pkg = piIntegrationDir(opts.frameworkRoot);
      const res = pkg ? piPackageResources(pkg) : { extensions: [], skills: [], prompts: [] };
      // One SettingsManager instance, shared by the loader and the session, so
      // project trust is computed exactly once and both agree on it. When a
      // caller supplies its own (tests), that instance's trust decision wins.
      const settingsManager = opts.settingsManager ?? SettingsManager.create(cwd, agentDir, { projectTrusted: resolveProjectTrust(cwd, agentDir) });
      const trusted = settingsManager.isProjectTrusted();
      const loader = new DefaultResourceLoader({
        cwd,
        agentDir,
        settingsManager,
        additionalExtensionPaths: res.extensions,
        additionalSkillPaths: [...res.skills, ...extraSkillPaths(cwd, trusted)],
        additionalPromptTemplatePaths: res.prompts,
        extensionFactories: [...(opts.extraFactories ?? []), cockpitExtension({ gate, workspace })],
      });
      await loader.reload();
      const sessionManager =
        opts.persistent === false ? SessionManager.inMemory(cwd) : resume === "new" ? SessionManager.create(cwd) : SessionManager.continueRecent(cwd);
      const { session, modelFallbackMessage } = await createAgentSession({
        cwd,
        agentDir,
        resourceLoader: loader,
        sessionManager,
        settingsManager,
        ...(opts.model ? { model: opts.model as any } : {}),
      });
      const wrapped = new PiAgentSession(session);
      if (!pkg) wrapped.emit({ type: "notice", level: "info", text: "org-os Pi tools aren't installed yet (pi-harness not landed). The vault guard and approvals still apply." });
      if (modelFallbackMessage) wrapped.emit({ type: "notice", level: "warn", text: `pi: ${modelFallbackMessage}` });
      if (!trusted && existsSync(join(cwd, ".pi"))) {
        wrapped.emit({ type: "notice", level: "info", text: "This workspace's .pi/ resources load only after you trust it in Pi itself (run `pi` there once)." });
      }
      return wrapped;
    },
  };
}
