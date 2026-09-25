import type { ActionDef } from "../core/actions";
import type { CockpitSnapshot } from "../core/cockpit";
import { PAGE_INDEX } from "../core/pages";
import type { Command } from "../core/types";

export type PaletteAction = { kind: "command"; command: Command } | { kind: "ui"; ui: "toggle-agent" | "help" };
export type PaletteEntry = { id: string; label: string; hint?: string; action: PaletteAction };

function actionEntry(a: ActionDef): PaletteEntry {
  if (a.kind === "launch") return { id: `action:${a.id}`, label: a.label, action: { kind: "command", command: { type: "launch", host: a.host, placement: a.placement } } };
  return { id: `action:${a.id}`, label: a.label, action: { kind: "command", command: { type: "run-action", actionId: a.id } } };
}

export const launchEntries = (actions: ActionDef[]) => actions.filter((a) => a.kind === "launch").map(actionEntry);
export const actionEntries = (actions: ActionDef[]) => actions.filter((a) => a.kind !== "launch").map(actionEntry);

export function buildEntries(snap: Pick<CockpitSnapshot, "fleet">, actions: ActionDef[]): PaletteEntry[] {
  return [
    ...PAGE_INDEX.map((p) => ({ id: `page:${p.page}`, label: `Go to ${p.label}`, action: { kind: "command" as const, command: { type: "open-page" as const, ref: { page: p.page } } } })),
    ...snap.fleet.map((r) => ({
      id: `ws:${r.info.id}`,
      label: `Switch to ${r.summary?.name ?? r.info.label}`,
      hint: r.info.kind,
      action: { kind: "command" as const, command: { type: "select-workspace" as const, id: r.info.id } },
    })),
    ...actions.map(actionEntry),
    { id: "agent:new-session", label: "Agent: new session", action: { kind: "command", command: { type: "agent-new-session" } } },
    { id: "ui:agent", label: "Toggle agent pane", action: { kind: "ui", ui: "toggle-agent" } },
    { id: "ui:help", label: "Help", action: { kind: "ui", ui: "help" } },
  ];
}

// Case-insensitive subsequence match; consecutive runs and word starts score higher.
export function scoreEntry(label: string, q: string): number | null {
  const l = label.toLowerCase();
  const query = q.toLowerCase().replace(/\s+/g, "");
  if (!query) return 0;
  let score = 0;
  let from = 0;
  let prev = -2;
  for (const ch of query) {
    const i = l.indexOf(ch, from);
    if (i < 0) return null;
    score += i === prev + 1 ? 3 : 1;
    if (i === 0 || l[i - 1] === " ") score += 2;
    score -= Math.min(3, i - from);
    prev = i;
    from = i + 1;
  }
  return score;
}

export function filterEntries(entries: PaletteEntry[], q: string): PaletteEntry[] {
  if (!q.trim()) return entries;
  return entries
    .map((e, i) => ({ e, i, s: scoreEntry(e.label, q) }))
    .filter((x) => x.s !== null)
    .sort((a, b) => b.s! - a.s! || a.i - b.i)
    .map((x) => x.e);
}
