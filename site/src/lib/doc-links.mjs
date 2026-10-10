// doc-links.mjs — resolve one link found in one markdown file.
//
// Docs link to each other as files ("[x](FEDERATION.md)"). That is right in
// the repository and wrong on the site. Pure: everything it needs is passed in.
import { posix } from "node:path";

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const encodePath = (p) => p.split("/").map(encodeURIComponent).join("/");

/** Every ancestor directory of a list of repo-relative files. */
export function dirsOf(files) {
  const dirs = new Set();
  for (const f of files) {
    let d = posix.dirname(f);
    while (d !== "." && !dirs.has(d)) { dirs.add(d); d = posix.dirname(d); }
  }
  return dirs;
}

/**
 * @param {{ url: string, sourcePath: string, pages: { source: string, slug: string }[],
 *   repoFiles: Set<string>, repoDirs: Set<string>, base: string, repoUrl: string,
 *   ref: string, image?: boolean }} input
 * @returns {{ kind: "external" | "page" | "repo" | "broken", href: string }}
 */
export function resolveDocLink({ url, sourcePath, pages, repoFiles, repoDirs, base, repoUrl, ref, image = false }) {
  if (SCHEME.test(url) || url.startsWith("#") || url.startsWith("/")) return { kind: "external", href: url };

  const cut = url.search(/[#?]/);
  const rawPath = cut === -1 ? url : url.slice(0, cut);
  const tail = cut === -1 ? "" : url.slice(cut);

  let decoded;
  try { decoded = decodeURIComponent(rawPath); } catch { return { kind: "broken", href: url }; }

  const target = posix.normalize(posix.join(posix.dirname(sourcePath), decoded)).replace(/\/$/, "");
  if (target === ".." || target.startsWith("../")) return { kind: "broken", href: url };

  if (image) {
    if (!repoFiles.has(target)) return { kind: "broken", href: url };
    const raw = repoUrl.replace("https://github.com/", "https://raw.githubusercontent.com/");
    return { kind: "repo", href: `${raw}/${ref}/${encodePath(target)}` };
  }

  const page = pages.find((p) => p.source === target);
  if (page) return { kind: "page", href: `${base}/docs/${page.slug}${tail}` };
  if (repoFiles.has(target)) return { kind: "repo", href: `${repoUrl}/blob/${ref}/${encodePath(target)}${tail}` };
  if (target === ".") return { kind: "repo", href: `${repoUrl}/tree/${ref}` };
  if (repoDirs.has(target)) return { kind: "repo", href: `${repoUrl}/tree/${ref}/${encodePath(target)}` };
  return { kind: "broken", href: url };
}
