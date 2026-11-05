#!/usr/bin/env node
/**
 * claim-handle.mjs — the git address becomes a member's handle (wizards spec §5.4a, W2a), and the
 * owner's claim in an organisation that has locked itself out (DAO-OS L5 spec §8.1, F-L3-1).
 *
 * Usage: node scripts/claim-handle.mjs --repo <instance> --address <email> (--member <id> | --create <name>) [--dry]
 *        node scripts/claim-handle.mjs --repo <instance> --owner --member <id> (--git <email> | --wallet <CAIP-10>) [--dry]
 *
 * The admin app runs the first form for the person at the machine, after they have seen the exact lines and
 * pressed "This is me". The app has already checked; this script cannot trust it, so it reads the
 * repository itself and asks the same question (claimRefusal, packages/admin/lib/claim.mjs). It adds
 * the lines to data/members.yaml as text (every other byte kept), writes them to a temporary file,
 * checks the result against the members schema, checks that the address now names the claimed member
 * and no one else, and only then renames the file into place. On any failure the file is untouched.
 * It writes nothing else, and it never commits: the app does that, with its trailers.
 *
 * The second form, the owner's claim, is run by whoever runs commands on the machine that holds the
 * repository; no HTTP route makes it (C-9). It is refused unless the organisation is locked out: the rule
 * covering class members is missing, or its propose role holds nobody with a git or wallet handle. It
 * adds one handle (`handles.git`, or `handles.wallet` as a CAIP-10 account) to one listed person, the
 * same way, and then commits data/members.yaml alone itself, with `Org-Actor: owner` and
 * `Org-Rule: bootstrap/owner-claim`, which validate:governance accepts only at a locked-out parent.
 * `--address` is accepted for `--git`.
 *
 * Framework-only: it runs from the framework against any instance and needs packages/admin, which an
 * instance does not receive (scripts/lib/clone-excludes.mjs).
 *
 * Exit codes: 0 written (or, with --dry, would be) · 1 the arguments are wrong · 2 refused, nothing
 * written · 3 the result failed its own check, nothing written · 4 cannot run · 5 the owner's claim
 * was written and git refused its commit (the line stays; look at it with git diff).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

let claim;
let trailers;
try {
  claim = await import(new URL('../packages/admin/lib/claim.mjs', import.meta.url).href);
  trailers = await import(new URL('../packages/admin/lib/trailers.mjs', import.meta.url).href);
} catch (err) {
  console.error(`✗ claim-handle cannot load the admin library (${String(err?.message ?? err).split('\n')[0]})`);
  console.error('  run: npm ci --prefix packages/admin');
  process.exit(4);
}
const { MEMBERS_FILE, OWNER_ACTOR, OWNER_CLAIM_RULE, planClaim, readClaimState, verifyClaim } = claim;

const USAGE = [
  'Usage: node scripts/claim-handle.mjs --repo <instance> --address <email> (--member <id> | --create <name>) [--dry]',
  '       node scripts/claim-handle.mjs --repo <instance> --owner --member <id> (--git <email> | --wallet <CAIP-10>) [--dry]',
];

function option(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const stop = (code, ...lines) => {
  for (const line of lines) console.error(line);
  process.exit(code);
};

const repo = resolve(option('--repo') ?? '.');
const owner = process.argv.includes('--owner');
const gitArg = option('--git');
const addressArg = option('--address');
const address = gitArg ?? addressArg;
const wallet = option('--wallet');
const member = option('--member');
const create = option('--create');
const dry = process.argv.includes('--dry');

if (gitArg !== undefined && addressArg !== undefined) stop(1, ...USAGE);
if (owner) {
  // One listed member, and exactly one handle for them.
  if (!member || create !== undefined || (address === undefined) === (wallet === undefined) || address === '' || wallet === '') stop(1, ...USAGE);
} else if (!address || wallet !== undefined || (member === undefined) === (create === undefined) || member === '' || create === '') {
  stop(1, ...USAGE);
}
if (!existsSync(repo) || !statSync(repo).isDirectory()) stop(4, `✗ no such directory: ${repo}`);

const target = owner && wallet !== undefined ? { member, wallet } : member !== undefined ? { member } : { create };
const state = await readClaimState(repo, target);
if (owner) {
  // The owner names the address; it need not be the one git commits with here.
  state.owner = true;
  if (address !== undefined) state.address = address.trim();
} else {
  const git = (state.address ?? '').trim();
  if (git.toLowerCase() !== address.trim().toLowerCase()) {
    stop(2, `Refused: git reports ${git === '' ? 'no address' : git} here, not ${address}. Nothing was written. Prepare the claim again.`);
  }
}

const plan = planClaim(state);
if (plan.refusal) stop(2, `Refused: ${plan.refusal}`, 'Nothing was written.');

console.log(`${dry ? 'Would add' : 'Adding'} to ${MEMBERS_FILE}${plan.created ? ` (new member ${plan.id})` : ` (member ${plan.id})`}:`);
for (const line of plan.lines) console.log(`  + ${line}`);
if (dry) process.exit(0);

const file = join(repo, MEMBERS_FILE);
const tmp = `${file}.claim-${process.pid}.tmp`;
const fail = (code, message) => {
  rmSync(tmp, { force: true });
  stop(code, `✗ ${message}`, `${MEMBERS_FILE} was not changed.`);
};
try {
  writeFileSync(tmp, plan.text);
  const problem = verifyClaim(state.membersText ?? '', readFileSync(tmp, 'utf8'), state);
  if (problem) fail(3, problem);
  // Nothing may have touched the file since it was read: the claim is a change to exactly those bytes.
  if ((existsSync(file) ? readFileSync(file, 'utf8') : '') !== (state.membersText ?? '')) {
    fail(2, `${MEMBERS_FILE} changed while the claim was being made.`);
  }
  renameSync(tmp, file);
} catch (err) {
  fail(3, `could not write ${MEMBERS_FILE}: ${err instanceof Error ? err.message : String(err)}`);
}

if (owner) {
  // The owner's claim commits itself: data/members.yaml alone, whatever else the index holds.
  const handle = wallet !== undefined ? 'a wallet' : 'a git handle';
  const message = trailers.withTrailers(`admin(members): the owner's claim, ${handle} for ${plan.id}`, { actor: OWNER_ACTOR, rule: OWNER_CLAIM_RULE });
  const git = (args, input) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    git(['add', '--', MEMBERS_FILE]);
    git(['commit', '-q', '-F', '-', '--only', '--', MEMBERS_FILE], message);
  } catch (err) {
    const said = String(err?.stderr || err?.message || err).trim().split('\n')[0];
    stop(5, `✗ Written, not committed: ${MEMBERS_FILE} has the new line, but git refused the commit (${said}).`,
      '  Look at it with git diff, then commit it with the same trailers or put it back by hand.');
  }
  console.log(`Committed ${git(['rev-parse', '--short', 'HEAD']).trim()} (Org-Rule: ${OWNER_CLAIM_RULE}).`);
}
console.log('Done.');
