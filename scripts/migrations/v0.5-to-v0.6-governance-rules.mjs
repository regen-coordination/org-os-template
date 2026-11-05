#!/usr/bin/env node
/**
 * v0.5-to-v0.6-governance-rules.mjs — idempotent migration from 0.5 → 0.6 (F2): roles and
 * rules in data/governance.yaml, from what the instance already says about itself.
 *
 * Usage:
 *   node scripts/migrations/v0.5-to-v0.6-governance-rules.mjs <root> --dry       (first: what it would do)
 *   node scripts/migrations/v0.5-to-v0.6-governance-rules.mjs <root>             (then: do the certain part)
 *   node scripts/migrations/v0.5-to-v0.6-governance-rules.mjs <root> --confirm roles,rules
 *   node scripts/migrations/v0.5-to-v0.6-governance-rules.mjs <root> --confirm all
 *   doctor sync runs it through the runner (node scripts/migrate.mjs <root> --target 0.6), after
 *   canonical-records, with no flags: it writes only what is certain and prints the rest.
 *
 *   root       the instance to migrate; defaults to the repository this file sits in.
 *   --dry      say what would be written and what needs people, and write nothing, log included.
 *   --confirm  write the proposed parts you name (roles, rules, or all). Without it a part that
 *              is inferred from a field the instance wrote, rather than certain, is only printed.
 *
 * What it does (F2 spec §3.9):
 *   Roles, when governance has none:
 *     - model solo-maintainer (or none) and exactly one member of kind person: written, because
 *       it is certain: roles.maintainer = that member. A person added later is then not a
 *       maintainer unless the roles say so.
 *     - model solo with several people: nothing written; it says to name the maintainers.
 *     - any other model: the members with `layer: core` or `stakeholder_group: core-team` are
 *       PROPOSED as maintainer (and `member: { all: true }`); written only with --confirm.
 *   Rules, when governance has none:
 *     - solo: nothing. The solo default is the rule, and writing it out would turn a default
 *       into an edit people must maintain.
 *     - consensus: PROPOSED, from the architecture's example: records by one approval; every
 *       other class by consent over an objection window of P7D (the framework default: the
 *       prose names a window and no length). Written only with --confirm, and only beside roles.
 *     - any other model: reported. The framework has no default method for it.
 *   Prose is never read: a member's free `role:` text ("Founder and Strategy Lead") is not a
 *   governance role. No git address is read from anywhere: it prints the line to add.
 *   No rules that lock an org out (DAO-OS L5 spec §8.1 point 4, F-L3-1): even with --confirm, rules
 *   are written only when each role that proposes under them holds a person with a git or wallet
 *   handle. Otherwise nothing is written, and it prints the owner's claim command instead.
 *
 * The file is edited as text: the new keys are inserted inside `governance:` and every other
 * byte, comment and line ending stays. The result is parsed and compared with the original
 * plus the new keys; if it differs in any other way nothing is written.
 *
 * Standalone (js-yaml only): instances carry no packages/admin.
 */

import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync, statSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const NAME = "v0.5-to-v0.6-governance-rules";
const CONFIRM_KEYS = ["roles", "rules"];
const WINDOW = "P7D";

const args = process.argv.slice(2);
let dry = false;
const confirmed = new Set();
let rootArg = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--dry") dry = true;
  else if (a === "--confirm") {
    const value = args[++i];
    const keys = String(value ?? "").split(",").map((k) => k.trim()).filter(Boolean);
    if (keys.length === 0 || keys.some((k) => ![...CONFIRM_KEYS, "all"].includes(k))) {
      console.error("--confirm takes roles, rules or all (several with commas, such as roles,rules).");
      process.exit(2);
    }
    for (const k of keys) (k === "all" ? CONFIRM_KEYS : [k]).forEach((x) => confirmed.add(x));
  } else if (a.startsWith("--")) {
    console.error(`unknown option ${a}`);
    process.exit(2);
  } else if (rootArg === null) rootArg = a;
  else {
    console.error(`one path at most, and "${a}" is a second`);
    process.exit(2);
  }
}
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
let wrote = false; // the receipt records changes: a run that changed nothing adds nothing to it
const reports = [];
const report = (msg) => reports.push(msg);
/** @type {{ title: string, block: string, key: string }[]} */
const proposals = [];

