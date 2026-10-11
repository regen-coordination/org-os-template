// A command the site tells an operator to run must work where the site says to
// run it. The framework's own package.json cannot answer that: an instance
// receives a subset of the framework (tests/clone-manifest.txt), so a script can
// be in an instance's package.json while the code it loads is not there.
// `npm run doctor` is the case that was published wrong: it exits 2 in an instance.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { WHERE, checkCommand, reach, repoFacts } from "../scripts/command-where.mjs";

const SITE = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(SITE, "..");
const facts = repoFacts(REPO);
const landing = yaml.load(readFileSync(join(SITE, "src", "data", "landing.yaml"), "utf8"));

// A made-up repository, so each rule has a case that fails without the real one changing.
function fake(files, { shipped = Object.keys(files), scripts = {} } = {}) {
  return {
    scripts,
    shipped: new Set(shipped),
    exists: (p) => p in files,
    read: (p) => files[p],
  };
}

test("the clone manifest was read: it lists what an instance receives", () => {
  assert.ok(facts.shipped.size >= 100, `only ${facts.shipped.size} paths read from tests/clone-manifest.txt`);
  assert.ok(facts.shipped.has("package.json"));
  assert.ok(!facts.shipped.has("packages/instance-doctor/src/cli.mjs"), "the manifest now ships the doctor: the doctor case below needs another example");
});

test("`npm run doctor` in an instance is refused: the instance has the shim, not the package it loads", () => {
  const problems = checkCommand({ run: "npm run doctor", where: "instance" }, facts);
  assert.ok(problems.length >= 1, "no problem reported");
  assert.match(problems[0], /needs packages\/instance-doctor\/src\/cli\.mjs, which an instance does not receive/);
  // The shim itself is shipped, which is why the instance's package.json keeps the script.
  assert.doesNotMatch(problems.join("\n"), /scripts\/doctor\.mjs/);
});

test("the doctor as the framework runs it is accepted, and its flag is one the doctor reads", () => {
  assert.deepEqual(checkCommand({ run: "npm run doctor -- --dir ../my-instance", where: "framework" }, facts), []);
  const problems = checkCommand({ run: "npm run doctor -- --no-such-flag", where: "framework" }, facts);
  assert.match(problems.join("\n"), /--no-such-flag/);
});

test("a script file reaches what it imports and what it builds a path to", () => {
  const files = {
    "scripts/a.mjs": `import "./b.mjs";\nimport yaml from "js-yaml";\nconst x = await import("./lib/c.mjs");`,
    "scripts/b.mjs": `const here = "."; const local = path.resolve(here, '..', 'packages', 'p', 'cli.mjs');`,
    "scripts/lib/c.mjs": `const data = path.join(root, "data", "members.yaml");`,
    "packages/p/cli.mjs": "",
    "data/members.yaml": "",
  };
  assert.deepEqual([...reach("scripts/a.mjs", fake(files))].sort(), ["packages/p/cli.mjs", "scripts/a.mjs", "scripts/b.mjs", "scripts/lib/c.mjs"]);
});

test("a shell command in an instance needs its script, its target and everything the target reaches", () => {
  const files = { "package.json": "", "scripts/a.mjs": `import "./b.mjs";`, "scripts/b.mjs": "" };
  const scripts = { a: "node scripts/a.mjs" };
  assert.deepEqual(checkCommand({ run: "npm run a", where: "instance" }, fake(files, { scripts })), []);
  assert.match(checkCommand({ run: "npm run zz", where: "instance" }, fake(files, { scripts })).join(), /no script "zz"/);
  assert.match(
    checkCommand({ run: "npm run a", where: "instance" }, fake(files, { scripts, shipped: ["package.json", "scripts/b.mjs"] })).join(),
    /scripts\/a\.mjs, which an instance does not receive/,
  );
  assert.match(
    checkCommand({ run: "npm run a", where: "instance" }, fake(files, { scripts, shipped: ["package.json", "scripts/a.mjs"] })).join(),
    /scripts\/b\.mjs, which an instance does not receive/,
  );
  // The same command is fine from the framework checkout, which has every file.
  assert.deepEqual(checkCommand({ run: "npm run a", where: "framework" }, fake(files, { scripts, shipped: [] })), []);
});

test("a command typed to the agent needs its command file in the instance, and the scripts that file runs", () => {
  const files = { ".claude/commands/go.md": "Run:\n```bash\nnode scripts/a.mjs --format=markdown\n```", "scripts/a.mjs": "" };
  assert.deepEqual(checkCommand({ run: "/go", where: "agent" }, fake(files)), []);
  assert.match(checkCommand({ run: "/go", where: "agent" }, fake(files, { shipped: ["scripts/a.mjs"] })).join(), /\.claude\/commands\/go\.md/);
  assert.match(checkCommand({ run: "/go", where: "agent" }, fake(files, { shipped: [".claude/commands/go.md"] })).join(), /scripts\/a\.mjs, which an instance does not receive/);
  assert.match(checkCommand({ run: "/nope", where: "agent" }, fake(files)).join(), /\.claude\/commands\/nope\.md does not exist/);
});

test("a command is refused when the place does not fit its kind, or it is not a kind the check reads", () => {
  const f = fake({ "package.json": "", "scripts/a.mjs": "", ".claude/commands/go.md": "" }, { scripts: { a: "node scripts/a.mjs", site: "npm run build --prefix site" } });
  assert.match(checkCommand({ run: "npm run a", where: "agent" }, f).join(), /typed in a terminal/);
  assert.match(checkCommand({ run: "/go", where: "instance" }, f).join(), /typed to the agent/);
  assert.match(checkCommand({ run: "npm run a", where: "somewhere" }, f).join(), /"somewhere"/);
  assert.match(checkCommand({ run: "node scripts/a.mjs", where: "instance" }, f).join(), /neither/);
  assert.match(checkCommand({ run: "npm run site", where: "instance" }, f).join(), /cannot tell/);
});

test("every command on the home page works where the page says to run it", () => {
  assert.equal(landing.commands?.length, 3);
  for (const c of landing.commands) {
    assert.ok(WHERE[c.where], `"${c.run}": where is "${c.where}"; it must be one of ${Object.keys(WHERE).join(", ")}`);
    assert.deepEqual(checkCommand(c, facts), [], `"${c.run}" (${c.where})`);
  }
});

test("the page prints where each command is run, in words", () => {
  const hero = readFileSync(join(SITE, "src", "components", "Hero.astro"), "utf8");
  assert.match(hero, /WHERE\[c\.where\]/, "Hero.astro no longer prints the place from WHERE");
  for (const [key, words] of Object.entries(WHERE)) assert.ok(words.length > 0 && words.length <= 28, `the words for "${key}"`);
  assert.doesNotMatch(landing.commands_title, /in your instance/i, "the panel's title says every command is run in the instance; one is not");
});
