// Where a command works. The site tells operators to run commands; each one is
// shown with the place it is run, and this module says whether it can run there.
//
// An instance is not the framework: it receives the paths listed in
// tests/clone-manifest.txt (written by scripts/clone-framework.mjs and held by
// tests/clone-genesis.test.mjs). A script can be named in an instance's
// package.json while the code it loads stayed behind: `npm run doctor` is in
// every instance and exits 2 there, because scripts/doctor.mjs is shipped and
// packages/instance-doctor/ is not.
//
// What it reads: a script's target file, the files that target imports
// (followed to the end), the code files it builds a path to with
// path.resolve()/path.join() of quoted parts, and for an agent command the
// scripts its command file runs. What it cannot see: a path computed at run
// time, a dependency missing from node_modules, and whether the command
// succeeds on a given instance. It proves a command is present, not that it passes.
import { existsSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { join } from "node:path";

/** The places a command can be run, and the words the page prints for each. */
export const WHERE = {
  agent: "to your agent",
  instance: "in your instance",
  framework: "in the framework checkout",
};
const SHELL = new Set(["instance", "framework"]);
const CODE = /\.(mjs|js|cjs)$/;

/** The facts of this repository: its scripts, what an instance receives, its files. */
export function repoFacts(repo) {
  const manifest = readFileSync(join(repo, "tests", "clone-manifest.txt"), "utf8");
  return {
    scripts: JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).scripts ?? {},
    shipped: new Set(manifest.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))),
    exists: (p) => existsSync(join(repo, p)),
    read: (p) => readFileSync(join(repo, p), "utf8"),
  };
}

// The code files one file names: relative imports, and paths built from quoted parts.
function named(file, text, exists) {
  const dir = posix.dirname(file);
  const out = new Set();
  for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g)) {
    out.add(posix.normalize(posix.join(dir, m[1])));
  }
  for (const m of text.matchAll(/\b(?:resolve|join)\(([^()]*)\)/g)) {
    const args = m[1].split(",").map((a) => a.trim());
    const parts = args.map((a) => a.match(/^["'`]([^"'`$]*)["'`]$/)?.[1]).filter((p) => p !== undefined);
    if (parts.length === 0 || !CODE.test(parts.at(-1))) continue;
    const path = posix.join(...parts);
    // A first argument that is a variable is, by this repository's habit, the
    // script's own directory; try that, then the repository root.
    const candidates = [posix.normalize(posix.join(dir, path)), posix.normalize(path)];
    const found = candidates.find((c) => !c.startsWith("..") && exists(c));
    if (found) out.add(found);
  }
  return [...out].filter((p) => CODE.test(p) && !p.startsWith(".."));
}

/** Every code file `file` reaches, itself included. Files that do not exist are kept: the caller reports them. */
export function reach(file, { exists, read }) {
  const seen = new Set();
  const queue = [file];
  while (queue.length) {
    const next = queue.pop();
    if (seen.has(next)) continue;
    seen.add(next);
    if (!exists(next)) continue;
    for (const dep of named(next, read(next), exists)) queue.push(dep);
  }
  return seen;
}

// The file an npm script runs, by the rule of clone-framework.mjs stage 6d.
function target(command) {
  if (/--prefix[=\s]|(?:^|&&|;|\|\|)\s*cd\s/.test(command)) return null;
  const m = /(?:^|\s)((?:\.\/)?[\w.@/-]+\.(?:mjs|js|cjs))(?:\s|$)/.exec(command);
  return m ? m[1].replace(/^\.\//, "") : null;
}

/**
 * The reasons `run` does not work `where` the page says, as sentences. None means it is present there.
 * @param {{run: string, where: string}} command
 * @param {{scripts: Record<string,string>, shipped: Set<string>, exists: (p: string) => boolean, read: (p: string) => string}} facts
 */
export function checkCommand({ run, where }, facts) {
  const { scripts, shipped, exists } = facts;
  if (!WHERE[where]) return [`"${run}": where is "${where}"; it must be one of ${Object.keys(WHERE).join(", ")}`];
  const npm = run.match(/^npm run ([a-z0-9:-]+)(?: -- (.+))?$/);
  const slash = run.match(/^\/([a-z0-9-]+)$/);
  if (!npm && !slash) return [`"${run}" is neither "npm run <script>" nor "/<command>"`];

  const inInstance = where !== "framework";
  const problems = [];
  // A file is there when the framework has it and, for an instance, the clone ships it.
  const need = (file, why) => {
    if (!exists(file)) problems.push(`"${run}" ${why} ${file}, which does not exist`);
    else if (inInstance && !shipped.has(file)) problems.push(`"${run}" ${why} ${file}, which an instance does not receive (tests/clone-manifest.txt)`);
  };
  const needAll = (file) => {
    const files = [...reach(file, facts)];
    for (const f of files) need(f, f === file ? "runs" : "needs");
    return files;
  };

  if (slash) {
    if (where !== "agent") return [`"${run}" is typed to the agent, not ${WHERE[where]}`];
    const file = `.claude/commands/${slash[1]}.md`;
    if (!exists(file)) return [`"${run}": ${file} does not exist`];
    need(file, "is");
    for (const m of facts.read(file).matchAll(/\bnode\s+((?:\.\/)?[\w.@/-]+\.(?:mjs|js|cjs))/g)) needAll(m[1].replace(/^\.\//, ""));
    return problems;
  }

  if (!SHELL.has(where)) return [`"${run}" is typed in a terminal, not ${WHERE[where]}`];
  const [, name, args] = npm;
  if (!scripts[name]) return [`"${run}": the root package.json has no script "${name}"`];
  if (inInstance) need("package.json", "needs");
  const file = target(scripts[name]);
  if (!file) return [...problems, `"${run}": cannot tell which file "${scripts[name]}" runs, so not where it works`];
  const files = needAll(file);
  // A flag the page shows must be one the command reads.
  const source = files.filter(exists).map((f) => facts.read(f)).join("\n");
  for (const flag of (args ?? "").match(/--[a-z][a-z0-9-]*/g) ?? []) {
    if (!source.includes(flag)) problems.push(`"${run}": no file it runs reads the flag ${flag}`);
  }
  return problems;
}
