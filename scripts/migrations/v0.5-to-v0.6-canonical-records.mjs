#!/usr/bin/env node
/**
 * v0.5-to-v0.6-canonical-records.mjs — additive, idempotent migration from 0.5 → 0.6 (F1).
 *
 * Usage:
 *   node scripts/migrations/v0.5-to-v0.6-canonical-records.mjs --dry   (first: what it would do)
 *   node scripts/migrations/v0.5-to-v0.6-canonical-records.mjs         (then: do it)
 *   node scripts/migrations/v0.5-to-v0.6-canonical-records.mjs [root] [--dry]
 *   doctor sync runs it through the runner: node scripts/migrate.mjs <root> --target 0.6
 *
 *   root   the instance to migrate; defaults to the repository this file sits in.
 *   --dry  say what would be written and what needs people, and write nothing:
 *          no data/systems.yaml, no memory/ log.
 *
 * What it does:
 *   1. Creates data/systems.yaml (schema_version "1.0") from governance.yaml
 *      `infrastructure` and federation.yaml `identity` — safe, gardens,
 *      hats / hats_tree, snapshot — one System per address. The originals are
 *      never edited or deleted. A data/systems.yaml that already exists is never
 *      rewritten: what it lacks is listed instead.
 *   2. Reports, without fixing, what only people can resolve: a governance.yaml
 *      holding several YAML documents, an address the two files disagree on, a
 *      value that is not an address, members whose `kind` or `layer` is unclear.
 *   3. Logs to memory/migrations-YYYY-MM-DD.md, like the migrations before it.
 *
 * Standalone (js-yaml only): instances carry no packages/admin.
 */

import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const NAME = "v0.5-to-v0.6-canonical-records";
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const CAIP2 = /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/;
const DEFAULT_LAYERS = ["core", "contributor", "community", "observer"];
const KINDS = ["person", "agent", "organization", "role"];

/** What each outside system becomes in systems.yaml, by the key it was found under. */
const SHAPES = {
  safe: { id: "treasury-safe", kind: "safe", name: "Treasury", label: "Safe address", driver: "safe", section: "organization/treasury", valid: (v) => ADDRESS.test(v) },
  gardens: { id: "gardens-pool", kind: "gardens-pool", name: "Gardens pool", label: "Gardens pool address", valid: (v) => ADDRESS.test(v) },
  hats: { id: "hats-tree", kind: "hats-tree", name: "Hats tree", label: "Hats tree id", valid: (v) => /^\S+$/.test(v) },
  snapshot: { id: "snapshot-space", kind: "snapshot-space", name: "Snapshot space", label: "Snapshot space", valid: (v) => /^\S+$/.test(v) },
};

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const rootArg = args.find((a) => !a.startsWith("--"));
const rootDir = path.resolve(rootArg ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".."));

// A mistyped root must not become a place we write into.
if (!existsSync(rootDir) || !statSync(rootDir).isDirectory() || !(existsSync(path.join(rootDir, "federation.yaml")) || existsSync(path.join(rootDir, "data")))) {
  console.error(`${rootDir} is not an org-os instance (no federation.yaml or data/ there): nothing was read or written.`);
  process.exit(2);
}

const log = [];
function note(msg) {
  console.log(msg);
  log.push(msg);
}
const reports = [];
function report(msg) {
  reports.push(msg);
}

function readText(rel) {
  const full = path.join(rootDir, rel);
  return existsSync(full) ? readFileSync(full, "utf-8") : null;
}
const isMap = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const firstLine = (err) => String(err?.message ?? err).split("\n")[0];

