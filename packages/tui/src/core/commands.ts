import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { LIFECYCLE_COMMANDS, type LifecycleCommand } from "./types";

export function stripFrontmatter(text: string): string {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

// Lifecycle commands have one source: .claude/commands/<name>.md of the
// workspace (framework copy as fallback). The expanded body is sent to the
// agent as an ordinary prompt, so every backend gets the same protocol.
export async function expandCommand(
  root: string,
  name: LifecycleCommand,
  args = "",
  { fallbackRoot }: { fallbackRoot?: string } = {},
): Promise<{ ok: true; text: string; source: string } | { ok: false; error: string }> {
  for (const base of [root, fallbackRoot].filter(Boolean) as string[]) {
    const source = join(base, ".claude", "commands", `${name}.md`);
    try {
      const raw = await readFile(source, "utf8");
      return { ok: true, text: stripFrontmatter(raw).split("$ARGUMENTS").join(args).trim(), source };
    } catch {
      // try the next base
    }
  }
  return { ok: false, error: `No .claude/commands/${name}.md in ${root}${fallbackRoot ? ` or ${fallbackRoot}` : ""}` };
}

export function parseSlash(text: string): { name: LifecycleCommand; args: string } | null {
  const m = text.trim().match(/^\/([a-z-]+)(?:\s+([\s\S]*))?$/);
  if (!m || !LIFECYCLE_COMMANDS.includes(m[1] as LifecycleCommand)) return null;
  return { name: m[1] as LifecycleCommand, args: (m[2] ?? "").trim() };
}
