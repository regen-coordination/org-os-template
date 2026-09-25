import { existsSync } from "node:fs";
import { Emitter } from "./bus";
import type { CockpitConfig, UiState } from "./config";
import { discoverFleet, pickActive } from "./fleet";
import { loadWorkspace as defaultLoad, summarize, watchWorkspace, type LoadedWorkspace } from "./workspace";
import { resolvePage, sourceFor, type FleetRow } from "./pages";
import { actionsFor, editorCommand, findAction, runScript as defaultRunScript, type ActionDef } from "./actions";
import { expandCommand, parseSlash } from "./commands";
import { Gate, type GuardFn } from "./gate";
import { detectLaunchEnv, launchHost as defaultLaunch, viableStrategies, type LaunchEnv } from "./launch";
import { integrationHints, mapAgentsToWorkspaces, type HerdrClient } from "./herdr";
import { reduceTranscript, type TranscriptEntry } from "./transcript";
import type { AgentBackend, AgentSession } from "./agents/backend";
import { run as defaultRun, type Runner } from "./proc";
import type {
  AgentEvent, AgentStatus, Command, ForegroundEffect, GitStatus, HerdrAgent, HostId, Notice, NoticeLevel,
  PageData, PageRef, PermissionRequest, Placement, WorkspaceInfo,
} from "./types";

export type CockpitSnapshot = {
  fleet: FleetRow[];
  activeId: string | null;
  activeName: string;
  activeGit: GitStatus | null;
  activeUrgent: number;
  page: PageData | null;
  canGoBack: boolean;
  transcript: TranscriptEntry[];
  agentStatus: AgentStatus;
  agentModel: string | null;
  agentAvailable: boolean;
  permissions: PermissionRequest[];
  herdr: { available: boolean; agents: number };
  loading: boolean;
};

export type CoreEvents = { state: CockpitSnapshot; notice: Notice };

export interface CockpitLike {
  events: Emitter<CoreEvents>;
  snapshot(): CockpitSnapshot;
  dispatch(cmd: Command): Promise<ForegroundEffect | void>;
  actions(): ActionDef[];
}

export type CockpitDeps = {
  frameworkRoot: string;
  invokedFrom: string;
  flags?: { workspace?: string; page?: string };
  config: CockpitConfig;
  uiState?: UiState;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  run?: Runner;
  backend?: AgentBackend | null;
  herdr?: HerdrClient | null;
  loadWorkspace?: typeof defaultLoad;
  watch?: typeof watchWorkspace | null;
  launch?: typeof defaultLaunch;
  launchEnv?: LaunchEnv;
  runScript?: typeof defaultRunScript;
  guard?: GuardFn;
  saveUiState?: (s: UiState) => void;
  git?: boolean;
};

const IDLE_POLL_PAUSE_MS = 10 * 60 * 1000;