/** governance.yaml's `infrastructure`, read leniently: the wrapper, or a flat file. Never several documents. */
function governanceInfrastructure() {
  const text = readText("data/governance.yaml");
  if (text === null) return {};
  let docs;
  try {
    docs = yaml.loadAll(text).filter((d) => d !== null && d !== undefined);
  } catch (err) {
    report(`data/governance.yaml is not valid YAML (${firstLine(err)}): nothing was read from it.`);
    return {};
  }
  if (docs.length > 1) {
    report(`data/governance.yaml holds ${docs.length} YAML documents, separated by \`---\`, where a registry is one: merge them into one document under \`governance:\` by hand. Nothing was read from it.`);
    return {};
  }
  const top = isMap(docs[0]) ? docs[0] : {};
  const block = isMap(top.governance) ? top.governance : top;
  return isMap(block.infrastructure) ? block.infrastructure : {};
}

function federationIdentity() {
  const text = readText("federation.yaml");
  if (text === null) return {};
  try {
    const fed = yaml.load(text);
    return isMap(fed?.identity) ? fed.identity : {};
  } catch (err) {
    report(`federation.yaml is not valid YAML (${firstLine(err)}): nothing was read from it.`);
    return {};
  }
}

const infra = governanceInfrastructure();
const identity = federationIdentity();

// Non-null infrastructure entries under keys this script does not know: only people can place them.
const KNOWN_INFRA = ["safe", "chain", "gardens", "hats_tree", "hats", "snapshot"];
const isSet = (v) => v !== null && v !== undefined && String(v).trim() !== "";
const unknownInfra = Object.keys(infra).filter((k) => !KNOWN_INFRA.includes(k) && isSet(infra[k]));
for (const k of unknownInfra) {
  report(`data/governance.yaml infrastructure.${k} is ${JSON.stringify(infra[k])}, a key this migration does not know: not migrated. Add it to data/systems.yaml by hand if it is an outside system.`);
}
const complete = unknownInfra.length === 0;

// Where each value was found. `chain` beside `safe` in governance.yaml is one instance's own key.
const found = [
  { key: "safe", value: infra.safe, from: "data/governance.yaml infrastructure.safe" },
  { key: "gardens", value: infra.gardens, from: "data/governance.yaml infrastructure.gardens" },
  { key: "hats", value: infra.hats_tree, from: "data/governance.yaml infrastructure.hats_tree" },
  { key: "hats", value: infra.hats, from: "data/governance.yaml infrastructure.hats" },
  { key: "snapshot", value: infra.snapshot, from: "data/governance.yaml infrastructure.snapshot" },
  { key: "safe", value: identity.safe, from: "federation.yaml identity.safe" },
  { key: "gardens", value: identity.gardens, from: "federation.yaml identity.gardens" },
  { key: "hats", value: identity.hats, from: "federation.yaml identity.hats" },
  { key: "snapshot", value: identity.snapshot, from: "federation.yaml identity.snapshot" },
].filter((f) => f.value !== null && f.value !== undefined && String(f.value).trim() !== "");

// Every chain written down, valid or not: one that is present but not CAIP-2 is named, never read as absent.
const isCaip2 = (v) => typeof v === "string" && CAIP2.test(v.trim());
const chains = [
  { value: infra.chain, from: "data/governance.yaml infrastructure.chain" },
  { value: identity.chain, from: "federation.yaml identity.chain" },
].filter((c) => isSet(c.value));
const goodChains = chains.filter((c) => isCaip2(c.value));
const badChains = chains.filter((c) => !isCaip2(c.value));
const validChains = [...new Set(goodChains.map((c) => c.value.trim()))];
const CAIP2_EXAMPLE = 'a CAIP-2 chain id (such as "eip155:42220")';
const shown = (v) => JSON.stringify(v);
let chain = null;
if (validChains.length > 1) {
  report(`the chain disagrees between ${goodChains.map((c) => `${c.from} (${c.value})`).join(" and ")}: no on-chain system was migrated. Decide which chain the org's systems are on.`);
} else if (validChains.length === 1) {
  chain = validChains[0];
}
if (validChains.length > 0) {
  for (const c of badChains) {
    report(`${c.from} is ${shown(c.value)}, which is not ${CAIP2_EXAMPLE}: ignored; the systems were ${chain ? `migrated on ${chain}, from ${goodChains.map((g) => g.from).join(", ")}` : "not migrated (above)"}. Correct it or remove it.`);
  }
}

