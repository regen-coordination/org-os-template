// tests/clone-locale.test.mjs
//
// `org.language` in the clone config: an instance whose people never need
// English to run it. Templates, partials and the scaffold files the generator
// writes are looked up per language (templates/<lang>/… first, the English file
// otherwise), the language is recorded in federation.yaml, and the instance's
// CLAUDE.md / AGENTS.md tell agents to work in it.
//
// The English path is pinned elsewhere (clone-framework, clone-genesis, the
// manifest); here: the pt-BR set, the fallback, and what ships.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, writeFileSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { isOtherLanguageTemplate, isPathExcluded } from "../scripts/lib/clone-excludes.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(rootDir, "scripts", "clone-framework.mjs");
const doctorScript = path.join(rootDir, "scripts", "doctor.mjs");
const ptConfigPath = path.join(rootDir, "tests", "fixtures", "instance-config-pt-br.yaml");
const enConfigPath = path.join(rootDir, "tests", "fixtures", "instance-config.yaml");

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
};

function clone(configPath, { git = false } = {}) {
  const dst = mkdtempSync(path.join(tmpdir(), "clone-locale-"));
  rmSync(dst, { recursive: true, force: true });
  const r = spawnSync(
    "node",
    [scriptPath, "--target", dst, "--config", configPath, ...(git ? [] : ["--no-git"])],
    { encoding: "utf-8", timeout: 120_000, env: GIT_ENV },
  );
  return { dst, r };
}

// A config derived from the pt-BR fixture, written to a temp file.
function variant(mutate) {
  const cfg = yaml.load(readFileSync(ptConfigPath, "utf-8"));
  mutate(cfg);
  const dir = mkdtempSync(path.join(tmpdir(), "clone-locale-cfg-"));
  const file = path.join(dir, "config.yaml");
  writeFileSync(file, yaml.dump(cfg));
  return { file, dir };
}

const read = (dir, rel) => readFileSync(path.join(dir, rel), "utf-8");

// Every file the generator writes or renders with prose in it.
const LOCALISED_FILES = [
  "README.md", "GETTING-STARTED.md", "CLAUDE.md", "AGENTS.md",
  "IDENTITY.md", "MASTERPLAN.md", "MEMORY.md", "HEARTBEAT.md",
  "SOUL.md", "USER.md", "TOOLS.md", "DECISIONS.md",
  "knowledge/INDEX.md", "docs/plans/QUEUE.md", "dashboard.yaml",
  "data/members.yaml", "data/projects.yaml", "data/governance.yaml",
];

