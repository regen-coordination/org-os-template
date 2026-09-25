import { createRenderEffect } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import type { PermissionAnswer, PermissionRequest } from "../../core/types";
import { truncate } from "../format";
import { theme } from "../theme";

// Answer keys are ignored this long after a request appears, so a keystroke still in flight from
// typing in the agent input can never approve a write.
export const PERMISSION_ARM_MS = 250;

export function PermissionDialog(props: { request: PermissionRequest; queued: number; workspaceLabel: string; width: number; onAnswer: (a: PermissionAnswer) => void }) {
  let shownAt = Date.now();
  createRenderEffect(() => {
    void props.request.id; // re-arm for every request shown, including the next queued one
    shownAt = Date.now();
  });
  useKeyboard((k) => {
    if (k.ctrl || k.meta) return;
    if (Date.now() - shownAt < PERMISSION_ARM_MS) return;
    if (k.name === "y") props.onAnswer("once");
    else if (k.name === "s") props.onAnswer("session");
    else if (k.name === "n" || k.name === "escape") props.onAnswer("deny");
  });
  const w = () => Math.max(30, Math.min(76, props.width - 4));
  return (
    <box position="absolute" left={Math.floor((props.width - w()) / 2)} top={3} width={w()} height={8} zIndex={30} border borderColor={theme.warn} backgroundColor={theme.bg} title="Approval needed" flexDirection="column">
      <text fg={theme.fg}>{truncate(`pi wants to use ${props.request.tool} in ${props.workspaceLabel}`, w() - 2)}</text>
      <text fg={theme.accent}>{truncate(props.request.summary, w() - 2)}</text>
      <text fg={theme.dim}>{props.queued > 1 ? `${props.queued - 1} more waiting` : " "}</text>
      <text fg={theme.fg}>{truncate(`[y] allow once   [s] allow ${props.request.tool} this session   [n] deny`, w() - 2)}</text>
    </box>
  );
}
