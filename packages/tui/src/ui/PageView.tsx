import { For } from "solid-js";
import type { PageData } from "../core/types";
import { truncate } from "./format";
import type { LineStyle, PageLine } from "./page-model";
import { selectedLineIndex, windowFor } from "./page-model";
import { theme } from "./theme";

function color(style: LineStyle): string {
  switch (style) {
    case "heading":
    case "h1":
    case "h2":
      return theme.accent;
    case "h3":
    case "header":
      return theme.primary;
    case "code":
    case "quote":
    case "rule":
      return theme.dim;
    case "warn":
      return theme.warn;
    case "error":
      return theme.error;
    case "info":
      return theme.accent;
    default:
      return theme.fg;
  }
}

export function PageView(props: { page: PageData | null; lines: PageLine[]; cursor: number; focused: boolean; width: number; height: number }) {
  const body = () => Math.max(1, props.height - 2);
  const selected = () => selectedLineIndex(props.lines, props.cursor);
  const start = () => windowFor(props.lines, props.cursor, body());
  const visible = () => props.lines.slice(start(), start() + body());
  const title = () => (props.page ? `${props.page.title}${props.page.subtitle ? ` · ${props.page.subtitle}` : ""}` : "loading…");
  return (
    <box flexDirection="column" flexGrow={1} height="100%" border borderColor={props.focused ? theme.borderFocus : theme.border} title={truncate(title(), Math.max(4, props.width - 4))}>
      <For each={visible()}>
        {(line, i) => (
          <text fg={color(line.style)} bg={props.focused && start() + i() === selected() ? theme.selBg : undefined}>
            {truncate(line.text, Math.max(1, props.width - 2)) || " "}
          </text>
        )}
      </For>
    </box>
  );
}