const systems = [];
for (const key of Object.keys(SHAPES)) {
  const shape = SHAPES[key];
  const here = found.filter((f) => f.key === key);
  const usable = [];
  for (const f of here) {
    if (typeof f.value !== "string" && typeof f.value !== "number") {
      report(`${f.from} is not a single value: not migrated.`);
    } else if (key !== "hats" && typeof f.value === "number") {
      report(`${f.from} reads as a number, not an address: put the address in quotes in the file. Not migrated.`);
    } else if (!shape.valid(String(f.value).trim())) {
      report(`${f.from} is "${f.value}", which is not ${key === "safe" || key === "gardens" ? "a 0x address" : "a single word"}: not migrated.`);
    } else {
      usable.push({ ...f, value: String(f.value).trim() });
    }
  }
  if (usable.length === 0) continue;
  const distinct = [...new Set(usable.map((u) => u.value.toLowerCase()))];
  if (distinct.length > 1) {
    report(`the ${shape.label} disagrees between ${usable.map((u) => `${u.from} (${u.value})`).join(" and ")}: neither was migrated. Decide which is right and add it to data/systems.yaml.`);
    continue;
  }
  const value = usable[0].value;
  const sources = usable.map((u) => u.from);
  if (key === "snapshot") {
    const url = /^https?:\/\//.test(value) ? value : `https://snapshot.org/#/${value}`;
    systems.push({ id: shape.id, kind: shape.kind, name: shape.name, url, sources });
    continue;
  }
  if (!chain) {
    if (validChains.length === 0 && badChains.length > 0) {
      report(`the ${shape.label} ${value} (from ${sources.join(", ")}) was not migrated: its chain is not ${CAIP2_EXAMPLE}: ${badChains.map((c) => `${c.from} is ${shown(c.value)}`).join(", ")}. Add it to data/systems.yaml with its CAIP-2 chain.`);
    } else if (validChains.length === 0) {
      report(`the ${shape.label} ${value} (from ${sources.join(", ")}) has no chain beside it in either file: not migrated. Add it to data/systems.yaml with its CAIP-2 chain.`);
    }
    continue;
  }
  const system = { id: shape.id, kind: shape.kind, name: shape.name, chain, address: value, sources };
  if (shape.driver) system.driver = shape.driver;
  if (shape.section) system.section = shape.section;
  systems.push(system);
}

// Members the platform cannot read a kind or a layer for with confidence.
const membersText = readText("data/members.yaml");
if (membersText !== null) {
  let members = [];
  try {
    const doc = yaml.load(membersText);
    members = Array.isArray(doc?.members) ? doc.members.filter(isMap) : [];
  } catch (err) {
    report(`data/members.yaml is not valid YAML (${firstLine(err)}): its members were not looked at.`);
  }
  const layers = new Map();
  for (const m of members) {
    const id = m.id ?? "(no id)";
    if (m.kind !== undefined && m.kind !== null && !KINDS.includes(m.kind)) {
      report(`member "${id}": kind "${m.kind}" is not one of ${KINDS.join(", ")}.`);
    } else if ((m.kind === undefined || m.kind === null) && m.type !== undefined && m.type !== null && m.type !== "individual") {
      report(`member "${id}": type "${m.type}" says nothing the platform reads, so it counts as a person. Add kind (${KINDS.join(", ")}) if it is not one.`);
    }
    if (typeof m.layer === "string" && !DEFAULT_LAYERS.includes(m.layer)) layers.set(m.layer, (layers.get(m.layer) ?? 0) + 1);
  }
  if (layers.size > 0) {
    report(`members use layer values outside the default vocabulary (${DEFAULT_LAYERS.join(", ")}): ${[...layers].map(([l, n]) => `${l} ×${n}`).join(", ")}. They stay valid (layer is open in 0.6); check each says what you mean.`);
  }
}

