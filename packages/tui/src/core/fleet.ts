import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import yaml from "js-yaml";
// @ts-ignore — plain .mjs without types
import { findEnclosingWorkspace, isWorkspace, readWorkspaceName } from "../../../harness-kit/workspace.mjs";
import type { CockpitConfig } from "./config";
import type { WorkspaceInfo, WorkspaceKind } from "./types";
import { containsPath, slug } from "./util";

export type InstanceEntry = { id: string; name?: string; local_path?: string; drift?: unknown[] };

export function readInstanceRegistry(frameworkRoot: string): { instances: InstanceEntry[]; error?: string } {
  let text: string;
  try {
    text = readFileSync(join(frameworkRoot, "data", "instances.yaml"), "utf8");
  } catch {
    return { instances: [] };
  }
  try {
    const data = yaml.load(text) as { instances?: InstanceEntry[] } | null;
    return { instances: Array.isArray(data?.instances) ? data!.instances : [] };
  } catch (e) {
    return { instances: [], error: `data/instances.yaml: ${String((e as Error).message).split("\n")[0]}` };
  }
}

export function discoverFleet(
  frameworkRoot: string,
  config: Pick<CockpitConfig, "workspaces">,
): { fleet: WorkspaceInfo[]; errors: string[] } {
  const fleet: WorkspaceInfo[] = [];
  const errors: string[] = [];
  const roots = new Set<string>();
  const ids = new Set<string>();
  const add = (root: string, kind: WorkspaceKind, label: string, idHint: string, drift = 0) => {
    const abs = resolve(root);
    if (roots.has(abs)) return;
    roots.add(abs);
    const base = slug(idHint);
    let id = base;
    for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
    ids.add(id);
    fleet.push({ id, label, root: abs, kind, exists: isWorkspace(abs), drift });
  };

  const hub = findEnclosingWorkspace(frameworkRoot);
  if (hub) add(hub.root, "hub", hub.name, "hub");
  add(frameworkRoot, "framework", readWorkspaceName(frameworkRoot), basename(resolve(frameworkRoot)));

  const registry = readInstanceRegistry(frameworkRoot);
  if (registry.error) errors.push(registry.error);
  for (const inst of registry.instances) {
    if (!inst?.id || !inst.local_path) continue;
    add(resolve(frameworkRoot, inst.local_path), "instance", inst.name || inst.id, inst.id, Array.isArray(inst.drift) ? inst.drift.length : 0);
  }
  for (const w of config.workspaces ?? []) add(w.path, "extra", w.label || basename(w.path), w.label || basename(w.path));
  return { fleet, errors };
}

export function pickActive(
  fleet: WorkspaceInfo[],
  opts: { invokedFrom: string; flag?: string; remembered?: string },
): string | null {
  if (opts.flag) {
    const byFlag = fleet.find((w) => w.id === opts.flag || w.root === resolve(opts.flag!));
    if (byFlag) return byFlag.id;
  }
  const containing = fleet
    .filter((w) => containsPath(w.root, opts.invokedFrom))
    .sort((a, b) => b.root.length - a.root.length)[0];
  if (containing) return containing.id;
  if (opts.remembered && fleet.some((w) => w.id === opts.remembered)) return opts.remembered;
  return (fleet.find((w) => w.kind === "hub") ?? fleet.find((w) => w.kind === "framework") ?? fleet[0])?.id ?? null;
}
