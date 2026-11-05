#!/usr/bin/env node
/**
 * validate-governance.mjs — the rules of an org-os instance are well-formed, and its
 * git history does not contradict them (architecture §4.7, F2 spec §3.8).
 *
 * Usage: node scripts/validate-governance.mjs [path] [--strict] [--max <n>] [--range <rev-range>]
 *   path     root of the instance to check (default: the current directory)
 *   --strict history findings are errors (CI=true does the same); locally they are warnings
 *   --max    judge at most the newest n commits (default 500)
 *   --range  a revision range to walk instead of HEAD, such as origin/main..HEAD
 *
 * Part 1: data/governance.yaml read with data/members.yaml and data/systems.yaml: the roles
 * and rules are well-formed. These are errors, always.
 *
 * Part 2: the first-parent history, oldest to newest. A commit that touches a file a rule can
 * govern (a registry under data/, IDENTITY.md, federation.yaml, .well-known/) is governed when
 * the rule in force for its class is not one its author may apply alone. A governed commit
 * needs an `Org-Proposal` trailer naming a ratified proposal. The rule in force is the one in
 * the commit's parent, never the one the commit writes; a history with no written rules is not
 * judged (the solo default); a root commit is not judged. It never stops a commit: the data
 * plane stays writable, and tightness comes from checking (architecture §4.7). A trailer can
 * be typed by anyone with commit access: this makes going around the loop visible.
 *
 * The ledger (0.6 P2 spec §3.10, P2-R13) is judged by its own check, under the same condition:
 * a commit that touches data/proposals.yaml, where its parent's rules are written, may open a
 * proposal (open, by the commit's actor, who may propose; its rules the ones in force at the
 * parent; its classes covering its ops; named by Org-Proposal; `opened` near the commit's date)
 * and add events to an open one (each by the commit's actor and allowed for them by
 * `eventPermission`; for the proposal's rev; a new id; `at` within CLOCK_SKEW of the commit's date
 * and not before `opened`; no vote after the vote closed; no system reading without an attach).
 * Its ops change only with a revise event by its author. Everything is read at the commit's own
 * parent.
 *
 * The closings (§3.8, §3.10 M4) are judged in the same walk. A proposal is ratified only by a merge
 * carrying its Org-Proposal, ratified in the merge's tree and open at its first parent, with the
 * evaluation `met` at the merge's committer date under the parent's roles, a ratify by someone who
 * may, its decision row, and its content: the second parent stands on the first parent, the merge
 * changes no file but the ops' files, the ledger files and DECISIONS.md, each ops file is, as parsed
 * data, the parent's document with its record list replaced by what `projectOp` makes of it, and
 * DECISIONS.md changes only for a statement, by one inserted entry. A merge carrying Org-Proposal
 * carries a proposal only as that ratification: no other proposal is added, changed or removed in
 * it. A reject and an expire are single commits whose evaluation is `failed` / `expired`, with their
 * row; a withdraw is the author's. A closed proposal never changes and no proposal leaves the
 * ledger. A decision row that names a proposal comes only with its closing, its proposal, rule,
 * method, outcome, status, by and keys equal to what `decisionRowFor` makes of the evaluation (its
 * summary is words, not judged), and is never changed after; a row that names none is judged by
 * class. A change to data/governance.yaml that only touches rows naming a proposal is a ledger
 * change, not one of class governance; an Org-Proposal trailer is looked up in the commit's own tree, and
 * names a proposal ratified there and open at the parent, so a later commit cannot borrow it. The
 * ledger is checked for form, rule, standing and, for a ratify, content, not for signature: a git
 * identity and a commit date are the machine's claim until sign-in (P5).
 *
 * A merge with no Org-Proposal (a Sync, a crew branch landing; §3.10 H3, M-e, M-1) is not judged as a
 * change of its own. Its incoming commits are: the second parent's first-parent line down to the merge
 * base (`rev-list --first-parent --reverse P1..P2`), each judged by all of the above with the files at
 * its own first parent, a merge among them handled the same way again, none judged twice, none the
 * --range leaves out. It is expanded when any of its parents has written rules (a Sync can bring in the
 * first rules). A merge carrying Org-Proposal stays one change, and the commits beneath it are never
 * visited. The merge itself is compared with git's own merge of its parents (`merge-tree --write-tree`,
 * git 2.38): a path git merged cleanly where the merge differs is a finding; a path git reported as
 * conflicted is one a person resolved (even when committed with git's own markers), a warning at every
 * severity ("resolved by hand"), except data/proposals.yaml, which must be the two sides' ledgers merged
 * by id (`mergeLedgers`). Inside a file resolved by hand nothing is
 * compared: a person reads it. On an older git the merge is not compared, and the validator says so.
 * merge-tree writes the tree it computes into the object store; the validator moves no ref and changes
 * no file.
 *
 * The owner's claim (DAO-OS L5 spec §8.1, F-L3-1): a commit carrying `Org-Rule: bootstrap/owner-claim`
 * (scripts/claim-handle.mjs --owner) is accepted, whoever made it, only when its parent is locked out (the
 * rule covering members is missing, or its propose role holds nobody with a git or wallet handle) and it
 * changes data/members.yaml alone, adding exactly one handle to one person. Anywhere else the validator
 * says why, and judges the commit as any other.
 *
 * A narrowing (DAO-OS L5 spec §9.7, C-14, R-L5-16.7): a commit carrying `Org-Rule: visibility/narrow` applies at once,
 * outside the rules, and is accepted, judged no further, only when it is made by someone the repository names and it
 * changes exactly what the narrowing its subject names changes ("visibility: narrow <record | collection | field of
 * collection> to <level>", or "A change to a restricted collection" for the private store alone): the record's level, or
 * the record taken out; the collection's level; the field's level and, stricter than members, its values taken out of
 * its file and out of the ledger's ops, each held as a well-formed placeholder, with the proposal's approvals, votes and
 * objections on its old rev carried to the new one (R-L5-16.6). A member's record and members.handles never leave.
 * Anywhere else the validator says why, and judges the commit as any other.
 *
 * The house (DAO-OS L5 spec §6.4, §7.5): a commit authored by HOUSE_IDENT (house@org-os.invalid, lib/trailers.mjs) is a
 * signed-in member's act, judged as made by its Org-Actor (a member id or a CAIP-10 id); any other commit by its author's
 * email, as in 0.6, whatever Org-Actor it carries. An act on a proposal is judged by the book its proposal recorded up to
 * it (`opened_as`, each event's `as`, `closed.as`, a ratify's `closed.checked`: lib/hat-readings.mjs), offline; each
 * reading must be readable, of the act's own account, and on a hat of the membership tree. A direct apply by a CAIP-10
 * actor carries Org-Hat (`<hat ref> @<block>`), a hat of the membership tree; under written rules the role of that hat
 * must decide alone, and Org-Hat names no hat but a deciding one. Under the solo default any hat of the tree does.
 * Beside the rules, it reports validate:data's rule-4 errors (L5 spec §10.5): nothing stricter than members in git.
 *
 * It runs from the framework against any instance, as validate:data does; the instance
 * doctor runs it so.
 *
 * Exit codes: 0 no errors (warnings never fail) · 1 errors · 2 cannot run (admin deps
 * missing, an unknown option, or the root is not a readable directory).
 */

import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const DEFAULT_MAX = 500;

const args = process.argv.slice(2);
let strict = process.env.CI === 'true';
let max = DEFAULT_MAX;
let range = null;
let rootArg = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--strict') strict = true;
  else if (a === '--max' || a === '--range') {
    const value = args[++i];
    if (value === undefined) { console.error(`✗ ${a} needs a value`); process.exit(2); }
    if (a === '--max') {
      max = Number(value);
      if (!Number.isInteger(max) || max < 1) { console.error(`✗ --max needs a whole number of 1 or more, not "${value}"`); process.exit(2); }
    } else range = value;
  } else if (a.startsWith('--')) { console.error(`✗ unknown option ${a}`); process.exit(2); }
  else if (rootArg === null) rootArg = a;
  else { console.error(`✗ one path at most, and "${a}" is a second`); process.exit(2); }
}

let validateRepo, readGovernance, yamlDocuments, effectiveRules, resolveRoles, ruleFor, mayDecideAlone, mayPropose, describeRule, findMemberByEmail, governedClassOf, classOf, CHANGE_CLASSES, parseTrailers;
let checkProposals, eventPermission, liveEvents, revOf, instant, methodOf, decidersOf, CLOCK_SKEW_MS, ballotsClosed, inWords, parseRecord, REGISTRIES;
let evaluateAll, projectOp, decisionRowFor, resolveTopKey, mergeLedgers, insertDecisionsMdEntry, receiptsRideAlong;
let OWNER_CLAIM_RULE, lockedOut, oneHandleAdded;
let NARROW_RULE, narrowCommitProblem, governanceNamesOf, referrersOf;
let HOUSE_IDENT, observationsOf, walletsOf, knownIds, membershipTree, parseHatRef, hatRef, parseTreeRef, inTree, parseCaip10, isGitSafetyProblem;
try {
  const lib = (name) => import(new URL(`../packages/admin/lib/${name}`, import.meta.url).href);
  ({ validateRepo, isGitSafetyProblem, referrersOf } = await lib('data-validate.mjs'));
  ({ readGovernance, yamlDocuments } = await lib('governance-read.mjs'));
  ({ effectiveRules, resolveRoles, ruleFor, mayDecideAlone, mayPropose, describeRule, membershipTree } = await lib('rules.mjs'));
  ({ findMemberByEmail } = await lib('members.mjs'));
  ({ governedClassOf, classOf, CHANGE_CLASSES } = await lib('change-classes.mjs'));
  ({ parseTrailers, HOUSE_IDENT } = await lib('trailers.mjs'));
  ({ observationsOf, walletsOf } = await lib('hat-readings.mjs'));
  ({ parseHatRef, hatRef, parseTreeRef, inTree } = await lib('hats.mjs'));
  ({ parseCaip10 } = await lib('caip.mjs'));
  ({ knownIds, checkProposals, eventPermission, liveEvents, revOf, instant, methodOf, decidersOf, CLOCK_SKEW_MS, mergeLedgers } = await lib('proposals.mjs'));
  ({ ballotsClosed, inWords, evaluateAll } = await lib('evaluate.mjs'));
  ({ parseRecord, projectOp } = await lib('ops.mjs'));
  ({ REGISTRIES, resolveTopKey } = await lib('registries.mjs'));
  ({ decisionRowFor } = await lib('decision-row.mjs'));
  ({ insertDecisionsMdEntry } = await lib('decision-write.mjs'));
  ({ judgedFiles: receiptsRideAlong } = await lib('receipts.mjs'));
  ({ OWNER_CLAIM_RULE, lockedOut, oneHandleAdded } = await lib('claim.mjs'));
  ({ NARROW_RULE, narrowCommitProblem, governanceNamesOf } = await lib('narrow.mjs'));
} catch (err) {
  console.error(`✗ validate:governance cannot load the admin schemas (${String(err?.message ?? err).split('\n')[0]})`);
  console.error('  run: npm ci --prefix packages/admin');
  process.exit(2);
}

