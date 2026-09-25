import type { Block, HerdrAgent, PageData, PageRef, WorkspaceInfo, WorkspaceSummary } from "../types";
import type { LoadedWorkspace } from "../workspace";

export type FleetRow = { info: WorkspaceInfo; summary: WorkspaceSummary | null; agents: HerdrAgent[] };
export type PageContext = { ws: LoadedWorkspace | null; fleet: FleetRow[]; now: Date; hints: string[] };
export type Resolver = (ref: PageRef, ctx: PageContext) => PageData;

export function makePage(ref: PageRef, title: string, blocks: Block[], extra: Partial<PageData> = {}): PageData {
  return { ref, title, blocks, actions: [], sources: [], errors: [], ...extra };
}

export function notice(level: "info" | "warn" | "error", text: string): Block {
  return { kind: "notice", level, text };
}
