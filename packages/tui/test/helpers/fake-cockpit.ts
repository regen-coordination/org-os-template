import { Emitter } from "../../src/core/bus";
import { actionsFor } from "../../src/core/actions";
import type { CockpitLike, CockpitSnapshot, CoreEvents } from "../../src/core/cockpit";
import type { Command } from "../../src/core/types";

export function baseSnapshot(over: Partial<CockpitSnapshot> = {}): CockpitSnapshot {
  const row = (id: string, label: string, kind: any, extra: any = {}) => ({
    info: { id, label, root: `/v/${id}`, kind, exists: true, drift: 0 },
    summary: { id, name: label, type: null, git: { branch: "main", dirty: false, ahead: 0, behind: 0, lastCommit: null }, openTasks: 3, urgentTasks: 1, lastMemory: "2026-09-24", errors: [] },
    agents: [],
    ...extra,
  });
  return {
    fleet: [
      row("hub", "🧬 LF Hub", "hub"),
      row("fw", "org-os", "framework"),
      row("inst-a", "ReFi BCN", "instance", { agents: [{ paneId: "w1:p2", workspaceId: "w1", name: "bcn-claude", agent: "claude", status: "working", cwd: "/v/inst-a", title: null }] }),
    ],
    activeId: "hub",
    activeName: "🧬 LF Hub",
    activeGit: { branch: "main", dirty: true, ahead: 0, behind: 0, lastCommit: "1 hour ago" },
    activeUrgent: 1,
    page: {
      ref: { page: "dashboard" },
      title: "LF Hub",
      subtitle: "hub",
      actions: [],
      sources: [],
      errors: [],
      blocks: [
        { kind: "list", heading: "Urgent", items: [{ key: "a", label: "Pay invoices", target: { page: "tasks" } }, { key: "b", label: "Grant report", badge: "2d", target: { page: "this-week" } }] },
        { kind: "table", heading: "Projects", columns: ["Project", "Stage"], rows: [{ key: "c", cells: ["Cockpit", "Develop"], target: { page: "project", id: "cockpit" } }] },
      ],
    },
    canGoBack: false,
    transcript: [{ kind: "user", text: "status?" }, { kind: "assistant", text: "All green.", streaming: false }],
    agentStatus: "idle",
    agentModel: "anthropic/claude-opus-5",
    agentAvailable: true,
    permissions: [],
    herdr: { available: true, agents: 1 },
    loading: false,
    ...over,
  };
}

export function fakeCockpit(over: Partial<CockpitSnapshot> = {}) {
  const events = new Emitter<CoreEvents>();
  const dispatched: Command[] = [];
  let snap = baseSnapshot(over);
  const cockpit: CockpitLike = {
    events,
    snapshot: () => snap,
    dispatch: async (c) => {
      dispatched.push(c);
    },
    actions: () => actionsFor(null),
  };
  return {
    cockpit,
    dispatched,
    set(next: Partial<CockpitSnapshot>) {
      snap = { ...snap, ...next };
      events.emit("state", snap);
    },
  };
}