const root = resolve(rootArg || '.');
if (!existsSync(root) || !statSync(root).isDirectory()) {
  console.error(`✗ no such directory: ${root}`);
  process.exit(2);
}

console.log(`validate:governance — ${root}\n`);

const line = (p) => `${p.file}${p.id ? ` [${p.id}]` : ''}${p.path ? ` ${p.path}` : ''}: ${p.message}`;
/** @type {{ unit: string, level: 'error'|'warn', text: string }[]} */
const findings = [];
const notes = [];

// ── Part 1: the rules are well-formed ────────────────────────────────────────
// Beside them, nothing stricter than members is in git (DAO-OS L5 spec §10.5): validate:data's rule-4 errors, here too.
const GIT_SAFETY = 'nothing stricter than members in git';
for (const p of validateRepo(root)) {
  if (p.file === 'data/governance.yaml') findings.push({ unit: 'data/governance.yaml', level: p.level, text: line(p) });
  else if (isGitSafetyProblem(p)) findings.push({ unit: GIT_SAFETY, level: p.level, text: line(p) });
}

// ── Part 2: the history does not contradict them ─────────────────────────────
// A git variable inherited from the caller (a hook runs with GIT_DIR and GIT_INDEX_FILE set, an editor's terminal may
// export GIT_WORK_TREE) outranks `-C <root>` and would point every read here at another repository: they are removed.
const GIT_ENV = { ...process.env };
for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) delete GIT_ENV[key];
const git = (gitArgs, input) => spawnSync('git', ['-C', root, '-c', 'core.quotepath=off', ...gitArgs], { encoding: 'utf-8', maxBuffer: 512 * 1024 * 1024, input, env: GIT_ENV });
const show = (rev, rel) => {
  const r = git(['show', `${rev}:${rel}`]);
  return r.status === 0 ? r.stdout : null;
};
const first = (value) => (Array.isArray(value) ? value[0] : undefined);
/** The entries of a registry's text, or []. */
function entriesOf(text, key) {
  if (text === null) return [];
  const [doc] = yamlDocuments(text);
  const list = doc?.value?.[key];
  return Array.isArray(list) ? list.filter((e) => e && typeof e === 'object') : [];
}

