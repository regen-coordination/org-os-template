import type { Focus } from "./keys";

export type Layout = { showRail: boolean; rail: number; agent: number; agentOverlay: boolean };

export function computeLayout(width: number, agentOpen: boolean): Layout {
  if (width >= 140) return { showRail: true, rail: 26, agent: agentOpen ? Math.max(40, Math.floor(width * 0.34)) : 0, agentOverlay: false };
  if (width >= 100) return { showRail: true, rail: 24, agent: agentOpen ? Math.floor(width * 0.5) : 0, agentOverlay: agentOpen };
  return { showRail: false, rail: 0, agent: agentOpen ? width : 0, agentOverlay: agentOpen };
}

export function regionsFor(layout: Layout, agentOpen: boolean): Focus[] {
  return [...(layout.showRail ? (["rail"] as Focus[]) : []), "page", ...(agentOpen ? (["agent"] as Focus[]) : [])];
}
