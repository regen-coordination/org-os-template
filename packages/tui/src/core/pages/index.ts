import { join } from "node:path";
import type { PageData, PageRef } from "../types";
import type { LoadedWorkspace } from "../workspace";
import { fleetPage } from "./fleet";
import { workspacePages } from "./workspace-pages";
import { thisWeekPage } from "./this-week";
import { makePage, notice, type PageContext, type Resolver } from "./helpers";

export { makePage, notice } from "./helpers";
export type { FleetRow, PageContext, Resolver } from "./helpers";

export const PAGE_INDEX: { page: string; label: string }[] = [
  { page: "fleet", label: "Fleet" },
  { page: "dashboard", label: "Dashboard" },
  { page: "tasks", label: "Tasks" },
  { page: "projects", label: "Projects" },
  { page: "plans", label: "Plans" },
  { page: "decisions", label: "Decisions" },
  { page: "memory", label: "Memory" },
  { page: "this-week", label: "This week" },
];

const RESOLVERS: Record<string, Resolver> = {
  fleet: fleetPage,
  "this-week": thisWeekPage,
  ...workspacePages,
};

export function resolvePage(ref: PageRef, ctx: PageContext): PageData {
  const resolver = RESOLVERS[ref.page];
  if (!resolver) return makePage(ref, "Unknown page", [notice("error", `No page called "${ref.page}". Open the palette (ctrl+p) for the list.`)]);
  try {
    return resolver(ref, ctx);
  } catch (e) {
    return makePage(ref, ref.page, [notice("error", `This page failed to render: ${(e as Error).message}`)]);
  }
}

const SOURCES: Record<string, (ref: PageRef, ws: LoadedWorkspace) => string | null> = {
  dashboard: () => "HEARTBEAT.md",
  tasks: () => "HEARTBEAT.md",
  projects: () => "data/projects.yaml",
  project: () => "data/projects.yaml",
  decisions: () => "DECISIONS.md",
  decision: () => "DECISIONS.md",
  plans: (_r, ws) => ws.state?.queue?.path ?? null,
  memory: (r) => (r.id ? `memory/${r.id}.md` : null),
  "this-week": () => "data/events.yaml",
};

export function sourceFor(ref: PageRef, ws: LoadedWorkspace | null): string | null {
  if (!ws) return null;
  const rel = SOURCES[ref.page]?.(ref, ws) ?? null;
  return rel ? join(ws.info.root, rel) : null;
}