// ── The ledger (P2 spec §3.10) ───────────────────────────────────────────────
const LEDGER = 'data/proposals.yaml';
/** JSON with the keys sorted at every depth: two values hold the same data when this is equal. */
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map((v) => canonical(v === undefined ? null : v)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).filter((k) => value[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
const same = (a, b) => canonical(a) === canonical(b);
const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const listOf = (v) => (Array.isArray(v) ? v : []);
const opsOf = (p) => listOf(p.ops).filter(isMap);
/** A rule list in words: `rule "records" (applies to records · member proposes · …)`. */
const rulesInWords = (rules) => (rules.length === 0 ? 'no rule' : rules.map((r) => `rule "${r?.id}" (${describeRule(isMap(r) ? r : {})})`).join(' and '));
/** checkProposals says a duplicate event id itself; the ledger check says it once, as "already used". */
const DUPLICATE_EVENT = /^event id ".*" is used twice in this proposal$/;

// ── Who made a commit, and what it read (DAO-OS L5 spec §6.4, §7.2, §7.5) ────
/**
 * Who made a commit: a commit the house authored (`HOUSE_IDENT`, a signed-in member's act) is its Org-Actor's, a member id
 * or a CAIP-10 id; any other is the member whose git address authored it, as in 0.6 (its Org-Actor is anyone's to type).
 * `id` is null when nobody is known. @returns {{ id: string | null, house: boolean }}
 */
function actorOf(c, members) {
  if (c.email === HOUSE_IDENT.email) {
    const named = parseTrailers(c.message).actor;
    return { id: named ? String(named) : null, house: true };
  }
  const member = findMemberByEmail(members, c.email);
  return { id: member === null ? null : String(member.id), house: false };
}
/** The start of the sentence for a commit nobody is known to have made. */
const nobodyMade = (actor) => (actor.house ? `the house (${HOUSE_IDENT.email}) made it and it names no Org-Actor` : 'no member of data/members.yaml commits with that address');
/** A CAIP-10 id in one form (EIP-55), or null: an address, not a member id. */
const accountOf = (value) => { const p = parseCaip10(value); return p ? `${p.chain}:${p.address}` : null; };
const isAccount = (value) => accountOf(value) !== null;
/** Two actor ids name the same actor: equal, or the same account however its address is cased. */
const sameActor = (a, b) => String(a) === String(b) || (isAccount(a) && accountOf(a) === accountOf(b));
/** The accounts an actor acts from: a CAIP-10 id's own, a member's `handles.wallet`. */
const accountsOf = (id, members) => (isAccount(id) ? [accountOf(id)] : walletsOf(members.find((m) => String(m.id) === String(id))));
const isBlock = (b) => typeof b === 'number' && Number.isSafeInteger(b) && b >= 0;
/** A hat ref in one form (lowercase id), or null. */
const hatOf = (value) => { const p = parseHatRef(value); return p ? hatRef(p.chain, p.hatId) : null; };
/** Whether `hat` lies in the membership tree `tree` (`membershipTree`'s answer): on its chain and under its top hat. */
function inMembershipTree(hat, tree) {
  const p = parseHatRef(hat);
  const t = parseTreeRef(tree?.tree);
  return p !== null && t !== null && p.chain === t.chain && inTree(p.hatId, t.treeId);
}
/** The hat that is not in the membership tree, as a sentence's end, or null. */
const outsideTree = (hat, tree) => (inMembershipTree(hat, tree) ? null
  : tree === null ? `names the hat ${hat}, and this org has no membership tree to read it in`
    : `names the hat ${hat}, which is not a hat of the membership tree ${tree.tree}`);

/**
 * What is wrong with a recorded reading (§7.2: `opened_as`, an event's `as`, `closed.as`) of an act by `by`, as sentences:
 * one lib/hat-readings.mjs cannot read is left out of the book silently there (R-L5-3.5), so it is said here; its account
 * is the act's own (a CAIP-10 id's, or a wallet of the member's); its hat lies in the membership tree. `what` names it, and
 * `act` names the act ("the event", "the proposal", "the closing"). Its absence is checkProposals'.
 */
function readingProblems(raw, what, by, act, members, tree) {
  if (!isMap(raw)) return [];
  const out = [];
  const unread = [];
  if (hatOf(raw.hat) === null) unread.push('its hat is not a hat ref');
  if (!isAccount(raw.account)) unread.push('its account is not a CAIP-10 id');
  if (!isBlock(raw.block)) unread.push('its block is not a whole number');
  if (typeof raw.readAt !== 'string' || raw.readAt === '') unread.push('it has no read time (readAt)');
  if (unread.length > 0) out.push(`${what} cannot be read (${unread.join(', ')}), so it says nothing of who wears the hat.`);
  if (Array.isArray(raw.wearers) && raw.wearers.some((w) => !isAccount(w))) out.push(`${what} lists a wearer that is not a CAIP-10 id, so its list is not read whole.`);
  if (isAccount(raw.account)) {
    const account = accountOf(raw.account);
    if (isAccount(by) && account !== accountOf(by)) out.push(`${what} reads the account ${raw.account}, and ${act} is by ${by}: an act records the reading of its own account.`);
    else if (!isAccount(by) && !accountsOf(by, members).includes(account)) {
      out.push(`${what} reads the account ${raw.account}, which is not a wallet of ${by} in data/members.yaml (handles.wallet): an act records the reading of its own account.`);
    }
  }
  const hat = hatOf(raw.hat);
  const outside = hat === null ? null : outsideTree(hat, tree);
  if (outside) out.push(`${what} ${outside}.`);
  return out;
}

/**
 * The book an act on a proposal is judged by (§7.3, §7.5): the roles at the commit's parent, with the hats the proposal's
 * own readings up to and including the act (`entry`) say are worn, and who may write to it (`knownIds`). An act recorded
 * with no reading of its own (`reading` false) is judged without any earlier observation of its actor's accounts
 * (R-L5-8.10, R-L5-8.12): the server admitted it so, and it never counts under a hat on what the proposal saw before.
 */
function bookAt(governance, members, entry, by, reading) {
  const unread = reading ? [] : accountsOf(by, members);
  const observed = observationsOf(entry).filter((o) => !unread.includes(o.account));
  return { book: resolveRoles(governance, members, observed), known: knownIds(members, observed) };
}

/** Org-Hat (§6.4): `<hat ref> @<block>`, comma-separated → the hats (one form) and a sentence per item that is not one. */
function orgHats(value) {
  const hats = [];
  const problems = [];
  for (const item of String(value ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = /^(\S+)\s*@\s*(\d+)$/.exec(item);
    const hat = m ? hatOf(m[1]) : null;
    if (hat === null) problems.push(`its Org-Hat "${item}" is not <hat ref> @<block>.`);
    else if (!hats.includes(hat)) hats.push(hat);
  }
  return { hats, problems };
}
const NO_ORG_HAT = 'a direct apply by an address carries the hat it acted under (Org-Hat: <hat ref> @<block>), and this one carries none.';

/**
 * The book a direct apply is judged by (§7.5): the parent's roles, with the actor holding every role sourced from a hat
 * its Org-Hat names, and no other. The house names the proposing hat as well as the deciding one (Task 10 M1,
 * R-L5-21.2), so nothing is taken on faith.
 */
function withOrgHat(book, actorId, hats) {
  if (actorId === null || hats.length === 0) return book;
  const add = (r) => ({ ...r, members: [...new Set([...r.members, actorId])] });
  const roles = new Map([...book.roles].map(([id, r]) => [id, r.hat !== undefined && hats.includes(r.hat) ? add(r) : r]));
  return { ...book, roles };
}

/** `at` against the commit's own date (P2-R30): null within CLOCK_SKEW either way, else how far off, in words. */
function offCommit(time, c) {
  const t = instant(time);
  const dated = Date.parse(c.date);
  if (Number.isNaN(t) || Number.isNaN(dated) || Math.abs(t - dated) <= CLOCK_SKEW_MS) return null;
  return `${inWords(Math.abs(t - dated))} ${t < dated ? 'before' : 'after'} the commit that adds it (${c.date})`;
}

/** The events of `now` that `was` does not hold (in order), and those of `was` that `now` no longer holds as they were. */
function eventsDiff(was, now) {
  const pool = was.map(canonical);
  const kept = pool.map(() => false);
  const added = [];
  for (const e of now) {
    const at = pool.findIndex((k, i) => !kept[i] && k === canonical(e));
    if (at >= 0) kept[at] = true;
    else added.push(e);
  }
  return { added, kept: was.filter((_, i) => kept[i]), removed: was.filter((_, i) => !kept[i]) };
}

/**
 * What a commit that touches the ledger, judged under written rules, does wrong to it (P2 spec §3.10's rows for a new
 * proposal, new events and a revision): `{ id, text }` per finding. Everything it reads is at the commit's parent:
 * `rules`, `members`, `governance`, `systems`, `tree` (the membership tree), and `was` (the ledger there); `now` is the
 * ledger the commit writes. A proposal closed at the parent, closed by this commit, or gone from it is `judgeClosings`'.
 * The commit is its actor's (`actorOf`); each act is judged by the book its proposal recorded up to it (`bookAt`).
 */
function judgeLedger(c, { rules, members, governance, systems, tree, was, now }) {
  const out = [];
  const before = new Map(entriesOf(was, 'proposals').map((p) => [String(p.id), p]));
  const actor = actorOf(c, members);
  const actorId = actor.id;
  const trailer = parseTrailers(c.message).proposal;
  const skew = inWords(CLOCK_SKEW_MS);
  const shapeCtx = { members, governance, systems, classes: CHANGE_CLASSES, classOf: (registry) => classOf({ registry }) };
  const shapeKey = (p) => `${p.path}|${p.message}`;
  const offBy = (time) => offCommit(time, c);

  for (const p of entriesOf(now, 'proposals')) {
    const id = String(p.id);
    const prior = before.get(id);
    if (prior !== undefined && (prior.state !== 'open' || p.state !== 'open')) continue;
    if (prior !== undefined && same(prior, p)) continue;
    const say = (text) => out.push({ id, text });

    if (trailer !== id) say(trailer ? `its Org-Proposal trailer names ${trailer}, not ${id}: the commit that writes to a proposal names it.` : `the commit carries no Org-Proposal trailer naming ${id}.`);
    if (actorId === null) say(`${nobodyMade(actor)}, so it can neither open a proposal nor write an event.`);
    const had = new Set(prior === undefined ? [] : checkProposals([prior], shapeCtx).map(shapeKey));
    for (const problem of checkProposals([p], shapeCtx)) {
      if (!had.has(shapeKey(problem)) && !DUPLICATE_EVENT.test(problem.message)) say(`${problem.message}.`);
    }

    if (prior === undefined) {
      // A new proposal.
      if (p.state !== 'open') say(`a new proposal opens as open, and this one is ${p.state ?? 'in no state'}.`);
      const late = offBy(p.opened);
      if (late) say(`it was opened at ${p.opened}, ${late}; a new proposal's \`opened\` lies within ${skew} of its commit.`);
      if (actorId !== null && !sameActor(p.author, actorId)) say(`its author is "${p.author}", and the commit was made by "${actorId}": a proposal's author is the member who opens it.`);
      for (const text of readingProblems(p.opened_as, '`opened_as`', String(p.author), 'the proposal', members, tree)) say(text);
      const { book } = bookAt(governance, members, { opened_as: p.opened_as }, String(p.author), isMap(p.opened_as));
      const classes = listOf(p.classes).map(String);
      const expected = [];
      for (const cls of classes) {
        const rule = ruleFor(rules, cls);
        if (rule === null) say(`no rule covers the class ${cls}, so nobody can propose it.`);
        else if (!expected.some((r) => r.id === rule.id)) expected.push(rule);
      }
      const held = listOf(p.rules);
      if (held.length !== expected.length || !expected.every((r) => held.some((h) => same(h, r)))) {
        say(`its rules are not the ones in force at its parent for ${classes.join(', ') || 'its classes'}: it holds ${rulesInWords(held)}, and data/governance.yaml gave ${rulesInWords(expected)}. A proposal is decided under the rules in force when it was opened.`);
      }
      for (const rule of expected) {
        const may = mayPropose(rule, String(p.author), book);
        if (may !== true) say(may);
      }
      if (typeof p.rev === 'string' && p.rev !== revOf(opsOf(p))) say(`its rev ${p.rev} is not the rev of its ops (${revOf(opsOf(p))}).`);
    } else {
      // An open proposal: what was fixed when it was opened stays.
      for (const key of ['author', 'opened', 'opened_as', 'rules']) {
        if (!same(prior[key], p[key])) say(`its \`${key}\` changed; it is fixed when the proposal is opened.`);
      }
    }

    // Its events: the ones this commit adds, judged in the order the ledger holds them.
    const { added, kept, removed } = eventsDiff(prior === undefined ? [] : listOf(prior.events), listOf(p.events));
    for (const e of removed) say(`event ${e?.id ?? '(no id)'} was changed or removed: events are append-only, and one is taken back by a retract.`);
    const used = new Set(kept.map((e) => String(e?.id)));
    const sofar = [...kept];
    const snapshot = listOf(p.rules);
    for (const e of added.filter(isMap)) {
      const eid = String(e.id ?? '(no id)');
      const kind = String(e.kind);
      const by = String(e.by);
      if (used.has(eid)) say(`event id ${eid} is already used in this proposal: each event has an id of its own.`);
      used.add(eid);
      const server = kind === 'system' || (kind === 'replay' && by.startsWith('system:'));
      if (!server && actorId !== null && !sameActor(by, actorId)) say(`event ${eid} says it is by "${by}", and the commit was made by "${actorId}".`);
      for (const text of readingProblems(e.as, `event ${eid}: its \`as\``, by, 'the event', members, tree)) say(text);
      const { book, known } = bookAt(governance, members, { opened_as: p.opened_as, events: [...sofar, e] }, by, isMap(e.as));
      const refused = eventPermission(kind, { actor: by, proposal: { author: p.author, events: listOf(p.events) }, rules: snapshot, book, known, of: e.of });
      if (refused) say(`event ${eid}: ${refused}`);
      if (e.rev !== undefined && e.rev !== p.rev) say(`event ${eid} is about rev ${e.rev}, and the proposal is at rev ${p.rev}.`);
      const t = instant(e.at);
      const late = offBy(e.at);
      if (late) say(`event ${eid} is dated ${e.at}, ${late}; an event's time lies within ${skew} of its commit.`);
      if (!Number.isNaN(t) && t < instant(p.opened) - CLOCK_SKEW_MS) say(`event ${eid} is dated ${e.at}, before the proposal was opened (${p.opened}).`);
      if (kind === 'vote' && !Number.isNaN(t)) {
        const voting = snapshot.filter((r) => isMap(r) && methodOf(r) === 'vote' && decidersOf(r, book).includes(by));
        const then = { ...p, events: sofar };
        if (voting.length > 0 && voting.every((rule) => ballotsClosed({ rule, proposal: then, book, now: t }))) {
          say(`event ${eid} is a vote written after the vote closed, so it is not counted.`);
        }
      }
      if (kind === 'system' && !liveEvents({ rev: p.rev, events: sofar }).some((x) => x.kind === 'attach' && x.rev === e.rev)) {
        say(`event ${eid} reads an outside system, and no attach for this rev comes before it.`);
      }
      sofar.push(e);
    }

    if (prior !== undefined && (revOf(opsOf(prior)) !== revOf(opsOf(p)) || prior.rev !== p.rev)) {
      // Its content: only its author revises it, with a revise event in the same commit.
      if (!added.some((e) => isMap(e) && e.kind === 'revise' && String(e.by) === String(p.author))) say('its ops changed with no revise event by its author in the same commit.');
      else if (p.rev !== revOf(opsOf(p))) say(`its rev ${p.rev} is not the rev of its ops (${revOf(opsOf(p))}).`);
    }
  }
  return out;
}

// ── The closings (P2 spec §3.8, §3.9, §3.10) ─────────────────────────────────
const GOVERNANCE = 'data/governance.yaml';
const DECISIONS_MD = 'DECISIONS.md';
/** The event each closed state is written with, and what the evaluation must say for the states that decide. */
const CLOSING_EVENT = { ratified: 'ratify', rejected: 'reject', expired: 'expire', withdrawn: 'withdraw' };
const NEEDED = { ratified: 'met', rejected: 'failed', expired: 'expired' };
const json = (v) => (v === undefined ? 'absent' : JSON.stringify(v));

/** A governance text's one document without `decisions` (beside and inside `governance:`), canonical; null when unread. */
function withoutDecisions(text) {
  if (text === null) return null;
  const docs = yamlDocuments(text);
  if (docs.length !== 1 || docs[0].error !== undefined || !isMap(docs[0].value)) return null;
  const { decisions: _beside, ...top } = docs[0].value;
  if (isMap(top.governance)) {
    const { decisions: _inside, ...block } = top.governance;
    top.governance = block;
  }
  return canonical(top);
}
/** Only `decisions` differs between the two texts: the change to data/governance.yaml is a ledger change (§3.10). */
const onlyDecisions = (was, now) => {
  const a = withoutDecisions(was);
  return a !== null && a === withoutDecisions(now);
};
/** The rows of `governance.decisions`, or []. */
const decisionsOf = (text) => (text === null ? [] : listOf(readGovernance(text).governance?.decisions).filter(isMap));
/** A row that names a proposal is the ledger's; one that names none (written before P2, by hand) is judged by class. */
const tied = (row) => typeof row.proposal === 'string' && row.proposal !== '';
/** The governance change only adds, changes or removes rows that name a proposal: a ledger change, not class governance. */
const ledgerOnly = (was, now) => {
  if (!onlyDecisions(was, now)) return false;
  const { added, removed } = eventsDiff(decisionsOf(was), decisionsOf(now));
  return [...added, ...removed].every(tied);
};
/** The fields of a decision row the evaluation decides (§3.9; `status` is the outcome). `summary` is words, not judged. */
const ROW_FIELDS = ['proposal', 'rule', 'method', 'outcome', 'status', 'by'];

/** The one document of a registry file: {} when the file is absent or empty, null when it cannot be read. */
function documentOf(text) {
  if (text === null) return {};
  const docs = yamlDocuments(text);
  if (docs.length === 0) return {};
  return docs.length > 1 || docs[0].error !== undefined || !isMap(docs[0].value) ? null : docs[0].value;
}

/** How `actual` differs from `expected`, field by field, in words. */
function difference(expected, actual) {
  if (expected === undefined) return 'the merge holds it, and the result has no such record';
  if (actual === undefined) return 'the merge has no such record, and the result holds it';
  if (!isMap(expected) || !isMap(actual)) return `the merge holds ${json(actual)}, and the result is ${json(expected)}`;
  return [...new Set([...Object.keys(expected), ...Object.keys(actual)])].filter((k) => canonical(expected[k]) !== canonical(actual[k])).sort()
    .map((k) => `${k} is ${json(actual[k])}, where the result is ${json(expected[k])}`).join('; ');
}

/**
 * A ratify merge's content (§3.10's M4): its second parent stands on its first; it changes no file but the ops' files,
 * the ledger files and DECISIONS.md; each ops file is, as parsed data, the first parent's document with its record list
 * replaced by the ops' result (`projectOp`), so no record and no other top-level key changes but by an op; and
 * DECISIONS.md changes only for a statement, by one inserted entry. Sentences, one per finding.
 */
function judgeRatifyContent(c, p, govLedgerOnly) {
  const out = [];
  const [first, second] = c.parents;
  const under = git(['rev-parse', '--verify', '-q', `${second}^`]).stdout.trim();
  if (under !== first) {
    out.push(`its second parent ${second.slice(0, 7)} stands on ${under ? under.slice(0, 7) : 'no commit'}, not on its first parent ${first.slice(0, 7)}: ` +
      'a ratify merges a branch built on the trunk\'s tip, so that the merge brings the proposal\'s change and nothing else.');
  }
  const ops = opsOf(p);
  const registryOf = (op) => { try { return parseRecord(String(op.record)).registry; } catch { return null; } };
  const files = new Map();
  for (const op of ops) {
    const registry = registryOf(op);
    if (registry !== null) files.set(`data/${registry}.yaml`, registry);
  }
  const allowed = new Set([...files.keys(), LEDGER, DECISIONS_MD, ...(govLedgerOnly ? [GOVERNANCE] : [])]);
  const outside = c.files.filter((f) => !allowed.has(f));
  if (outside.length > 0) {
    out.push(`the merge also changes ${outside.join(', ')}, which no op of the proposal names and which ${outside.length === 1 ? 'is' : 'are'} not a ledger file.`);
  }
  for (const [file, registry] of files) {
    const def = REGISTRIES.find((r) => r.name === registry);
    const wasDoc = documentOf(show(first, file));
    const nowDoc = documentOf(show(c.hash, file));
    // The list the ops write: under the key the first parent uses (the canonical one when it has none).
    const listKey = wasDoc === null ? null : resolveTopKey((k) => Object.hasOwn(wasDoc, k), def);
    const listIn = (doc) => (doc === null ? null : doc[listKey] === undefined || doc[listKey] === null ? [] : Array.isArray(doc[listKey]) ? doc[listKey] : null);
    const was = listIn(wasDoc);
    const now = listIn(nowDoc);
    if (was === null || now === null) {
      out.push(`${file} cannot be read ${was === null ? 'at the merge\'s first parent' : 'in the merge'}, so its records cannot be compared with the ops' result.`);
      continue;
    }
    for (const k of new Set([...Object.keys(wasDoc), ...Object.keys(nowDoc)])) {
      if (k === listKey || same(wasDoc[k], nowDoc[k])) continue;
      const names = [def.topKey, ...(def.aliases ?? [])];
      if (names.includes(k) && !Object.hasOwn(wasDoc, k)) out.push(`\`${k}\` is added beside \`${listKey}\` in ${file}: it is another name for the same records, and the ops' result is written under one.`);
      else out.push(`the merge ${!Object.hasOwn(wasDoc, k) ? 'adds' : !Object.hasOwn(nowDoc, k) ? 'removes' : 'changes'} the top-level key \`${k}\` of ${file}, which no op touches.`);
    }
    const entries = new Map([[registry, was.map((e) => structuredClone(e))]]);
    const mine = ops.filter((op) => registryOf(op) === registry);
    for (const op of mine) projectOp(entries, op);
    const keyOf = (e) => (isMap(e) && e.id !== undefined && e.id !== null ? String(e.id) : null);
    const byId = (list) => {
      const m = new Map();
      for (const e of list) m.set(keyOf(e), [...(m.get(keyOf(e)) ?? []), e]);
      return m;
    };
    const expected = byId(entries.get(registry));
    const actual = byId(now);
    for (const id of new Set([...expected.keys(), ...actual.keys()])) {
      const want = expected.get(id) ?? [];
      const have = actual.get(id) ?? [];
      if (canonical(want.map(canonical).sort()) === canonical(have.map(canonical).sort())) continue;
      const record = `${registry}:${id ?? '(no id)'}`;
      const detail = difference(want[0], have[0]);
      const op = id === null ? undefined : [...mine].reverse().find((o) => String(o.record) === record);
      out.push(op
        ? `record ${record} in the merge is not its ${op.op} op's result: ${detail}.`
        : `record ${record} changes in the merge, and no op of the proposal names it: ${detail}.`);
    }
  }
  if (c.files.includes(DECISIONS_MD)) {
    if (!isMap(p.statement)) out.push(`the merge changes ${DECISIONS_MD}, and the proposal carries no statement: a ratify writes there only the entry of a statement.`);
    else {
      const was = show(first, DECISIONS_MD) ?? '';
      const now = show(c.hash, DECISIONS_MD) ?? '';
      const a = was.split(/\r?\n/);
      const b = now.split(/\r?\n/);
      let i = 0;
      while (i < a.length && i < b.length && a[i] === b[i]) i++;
      let j = 0;
      while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
      // What the ratify writes for this statement (insertDecisionsMdEntry, with the decision row's id and date): the
      // inserted block is compared with it, so a line of the entry that looks like a heading is not read as a second one.
      const id = String(p.id);
      const decisionId = isMap(p.closed) ? String(p.closed.decision ?? '') : '';
      const govAt = documentOf(show(c.hash, GOVERNANCE));
      const row = listOf(govAt?.governance?.decisions).find((r) => isMap(r) && String(r.id) === decisionId);
      const st = p.statement;
      const expected = row === undefined ? null : insertDecisionsMdEntry(was, {
        date: String(row.date ?? ''), title: String(st.title ?? ''), scope: String(st.scope ?? listOf(p.classes).join(', ')),
        decision: String(st.decision ?? ''), why: String(st.why ?? ''), proposal: id, decisionId,
      });
      if (expected !== null && expected.ok && expected.text === now) { /* exactly the statement's entry */ }
      else if (i + j !== a.length) out.push(`the merge changes lines of ${DECISIONS_MD} besides inserting its entry: a ratify adds its entry as the newest, and the older ones stay as they were.`);
      else if (expected !== null && !expected.ok) out.push(`its statement cannot be written as one entry of ${DECISIONS_MD} (${expected.reason.replace(/ Nothing was written\.$/, '')}), and the merge inserts one anyway.`);
      else out.push(`the entry the merge inserts into ${DECISIONS_MD} is not the one its statement writes: a ratify inserts exactly the entry of its statement, as the newest.`);
    }
  }
  return out;
}

/**
 * What a commit that touches a ledger file, judged under written rules, does wrong to the closings (P2 spec §3.10's rows
 * for state → ratified, rejected, expired, withdrawn; a closed proposal; a proposal gone; a decision row): `{ id, text }`
 * per finding. `governance`, `members`, `tree`, `was` and `wasGov` are at the commit's first parent; `now` and `nowGov`
 * are what the commit writes. A non-merge commit, or a merge carrying an Org-Proposal (a ratify): a merge with none is a
 * Sync's, Task 14b's. The closing is judged by the book of what its proposal recorded up to it and its `closed.as`; the
 * evaluation by the book of everything the proposal recorded, the ratify's fresh readings (`closed.checked`) included
 * (L5 spec §7.3, §7.4).
 */
function judgeClosings(c, { governance, members, tree, was, now, wasGov, nowGov, govLedgerOnly }) {
  const out = [];
  const before = new Map(entriesOf(was, 'proposals').map((p) => [String(p.id), p]));
  const after = new Map(entriesOf(now, 'proposals').map((p) => [String(p.id), p]));
  const merge = c.parents.length > 1;
  const trailers = parseTrailers(c.message);
  const actor = actorOf(c, members);
  const actorId = actor.id;
  const diff = eventsDiff(decisionsOf(wasGov), decisionsOf(nowGov));
  const rows = { added: diff.added.filter(tied), removed: diff.removed.filter(tied) };
  /** The proposals this commit ratifies, rejects or expires: the ones a new decision row may name. */
  const decided = new Set();
  const where = (q) => (q === undefined ? 'not in the ledger' : (q.state ?? 'in no state'));
  if (merge) {
    // A merge carries a proposal only as its ratification: the one it names, open at the first parent, ratified in it.
    const named = String(trailers.proposal);
    const [p0, p1] = [before.get(named), after.get(named)];
    if (p0?.state !== 'open' || p1?.state !== 'ratified') {
      out.push({ id: named, text: `a merge carries a proposal only as its ratification, and proposal ${named} is ${where(p0)} at the merge's first parent and ${where(p1)} in the merge` +
        `${p0 !== undefined && p1 !== undefined && same(p0, p1) ? ', which does not change it' : ''}.` });
    }
  }

  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const prior = before.get(id);
    const p = after.get(id);
    const say = (text) => out.push({ id, text });
    if (p === undefined) { say('it is gone from data/proposals.yaml: a proposal stays in the ledger once it is opened, closed or not.'); continue; }
    if (prior !== undefined && prior.state !== 'open') {
      if (!same(prior, p)) say(`it was already ${prior.state} at the commit's parent, and the commit changes it: a closed proposal does not change.`);
      continue;
    }
    if (merge && id !== trailers.proposal) {
      if (prior === undefined || !same(prior, p)) say(`a merge carries a proposal only as its ratification, and this one is ${prior === undefined ? 'added' : 'changed'} by a merge that names ${trailers.proposal}.`);
      continue;
    }
    if (prior === undefined || p.state === 'open') continue; // a new proposal, or events on an open one: the ledger check's

    const state = String(p.state);
    const kind = CLOSING_EVENT[state];
    if (kind === undefined) { say(`its state is ${state}, and a proposal closes as ratified, rejected, withdrawn or expired.`); continue; }
    if (trailers.proposal !== id) say(trailers.proposal ? `its Org-Proposal trailer names ${trailers.proposal}, not ${id}: the commit that closes a proposal names it.` : `the commit carries no Org-Proposal trailer naming ${id}.`);
    if (state === 'ratified' && !merge) say('it is ratified by a commit that is not a merge: a proposal is ratified only by the merge that carries its change (spec §3.8), so this records a ratification of nothing.');
    if (state !== 'ratified' && merge) continue; // said above: a merge carries a proposal only as its ratification
    if (actorId === null) say(`${nobodyMade(actor)}, so it can close no proposal.`);
    for (const key of new Set([...Object.keys(prior), ...Object.keys(p)])) {
      if (!['state', 'closed', 'events'].includes(key) && !same(prior[key], p[key])) say(`its \`${key}\` changed in the commit that closes it: a closing sets its state, \`closed\` and one event, and nothing else.`);
    }

    // Its events: the ones it had, and one closing event.
    const { added, removed } = eventsDiff(listOf(prior.events), listOf(p.events));
    for (const e of removed) say(`event ${e?.id ?? '(no id)'} was changed or removed: events are append-only, and one is taken back by a retract.`);
    const event = added.length === 1 && isMap(added[0]) && added[0].kind === kind ? added[0] : null;
    if (event === null) say(`a ${kind} adds one event, its ${kind} event, and this commit adds ${added.length === 0 ? 'none' : added.map((e) => `${e?.kind ?? '(no kind)'} ${e?.id ?? ''}`.trim()).join(', ')}.`);
    else {
      if (actorId !== null && !sameActor(event.by, actorId)) say(`its ${kind} event says it is by "${event.by}", and the commit was made by "${actorId}".`);
      for (const text of readingProblems(event.as, `its ${kind} event's \`as\``, String(event.by), 'the event', members, tree)) say(text);
      if (listOf(prior.events).some((e) => isMap(e) && String(e.id) === String(event.id))) say(`event id ${event.id} is already used in this proposal: each event has an id of its own.`);
      const late = offCommit(event.at, c);
      if (late) say(`its ${kind} event is dated ${event.at}, ${late}; an event's time lies within ${inWords(CLOCK_SKEW_MS)} of its commit.`);
    }
    const by = event !== null ? String(event.by) : actorId;
    const closed = isMap(p.closed) ? p.closed : null;
    if (by !== null) {
      // The closing's reading is on `closed.as` (§7.2); its event may carry its own.
      const reading = isMap(closed?.as) ? closed.as : event?.as;
      const entry = { opened_as: prior.opened_as, events: [...listOf(prior.events), ...(event === null ? [] : [event])], closed: { as: closed?.as } };
      const { book, known } = bookAt(governance, members, entry, by, isMap(reading));
      const refused = eventPermission(kind, { actor: by, proposal: { author: prior.author, events: listOf(prior.events) }, rules: listOf(prior.rules), book, known });
      if (refused) say(`${kind}: ${refused}`);
    }
    if (closed === null) say('it is closed with no `closed` record ({ at, by, decision }).');
    else {
      if (by !== null && !sameActor(closed.by, by)) say(`its \`closed.by\` is "${closed.by}", and it was closed by "${by}".`);
      for (const text of readingProblems(closed.as, '`closed.as`', String(closed.by), 'the closing', members, tree)) say(text);
      listOf(closed.checked).forEach((row, i) => {
        const unread = [];
        if (!isMap(row) || hatOf(row.hat) === null) unread.push('its hat is not a hat ref');
        if (!isMap(row) || !isAccount(row.account)) unread.push('its account is not a CAIP-10 id');
        if (!isMap(row) || typeof row.wears !== 'boolean') unread.push('its wears is not true or false');
        if (!isMap(row) || !isBlock(row.block)) unread.push('its block is not a whole number');
        if (!isMap(row) || typeof row.readAt !== 'string' || row.readAt === '') unread.push('it has no read time (readAt)');
        if (unread.length > 0) say(`\`closed.checked\` row ${i + 1} cannot be read (${unread.join(', ')}), so it says nothing of who still wears the hat.`);
        else if (outsideTree(hatOf(row.hat), tree)) say(`\`closed.checked\` row ${i + 1} ${outsideTree(hatOf(row.hat), tree)}.`);
      });
    }

    if (state === 'withdrawn') {
      if (closed !== null && closed.decision !== null && closed.decision !== undefined) say('a withdrawal names no decision row: nobody decided it.');
      continue;
    }
    decided.add(id);

    // The evaluation at the commit's date, with the roles of the parent and what the proposal recorded (§7.3, §7.4).
    let evaluation = null;
    try { evaluation = evaluateAll({ proposal: p, book: resolveRoles(governance, members, observationsOf(p)), now: Date.parse(c.date) }); } catch (err) { say(`it cannot be evaluated: ${String(err?.message ?? err).split('\n')[0]}`); }
    if (evaluation !== null && evaluation.state !== NEEDED[state]) {
      say(`it is ${state} while its evaluation at the commit's date (${c.date}) is ${evaluation.state}${evaluation.missing ? ` (${evaluation.missing})` : ''}; ` +
        `a proposal is ${state} only when the evaluation says ${NEEDED[state]}.`);
    }

    // Its decision row (§3.9): one, added by this commit, equal to what the evaluation produces.
    const mine = rows.added.filter((r) => String(r.proposal) === id);
    if (mine.length === 0) say(`no decision row for it is added to data/governance.yaml's decisions: a ${state} proposal is recorded as a decision (spec §3.9).`);
    else if (mine.length > 1) say(`${mine.length} decision rows for it are added (${mine.map((r) => r.id).join(', ')}); a decided proposal has one.`);
    else {
      const [row] = mine;
      if (evaluation !== null) {
        let expected = null;
        try { expected = decisionRowFor(p, evaluation, { id: row.id, date: row.date, outcome: state }); } catch (err) { say(`no decision row can be made for it: ${String(err?.message ?? err).split('\n')[0]}`); }
        if (expected !== null) {
          const wrong = ROW_FIELDS.filter((k) => canonical(expected[k]) !== canonical(row[k]))
            .map((k) => `${k} is ${json(row[k])}, and the evaluation gives ${json(expected[k])}`);
          const extra = Object.keys(row).filter((k) => !Object.hasOwn(expected, k)).sort();
          const lacking = Object.keys(expected).filter((k) => !Object.hasOwn(row, k)).sort();
          if (extra.length > 0) wrong.push(`it holds ${extra.join(', ')}, which a decision row does not`);
          if (lacking.length > 0) wrong.push(`it lacks ${lacking.join(', ')}`);
          if (wrong.length > 0) say(`its decision row ${row.id} is not what the evaluation produces: ${wrong.join('; ')}.`);
        }
      }
      if (closed !== null && String(closed.decision) !== String(row.id)) say(`its \`closed.decision\` is ${json(closed.decision)}, and its decision row is ${row.id}.`);
      if (trailers.decision !== String(row.id)) say(trailers.decision ? `its Org-Decision trailer names ${trailers.decision}, and its decision row is ${row.id}.` : `the commit carries no Org-Decision trailer naming its decision row ${row.id}.`);
    }

    if (state === 'ratified') {
      if (isMap(p.statement) && !c.files.includes(DECISIONS_MD)) say('it carries a statement, and the merge appends no entry to DECISIONS.md (spec §3.9).');
      if (merge) for (const text of judgeRatifyContent(c, p, govLedgerOnly)) say(text);
    }
  }

  // The decision rows: added only with the closing that decides their proposal, and never changed after.
  const rowSay = (row, text) => out.push({ id: String(row.proposal ?? '(none)'), text });
  for (const row of rows.removed) rowSay(row, `decision row ${row.id ?? '(no id)'} was changed or removed: a decision row stays as it was written.`);
  for (const row of rows.added) {
    if (!decided.has(String(row.proposal))) rowSay(row, `decision row ${row.id ?? '(no id)'} is added by a commit that does not ratify, reject or expire it: a decision row comes only with the closing of the proposal it names.`);
  }
  return out;
}

/** The registries an op can name: the collections the change engine stages (`parseRecord` refuses a document
 *  registry), less the ledger. A file outside them (data/governance.yaml, data/finances.yaml, IDENTITY.md, a data
 *  file no registry knows) cannot be carried by a proposal until P2b (P2-R33). */
const STAGED = new Set(REGISTRIES.filter((r) => {
  if (r.ledger) return false;
  try { parseRecord(`${r.name}:x`); return true; } catch { return false; }
}).map((r) => r.name));
const reachableByOp = (file) => STAGED.has(/^data\/([^/]+)\.yaml$/.exec(file)?.[1] ?? '');

// ── Merges with no Org-Proposal (P2 spec §3.10 H3, M-e, M-1; §3.12) ──────────
const FILES = { governance: 'data/governance.yaml', members: 'data/members.yaml', systems: 'data/systems.yaml', proposals: LEDGER };
const FORMAT = '--format=%x1e%H%x1f%P%x1f%ae%x1f%cI%x1f%s%x1f%B%x1f';
/** `git log --first-parent -m --name-only` in FORMAT, as commits: the files are each one's change against its first parent. */
const commitsOf = (text) => text.split('\x1e').slice(1).map((record) => {
  const [hash, parents, email, date, subject, body, rest] = record.split('\x1f');
  return { hash, parents: parents.split(' ').filter(Boolean), email: email.trim(), date, subject, message: body, files: rest.split('\n').map((f) => f.trim()).filter(Boolean) };
});
/** The texts of git's blobs, by blob id: one read for each file however many commits share it. */
const blobs = new Map();
/** The four files a commit is judged by, as they are in `rev` (`git show <rev>:<file>`, cached by blob id). */
function filesAt(rev) {
  const at = { governance: null, members: null, systems: null, proposals: null };
  const listed = git(['ls-tree', '-z', rev, '--', ...Object.values(FILES)]);
  if (listed.status !== 0) return at;
  for (const entry of listed.stdout.split('\0').filter(Boolean)) {
    const [meta, rel] = entry.split('\t');
    const [, type, id] = meta.split(' ');
    const key = Object.keys(FILES).find((k) => FILES[k] === rel);
    if (type !== 'blob' || key === undefined) continue;
    if (!blobs.has(id)) {
      const read = git(['cat-file', 'blob', id]);
      blobs.set(id, read.status === 0 ? read.stdout : null);
    }
    at[key] = blobs.get(id);
  }
  return at;
}

/** Whether this git has `merge-tree --write-tree` (2.38), asked once. */
let modernGit;
function hasMergeTree() {
  if (modernGit === undefined) {
    const m = /git version (\d+)\.(\d+)/.exec(spawnSync('git', ['--version'], { encoding: 'utf-8', env: GIT_ENV }).stdout ?? '');
    modernGit = m !== null && (Number(m[1]) > 2 || (Number(m[1]) === 2 && Number(m[2]) >= 38));
  }
  return modernGit;
}

/** The entries of a ledger document, as data; the document is {} when the file is absent. */
const proposalsOf = (doc) => listOf(doc.proposals).filter(isMap);
/**
 * Why the merge's data/proposals.yaml, which git could not merge, is not the two sides' ledgers merged by id
 * (`mergeLedgers` of the merge base's copy and the two parents', the function Sync uses), or null when it is. The
 * entries are compared as a set (Sync writes ours' order with the incoming ones after); the rest of the document is
 * one parent's.
 */
function ledgerByIdProblem(c) {
  const [p1, p2] = c.parents;
  const base = first(git(['merge-base', p1, p2]).stdout.trim().split('\n')) || null;
  const [b, ours, theirs, mine] = [base, p1, p2, c.hash].map((rev) => (rev === null ? {} : documentOf(show(rev, LEDGER))));
  if ([b, ours, theirs, mine].includes(null)) return `${LEDGER} cannot be read ${mine === null ? 'in the merge' : 'at the merge base or a parent'}, so it cannot be compared with the two sides' ledgers merged by id`;
  const merged = mergeLedgers(proposalsOf(b), proposalsOf(ours), proposalsOf(theirs));
  const said = `${LEDGER} was resolved by hand, and it is not the two sides' ledgers merged by id (mergeLedgers, as Sync merges them)`;
  if (!merged.ok) return `${said}: they cannot be merged by id (${merged.reason})`;
  const want = new Map(merged.entries.map((e) => [String(e.id), canonical(e)]));
  const have = new Map();
  for (const e of proposalsOf(mine)) have.set(String(e.id), [...(have.get(String(e.id)) ?? []), canonical(e)]);
  const wrong = [];
  for (const id of [...new Set([...want.keys(), ...have.keys()])].sort()) {
    const [w, h] = [want.get(id), have.get(id) ?? []];
    if (w === undefined) wrong.push(`proposal ${id} is in it, and the merge by id has no such proposal`);
    else if (h.length === 0) wrong.push(`proposal ${id} is missing`);
    else if (h.length > 1) wrong.push(`proposal ${id} is in it ${h.length} times`);
    else if (h[0] !== w) wrong.push(`proposal ${id} is not as the merge by id gives it`);
  }
  const rest = (doc) => canonical({ ...doc, proposals: undefined });
  if (rest(mine) !== rest(ours) && rest(mine) !== rest(theirs)) wrong.push('outside its proposals it is neither parent\'s ledger');
  return wrong.length === 0 ? null : `${said}: ${wrong.join('; ')}`;
}

/**
 * A merge with no Org-Proposal against git's own merge of its parents (M-e, M-1): `{ level, text }` per path where it
 * differs. A path git merged cleanly is a finding; one git reported as conflicted is a warning at every severity, but
 * data/proposals.yaml, which must be the ledgers merged by id.
 */
function compareWithGit(c) {
  const finding = (text) => ({ level: strict ? 'error' : 'warn', text });
  if (c.parents.length > 2) return [finding(`it merges ${c.parents.length} parents at once, and git's own merge is rebuilt for two: this merge was not checked.`)];
  if (!hasMergeTree()) return [finding('merge expansion needs git 2.38; this merge was not checked.')];
  const [p1, p2] = c.parents;
  const merged = git(['merge-tree', '--write-tree', '--name-only', p1, p2]);
  const out = merged.stdout.split('\n');
  const tree = out[0] ?? '';
  if (![0, 1].includes(merged.status) || !/^[0-9a-f]{40,64}$/.test(tree)) {
    return [finding(`git cannot merge its parents (${first(merged.stderr.trim().split('\n')) || 'no tree'}), so it cannot be compared with git's own merge: this merge was not checked.`)];
  }
  // The files git could not merge: after the tree id, up to the first blank line (exit 1 means there are some).
  const end = out.indexOf('', 1);
  const conflicted = new Set(out.slice(1, end === -1 ? undefined : end).filter(Boolean));
  const diff = git(['diff-tree', '-r', '--no-renames', '--name-status', tree, `${c.hash}^{tree}`]);
  if (diff.status !== 0) return [finding(`git cannot compare it with its own merge of its parents (${first(diff.stderr.trim().split('\n')) || 'no answer'}): this merge was not checked.`)];
  const differs = [];
  // A path git could not merge is one a person resolved, whatever the merge holds: even git's own conflict markers, which
  // equal merge-tree's tree, are a resolution someone committed. The ledger is the one such path checked by content.
  for (const path of conflicted) {
    if (path !== LEDGER) differs.push({ level: 'warn', text: `resolved by hand: \`${path}\`, review it.` });
    else {
      const problem = ledgerByIdProblem(c);
      if (problem) differs.push(finding(`it is a merge with no Org-Proposal, and ${problem}.`));
    }
  }
  for (const row of diff.stdout.split('\n').filter(Boolean)) {
    const [status, path] = [row[0], row.slice(row.indexOf('\t') + 1)];
    if (conflicted.has(path)) continue;
    const how = status === 'A' ? `${path} is added by the merge, where git's own merge of its parents has no such file`
      : status === 'D' ? `${path} is in git's own merge of its parents, and the merge drops it`
        : `${path} is not what git's own merge of its parents makes of it`;
    differs.push(finding(`it is a merge with no Org-Proposal, and ${how}: a merge brings in both sides as git merges them, and changes nothing of its own.`));
  }
  return differs;
}

/** Whether a governance text writes rules (M3): `read.governance !== null && !implied && rules.length > 0`. */
function rulesWritten(text) {
  const read = readGovernance(text);
  if (read.governance === null) return false;
  const { rules, implied } = effectiveRules(read.governance);
  return !implied && rules.length > 0;
}

/** The excluded ends of --range (`^<sha>`, from `git rev-parse <range>`), read once: every expansion is bounded by them,
 *  so a commit the range leaves out is not judged because a merge in the range brings it in. */
let bounds;
function rangeBounds() {
  if (bounds === undefined) {
    bounds = range === null ? [] : git(['rev-parse', range]).stdout.split('\n').filter((l) => /^\^[0-9a-f]{40,64}$/.test(l));
  }
  return bounds;
}

let history = false;
let unchecked = false;
/** Every commit judged, by hash: one brought in twice is judged once. */
const judged = new Set();

/** The governed classes a commit's own files change (no ledger file, and data/governance.yaml only when it changes more
 *  than decision rows): a direct apply, when there is any. */
function directClasses(c, at) {
  const govLedgerOnly = c.files.includes(GOVERNANCE) && ledgerOnly(at.governance, show(c.hash, GOVERNANCE));
  const files = c.files.filter((f) => f !== LEDGER && f !== DECISIONS_MD && !(f === GOVERNANCE && govLedgerOnly));
  return [...new Set(receiptsRideAlong(files, governedClassOf).map((f) => governedClassOf(f)).filter(Boolean))];
}

/**
 * Judge one commit: `at` holds the four files at its first parent, `via` the merge that brought it in (null on the trunk's
 * first-parent line). A merge with no Org-Proposal is expanded instead of judged as a change of its own.
 */
function judgeCommit(c, at, via = null) {
  if (c.parents.length === 0 || judged.has(c.hash)) return;
  judged.add(c.hash);
  const read = readGovernance(at.governance);
  const { rules, implied } = effectiveRules(read.governance);
  const members = entriesOf(at.members, 'members');
  const actor = actorOf(c, members);
  const by = actor.house ? `${c.email}, for ${actor.id ?? 'nobody named'}` : c.email;
  const who = `${c.hash.slice(0, 7)} "${c.subject}" (${by})${via ? `, brought in by ${via.slice(0, 7)}` : ''}`;
  const trailers = parseTrailers(c.message);
  // A narrowing (L5 §9.7): accepted, and judged no further, when everything it changes narrows (`narrowProblem`).
  const narrowing = trailers.rule === NARROW_RULE && c.parents.length === 1 ? narrowProblem(c, actor) : undefined;
  if (narrowing === null) return;
  if (c.parents.length > 1 && !trailers.proposal) {
    // Never judged as a change of its own. Expanded when any parent's rules are written: a Sync can bring in the first
    // rules and a commit they forbid while its first parent still has none. Each commit it brings in is gated by its own parent.
    if (rulesWritten(at.governance) || c.parents.slice(1).some((p) => rulesWritten(filesAt(p).governance))) expandMerge(c, who);
    return;
  }
  const tree = membershipTree(read.governance, at.systems === null ? null : entriesOf(at.systems, 'systems'));
  const hatted = orgHats(trailers.hat);
  const written = read.governance !== null && !implied && rules.length > 0;
  if (narrowing) findings.push({ unit: 'history', level: strict ? 'error' : 'warn', text: `${who}: its Org-Rule is ${NARROW_RULE}, and ${narrowing}.` });
  if (c.parents.length === 1 && trailers.rule !== OWNER_CLAIM_RULE) {
    // A direct apply under a hat (§6.4, §7.5): its Org-Hat is read, whatever the rules. Under the solo default any hat of the
    // membership tree lets its wearer decide alone (R-L5-8.9), so what is judged there is that it carries one in the tree.
    const hatSay = (text) => findings.push({ unit: 'history', level: strict ? 'error' : 'warn', text: `${who}: ${text}` });
    for (const text of hatted.problems) hatSay(text);
    for (const hat of hatted.hats) { const outside = outsideTree(hat, tree); if (outside) hatSay(`its Org-Hat ${outside}.`); }
    if (isAccount(actor.id) && !trailers.proposal && hatted.hats.length === 0 && hatted.problems.length === 0 && directClasses(c, at).length > 0) hatSay(NO_ORG_HAT);
  }
  if (!written) return;
  // The owner's claim (L5 spec §8.1 point 2): accepted here, and judged no further, only at a locked-out parent, for a
  // commit of data/members.yaml alone that adds exactly one handle. Otherwise it is said why, and the commit is judged
  // as any other: its trailer excuses nothing.
  if (trailers.rule === OWNER_CLAIM_RULE && c.parents.length === 1) {
    const why = ownerClaimProblem(c, at);
    if (why === null) return;
    findings.push({ unit: 'history', level: strict ? 'error' : 'warn', text: `${who}: its Org-Rule is ${OWNER_CLAIM_RULE}, and ${why}.` });
  }
  const book = resolveRoles(read.governance, members);
  // What the commit writes, and whether its change to governance.yaml only adds to `decisions` (a ledger change).
  const ledgerNow = c.files.includes(LEDGER) ? show(c.hash, LEDGER) : at.proposals;
  const govNow = c.files.includes(GOVERNANCE) ? show(c.hash, GOVERNANCE) : at.governance;
  const govLedgerOnly = c.files.includes(GOVERNANCE) && ledgerOnly(at.governance, govNow);
  // A library receipt rides along (L1-C5): data/library.yaml is judged only in a commit that writes nothing else governed.
  const judgedFiles = receiptsRideAlong(c.files.filter((f) => !(f === GOVERNANCE && govLedgerOnly)), governedClassOf);
  /** @type {string[]} */
  const reasons = [];
  const governed = [];
  for (const cls of new Set(judgedFiles.map((f) => governedClassOf(f)).filter(Boolean))) {
    const rule = ruleFor(rules, cls);
    let why;
    if (rule === null) why = `no rule covers the class ${cls}`;
    else if (actor.id === null) why = `${nobodyMade(actor)}, so it is nobody's to apply alone`;
    else {
      const may = mayDecideAlone(rule, actor.id, withOrgHat(book, actor.id, hatted.hats));
      if (may !== true) why = may;
    }
    if (why !== undefined) { reasons.push(`${cls}: ${why.replace(/\.?$/, '.')}`); governed.push(cls); }
  }
  if (reasons.length > 0) {
    const trailer = trailers.proposal;
    // Files no op can reach: a proposal cannot carry them, and a revert would be a hand commit of the same class,
    // so the only way out is the one spec §6 names.
    const unreachable = new Map();
    for (const f of judgedFiles) {
      const cls = governedClassOf(f);
      if (cls && governed.includes(cls) && !reachableByOp(f)) unreachable.set(cls, [...(unreachable.get(cls) ?? []), f]);
    }
    let problem = null;
    if (!trailer) {
      problem = unreachable.size === 0
        ? 'it has no Org-Proposal trailer. Propose the change, or ask a maintainer to revert it.'
        : `it has no Org-Proposal trailer, and no proposal can carry a change of ${[...unreachable].map(([cls, files]) => `class ${cls} (${files.join(', ')})`).join(' or ')} until P2b. ` +
          `The finding stays while the commit is among the last ${max}; to clear CI, give the CI command a --range that starts after it (spec §6).`;
    } else if (ledgerNow === null) {
      unchecked = true;
    } else {
      // Looked up in the commit's own tree, ratified there and open at its parent (§3.10): a ratification is used
      // once, by the merge that records it.
      const found = entriesOf(ledgerNow, 'proposals').find((p) => String(p.id) === trailer);
      const prior = entriesOf(at.proposals, 'proposals').find((p) => String(p.id) === trailer);
      if (!found) problem = `its Org-Proposal trailer names proposal ${trailer}, and proposal ${trailer} is not in data/proposals.yaml.`;
      else if (found.state !== 'ratified') problem = `its Org-Proposal trailer names proposal ${trailer}, and proposal ${trailer} is ${found.state ?? 'in no state'}, not ratified.`;
      else if (prior?.state !== 'open') {
        problem = `its Org-Proposal trailer names proposal ${trailer}, which ${prior === undefined ? 'was not in the ledger at its parent' : `was already ${prior.state ?? 'in no state'} at its parent`}: ` +
          'a proposal is ratified by the one merge that records it, and a later commit cannot borrow it.';
      }
    }
    if (problem) findings.push({ unit: 'history', level: strict ? 'error' : 'warn', text: `${who}: ${reasons.join(' ')} It is a change that needs someone else's say, and ${problem}` });
  } else if (c.parents.length === 1 && !trailers.proposal && hatted.hats.length > 0) {
    // Org-Hat names only the hats of the roles that propose or decide what the commit changes (R-L5-8.9, R-L5-21.2).
    // A direct apply's private part changes no file (L5 §10.3; alone, it is the empty commit "A change to a restricted
    // collection"): its classes are in the private store. So the commit is judged by the classes of its files together
    // with the classes of the direct rules its Org-Rule names (`<id>/direct`, the house's claim, as Org-Hat is), and
    // Org-Hat names only hats that decide one of those (R-L5-18.4).
    const named = (trailers.rule ?? '').split(',').map((s) => s.trim()).filter((s) => s.endsWith('/direct'))
      .map((s) => rules.find((r) => r.id === s.slice(0, -'/direct'.length))).filter((r) => r?.decide?.method === 'direct');
    const classes = [...new Set([...judgedFiles.map((f) => governedClassOf(f)).filter(Boolean), ...named.flatMap((r) => r.applies_to)])];
    const acting = classes.flatMap((cls) => [ruleFor(rules, cls)?.decide?.by, ruleFor(rules, cls)?.propose])
      .map((id) => book.roles.get(id ?? '')?.hat).filter(Boolean);
    for (const hat of hatted.hats.filter((h) => !acting.includes(h))) {
      findings.push({ unit: 'history', level: strict ? 'error' : 'warn', text: `${who}: its Org-Hat names the hat ${hat}, which is the hat of no role that proposes or decides ${classes.join(', ') || 'what it changes'}: a direct apply names the hats it acted under.` });
    }
  }
  // A merge here carries Org-Proposal: it is judged as a closing (a ratify), one unit, whatever it touches, once there is
  // a ledger to judge it by. A non-merge commit's ledger change is judged against its first parent.
  const ratifyMerge = c.parents.length > 1;
  const ledger = [];
  if (!ratifyMerge && c.files.includes(LEDGER)) {
    ledger.push(...judgeLedger(c, {
      rules, members, governance: read.governance, systems: at.systems === null ? null : entriesOf(at.systems, 'systems'), tree,
      was: at.proposals, now: ledgerNow,
    }));
  }
  if ((!ratifyMerge && (c.files.includes(LEDGER) || c.files.includes(GOVERNANCE))) || (ratifyMerge && (ledgerNow !== null || at.proposals !== null))) {
    ledger.push(...judgeClosings(c, { governance: read.governance, members, tree, was: at.proposals, now: ledgerNow, wasGov: at.governance, nowGov: govNow, govLedgerOnly }));
  }
  for (const f of ledger) findings.push({ unit: 'history', level: strict ? 'error' : 'warn', text: `${who}: proposal ${f.id}: ${f.text}` });
}

/**
 * Why a commit carrying `Org-Rule: visibility/narrow` is not exactly the narrowing its subject names (L5 spec §9.7,
 * R-L5-16.7), or null when it is: made by someone the repository names, and changing nothing but what that narrowing
 * changes (lib/narrow.mjs `narrowCommitProblem`), each file read at its parent and in it.
 */
function narrowProblem(c, actor) {
  if (actor.id === null) return `${nobodyMade(actor)}, so it is nobody's to narrow`;
  const parent = `${c.hash}^`;
  const VISIBILITY = 'data/visibility.yaml';
  const docAt = (rev, f) => { const text = show(rev, f); return text === null ? null : documentOf(text); };
  return narrowCommitProblem({
    subject: c.subject,
    files: c.files,
    doc: (f) => ({ was: docAt(parent, f), now: docAt(c.hash, f) }),
    policy: { was: docAt(parent, VISIBILITY), now: docAt(c.hash, VISIBILITY) },
    records: (doc, name) => recordsOfDoc(doc, name),
    classOf: (registry) => classOf({ registry }),
    // Judged from the parent's tree, as the server judges from the files it narrows (R-L5-16.12).
    referred: (registry, id) => [
      ...referrersOf(registry, id, (r) => recordsOfDoc(docAt(parent, `data/${r}.yaml`), r)),
      ...governanceNamesOf(readGovernance(show(parent, GOVERNANCE) ?? '').governance, registry, id),
    ],
  });
}

/** A registry's entries in its parsed document, under its top key or an alias of it (lib/registries.mjs). */
function recordsOfDoc(doc, name) {
  const d = isMap(doc) ? doc : {};
  const def = REGISTRIES.find((r) => r.name === name);
  const key = [def?.topKey ?? name, ...(def?.aliases ?? [])].find((k) => Object.hasOwn(d, k)) ?? def?.topKey ?? name;
  return listOf(d[key]).filter(isMap);
}

/**
 * Why a commit carrying `Org-Rule: bootstrap/owner-claim` is not the owner's claim (L5 spec §8.1 point 2), or null when it
 * is: its parent (`at`) is locked out (packages/admin/lib/claim.mjs `lockedOut`), it changes data/members.yaml and
 * nothing else, and that change adds exactly one handle to one person (`oneHandleAdded`).
 */
function ownerClaimProblem(c, at) {
  const others = c.files.filter((f) => f !== FILES.members);
  if (!c.files.includes(FILES.members)) return `it does not change ${FILES.members}, where the owner's claim adds a handle`;
  if (others.length > 0) return `it changes ${others.join(', ')} as well as ${FILES.members}, where the owner's claim changes that file alone`;
  const parent = { address: null, membersText: at.members, governanceText: at.governance, systemsText: at.systems, authors: null, dirty: [] };
  if (!lockedOut(parent)) return 'its parent is not locked out: someone could propose a change to members there, so it needed their say';
  return oneHandleAdded(at.members, show(c.hash, FILES.members));
}

/**
 * A merge with no Org-Proposal (H3): compared with git's own merge of its parents, and the commits on each incoming
 * parent's first-parent line down to the merge base judged, oldest first, each with the files at its own first parent.
 */
function expandMerge(c, who) {
  for (const f of compareWithGit(c)) findings.push({ unit: 'history', level: f.level, text: `${who}: ${f.text}` });
  const [p1, ...incoming] = c.parents;
  for (const p of incoming) {
    const line = git(['rev-list', '--first-parent', '--reverse', `${p1}..${p}`, ...rangeBounds()]);
    if (line.status !== 0) {
      findings.push({ unit: 'history', level: strict ? 'error' : 'warn', text: `${who}: git cannot list the commits it brings in (${first(line.stderr.trim().split('\n')) || 'no answer'}), so they were not judged.` });
      continue;
    }
    const hashes = line.stdout.split('\n').filter((h) => h !== '' && !judged.has(h));
    if (hashes.length === 0) continue;
    const log = git(['log', '--no-walk=unsorted', '--stdin', '--first-parent', '-m', '--name-only', FORMAT], `${hashes.join('\n')}\n`);
    const byHash = new Map(log.status === 0 ? commitsOf(log.stdout).map((x) => [x.hash, x]) : []);
    for (const h of hashes) {
      const x = byHash.get(h);
      if (x === undefined) {
        findings.push({ unit: 'history', level: strict ? 'error' : 'warn', text: `${who}: git cannot read commit ${h.slice(0, 7)}, which it brings in, so it was not judged.` });
        continue;
      }
      if (x.parents.length > 0) judgeCommit(x, filesAt(x.parents[0]), c.hash);
    }
  }
}

const top = git(['rev-parse', '--is-inside-work-tree', '--show-prefix']);
if (top.status !== 0 || top.stdout.split('\n')[0] !== 'true' || top.stdout.split('\n')[1] !== '') {
  notes.push(`history not checked: ${root} is not a git repository of its own`);
} else {
  const log = git(['log', '--first-parent', '-m', '--name-only', '-n', String(max), FORMAT, ...(range ? [range] : [])]);
  if (log.status !== 0) {
    notes.push(`history not checked: git could not read ${range ?? 'HEAD'} (${first(log.stderr.trim().split('\n')) ?? 'no commits yet'})`);
  } else {
    history = true;
    const commits = commitsOf(log.stdout).reverse(); // oldest first
    if (commits.length === max) notes.push(`history: judged the newest ${max} commits only (--max ${max})`);

    // The files at the commit's own parent: read at the first commit's parent, then kept up to date as the walk
    // moves on. The walk is first-parent, so the files after one commit are the files at the next one's parent.
    // (A commit a merge brings in is read at its own parent instead: expandMerge.)
    const state = { governance: null, members: null, systems: null, proposals: null };
    const firstParent = commits[0]?.parents[0];
    if (firstParent) for (const [k, rel] of Object.entries(FILES)) state[k] = show(firstParent, rel);

    for (const c of commits) {
      judgeCommit(c, { ...state });
      for (const [k, rel] of Object.entries(FILES)) if (c.files.includes(rel)) state[k] = show(c.hash, rel);
    }
    if (unchecked) notes.push('data/proposals.yaml does not exist yet: an Org-Proposal trailer is accepted without looking up the proposal');
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
for (const n of notes) console.log(`  · ${n}`);
if (notes.length > 0) console.log('');
const warnings = findings.filter((f) => f.level === 'warn');
const errors = findings.filter((f) => f.level === 'error');
for (const f of warnings) console.log(`  ⚠ ${f.text}`);
for (const f of errors) console.log(`  ✗ ${f.text}`);

const units = ['data/governance.yaml', ...(history ? ['history'] : []), ...(findings.some((f) => f.unit === GIT_SAFETY) ? [GIT_SAFETY] : [])];
const failed = new Set(errors.map((f) => f.unit));
const passed = units.filter((u) => !failed.has(u)).length;
if (findings.length === 0) console.log(`  ✓ ${history ? 'the rules are well-formed and the history agrees with them' : 'the rules are well-formed'}`);
console.log(`\nResults: ${passed} passed, ${failed.size} failed, ${warnings.length} warnings`);
process.exit(errors.length > 0 ? 1 : 0);
