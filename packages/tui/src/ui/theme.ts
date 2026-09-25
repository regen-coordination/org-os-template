import type { NoticeLevel } from "../core/types";

export const theme = {
  fg: "#D8DEE9",
  dim: "#6B7280",
  accent: "#7DD3FC",
  primary: "#34D399",
  warn: "#FBBF24",
  error: "#F87171",
  ok: "#34D399",
  user: "#A5B4FC",
  selBg: "#1F3A5F",
  border: "#374151",
  borderFocus: "#34D399",
  bg: "#0B0F14",
};

export function levelColor(level: NoticeLevel | "dim"): string {
  return level === "error" ? theme.error : level === "warn" ? theme.warn : level === "dim" ? theme.dim : theme.accent;
}
