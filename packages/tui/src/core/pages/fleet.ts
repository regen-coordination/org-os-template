import type { PageData, PageRef } from "../types";
import { makePage, notice, type PageContext } from "./helpers";

export function fleetPage(ref: PageRef, ctx: PageContext): PageData {
  const rows = ctx.fleet.map(({ info, summary, agents }) => {
    const git = summary?.git;
    return {
      key: info.id,
      cells: [
        info.exists ? summary?.name ?? info.label : `${info.label} (missing)`,
        info.kind,
        git ? `${git.branch ?? "?"}${git.dirty ? " ●" : ""}` : "—",
        summary ? `${summary.openTasks}/${summary.urgentTasks}` : "—",
        summary?.lastMemory ?? "—",
        agents.length ? agents.map((a) => `${a.agent ?? "agent"}:${a.status}`).join(" ") : "—",
      ],
      target: { page: "dashboard", workspace: info.id },
    };
  });
  const blocks: PageData["blocks"] = [
    { kind: "table", columns: ["Workspace", "Kind", "Branch", "Open/Urgent", "Memory", "Agents"], rows },
  ];
  const missing = ctx.fleet.filter((r) => !r.info.exists);
  if (missing.length) blocks.push(notice("warn", `${missing.length} workspace(s) not found on disk: ${missing.map((m) => m.info.label).join(", ")}`));
  const live = ctx.fleet.flatMap((r) => r.agents.map((a) => ({ a, ws: r.info.label })));
  if (live.length) {
    blocks.push({
      kind: "list",
      heading: "herdr agents",
      items: live.map(({ a, ws }) => ({ key: a.paneId, label: `${a.name ?? a.agent ?? "agent"} · ${a.status}`, detail: ws, badge: a.agent ?? undefined, target: { page: "herdr-agent", id: a.paneId } })),
    });
  }
  const drifting = ctx.fleet.filter((r) => r.info.drift > 0);
  if (drifting.length) blocks.push(notice("info", `Drift reported for ${drifting.map((d) => `${d.info.label} (${d.info.drift})`).join(", ")}`));
  for (const hint of ctx.hints) blocks.push(notice("info", hint));
  return makePage(ref, "Fleet", blocks, { subtitle: `${ctx.fleet.length} workspaces` });
}
