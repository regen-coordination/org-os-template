import type { Notice } from "../core/types";
import { displayWidth, truncate } from "./format";
import type { Focus } from "./keys";
import { levelColor, theme } from "./theme";

const HINTS: Record<Focus, string> = {
  rail: "j/k move · enter open · 1-9 jump · tab focus · ctrl+p palette · ? help · q quit",
  page: "j/k move · enter open · esc back · a actions · L launch · e edit · r refresh · ctrl+a agent · ? help",
  agent: "enter send · esc leave · ctrl+x abort · ctrl+n new session · tab focus",
};

export function StatusBar(props: { focus: Focus; toast: Notice | null; message: string | null; width: number }) {
  const right = () => props.message ?? (props.toast ? truncate(props.toast.text, Math.floor(props.width / 2)) : "");
  const rightColor = () => (props.message ? theme.warn : props.toast ? levelColor(props.toast.level) : theme.dim);
  return (
    <box flexDirection="row" height={1} width="100%">
      <text fg={theme.dim}>{truncate(HINTS[props.focus], Math.max(10, props.width - displayWidth(right()) - 2))}</text>
      <box flexGrow={1} />
      <text fg={rightColor()}>{right()}</text>
    </box>
  );
}
