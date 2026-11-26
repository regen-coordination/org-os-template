// remark-doc-links.mjs — rewrite file links in a doc into addresses that work
// on the site, and stop the build on one that goes nowhere. See doc-links.mjs.
import { relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDocLink, dirsOf } from "./doc-links.mjs";

function walk(node, visit) {
  visit(node);
  if (Array.isArray(node.children)) for (const child of node.children) walk(child, visit);
}

/** Rewrites in place. Returns the URLs that resolve to nothing. */
export function rewriteTree(tree, { sourcePath, pages, repoFiles, repoDirs, base, repoUrl, ref }) {
  const broken = [];
  walk(tree, (node) => {
    if (node.type !== "link" && node.type !== "definition" && node.type !== "image") return;
    if (typeof node.url !== "string" || node.url === "") return;
    const out = resolveDocLink({
      url: node.url, sourcePath, pages, repoFiles, repoDirs, base, repoUrl, ref,
      image: node.type === "image",
    });
    if (out.kind === "broken") broken.push(node.url);
    else node.url = out.href;
  });
  return broken;
}

// Astro hands remark the source as a file: URL object; plain remark uses a
// string. Accept both.
function toPath(value) {
  if (value instanceof URL) return fileURLToPath(value);
  if (typeof value === "string" && value.startsWith("file:")) return fileURLToPath(value);
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * @param {{ pages: { source: string, slug: string }[], repoRoot: string, base: string,
 *   repoUrl: string, ref: string, listFiles: () => string[] }} options
 */
export default function remarkDocLinks({ pages, repoRoot, base, repoUrl, ref, listFiles }) {
  let repoFiles;
  let repoDirs;
  return (tree, file) => {
    const abs = toPath(file?.path ?? file?.history?.[0]);
    if (!abs) throw new Error("remark-doc-links: no source path on the file, so relative links cannot be resolved");
    if (!repoFiles) { repoFiles = new Set(listFiles()); repoDirs = dirsOf(repoFiles); }
    const sourcePath = relative(repoRoot, abs).split(sep).join("/");
    const broken = rewriteTree(tree, { sourcePath, pages, repoFiles, repoDirs, base, repoUrl, ref });
    if (broken.length > 0) {
      throw new Error(`Broken link(s) in ${sourcePath}:\n${broken.map((u) => `  → ${u}`).join("\n")}`);
    }
  };
}