const isMap = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const firstLine = (err) => String(err?.message ?? err).split("\n")[0];
const readText = (rel) => (existsSync(path.join(rootDir, rel)) ? readFileSync(path.join(rootDir, rel), "utf-8") : null);

// ── members ──────────────────────────────────────────────────────────────────
function readMembers() {
  const text = readText("data/members.yaml");
  if (text === null) return [];
  try {
    const doc = yaml.load(text);
    return Array.isArray(doc?.members) ? doc.members.filter((m) => isMap(m) && m.id !== undefined && m.id !== null && m.id !== "") : [];
  } catch (err) {
    report(`data/members.yaml is not valid YAML (${firstLine(err)}): its members were not looked at.`);
    return [];
  }
}
// Absent, `person` and `type: individual` are people; agent, organization and role are not.
const kindOf = (m) => (["person", "agent", "organization", "role"].includes(m.kind) ? m.kind : "person");
const hasGitAddress = (m) => {
  const h = isMap(m.handles) ? m.handles : {};
  return [h.git, h.email, m.email].flat().some((v) => typeof v === "string" && v.trim() !== "");
};

// ── governance.yaml: read it, or say why not ─────────────────────────────────
const govText = readText("data/governance.yaml");
let block = null;
let doc = null;
note(`${NAME}: ${dry ? "dry run (nothing is written)" : "running"} in the instance root (.)`);

