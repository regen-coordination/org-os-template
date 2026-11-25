// installs.mjs — the two installs the site needs, in the order CI runs them
// (.github/workflows/deploy-pages.yml), and a check that says in words which one
// is missing. Imports nothing but Node itself, so it can run before any of them.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

// The <federation-map> element the site bundles has had no dependencies since
// @org-os/federation-map 0.2.0 (it no longer imports d3-force), so its package
// needs no install of its own.
// `probe` is one file the install is known to create; `readme` is the line
// site/README.md carries for it (test/installs.test.mjs holds the two together).
export const REQUIRED_INSTALLS = [
  {
    dir: ".",
    label: "the repository root",
    probe: "node_modules/js-yaml/package.json",
    why: "packages/org-os-kms, which builds the federation map data, loads js-yaml from there",
    readme: "(cd .. && npm ci)",
  },
  {
    dir: "site",
    label: "site/",
    probe: "node_modules/astro/package.json",
    why: "Astro and the site's own tools live there",
    readme: "npm ci",
  },
];

export function missingInstalls(repoRoot) {
  return REQUIRED_INSTALLS.filter((install) => !existsSync(join(repoRoot, install.dir, install.probe)));
}

// One sentence and one command per missing install.
export function installMessage(missing, repoRoot) {
  return missing
    .map((install) =>
      `The install at ${install.label} is missing: ${install.why}.\n  Run: cd "${resolve(repoRoot, install.dir)}" && npm ci`)
    .join("\n");
}
