// scripts/lib/standards-vendor.mjs
//
// The standards generator an instance carries (DAO-OS L8, Q56).
//
// The builder of .well-known/ lives in the framework at packages/admin/lib/standards/, and instances do not receive
// packages/admin. So clone stage 5 (scripts/clone-framework.mjs) and the instance doctor's inject-machinery stage
// (packages/instance-doctor) copy into the instance's scripts/lib/:
//   - every packages/admin/lib/standards/*.mjs except index.mjs and validate.mjs (they need ajv, which an instance
//     does not install), and
//   - the transitive closure of the relative imports of those files (../visibility.mjs, ../caip.mjs, …),
// keeping the layout, so scripts/lib/standards/build.mjs still imports ../visibility.mjs. The instance's
// scripts/generate-all-schemas.mjs then finds the builder at ./lib/standards/ and writes the same bytes the
// framework's copy writes (tests/clone-standards.test.mjs proves it).
//
// The set is COMPUTED from the files' imports, never listed by hand, so a new module the builder imports travels
// with it. Nothing in the set may import an npm package — the vendored copy has no packages of its own — and only
// load.mjs may import node built-ins (node:fs, node:path); anything else throws here, before a file is written.
//
// Reads go through a `source` the caller supplies, so the clone reads committed blobs at HEAD and the doctor reads
// the framework checkout through its io bag.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/** Where the builder lives in the framework, and where an instance keeps its copy (both relative to their roots). */
export const STANDARDS_SOURCE_DIR = "packages/admin/lib";
export const STANDARDS_VENDOR_DIR = "scripts/lib";

/** The standards modules that are NOT vendored: both need ajv (schema validation runs from the framework). */
export const NOT_VENDORED = new Set(["standards/index.mjs", "standards/validate.mjs"]);

/** The only non-relative specifiers the vendored set may contain, by file (relative to STANDARDS_SOURCE_DIR). */
export const ALLOWED_EXTERNALS = new Map([["standards/load.mjs", ["node:fs", "node:path"]]]);

// `import … from '…'` / `export … from '…'` (one statement, possibly over several lines), `import '…'`, `import('…')`.
// Anchored at a line start so prose in comments and strings ("needs 2 approvals from the …") is not read as code.
const STATIC_FROM = /^[ \t]*(?:import|export)\b[^;=()'"`]*?\bfrom[ \t]*(['"])([^'"\n]+)\1/gm;
const BARE_IMPORT = /^[ \t]*import[ \t]*(['"])([^'"\n]+)\1/gm;
const DYNAMIC_IMPORT = /\bimport\(\s*(['"])([^'"\n]+)\1\s*\)/g;

/** Every module specifier a module's source imports or re-exports, in source order, without duplicates. */
export function importSpecifiers(text) {
  const found = [];
  for (const re of [STATIC_FROM, BARE_IMPORT, DYNAMIC_IMPORT]) {
    for (const m of String(text).matchAll(re)) found.push({ at: m.index, spec: m[2] });
  }
  return [...new Set(found.sort((a, b) => a.at - b.at).map((f) => f.spec))];
}

/**
 * The files to vendor.
 *
 * @param {{ read(rel: string): string|null|undefined, list(relDir: string): string[] }} source
 *   framework-relative reads: `read` returns a file's text (null/undefined when absent); `list` returns the
 *   framework-relative paths of the files directly under a directory ([] when absent).
 * @returns {{ files: { from: string, to: string }[], externals: { file: string, specifier: string }[] }}
 *   `from` framework-relative, `to` instance-relative, sorted by `to`; `externals` are the allowed non-relative
 *   specifiers found (file relative to STANDARDS_SOURCE_DIR). Empty when the framework has no standards builder
 *   (it predates DAO-OS L8).
 * @throws when an import leaves STANDARDS_SOURCE_DIR, names a file the framework lacks, or is a package or built-in
 *   the vendored copy cannot have.
 */
export function standardsVendorSet(source) {
  const base = `${STANDARDS_SOURCE_DIR}/`;
  if (source.read(`${base}standards/build.mjs`) == null) return { files: [], externals: [] };

  const roots = new Set(["standards/build.mjs", "standards/load.mjs"]);
  for (const rel of source.list(`${base}standards`)) {
    const name = rel.slice(base.length);
    if (name.endsWith(".mjs") && !NOT_VENDORED.has(name)) roots.add(name);
  }

  const seen = new Set();
  const externals = [];
  const queue = [...roots].sort();
  while (queue.length > 0) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    const text = source.read(base + file);
    if (text == null) throw new Error(`the standards builder imports ${base}${file}, which the framework does not have`);
    seen.add(file);
    for (const spec of importSpecifiers(text)) {
      if (spec.startsWith("./") || spec.startsWith("../")) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
        if (target.startsWith("../") || !target.endsWith(".mjs")) {
          throw new Error(`${base}${file} imports ${spec}, outside ${base} or not a module — it cannot be vendored`);
        }
        if (NOT_VENDORED.has(target)) {
          throw new Error(`${base}${file} imports ${spec}, which needs ajv and is never vendored`);
        }
        queue.push(target);
        continue;
      }
      if (!(ALLOWED_EXTERNALS.get(file) ?? []).includes(spec)) {
        throw new Error(`${base}${file} imports "${spec}": the vendored standards builder may import no package (only load.mjs may use node:fs and node:path)`);
      }
      externals.push({ file, specifier: spec });
    }
  }

  const files = [...seen].sort().map((rel) => ({ from: base + rel, to: `${STANDARDS_VENDOR_DIR}/${rel}` }));
  return { files, externals };
}

/** A `source` over a checkout on disk (the framework's working tree). */
export function diskSource(root) {
  return {
    read: (rel) => {
      const file = path.join(root, rel);
      return existsSync(file) ? readFileSync(file, "utf-8") : null;
    },
    list: (relDir) => {
      const dir = path.join(root, relDir);
      if (!existsSync(dir)) return [];
      return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => `${relDir}/${e.name}`);
    },
  };
}