if (govText === null) {
  note("  · no data/governance.yaml: the platform reads that as the solo default; nothing to write");
} else {
  let docs = null;
  try {
    docs = yaml.loadAll(govText).filter((d) => d !== null && d !== undefined);
  } catch (err) {
    report(`data/governance.yaml is not valid YAML (${firstLine(err)}): left as it is.`);
  }
  if (docs !== null) {
    if (docs.length > 1) {
      report(`data/governance.yaml holds ${docs.length} YAML documents, separated by \`---\`, where a registry is one: merge them into one document under \`governance:\` by hand. Left as it is.`);
    } else if (!isMap(docs[0]) || !isMap(docs[0].governance)) {
      report("data/governance.yaml has no `governance:` block (a flat file): put its keys under `governance:` first, then run this again. Left as it is.");
    } else if (!/^governance:\s*(#.*)?\r?$/m.test(govText)) {
      report("data/governance.yaml's `governance:` block is written in flow style: this migration edits block-style files only. Left as it is.");
    } else {
      doc = docs[0];
      block = doc.governance;
    }
  }
}

// ── plan ─────────────────────────────────────────────────────────────────────
const members = readMembers();
const persons = members.filter((m) => kindOf(m) === "person");
const q = (v) => JSON.stringify(String(v));
const rolesLines = (ids, withMember) => [
  "roles:",
  `  maintainer: { members: [${ids.map(q).join(", ")}] }`,
  ...(withMember ? ["  member: { all: true }"] : []),
];
// The architecture's example sends `treasury` to a Safe. A Safe is a System, so it can be named
// only where data/systems.yaml (F1's migration writes it first) holds exactly one of kind safe.
const systems = (() => {
  const text = readText("data/systems.yaml");
  if (text === null) return [];
  try {
    const list = yaml.load(text)?.systems;
    return Array.isArray(list) ? list.filter(isMap) : [];
  } catch {
    return [];
  }
})();
const safes = systems.filter((x) => x.kind === "safe" && typeof x.id === "string").map((x) => x.id);
const treasurySafe = safes.length === 1 ? safes[0] : null;
const rulesLines = (safe) => [
  "rules:",
  "  - id: records",
  "    applies_to: [records]",
  "    propose: member",
  "    decide: { by: maintainer, method: approve, count: 1 }",
  "  - id: governance",
  `    applies_to: [governance, members, identity, systems, ${safe === null ? "treasury, " : ""}operations, publication]`,
  "    propose: maintainer",
  `    decide: { by: maintainer, method: consent, window: ${WINDOW} }`,
  ...(safe === null ? [] : [
    "  - id: treasury",
    "    applies_to: [treasury]",
    "    propose: maintainer",
    `    decide: { by: system, system: ${q(safe)} }`,
  ]),
];
const treasuryNote = treasurySafe !== null
  ? `Where it departs from the architecture's example: it also covers operations, which the example leaves out, and treasury is decided by the System ${treasurySafe}, which data/systems.yaml names, as in the example.`
  : safes.length > 1
    ? "Where it departs from the architecture's example: the example sends treasury to a Safe, and data/systems.yaml names more than one Safe, which this migration will not choose between. Treasury is under consent here; change it to a rule with decide: { by: system, system: <id> } once you say which."
    : "Where it departs from the architecture's example: the example sends treasury to a Safe, and this instance has no System of kind safe in data/systems.yaml. Treasury is under consent here; once a Safe is named, change it to a rule with decide: { by: system, system: <id> }.";

// ── who can act (L5 spec §7.6, §8.1) ─────────────────────────────────────────
// A standalone copy of packages/admin/lib/rules.mjs `canAct` (instances carry no packages/admin; change both together):
// a person with a git address (handles.git, handles.email, a top-level email) or a CAIP-10 wallet (handles.wallet).
// With a membership tree known (governance.membership.tree, or the only hats-tree System), a wallet counts only on the
// tree's chain and only when exactly one member lists it. Unlike the library, it cannot check an EIP-55 checksum
// (there is no keccak here), so an address in any case passes.
const CAIP10 = /^(eip155:[0-9]{1,32}):(0x[0-9a-fA-F]{40})$/;
const walletsOf = (m) => {
  const h = isMap(m.handles) ? m.handles : {};
  return [h.wallet].flat().filter((v) => typeof v === "string").map((v) => CAIP10.exec(v.trim())).filter(Boolean).map((x) => `${x[1]}:${x[2].toLowerCase()}`);
};
const treeChain = (() => {
  const trees = systems.filter((x) => x.kind === "hats-tree");
  const named = block !== null && isMap(block.membership) && typeof block.membership.tree === "string" ? block.membership.tree : null;
  const tree = named !== null ? trees.find((x) => String(x.id) === named) : trees.length === 1 ? trees[0] : undefined;
  const id = String(tree?.address ?? "");
  const treeId = /^[0-9]+$/.test(id) ? Number(id) : /^0x[0-9a-fA-F]{8}$/.test(id) ? parseInt(id, 16) : 0;
  return tree && /^eip155:[0-9]+$/.test(String(tree.chain)) && treeId >= 1 && treeId <= 0xffffffff ? String(tree.chain) : null;
})();
const canAct = (m) => kindOf(m) === "person" && (hasGitAddress(m) ||
  walletsOf(m).some((w) => treeChain === null || (w.startsWith(`${treeChain}:`) && members.filter((o) => walletsOf(o).includes(w)).length === 1)));
/** The members a role holds, as the platform reads it (lib/rules.mjs `resolveRoles`): listed ids, every person for
 *  `all: true`, every person for an undefined maintainer. */
const holders = (roles, id) => {
  const def = isMap(roles) ? roles[id] : undefined;
  if (isMap(def) && Array.isArray(def.members)) return def.members.map((x) => members.find((m) => String(m.id) === String(x))).filter(Boolean);
  if ((isMap(def) && def.all === true) || (def === undefined && id === "maintainer")) return persons;
  return [];
};
/** Whether someone could propose in this role: it is sourced from a hat (whoever signs in wearing it), or it holds a
 *  person who can act. */
const canPropose = (roles, id) => (isMap(roles) && isMap(roles[id]) && roles[id].hat !== undefined) || holders(roles, id).some(canAct);

/** @type {{ key: string, label: string, lines: string[], why: string }[]} */
const writes = [];
let maintainers = []; // ids, for the git-address advice

if (block !== null) {
  const rawModel = block.model ?? block.decision_model;
  const model = typeof rawModel === "string" ? rawModel.trim() : "";
  const solo = model === "" || model === "solo-maintainer";
  const rolesWritten = Array.isArray(block.roles) ? block.roles.length > 0 : isMap(block.roles) && Object.keys(block.roles).length > 0;
  const rulesWritten = Array.isArray(block.rules) && block.rules.length > 0;
  if (Array.isArray(block.roles) && block.roles.length > 0) {
    report("data/governance.yaml `roles` is a list; roles are a map from a role name to { members: [...] } or { all: true }. Rewrite it by hand: it was left as it is.");
  }

  if (rolesWritten) {
    note("  · data/governance.yaml already has roles; left as they are");
    if (isMap(block.roles)) maintainers = (isMap(block.roles.maintainer) && Array.isArray(block.roles.maintainer.members) ? block.roles.maintainer.members : []).map(String);
  } else if (solo) {
    if (persons.length === 1) {
      const id = String(persons[0].id);
      writes.push({ key: "roles", label: "roles.maintainer", lines: rolesLines([id], false), why: `the one person in data/members.yaml (${id})` });
      maintainers = [id];
    } else if (persons.length === 0) {
      report("data/members.yaml has no member of kind person (or there is no members file): there is no one to name as the maintainer.");
    } else {
      report(`the model is solo-maintainer, but data/members.yaml lists ${persons.length} people, and the solo rule lets each of ${persons.length} people decide alone. Name the maintainers in governance.roles.maintainer, or give the members who are not people their kind.`);
    }
  } else {
    const core = persons.filter((m) => m.layer === "core" || m.stakeholder_group === "core-team").map((m) => String(m.id));
    if (core.length === 0) {
      report(`the model is ${model}, and no member carries layer: core or stakeholder_group: core-team, so no maintainers can be proposed. Write governance.roles by hand.`);
    } else {
      proposals.push({
        key: "roles",
        title: `Roles, proposed from \`layer: core\` / \`stakeholder_group: core-team\` (${core.length} member${core.length === 1 ? "" : "s"}). Check each is a maintainer, and that no maintainer is missing:`,
        block: rolesLines(core, true).join("\n"),
      });
      maintainers = core;
    }
  }

  if (rulesWritten) {
    note("  · data/governance.yaml already has rules; left as they are");
  } else if (solo) {
    note("  · the solo default is the rule (no rules written)");
  } else if (model === "consensus") {
    proposals.push({
      key: "rules",
      title: `Rules, proposed for model: consensus: records by one approval, everything else by consent over an objection window. The prose names a window and no length; ${WINDOW} is the framework default, so confirm it or change it. ${treasuryNote}`,
      block: rulesLines(treasurySafe).join("\n"),
    });
  } else {
    report(`the model is ${model}, and ${model} has no default method in the framework: a rule is a decision for the people of this org. Write governance.rules by hand (docs/DATA-MODEL.md, governance).`);
  }

  // Confirmed proposals become writes. Rules name roles, so they need roles to exist.
  const rolesWillExist = rolesWritten || writes.some((w) => w.key === "roles") || (confirmed.has("roles") && proposals.some((p) => p.key === "roles"));
  for (const key of CONFIRM_KEYS) {
    const at = proposals.findIndex((p) => p.key === key);
    if (at < 0 || !confirmed.has(key)) continue;
    if (key === "rules" && !rolesWillExist) {
      report("--confirm rules was not written: rules need the roles they name. Confirm the roles too (--confirm roles,rules), or write governance.roles by hand first.");
      continue;
    }
    const [p] = proposals.splice(at, 1);
    writes.push({ key, label: key, lines: p.block.split("\n"), why: "confirmed" });
  }

  // No rules that lock an org out (L5 spec §8.1 point 4): each role the rules name to propose must hold a person who
  // can act. If one does not, nothing at all is written: the roles were confirmed to go with these rules.
  const ruleWrite = writes.find((w) => w.key === "rules");
  if (ruleWrite) {
    const roleWrite = writes.find((w) => w.key === "roles");
    const roles = roleWrite ? yaml.load(roleWrite.lines.join("\n")).roles : isMap(block.roles) ? block.roles : {};
    const proposing = [...new Set(yaml.load(ruleWrite.lines.join("\n")).rules.map((r) => r.propose))];
    const stuck = proposing.filter((role) => !canPropose(roles, role));
    if (stuck.length > 0) {
      writes.length = 0;
      const first = (holders(roles, stuck.includes("maintainer") ? "maintainer" : stuck[0])[0] ?? persons[0])?.id ?? "<id>";
      report(`--confirm rules was not written, nor anything with it: nobody could propose under them. The ${stuck.join(" and ")} role${stuck.length === 1 ? "" : "s"} ` +
        "would hold no person with a git or wallet handle, and rules that leave nobody able to propose lock the org out. Give one of them a handle first: " +
        `the owner's claim, run from the framework, is node scripts/claim-handle.mjs --repo <instance> --owner --member ${first} (--git <email> | --wallet <CAIP-10>). Then run this again.`);
    }
  }
}

// ── write ────────────────────────────────────────────────────────────────────
/**
 * Insert (or put in place of an empty `roles: []`) the keys, as text, inside the governance block.
 * Returns the new text, or throws with the reason it cannot be done without risk.
 */
function edit(text, list, original) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const gAt = lines.findIndex((l) => /^governance:\s*(#.*)?$/.test(l));
  if (gAt < 0) throw new Error("no `governance:` line");
  const child = (() => {
    for (let i = gAt + 1; i < lines.length; i++) {
      if (lines[i].trim() === "" || /^\s*#/.test(lines[i])) continue;
      const m = /^(\s+)\S/.exec(lines[i]);
      return m ? m[1] : "  ";
    }
    return "  ";
  })();
  const endOf = () => {
    let i = gAt + 1;
    for (; i < lines.length; i++) if (lines[i].length > 0 && !/^\s/.test(lines[i])) break;
    return i;
  };
  let first = true;
  for (const { key, lines: body } of list) {
    const text = body.map((l) => child + l);
    if (first) text.unshift(`${child}# Added by ${NAME} (0.6 F2); see docs/DATA-MODEL.md, governance.`);
    first = false;
    const end = endOf();
    const at = lines.slice(gAt + 1, end).findIndex((l) => new RegExp(`^${child}${key}:\\s*(\\[\\s*\\]|\\{\\s*\\}|null|~)?\\s*(#.*)?$`).test(l));
    if (at >= 0) {
      lines.splice(gAt + 1 + at, 1, ...text);
      continue;
    }
    const decisions = lines.slice(gAt + 1, end).findIndex((l) => new RegExp(`^${child}decisions:`).test(l));
    let insertAt;
    if (decisions >= 0) insertAt = gAt + 1 + decisions;
    else {
      insertAt = gAt + 1;
      for (let i = gAt + 1; i < end; i++) if (lines[i].trim() !== "" && !/^\s*#/.test(lines[i])) insertAt = i + 1;
    }
    lines.splice(insertAt, 0, ...text);
  }
  const out = lines.join(eol);
  // The result must be the original and the new keys, and nothing else.
  const after = yaml.load(out);
  const expected = { ...original.doc, governance: { ...original.block } };
  for (const { key, lines: body } of list) expected.governance[key] = yaml.load(body.join("\n"))[key];
  if (!isDeepStrictEqual(after, expected)) throw new Error("the edited file does not parse to the original plus the new keys");
  return out;
}

if (writes.length > 0 && block !== null) {
  const govPath = path.join(rootDir, "data", "governance.yaml");
  try {
    const out = edit(govText, writes, { doc, block });
    for (const w of writes) note(`  ${dry ? "would write" : "✓ wrote"} ${w.label} — ${w.why}`);
    if (!dry) {
      writeFileSync(govPath, out);
      wrote = true;
    }
  } catch (err) {
    report(`could not add ${writes.map((w) => w.key).join(" and ")} to data/governance.yaml without changing something else (${firstLine(err)}): nothing was written. Add this by hand, under \`governance:\`:\n${writes.map((w) => w.lines.map((l) => `      ${l}`).join("\n")).join("\n")}`);
  }
}

// Members who will be maintainers, and have no address git commits are matched by.
const byId = new Map(members.map((m) => [String(m.id), m]));
for (const id of new Set(maintainers)) {
  const m = byId.get(id);
  if (m && !hasGitAddress(m)) {
    report(`${id} has no handles.git, so the platform cannot tell which commits are theirs and stays read-only for them. Add, under their entry in data/members.yaml:\n      handles:\n        git: ["<the address ${m.name ?? id} commits with>"]`);
  }
}

if (proposals.length > 0) {
  note("\n  Needs your confirmation — inferred from fields this instance wrote, so not written:");
  for (const p of proposals) {
    note(`\n  ${p.title}\n`);
    for (const l of p.block.split("\n")) note(`      ${l}`);
  }
  const keys = proposals.map((p) => p.key).join(",");
  note(`\n  To write ${proposals.length === 1 ? "it" : "them"}, run, from the instance root: node scripts/migrations/${NAME}.mjs . --confirm ${keys}`);
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