test("a pt-BR config yields README, GETTING-STARTED, CLAUDE and AGENTS in Portuguese", () => {
  const { dst, r } = clone(ptConfigPath);
  try {
    assert.equal(r.status, 0, r.stderr);
    const readme = read(dst, "README.md");
    assert.match(readme, /## O que é isto/);
    assert.match(readme, /## Licença/);
    assert.doesNotMatch(readme, /What this is|Quick navigation|Who are you\?|Requirements/);

    const started = read(dst, "GETTING-STARTED.md");
    assert.match(started, /# Primeiros passos com instancia-teste-os/);
    assert.match(started, /## Comandos do dia a dia/); // the cheatsheet partial
    assert.doesNotMatch(started, /Getting started|Meet your org|When you get stuck|Common operations/);

    const claude = read(dst, "CLAUDE.md");
    assert.match(claude, /## Regras principais/);
    assert.doesNotMatch(claude, /Quick Start|Key Rules|Session Lifecycle|Common Tasks/);

    const agents = read(dst, "AGENTS.md");
    assert.match(agents, /# instancia-teste-os — Guia para agentes/);
    assert.match(agents, /## 6\. Política de segurança/);
    assert.doesNotMatch(agents, /Agent Guide|START HERE|Memory System|Safety Policy|Success Indicators/);

    // The federation partial, rendered with this instance's data.
    assert.match(readme, /## Federação/);
    assert.match(readme, /rede-teste/);
  } finally {
    rmSync(dst, { recursive: true, force: true });
  }
});

test("a pt-BR config yields the placeholder and scaffold files in Portuguese", () => {
  const { dst, r } = clone(ptConfigPath);
  try {
    assert.equal(r.status, 0, r.stderr);
    const expectations = {
      "HEARTBEAT.md": [/## Tarefas ativas/, /Active Tasks|System Health|Fresh bootstrap/],
      "MASTERPLAN.md": [/## Mandato/, /## Mandate|Activations|Character/],
      "MEMORY.md": [/## Decisões principais/, /Key Decisions|Active Context|Fresh start/],
      "IDENTITY.md": [/\*\*Descrição curta:\*\*/, /Short description|Edit freely/],
      "SOUL.md": [/# SOUL\.md — Quem somos/, /Who We Are|## Values|## Voice/],
      "USER.md": [/Pessoa de Teste/, /About Your Operator|The person you're helping/],
      "TOOLS.md": [/nada configurado ainda/, /Local Tool Notes|none configured yet/],
      "DECISIONS.md": [/## Convenções/, /Key Decisions Log|## Conventions|Append-only/],
      "knowledge/INDEX.md": [/nenhum domínio ainda/, /Knowledge Index|no domains yet/],
      "docs/plans/QUEUE.md": [/# Fila de planos — instancia-teste-os/, /Plan Queue|Strategic \(multi-session\)|_\(none\)_/],
      "dashboard.yaml": [/controla o que o \/initialize mostra/, /controls what|look-ahead window/],
      "data/members.yaml": [/Registro de membros/, /Members Registry/],
      "data/projects.yaml": [/Registro de projetos/, /Projects Registry/],
      "data/governance.yaml": [/Registro de governança/, /Governance Registry|Decisions are recorded/],
    };
    for (const [rel, [present, absent]] of Object.entries(expectations)) {
      const text = read(dst, rel);
      assert.match(text, present, `${rel} is not in Portuguese`);
      assert.doesNotMatch(text, absent, `${rel} still carries English scaffold text`);
    }
    // The untracked-scratch convention the generator appends to .gitignore.
    assert.match(read(dst, ".gitignore"), /Rascunhos[^\n]*\ndocs\/temp\/\n/);
  } finally {
    rmSync(dst, { recursive: true, force: true });
  }
});

test("no unrendered template tag is left in any rendered pt-BR file", () => {
  const { dst, r } = clone(ptConfigPath);
  try {
    assert.equal(r.status, 0, r.stderr);
    for (const rel of LOCALISED_FILES) {
      assert.doesNotMatch(read(dst, rel), /\{\{|\}\}/, `${rel} has an unrendered tag`);
    }
  } finally {
    rmSync(dst, { recursive: true, force: true });
  }
});

test("the language is recorded in federation.yaml and agents are told to work in it", () => {
  const { dst, r } = clone(ptConfigPath);
  try {
    assert.equal(r.status, 0, r.stderr);
    const fed = yaml.load(read(dst, "federation.yaml"));
    assert.equal(fed.identity.language, "pt-BR");
    assert.equal(fed.identity.name, "instancia-teste-os");
    assert.match(read(dst, "federation.yaml"), /^# Gerado pelo clone-framework em \d{4}-\d{2}-\d{2}\.$/m);
    assert.match(read(dst, "IDENTITY.md"), /\*\*Idioma:\*\* pt-BR/);

    for (const rel of ["CLAUDE.md", "AGENTS.md"]) {
      const text = read(dst, rel);
      assert.match(text, /## Idioma de trabalho/, `${rel} has no language instruction`);
      assert.match(text, /português do Brasil/, rel);
      // What the instruction covers: operating, documents, memory, commits, replies …
      assert.match(text, /documentos/, rel);
      assert.match(text, /memória/, rel);
      assert.match(text, /mensagens de commit/, rel);
      assert.match(text, /responda/i, rel);
      // … and what stays in English.
      assert.match(text, /ficam em inglês/, rel);
      assert.match(text, /`packages\/`/, rel);
    }
  } finally {
    rmSync(dst, { recursive: true, force: true });
  }
});

test("what the tooling reads by label survives the translation", () => {
  const { dst, r } = clone(ptConfigPath);
  try {
    assert.equal(r.status, 0, r.stderr);
    // validate-identity and the instance doctor read these two IDENTITY.md lines by label.
    const identity = read(dst, "IDENTITY.md");
    assert.match(identity, /^- \*\*Name:\*\* instancia-teste-os$/m);
    assert.match(identity, /^- \*\*Type:\*\* LocalNode$/m);
    // The dashboard files plans under these four section names (scripts/initialize.mjs).
    const queue = read(dst, "docs/plans/QUEUE.md");
    for (const section of ["Active", "Queued", "Backlog", "Completed"]) {
      assert.match(queue, new RegExp(`^## ${section}\\b`, "m"), `QUEUE.md lost its "${section}" section`);
    }
    // YAML the generator writes still parses, with the same keys.
    assert.equal(yaml.load(read(dst, "data/members.yaml")).members[0].name, "Pessoa de Teste");
    assert.deepEqual(yaml.load(read(dst, "data/projects.yaml")).projects, []);
    assert.equal(yaml.load(read(dst, "data/governance.yaml")).governance.current_phase, "bootstrap");
    assert.equal(yaml.load(read(dst, "dashboard.yaml")).sections.calendar.days, 7);
    // The dashboard finds the mission under its Portuguese heading.
    symlinkSync(path.join(rootDir, "node_modules"), path.join(dst, "node_modules"), "dir");
    const dash = spawnSync("node", ["scripts/initialize.mjs", "--format=json"], { cwd: dst, encoding: "utf-8", timeout: 120_000 });
    assert.equal(dash.status, 0, dash.stderr);
    assert.equal(JSON.parse(dash.stdout).identity.mission, "Instância de teste do gerador, em português.");
  } finally {
    rmSync(dst, { recursive: true, force: true });
  }
});

test("an English clone is untouched: no language recorded, no instruction, no other language's templates", () => {
  const { dst, r } = clone(enConfigPath);
  try {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(yaml.load(read(dst, "federation.yaml")).identity.language, undefined);
    assert.doesNotMatch(read(dst, "CLAUDE.md"), /Working language|Idioma de trabalho/);
    assert.doesNotMatch(read(dst, "AGENTS.md"), /Working language|Idioma de trabalho/);
    assert.equal(existsSync(path.join(dst, "templates", "pt-BR")), false, "an English instance carries pt-BR templates");
    assert.ok(existsSync(path.join(dst, "templates", "scaffold", "HEARTBEAT.md")), "the English scaffold must ship with the generator");
  } finally {
    rmSync(dst, { recursive: true, force: true });
  }
});

test("a pt-BR clone carries its own language's templates, and no generator tests or fixtures", () => {
  const { dst, r } = clone(ptConfigPath);
  try {
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(path.join(dst, "templates", "pt-BR", "README.instance.md")));
    assert.ok(existsSync(path.join(dst, "templates", "pt-BR", "scaffold", "HEARTBEAT.md")));
    assert.ok(existsSync(path.join(dst, "templates", "README.instance.md")), "the English fallback must ship too");
    assert.equal(existsSync(path.join(dst, "tests", "clone-locale.test.mjs")), false);
    assert.equal(existsSync(path.join(dst, "tests", "fixtures", "instance-config-pt-br.yaml")), false);
  } finally {
    rmSync(dst, { recursive: true, force: true });
  }
});

test("exclusion rules: another language's templates stay behind; this suite and its fixture never ship", () => {
  assert.equal(isOtherLanguageTemplate("templates/pt-BR/README.instance.md", "en"), true);
  assert.equal(isOtherLanguageTemplate("templates/pt-BR/partials/cheatsheet.md", "es"), true);
  assert.equal(isOtherLanguageTemplate("templates/pt-BR/README.instance.md", "pt-BR"), false);
  // Not language directories.
  assert.equal(isOtherLanguageTemplate("templates/partials/cheatsheet.md", "en"), false);
  assert.equal(isOtherLanguageTemplate("templates/scaffold/HEARTBEAT.md", "en"), false);
  assert.equal(isOtherLanguageTemplate("templates/README.instance.md", "pt-BR"), false);
  assert.equal(isOtherLanguageTemplate("docs/pt-BR/x.md", "en"), false);
  assert.equal(isPathExcluded("tests/clone-locale.test.mjs"), true);
  assert.equal(isPathExcluded("tests/fixtures/instance-config-pt-br.yaml"), true);
});

test("a language with no templates falls back to English without failing, and says so", () => {
  const v = variant((c) => { c.org.language = "fr"; });
  const { dst, r } = clone(v.file);
  try {
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /no templates for "fr"[^\n]*English/);
    assert.match(read(dst, "README.md"), /## What this is/);
    assert.match(read(dst, "HEARTBEAT.md"), /## Active Tasks/);
    assert.match(read(dst, "GETTING-STARTED.md"), /# Getting started with/);
    // The organisation still said what it works in: recorded, and agents are told — in English.
    assert.equal(yaml.load(read(dst, "federation.yaml")).identity.language, "fr");
    for (const rel of ["CLAUDE.md", "AGENTS.md"]) {
      assert.match(read(dst, rel), /## Working language/, rel);
      assert.match(read(dst, rel), /`fr`/, rel);
    }
    assert.equal(existsSync(path.join(dst, "templates", "pt-BR")), false);
  } finally {
    rmSync(dst, { recursive: true, force: true });
    rmSync(v.dir, { recursive: true, force: true });
  }
});

test("a value that is not a language tag is ignored — English, nothing recorded, no path built from it", () => {
  for (const bad of ["../../etc", "Portuguese (Brazil)", "partials", 42]) {
    const v = variant((c) => { c.org.language = bad; });
    const { dst, r } = clone(v.file);
    try {
      assert.equal(r.status, 0, `"${bad}": ${r.stderr}`);
      assert.match(r.stdout, /not a language tag[^\n]*English/, `"${bad}"`);
      assert.match(read(dst, "README.md"), /## What this is/);
      assert.equal(yaml.load(read(dst, "federation.yaml")).identity.language, undefined);
      assert.doesNotMatch(read(dst, "CLAUDE.md"), /Working language/);
    } finally {
      rmSync(dst, { recursive: true, force: true });
      rmSync(v.dir, { recursive: true, force: true });
    }
  }
});

test("the tag is matched whatever its case: pt-br is pt-BR", () => {
  const v = variant((c) => { c.org.language = "pt-br"; });
  const { dst, r } = clone(v.file);
  try {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(yaml.load(read(dst, "federation.yaml")).identity.language, "pt-BR");
    assert.match(read(dst, "README.md"), /## O que é isto/);
  } finally {
    rmSync(dst, { recursive: true, force: true });
    rmSync(v.dir, { recursive: true, force: true });
  }
});

test("`language: en` is the default spelled out: the same output as no language at all", () => {
  const strip = (c) => { delete c.org.language; };
  const a = variant(strip);
  const b = variant((c) => { c.org.language = "en"; });
  const ca = clone(a.file);
  const cb = clone(b.file);
  try {
    assert.equal(ca.r.status, 0, ca.r.stderr);
    assert.equal(cb.r.status, 0, cb.r.stderr);
    for (const rel of [...LOCALISED_FILES, "federation.yaml", ".gitignore"]) {
      assert.equal(read(cb.dst, rel), read(ca.dst, rel), `${rel} differs`);
    }
    assert.deepEqual(readdirSync(path.join(cb.dst, "templates")).sort(), readdirSync(path.join(ca.dst, "templates")).sort());
  } finally {
    for (const d of [ca.dst, cb.dst, a.dir, b.dir]) rmSync(d, { recursive: true, force: true });
  }
});

test("a cloned pt-BR instance passes its own validate:structure and validate:schemas", () => {
  const { dst, r } = clone(ptConfigPath);
  try {
    assert.equal(r.status, 0, r.stderr);
    symlinkSync(path.join(rootDir, "node_modules"), path.join(dst, "node_modules"), "dir");
    // The operator's documented first steps, in order: generate:schemas, then the validators.
    for (const script of ["scripts/generate-all-schemas.mjs", "scripts/validate-structure.mjs", "scripts/validate-identity.mjs"]) {
      const v = spawnSync("node", [script], { cwd: dst, encoding: "utf-8", timeout: 120_000 });
      assert.equal(v.status, 0, `${script} failed in the pt-BR clone:\n${v.stdout}${v.stderr}`);
    }
  } finally {
    rmSync(dst, { recursive: true, force: true });
  }
});

test("the instance doctor finds a cloned pt-BR instance healthy: no blocker but the missing remote", () => {
  // With git, as in tests/clone-framework-health.test.mjs: git-remote-absent only
  // appears once the directory is a repository.
  const { dst, r } = clone(ptConfigPath, { git: true });
  try {
    assert.equal(r.status, 0, `clone failed: ${r.stderr}${r.stdout}`);
    const d = spawnSync("node", [doctorScript, "assess", "--dir", dst, "--json", "--no-validators"], {
      encoding: "utf-8", timeout: 120_000,
    });
    const blockers = JSON.parse(d.stdout).checks
      .flatMap((c) => c.findings)
      .filter((f) => f.level === "BLOCKER");
    assert.deepEqual(blockers.map((b) => b.code), ["git-remote-absent"]);
    // The genesis commit is the instance's first commit message — in its language.
    const subject = spawnSync("git", ["log", "-1", "--format=%s"], { cwd: dst, encoding: "utf-8" }).stdout.trim();
    assert.match(subject, /^chore: instância criada a partir do framework org-os \(genesis\)$/);
  } finally {
    rmSync(dst, { recursive: true, force: true });
  }
});
