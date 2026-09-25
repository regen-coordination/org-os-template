import type { CockpitSnapshot } from "../core/cockpit";
import { theme } from "./theme";

export function AgentPane(props: { snap: CockpitSnapshot; focused: boolean; width: number; height: number; onSubmit: (text: string) => void }) {
  return (
    <box flexDirection="column" width={props.width} height="100%" border borderColor={props.focused ? theme.borderFocus : theme.border} title="AGENT · pi">
      <text fg={theme.dim}>…</text>
    </box>
  );
}
