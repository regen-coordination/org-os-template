import { For } from "solid-js";
import type { FleetRow } from "../core/pages";
import { padLine } from "./format";
import { theme } from "./theme";

const MARK: Record<string, string> = { hub: "H", framework: "F", instance: "·", extra: "+" };

export function Rail(props: { rows: FleetRow[]; activeId: string | null; index: number; focused: boolean; width: number }) {
  return (
    <box flexDirection="column" width={props.width} height="100%" border borderColor={props.focused ? theme.borderFocus : theme.border} title="FLEET">
      <For each={props.rows}>
        {(row, i) => {
          const label = () => `${MARK[row.info.kind] ?? "·"} ${i() < 9 ? i() + 1 : " "} ${row.summary?.name ?? row.info.label}`;
          const badges = () =>
            [row.summary?.urgentTasks ? `${row.summary.urgentTasks}!` : "", !row.info.exists ? "missing" : row.info.drift ? "drift" : "", row.agents.length ? `◆${row.agents.length}` : ""]
              .filter(Boolean)
              .join(" ");
          const color = () => (row.info.id === props.activeId ? theme.accent : row.info.exists ? theme.fg : theme.dim);
          return (
            <text fg={color()} bg={props.focused && i() === props.index ? theme.selBg : undefined}>
              {padLine(label(), badges(), props.width - 2)}
            </text>
          );
        }}
      </For>
    </box>
  );
}
