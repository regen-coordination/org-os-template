#!/usr/bin/env node
/**
 * render-templates.mjs — render org-os's own README/GETTING-STARTED from templates.
 *
 * Dogfoods the templates/render.mjs engine on this very framework. Output:
 *   README.md (rendered from templates/README.framework.md)
 *   GETTING-STARTED.md (rendered from templates/GETTING-STARTED.md)
 *
 * For instances, the cloning engine (scripts/clone-framework.mjs, P10) will
 * pick the right template by org.type and render with instance-specific data.
 *
 * Usage:
 *   node scripts/render-templates.mjs           # render to repo root
 *   node scripts/render-templates.mjs --dry     # print to stdout, don't write
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { render } from "../templates/render.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const templatesDir = path.join(rootDir, "templates");
const partialsDir = path.join(templatesDir, "partials");
const dry = process.argv.includes("--dry");

// Derive data from existing org-os state
const pkg = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf-8"));
const fed = yaml.load(readFileSync(path.join(rootDir, "federation.yaml"), "utf-8")) || {};
const skillsMatrix = yaml.load(readFileSync(path.join(rootDir, "data", "skills-matrix.yaml"), "utf-8")) || {};
const packagesMatrix = yaml.load(readFileSync(path.join(rootDir, "data", "packages-matrix.yaml"), "utf-8")) || {};
const instancesYaml = yaml.load(readFileSync(path.join(rootDir, "data", "instances.yaml"), "utf-8")) || {};

const docs = readdirSync(path.join(rootDir, "docs"))
  .filter((f) => f.endsWith(".md"))
  .sort()
  .slice(0, 12) // top 12 to keep README scannable
  .map((f) => ({
    title: f.replace(/\.md$/, "").replace(/-/g, " "),
    path: `docs/${f}`,
    blurb: "",
  }));

const data = {
  org: {
    name: fed.identity?.name || "org-os",
    tagline: "shared operating system for a federation of regenerative organizations",
    short_description: fed.identity?.short_description || "Framework + standards + orchestration hub.",
    version: pkg.version,
    status: "active",
    bootstrap_date: "2026-04-24",
  },
  federation: {
    network: fed.network || "",
    peers: (fed.peers || []).map((p) => (typeof p === "string" ? p : p.id || p.name)).filter(Boolean),
    downstream: (instancesYaml.instances || []).map((i) => ({
      name: i.id || i.name,
      type: i.type || "instance",
      status: i.status || "unknown",
    })),
  },
  counts: {
    skills: (skillsMatrix.skills || []).length,
    packages: (packagesMatrix.packages || []).length,
  },
  docs,
};

const sources = [
  { template: "README.framework.md", target: "README.md" },
];

for (const { template, target } of sources) {
  const tmpl = readFileSync(path.join(templatesDir, template), "utf-8");
  const out = render(tmpl, data, { partialsDir });
  if (dry) {
    console.log(`=== ${target} ===`);
    console.log(out);
    console.log();
  } else {
    writeFileSync(path.join(rootDir, target), out);
    console.log(`✓ wrote ${target} (from templates/${template})`);
  }
}
