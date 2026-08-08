// Re-copies the org-os core into vendor/org-os-core.
//
// The org-os repo is canonical; this package holds a vendored copy because the Cloudflare OS
// workspace is a separate pnpm workspace and cannot resolve a sibling repo. Run this after any
// change to org-os/packages/cloudflare-os-integration/src, then re-run that package's tests
// there (they do not run from here).
//
//   ORG_OS_REPO=/path/to/org-os node scripts/sync-core.mjs
//
// Verify with `git diff vendor/` — an empty diff means the copy was already current.

import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dest = resolve(here, "..", "vendor", "org-os-core");

const repo =
  process.env.ORG_OS_REPO ??
  "/Users/luizfernando/Desktop/Workspaces/Zettelkasten/03 Libraries/org-os";
const src = join(repo, "packages", "cloudflare-os-integration", "src");

if (!existsSync(src)) {
  console.error(`sync-core: source not found: ${src}`);
  console.error("Set ORG_OS_REPO to the org-os repository root.");
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log(`sync-core: ${src} -> ${dest}`);