note(`${NAME}: ${dry ? "dry run (nothing is written)" : "running"} in the instance root (.)`);
let wrote = false; // the receipt records changes: a run that changed nothing adds nothing to it

const describe = (s) => `  + ${s.id} (${s.kind}) ${s.address ? `${s.chain} ${s.address}` : s.url} — from ${s.sources.join(", ")}`;

function systemsYaml(list) {
  const q = (v) => JSON.stringify(String(v));
  const lines = [
    'schema_version: "1.0"',
    "",
    "# Systems registry: the outside systems this org uses (docs/DATA-MODEL.md, systems.yaml).",
    `# Created by scripts/migrations/${NAME}.mjs from governance.yaml infrastructure`,
    "# and federation.yaml identity, which were left as they are.",
    "",
    "systems:",
  ];
  for (const s of list) {
    lines.push(`  - id: ${q(s.id)}`);
    for (const key of ["kind", "name", "chain", "address", "url", "driver", "section"]) {
      if (s[key] !== undefined) lines.push(`    ${key}: ${q(s[key])}`);
    }
  }
  return lines.join("\n") + "\n";
}

const systemsPath = path.join(rootDir, "data", "systems.yaml");
const existingText = readText("data/systems.yaml");
if (existingText !== null) {
  let have = null;
  try {
    const doc = yaml.load(existingText);
    have = new Set((Array.isArray(doc?.systems) ? doc.systems : []).filter(isMap).map((s) => String(s.address ?? s.url ?? "").toLowerCase()));
  } catch (err) {
    report(`data/systems.yaml is not valid YAML (${firstLine(err)}): it was left as it is.`);
  }
  if (have) {
    const missing = systems.filter((s) => !have.has(String(s.address ?? s.url).toLowerCase()));
    if (missing.length === 0) {
      note(`  · data/systems.yaml already holds every system ${complete ? "found" : "this migration could read"}; left as it is`);
    } else {
      report(`data/systems.yaml already exists, so it was not rewritten. It lacks ${missing.length} system(s) found elsewhere; add them through the admin or by hand:\n${missing.map(describe).join("\n")}`);
    }
  }
} else if (systems.length === 0) {
  note(`  · no outside systems ${complete ? "found to migrate" : "this migration could read"}; data/systems.yaml not created`);
} else {
  note(`  ${dry ? "would create" : "✓ created"} data/systems.yaml with ${systems.length} system(s):`);
  for (const s of systems) note(describe(s));
  if (!dry) {
    mkdirSync(path.dirname(systemsPath), { recursive: true });
    writeFileSync(systemsPath, systemsYaml(systems));
    wrote = true;
  }
}

if (reports.length > 0) {
  note(`\n  Needs people (${reports.length}) — reported, not fixed:`);
  for (const r of reports) note(`  ! ${r}`);
}

if (dry) {
  console.log("\n(--dry) Nothing was written.");
} else if (!wrote) {
  console.log("\nNothing was written, so nothing is added to the migration receipt.");
} else {
  const today = new Date().toISOString().slice(0, 10);
  const memDir = path.join(rootDir, "memory");
  if (!existsSync(memDir)) mkdirSync(memDir, { recursive: true });
  const logPath = path.join(memDir, `migrations-${today}.md`);
  const entry = `\n## ${NAME} — ${new Date().toISOString()}\n\n${log.map((l) => `- ${l.trim()}`).join("\n")}\n`;
  if (existsSync(logPath)) appendFileSync(logPath, entry);
  else writeFileSync(logPath, `# Migration log — ${today}\n${entry}`);
  console.log(`\n✓ Migration recorded in ${path.relative(rootDir, logPath)}`);
}