function shellQuote(parts: string[]): string {
  return parts.map((p) => (/^[\w./:@=+-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`)).join(" ");
}

export class Cockpit implements CockpitLike {
  readonly events = new Emitter<CoreEvents>();
  readonly gate: Gate;
  private fleet: WorkspaceInfo[] = [];
  private activeId: string | null = null;
  private loaded = new Map<string, LoadedWorkspace>();
  private history = new Map<string, PageRef[]>();
  private page: PageData | null = null;
  private sessions = new Map<string, AgentSession>();
  private opening = new Map<string, Promise<AgentSession | null>>();
  private transcripts = new Map<string, TranscriptEntry[]>();
  private statuses = new Map<string, AgentStatus>();
  private models = new Map<string, string>();
  private permissions: PermissionRequest[] = [];
  private herdrAgents: HerdrAgent[] = [];
  private hints: string[] = [];
  private loading = false;
  private stopWatch: (() => void) | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastActivity = Date.now();
  private reportSeq = 0;
  private lastReported: string | null = null;
  private herdrWarned = false;
  private emitQueued = false;
  private stopped = false;

  constructor(private deps: CockpitDeps) {
    this.gate = new Gate({
      ask: (req) => this.onPermission(req),
      onSettle: (id) => {
        this.permissions = this.permissions.filter((p) => p.id !== id);
        this.updateReport();
        this.emitState();
      },
      ...(deps.guard ? { guard: deps.guard } : {}),
    });
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────
  async start(): Promise<void> {
    const { fleet, errors } = discoverFleet(this.deps.frameworkRoot, this.deps.config);
    this.fleet = fleet;
    errors.forEach((e) => this.notice("warn", e));
    this.activeId = pickActive(fleet, {
      invokedFrom: this.deps.invokedFrom,
      flag: this.deps.flags?.workspace,
      remembered: this.deps.uiState?.lastWorkspace,
    });
    this.loading = true;
    this.emitState();
    if (this.activeId) await this.activate(this.activeId, this.deps.flags?.page ? { page: this.deps.flags.page } : undefined);
    if (this.stopped) return;
    for (const w of this.fleet) {
      if (this.stopped) return;
      if (!this.loaded.has(w.id)) {
        await this.load(w.id);
        if (this.stopped) return;
        this.refreshPage();
        this.emitState();
      }
    }
    this.loading = false;
    if (this.deps.herdr) {
      await this.loadHints();
      if (this.stopped) return;
      await this.pollHerdr();
      if (this.stopped) return;
      this.startPolling();
    }
    this.refreshPage();
    this.emitState();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.stopWatch?.();
    this.gate.cancelAll("cockpit closed");
    for (const s of this.sessions.values()) await s.dispose().catch(() => {});
    this.sessions.clear();
    const paneId = this.env().HERDR_PANE_ID;
    if (this.deps.herdr && paneId && this.lastReported) await this.deps.herdr.releaseAgent({ paneId, seq: ++this.reportSeq }).catch(() => {});
  }

  // ── public surface ────────────────────────────────────────────────────────
  snapshot(): CockpitSnapshot {
    const id = this.activeId;
    const info = this.activeInfo();
    const ws = this.activeLoaded();
    const summary = ws ? summarize(ws) : null;
    return {
      fleet: this.fleetRows(),
      activeId: id,
      activeName: summary?.name ?? info?.label ?? "org-os",
      activeGit: ws?.git ?? null,
      activeUrgent: summary?.urgentTasks ?? 0,
      page: this.page,
      canGoBack: (id ? this.history.get(id)?.length ?? 0 : 0) > 1,
      transcript: id ? this.transcripts.get(id) ?? [] : [],
      agentStatus: id ? this.statuses.get(id) ?? "idle" : "idle",
      agentModel: id ? this.models.get(id) || null : null,
      agentAvailable: !!this.deps.backend,
      permissions: [...this.permissions],
      herdr: { available: !!this.deps.herdr, agents: this.herdrAgents.length },
      loading: this.loading,
    };
  }

  actions(): ActionDef[] {
    return actionsFor(this.activeLoaded() ?? null);
  }

  notice(level: NoticeLevel, text: string): void {
    if (this.stopped) return;
    this.events.emit("notice", { level, text });
  }

  async dispatch(cmd: Command): Promise<ForegroundEffect | void> {
    this.lastActivity = Date.now();
    switch (cmd.type) {
      case "select-workspace":
        if (this.fleet.some((w) => w.id === cmd.id)) await this.activate(cmd.id);
        return;
      case "open-page": {
        const { workspace, ...ref } = cmd.ref;
        if (ref.page === "herdr-agent") {
          if (ref.id && this.deps.herdr) await this.deps.herdr.focusAgent(ref.id).catch((e: Error) => this.notice("warn", `herdr: ${e.message}`));
          return;
        }
        if (workspace && workspace !== this.activeId) return void (await this.activate(workspace, ref));
        this.pushPage(ref);
        return;
      }
      case "back": {
        const hist = this.activeId ? this.history.get(this.activeId) : undefined;
        if (hist && hist.length > 1) {
          hist.pop();
          this.refreshPage();
          this.emitState();
        }
        return;
      }
      case "refresh":
        if (this.activeId) await this.reload(this.activeId);
        return;
      case "run-action":
        return this.runAction(cmd.actionId);
      case "launch":
        return this.launch(cmd.host, cmd.placement, cmd.paneCols ?? 160);
      case "agent-prompt": {
        const slash = parseSlash(cmd.text);
        if (slash) return this.dispatch({ type: "agent-command", name: slash.name, args: slash.args });
        void this.sendToAgent(cmd.text).catch((e) => this.notice("error", `agent: ${(e as Error).message}`));
        return;
      }
      case "agent-command": {
        const info = this.activeInfo();
        if (!info) return;
        const r = await expandCommand(info.root, cmd.name, cmd.args ?? "", { fallbackRoot: this.deps.frameworkRoot });
        if (!r.ok) return void this.notice("error", r.error);
        void this.sendToAgent(r.text, `/${cmd.name}${cmd.args ? ` ${cmd.args}` : ""}`).catch((e) =>
          this.notice("error", `agent: ${(e as Error).message}`),
        );
        return;
      }
      case "agent-abort": {
        const s = this.activeId ? this.sessions.get(this.activeId) : undefined;
        await s?.abort().catch(() => {});
        return;
      }
      case "agent-new-session":
        await this.newSession();
        return;
      case "permission-answer":
        this.gate.answer(cmd.id, cmd.answer);
        return;
    }
  }

  // ── workspaces & pages ────────────────────────────────────────────────────
  private env(): NodeJS.ProcessEnv {
    return this.deps.env ?? process.env;
  }
  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }
  private activeInfo(): WorkspaceInfo | undefined {
    return this.fleet.find((w) => w.id === this.activeId);
  }
  private activeLoaded(): LoadedWorkspace | undefined {
    return this.activeId ? this.loaded.get(this.activeId) : undefined;
  }

  private async load(id: string): Promise<void> {
    const info = this.fleet.find((w) => w.id === id);
    if (!info) return;
    const load = this.deps.loadWorkspace ?? defaultLoad;
    this.loaded.set(id, await load(info, { now: this.now(), run: this.deps.run, git: this.deps.git ?? true }));
  }

  private async reload(id: string): Promise<void> {
    await this.load(id);
    if (id === this.activeId) this.refreshPage();
    this.emitState();
  }

  private async activate(id: string, ref?: PageRef): Promise<void> {
    this.activeId = id;
    if (!this.loaded.has(id)) await this.load(id);
    if (this.stopped) return;
    const hist = this.history.get(id) ?? [];
    if (ref) hist.push(ref);
    else if (!hist.length) hist.push({ page: "dashboard" });
    this.history.set(id, hist);
    this.refreshPage();
    this.startWatch();
    this.deps.saveUiState?.({ ...(this.deps.uiState ?? {}), lastWorkspace: id });
    this.reportTitle();
    this.emitState();
  }

  private pushPage(ref: PageRef): void {
    if (!this.activeId) return;
    const hist = this.history.get(this.activeId) ?? [];
    hist.push(ref);
    this.history.set(this.activeId, hist);
    this.refreshPage();
    this.emitState();
  }

  private currentRef(): PageRef {
    const hist = this.activeId ? this.history.get(this.activeId) : undefined;
    return hist?.[hist.length - 1] ?? { page: "dashboard" };
  }

  private fleetRows(): FleetRow[] {
    const byWs = mapAgentsToWorkspaces(this.herdrAgents, this.fleet);
    return this.fleet.map((info) => {
      const ws = this.loaded.get(info.id);
      return { info, summary: ws ? summarize(ws) : null, agents: byWs[info.id] ?? [] };
    });
  }

  private refreshPage(): void {
    this.page = resolvePage(this.currentRef(), { ws: this.activeLoaded() ?? null, fleet: this.fleetRows(), now: this.now(), hints: this.hints });
  }

  private startWatch(): void {
    if (this.stopped) return;
    this.stopWatch?.();
    this.stopWatch = null;
    if (this.deps.watch === null) return;
    const info = this.activeInfo();
    if (!info?.exists) return;
    const watch = this.deps.watch ?? watchWorkspace;
    this.stopWatch = watch(info.root, () => {
      void this.reload(info.id).catch((e) => this.notice("error", `reload: ${(e as Error).message}`));
    });
  }

  private emitState(): void {
    if (this.stopped || this.emitQueued) return;
    this.emitQueued = true;
    queueMicrotask(() => {
      this.emitQueued = false;
      if (this.stopped) return;
      this.events.emit("state", this.snapshot());
    });
  }

  // ── agent ─────────────────────────────────────────────────────────────────
  private ensureSession(id: string, resume: "continue" | "new"): Promise<AgentSession | null> {
    const existing = this.sessions.get(id);
    if (existing) return Promise.resolve(existing);
    const inflight = this.opening.get(id);
    if (inflight) return inflight;
    const info = this.fleet.find((w) => w.id === id);
    const backend = this.deps.backend;
    if (!backend) {
      this.notice("warn", "No agent backend in this mode.");
      return Promise.resolve(null);
    }
    if (!info?.exists) {
      this.notice("warn", "This workspace is missing on disk.");
      return Promise.resolve(null);
    }
    const p = backend
      .open({ workspace: info, resume, gate: this.gate })
      .then((session) => {
        if (this.stopped) {
          void session.dispose().catch(() => {});
          return null;
        }
        this.sessions.set(id, session);
        this.models.set(id, session.model ?? "");
        session.subscribe((e) => this.onAgentEvent(id, e));
        return session;
      })
      .catch((e) => {
        this.onAgentEvent(id, { type: "notice", level: "error", text: `Could not start pi: ${(e as Error).message}` });
        this.onAgentEvent(id, { type: "status", status: "error" });
        return null;
      })
      .finally(() => this.opening.delete(id));
    this.opening.set(id, p);
    return p;
  }

  private async sendToAgent(text: string, display?: string): Promise<void> {
    const id = this.activeId;
    if (!id) return;
    const session = await this.ensureSession(id, "continue");
    if (!session || this.stopped) return;
    await session.prompt(text, display);
  }

  private async newSession(): Promise<void> {
    const id = this.activeId;
    if (!id) return;
    const old = this.sessions.get(id);
    this.sessions.delete(id);
    await old?.dispose().catch(() => {});
    this.transcripts.set(id, []);
    this.statuses.set(id, "idle");
    this.permissions.filter((p) => p.workspace === id).forEach((p) => this.gate.answer(p.id, "deny"));
    this.gate.resetSession(id);
    this.updateReport();
    await this.ensureSession(id, "new");
    this.emitState();
  }

  private onAgentEvent(id: string, e: AgentEvent): void {
    this.transcripts.set(id, reduceTranscript(this.transcripts.get(id) ?? [], e));
    if (e.type === "status") {
      this.statuses.set(id, e.status);
      this.updateReport();
      if (e.status === "idle") void this.reload(id).catch((err) => this.notice("error", `reload: ${(err as Error).message}`));
    }
    this.emitState();
  }

  private onPermission(req: PermissionRequest): void {
    this.permissions.push(req);
    this.updateReport();
    const label = this.fleet.find((w) => w.id === req.workspace)?.label ?? req.workspace;
    this.deps.herdr?.notify({ title: "org-os: approval needed", body: `${req.tool} in ${label}`, sound: "request" }).catch(() => {});
    this.emitState();
  }

  // ── herdr ─────────────────────────────────────────────────────────────────
  private updateReport(): void {
    const herdr = this.deps.herdr;
    const paneId = this.env().HERDR_PANE_ID;
    if (!herdr || !paneId) return;
    const working = [...this.statuses.values()].some((s) => s === "working");
    const state = this.permissions.length ? "blocked" : working ? "working" : "idle";
    if (state === this.lastReported) return;
    this.lastReported = state;
    herdr.reportAgent({ paneId, state, seq: ++this.reportSeq }).catch(() => {});
  }

  private reportTitle(): void {
    const herdr = this.deps.herdr;
    const paneId = this.env().HERDR_PANE_ID;
    const info = this.activeInfo();
    if (!herdr || !paneId || !info) return;
    herdr.reportTitle({ paneId, title: `org-os · ${info.label}` }).catch(() => {});
  }

  private async loadHints(): Promise<void> {
    try {
      this.hints = integrationHints(await this.deps.herdr!.integrationStatus());
    } catch {
      this.hints = [];
    }
  }

  private async pollHerdr(): Promise<void> {
    if (!this.deps.herdr) return;
    try {
      this.herdrAgents = await this.deps.herdr.listAgents();
    } catch (e) {
      this.herdrAgents = [];
      if (!this.herdrWarned) {
        this.herdrWarned = true;
        this.notice("warn", `herdr unavailable: ${(e as Error).message}`);
      }
    }
    this.refreshPage();
    this.emitState();
  }

  private startPolling(): void {
    if (this.stopped || !this.deps.config.herdr.poll || this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      if (this.stopped) return;
      if (Date.now() - this.lastActivity > IDLE_POLL_PAUSE_MS) return;
      void this.pollHerdr().catch((e) => this.notice("error", `herdr poll: ${(e as Error).message}`));
    }, this.deps.config.herdr.pollMs);
  }

  // ── actions & launch ──────────────────────────────────────────────────────
  private async runAction(actionId: string): Promise<ForegroundEffect | void> {
    const ws = this.activeLoaded() ?? null;
    const action = findAction(actionsFor(ws), actionId);
    if (!action) return void this.notice("error", `Unknown or unavailable action: ${actionId}`);
    switch (action.kind) {
      case "script": {
        this.notice("info", `Running npm run ${action.script}…`);
        const r = await (this.deps.runScript ?? defaultRunScript)(ws!.info.root, action.script, this.deps.run ?? defaultRun);
        const tail = r.output.split("\n").filter(Boolean).at(-1);
        this.notice(r.ok ? "info" : "error", `npm run ${action.script} ${r.ok ? "finished" : "failed"}${tail ? `: ${tail}` : ""}`);
        if (r.ok) await this.reload(ws!.info.id);
        return;
      }
      case "agent":
        return this.dispatch({ type: "agent-command", name: action.command });
      case "launch":
        return this.launch(action.host, action.placement, 160);
      case "open":
        return this.openSource();
    }
  }

  private async openSource(): Promise<ForegroundEffect | void> {
    const ws = this.activeLoaded() ?? null;
    const file = sourceFor(this.currentRef(), ws);
    if (!ws || !file || !existsSync(file)) return void this.notice("warn", "This page has no source file to open.");
    const { cmd, args } = editorCommand(this.env(), file);
    const herdr = this.deps.herdr;
    if (herdr && this.env().HERDR_ENV === "1") {
      try {
        const paneId = await herdr.splitPane({ cwd: ws.info.root, direction: "right" });
        await herdr.runInPane(paneId, shellQuote([cmd, ...args]));
        return;
      } catch (e) {
        this.notice("warn", `herdr split failed (${(e as Error).message}); opening here instead`);
      }
    }
    return { type: "foreground", cmd, args, cwd: ws.info.root };
  }

  private async launch(host: HostId, placement: Placement, paneCols: number): Promise<ForegroundEffect | void> {
    const info = this.activeInfo();
    if (!info?.exists) return void this.notice("warn", "Select an existing workspace to launch into.");
    const le = this.deps.launchEnv ?? detectLaunchEnv(this.env());
    const strategies = viableStrategies(le, this.deps.config.launch.prefer);
    const takenNames = this.herdrAgents.map((a) => a.name).filter((n): n is string => !!n);
    const outcome = await (this.deps.launch ?? defaultLaunch)(
      { host, placement, cwd: info.root, wsId: info.id, paneCols, takenNames },
      { le, strategies, run: this.deps.run ?? defaultRun, herdr: this.deps.herdr ?? null },
    );
    if ("foreground" in outcome) return outcome.foreground;
    if (outcome.ok) {
      this.notice("info", `Launched ${host}: ${outcome.detail}`);
      void this.pollHerdr().catch((e) => this.notice("error", `herdr poll: ${(e as Error).message}`));
    } else {
      this.notice("error", `Could not launch ${host}: ${outcome.error}`);
    }
  }
}
