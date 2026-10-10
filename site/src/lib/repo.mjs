// repo.mjs — facts about the repository the site is built from.
//
// The site is built and tested from site/ (see README), so the repository root
// is process.cwd()/.. — the same assumption index.astro and modules.astro
// already make. Do not use import.meta.url here: Vite bundles this module and
// the URL would point into the build output.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const REPO_URL = "https://github.com/regen-coordination/org-os-template";
export const REPO_ROOT = resolve(process.cwd(), "..");
export const VERSION = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).version;
/** The git ref links into the repository point at. The tag is pushed at release. */
export const RELEASE_REF = `v${VERSION}`;

/** Tracked files plus untracked ones that are not ignored, from the root. */
export function listRepoFiles(root = REPO_ROOT) {
  const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  });
  return out.split("\0").filter(Boolean);
}

/** True when `sha` names a commit that is present in this checkout. */
export function commitExists(sha, root = REPO_ROOT) {
  try {
    execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
