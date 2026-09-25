import { resolve, sep } from "node:path";

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "ws";
}

export function containsPath(root: string, p: string): boolean {
  const r = resolve(root);
  const q = resolve(p);
  return q === r || q.startsWith(r.endsWith(sep) ? r : r + sep);
}

export function firstLine(s: string, max = 80): string {
  const line = String(s ?? "").split("\n")[0].trim();
  return line.length > max ? line.slice(0, max - 1) + "…" : line;
}
