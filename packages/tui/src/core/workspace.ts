import { existsSync, watch as fsWatch, type FSWatcher } from "node:fs";
import { join } from "node:path";
// @ts-ignore — plain .mjs without types
import { readWorkspaceFiles, WATCH_PATHS, loadWorkspaceState, yamlErrors } from "../../../org-state/index.mjs";
import { run as defaultRun, type Runner } from "./proc";
import type { GitStatus, WorkspaceInfo, WorkspaceSummary } from "./types";

export type LoadedWorkspace = {
  info: WorkspaceInfo;
  files: Record<string, string>;
  state: any | null;
  errors: string[];
  git: GitStatus | null;
  loadedAt: Date;
};

export function parseGitStatus(porcelain: string): Omit<GitStatus, "lastCommit"> {
  const lines = porcelain.split("\n").filter((l) => l.length > 0);
  let branch: string | null = null;
  let ahead = 0;
  let behind = 0;
  if (lines[0]?.startsWith("## ")) {
    const head = lines.shift()!.slice(3);
    if (head.startsWith("HEAD (no branch)")) branch = "HEAD";
    else if (head.startsWith("No commits yet on ")) branch = head.slice("No commits yet on ".length).trim();
    else branch = head.split("...")[0].split(" ")[0] || null;
    const a = head.match(/ahead (\d+)/);
    const b = head.match(/behind (\d+)/);
    ahead = a ? Number(a[1]) : 0;
    behind = b ? Number(b[1]) : 0;
  }
  return { branch, dirty: lines.length > 0, ahead, behind };
}

export async function readGitStatus(root: string, run: Runner = defaultRun): Promise<GitStatus | null> {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };
  const status = await run("git", ["-C", root, "status", "--porcelain=v1", "--branch"], { env, timeoutMs: 5000 });
  if (status.code !== 0) return null;
  const log = await run("git", ["-C", root, "log", "-1", "--format=%cr"], { env, timeoutMs: 5000 });
  return { ...parseGitStatus(status.stdout), lastCommit: log.code === 0 ? log.stdout.trim() || null : null };
}

export async function loadWorkspace(
  info: WorkspaceInfo,
  { now = new Date(), run = defaultRun, git = true }: { now?: Date; run?: Runner; git?: boolean } = {},
): Promise<LoadedWorkspace> {
  if (!info.exists) {
    return { info, files: {}, state: null, errors: [`workspace path missing or not an org-os workspace: ${info.root}`], git: null, loadedAt: now };
  }
  const { files, errors } = readWorkspaceFiles(info.root);
  let state: any = null;
  const all = [...errors, ...yamlErrors(files)];
  try {
    state = loadWorkspaceState(files, { now });
  } catch (e) {
    all.push(`state: ${(e as Error).message}`);
  }
  return { info, files, state, errors: all, git: git ? await readGitStatus(info.root, run) : null, loadedAt: now };
}

export function summarize(ws: LoadedWorkspace): WorkspaceSummary {
  const s = ws.state;
  return {
    id: ws.info.id,
    name: s?.identity?.name || ws.info.label,
    type: s?.identity?.type ?? null,
    git: ws.git,
    openTasks: s?.heartbeat?.open ?? 0,
    urgentTasks: (s?.tasks?.critical?.length ?? 0) + (s?.tasks?.urgent?.length ?? 0),
    lastMemory: s?.memory?.[0]?.date ?? null,
    errors: ws.errors,
  };
}

export function watchWorkspace(
  root: string,
  onChange: () => void,
  { debounceMs = 300, watch = fsWatch }: { debounceMs?: number; watch?: typeof fsWatch } = {},
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fire = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, debounceMs);
  };
  const watchers: FSWatcher[] = [];
  for (const rel of WATCH_PATHS as string[]) {
    const abs = join(root, rel);
    if (!existsSync(abs)) continue;
    try {
      watchers.push(watch(abs, fire));
    } catch {
      // unwatchable path: the operator can still press r
    }
  }
  return () => {
    if (timer) clearTimeout(timer);
    for (const w of watchers) w.close();
  };
}
