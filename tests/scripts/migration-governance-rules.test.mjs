// tests/scripts/migration-governance-rules.test.mjs
//
// scripts/migrations/v0.5-to-v0.6-governance-rules.mjs (F2 spec §3.9) on throwaway
// instances. Every fixture is synthetic: the shapes are the ones the 2026-10-18
// survey found, the values are invented. The script takes the instance root as its
// argument, so it runs in place from this checkout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';

import { ORG_ROOT } from '../helpers/repo-paths.mjs';

const SCRIPT = path.join(ORG_ROOT, 'scripts', 'migrations', 'v0.5-to-v0.6-governance-rules.mjs');
const VALIDATE_DATA = path.join(ORG_ROOT, 'scripts', 'validate-data.mjs');
const VALIDATE_GOVERNANCE = path.join(ORG_ROOT, 'scripts', 'validate-governance.mjs');

const SOLO = `schema_version: "2.0"

# Governance Registry — Fixture
# Decisions are recorded in DECISIONS.md.

governance:
  model: "solo-maintainer"     # solo-maintainer | steward-council | multisig | assembly | conviction
  current_phase: "bootstrap"   # bootstrap | transition | active | sunset
  infrastructure:
    safe: null
  decisions: []
  elections: []
`;
// consensus-shaped: prose that names a window with no length, a commented example, and elections last.
const CONSENSUS = `schema_version: "2.0"

governance:
  model: "consensus"
  current_phase: "bootstrap"
  description: "Consent-based decision-making with objection window."
  infrastructure:
    safe: null
  decisions: []
    # Example:
    # - id: "gov-001"
  elections: []
`;
const ONE = `members:
  - id: "github:ana-example"
    name: "Ana Example"
    role: "operator"
    layer: "core"
    handles:
      github: "ana-example"
`;
const TWO = `members:
  - id: "did:fixture:ana"
    name: "Ana"
    role: "Founder and Strategy Lead"
    type: "individual"
    stakeholder_group: "core-team"
    handles: { git: ["ana@example.org"] }
  - id: "did:fixture:bruno"
    name: "Bruno"
    role: "Operations Lead"
    type: "individual"
    stakeholder_group: "core-team"
  - id: "did:fixture:carla"
    name: "Carla"
    type: "individual"
    stakeholder_group: "advisors"
`;

function instance({ governance, members } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'migration-governance-'));
  mkdirSync(path.join(root, 'data'));
  writeFileSync(path.join(root, 'federation.yaml'), 'identity:\n  name: "Fixture"\n');
  if (governance !== null) writeFileSync(path.join(root, 'data', 'governance.yaml'), governance ?? SOLO);
  if (members !== null) writeFileSync(path.join(root, 'data', 'members.yaml'), members ?? ONE);
  return root;
}
const run = (root, ...args) => spawnSync('node', [SCRIPT, root, ...args], { encoding: 'utf-8' });
const read = (root, rel = 'data/governance.yaml') => readFileSync(path.join(root, rel), 'utf-8');
const governanceOf = (root) => yaml.load(read(root)).governance;
const check = (script, root, ...a) => spawnSync('node', [script, root, ...a], { encoding: 'utf-8' });
/** Every line of `before` is still in `after`, in the same order. */
function keepsEveryLine(before, after) {
  const a = after.split('\n');
  let at = 0;
  for (const line of before.split('\n')) {
    const found = a.indexOf(line, at);
    assert.ok(found >= 0, `the line ${JSON.stringify(line)} is gone or moved`);
    at = found + 1;
  }
}

test('solo with exactly one person: the maintainer role is written, with every other byte and comment kept', () => {
  const root = instance();
  const before = read(root);
  const r = run(root);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const after = read(root);
  keepsEveryLine(before, after);
  assert.deepEqual(governanceOf(root).roles, { maintainer: { members: ['github:ana-example'] } });
  assert.equal(governanceOf(root).rules, undefined, 'the solo default is the rule: it is not written out');
  assert.match(r.stdout, /roles\.maintainer/);
  // The roles go before decisions, inside the block.
  assert.ok(after.indexOf('  roles:') < after.indexOf('  decisions:'));
});

test('the written file passes validate:data and validate:governance', () => {
  const root = instance();
  run(root);
  for (const script of [VALIDATE_DATA, VALIDATE_GOVERNANCE]) {
    const v = check(script, root);
    assert.equal(v.status, 0, `${path.basename(script)}: ${v.stdout}${v.stderr}`);
  }
});

test('run twice: the second run changes nothing and says why', () => {
  const root = instance();
  run(root);
  const once = read(root);
  const r = run(root);
  assert.equal(r.status, 0);
  assert.equal(read(root), once);
  assert.match(r.stdout, /already has roles/);
});

test('--dry says what it would write and writes nothing: no governance change, no memory/ log', () => {
  const root = instance();
  const before = read(root);
  const r = run(root, '--dry');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /would write roles\.maintainer/);
  assert.match(r.stdout, /\(--dry\) Nothing was written/);
  assert.equal(read(root), before);
  assert.equal(existsSync(path.join(root, 'memory')), false);
});

test('a real run logs to memory/migrations-<date>.md like the migrations before it', () => {
  const root = instance();
  run(root);
  const logs = readdirSync(path.join(root, 'memory')).filter((f) => /^migrations-\d{4}-\d{2}-\d{2}\.md$/.test(f));
  assert.equal(logs.length, 1);
  assert.match(read(root, path.join('memory', logs[0])), /v0\.5-to-v0\.6-governance-rules/);
});

test('solo with several people: nothing is written, and it says whom to name', () => {
  const root = instance({ members: TWO });
  const before = read(root);
  const r = run(root);
  assert.equal(r.status, 0);
  assert.equal(read(root), before);
  assert.match(r.stdout, /the solo rule lets each of 3 people decide alone/);
});

test('an agent or an organization is not a person: one person plus a crew seat is still one maintainer', () => {
  const members = ONE + `  - id: "crew-engineer"\n    name: "Engineer seat"\n    kind: "agent"\n`;
  const root = instance({ members });
  run(root);
  assert.deepEqual(governanceOf(root).roles, { maintainer: { members: ['github:ana-example'] } });
});

test('prose in a member\'s role field is never read as a governance role', () => {
  const members = TWO.replace('stakeholder_group: "core-team"', 'stakeholder_group: "x"').replace('stakeholder_group: "core-team"', 'stakeholder_group: "y"');
  const root = instance({ members, governance: CONSENSUS });
  const r = run(root, '--confirm', 'all');
  assert.equal(r.status, 0);
  assert.equal(governanceOf(root).roles, undefined);
  assert.match(r.stdout, /no member carries layer: core or stakeholder_group: core-team/);
});

test('consensus: the roles and rules are proposed, printed ready to paste, and not written without --confirm', () => {
  const root = instance({ governance: CONSENSUS, members: TWO });
  const before = read(root);
  const r = run(root);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(read(root), before);
  assert.match(r.stdout, /Needs your confirmation/);
  assert.match(r.stdout, /maintainer: \{ members: \["did:fixture:ana", "did:fixture:bruno"\] \}/);
  assert.match(r.stdout, /member: \{ all: true \}/);
  assert.match(r.stdout, /window: P7D/);
  assert.match(r.stdout, /--confirm roles/);
  assert.ok(!r.stdout.includes('did:fixture:carla'), 'a member outside the core team is not proposed as a maintainer');
});

test('--confirm roles writes the roles only', () => {
  const root = instance({ governance: CONSENSUS, members: TWO });
  const before = read(root);
  const r = run(root, '--confirm', 'roles');
  assert.equal(r.status, 0, r.stderr);
  keepsEveryLine(before, read(root));
  const g = governanceOf(root);
  assert.deepEqual(g.roles, { maintainer: { members: ['did:fixture:ana', 'did:fixture:bruno'] }, member: { all: true } });
  assert.equal(g.rules, undefined);
});

test('--confirm rules without roles refuses and writes nothing: rules need the roles they name', () => {
  const root = instance({ governance: CONSENSUS, members: TWO });
  const before = read(root);
  const r = run(root, '--confirm', 'rules');
  assert.equal(r.status, 0);
  assert.equal(read(root), before);
  assert.match(r.stdout, /rules need the roles they name/);
});

test('--confirm all writes both, once, and what it wrote passes both validators with no warning', () => {
  const root = instance({ governance: CONSENSUS, members: TWO });
  const before = read(root);
  const r = run(root, '--confirm', 'all');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  keepsEveryLine(before, read(root));
  const g = governanceOf(root);
  assert.deepEqual(g.rules.map((x) => x.id), ['records', 'governance']);
  assert.deepEqual(g.rules[0], { id: 'records', applies_to: ['records'], propose: 'member', decide: { by: 'maintainer', method: 'approve', count: 1 } });
  assert.deepEqual(g.rules[1].decide, { by: 'maintainer', method: 'consent', window: 'P7D' });
  for (const script of [VALIDATE_DATA, VALIDATE_GOVERNANCE]) {
    const v = check(script, root);
    assert.equal(v.status, 0, `${path.basename(script)}: ${v.stdout}`);
    assert.match(v.stdout, /0 warnings/, `${path.basename(script)}: ${v.stdout}`);
  }
  // The second run has nothing left to do.
  const again = read(root);
  run(root, '--confirm', 'all');
  assert.equal(read(root), again);
});

test('consensus members who lack handles.git are listed with the line to add; nothing is read from git', () => {
  const root = instance({ governance: CONSENSUS, members: TWO });
  const r = run(root);
  assert.match(r.stdout, /did:fixture:bruno has no handles\.git/);
  assert.ok(!/did:fixture:ana has no handles\.git/.test(r.stdout));
  assert.match(r.stdout, /handles:\n\s+git: \["<the address Bruno commits with>"\]/);
});

test('another non-solo model: roles are proposed from the same fields, rules are reported, never invented', () => {
  const root = instance({ governance: CONSENSUS.replace('"consensus"', '"steward-council"'), members: TWO });
  const r = run(root, '--confirm', 'all');
  assert.equal(r.status, 0);
  const g = governanceOf(root);
  assert.ok(g.roles);
  assert.equal(g.rules, undefined);
  assert.match(r.stdout, /steward-council has no default method/);
});

test('roles or rules that are already written are never touched', () => {
  const written = CONSENSUS.replace('  decisions: []', `  roles:
    maintainer: { members: ["did:fixture:ana"] }
  rules:
    - id: everything
      applies_to: [all]
      propose: maintainer
      decide: { by: maintainer, method: direct }
  decisions: []`);
  const root = instance({ governance: written, members: TWO });
  const r = run(root, '--confirm', 'all');
  assert.equal(r.status, 0);
  assert.equal(read(root), written);
  assert.match(r.stdout, /already has roles/);
  assert.match(r.stdout, /already has rules/);
});

test('the template shape: an empty roles: [] line is replaced, not duplicated', () => {
  const template = SOLO.replace('  decisions: []', '  roles: []\n  decisions: []');
  const root = instance({ governance: template });
  const r = run(root);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const after = read(root);
  assert.equal(after.match(/^\s*roles:/gm).length, 1);
  assert.deepEqual(governanceOf(root).roles, { maintainer: { members: ['github:ana-example'] } });
});

test('a governance file with no model is read as solo (the platform default)', () => {
  const root = instance({ governance: 'governance:\n  decisions: []\n' });
  run(root);
  assert.deepEqual(governanceOf(root).roles, { maintainer: { members: ['github:ana-example'] } });
});

test('no members file, or none that is a person: nothing to name, reported', () => {
  const none = instance({ members: null });
  assert.match(run(none).stdout, /data\/members\.yaml has no member of kind person/);
  assert.equal(governanceOf(none).roles, undefined);
});

test('a file the migration cannot edit safely is left alone and the reason is printed', () => {
  const cases = {
    'several YAML documents': ['governance:\n  model: solo-maintainer\n---\nnotes: x\n', /holds 2 YAML documents/],
    'not valid YAML': ['governance: [\n', /is not valid YAML/],
    'no governance: wrapper': ['model: solo-maintainer\ndecisions: []\n', /no `governance:` block/],
    'a flow-style block': ['governance: { model: solo-maintainer }\n', /written in flow style/],
  };
  for (const [name, [text, expected]] of Object.entries(cases)) {
    const root = instance({ governance: text });
    const r = run(root);
    assert.equal(r.status, 0, `${name}: ${r.stderr}`);
    assert.equal(read(root), text, `${name}: the file was changed`);
    assert.match(r.stdout, expected, name);
  }
});

test('an edit that would not leave the file as the original plus the new keys is not written, and the block to paste is printed', () => {
  // A flow sequence that continues at column 0: the block's last line is inside it, and an insertion there breaks the file.
  const text = 'governance:\n  model: solo-maintainer\n  tags: [a,\nb]\n';
  const root = instance({ governance: text });
  const r = run(root);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(read(root), text);
  assert.match(r.stdout, /could not add roles to data\/governance\.yaml without changing something else/);
  assert.match(r.stdout, /maintainer: \{ members: \["github:ana-example"\] \}/);
});

test('a missing governance.yaml is not created: it is the platform default already', () => {
  const root = instance({ governance: null });
  const r = run(root);
  assert.equal(r.status, 0);
  assert.equal(existsSync(path.join(root, 'data', 'governance.yaml')), false);
  assert.match(r.stdout, /no data\/governance\.yaml/);
});

test('CRLF files keep their line endings', () => {
  const root = instance({ governance: SOLO.replace(/\n/g, '\r\n') });
  run(root);
  const after = read(root);
  assert.ok(!/[^\r]\n/.test(after), 'a bare LF crept in');
  assert.deepEqual(governanceOf(root).roles, { maintainer: { members: ['github:ana-example'] } });
});

test('a block with no decisions: the keys go at the end of the block, before the next top-level key', () => {
  const root = instance({ governance: 'governance:\n  model: solo-maintainer\n  elections: []\nextra:\n  keep: 1\n' });
  run(root);
  const after = yaml.load(read(root));
  assert.deepEqual(after.governance.roles, { maintainer: { members: ['github:ana-example'] } });
  assert.deepEqual(after.extra, { keep: 1 });
});

test('a mistyped root is not a place to write', () => {
  const r = spawnSync('node', [SCRIPT, path.join(tmpdir(), 'no-such-instance-' + process.pid)], { encoding: 'utf-8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /is not an org-os instance/);
});

test('an option it does not know, and a --confirm key it does not know, are refused before anything is read', () => {
  const root = instance();
  const before = read(root);
  const a = run(root, '--confrim', 'all');
  assert.equal(a.status, 2);
  assert.match(a.stderr, /unknown option --confrim/);
  const b = run(root, '--confirm', 'everything');
  assert.equal(b.status, 2);
  assert.match(b.stderr, /--confirm takes roles, rules or all/);
  assert.equal(read(root), before);
});

test('the runner selects it after canonical-records, whatever order the files come in', async () => {
  const { selectMigrations } = await import(new URL('../../scripts/migrate.mjs', import.meta.url).href);
  const files = ['v0.5-to-v0.6-governance-rules.mjs', 'v0.5-to-v0.6-canonical-records.mjs', 'v2-to-v3-workstream-frontmatter.mjs'];
  assert.deepEqual(selectMigrations(files, '0.5', '0.6').map((m) => m.file), ['v0.5-to-v0.6-canonical-records.mjs', 'v0.5-to-v0.6-governance-rules.mjs']);
  assert.deepEqual(selectMigrations([...files].reverse(), '0.5', '0.6').map((m) => m.file), ['v0.5-to-v0.6-canonical-records.mjs', 'v0.5-to-v0.6-governance-rules.mjs']);
});

// ── F2 review follow-up ──────────────────────────────────────────────────────
const SAFE_SYSTEMS = `schema_version: "1.0"

systems:
  - id: "treasury-safe"
    kind: "safe"
    name: "Treasury"
    chain: "eip155:42220"
    address: "0x1111111111111111111111111111111111111111"
    driver: "safe"
`;
const receipt = (root) => {
  const logs = existsSync(path.join(root, 'memory')) ? readdirSync(path.join(root, 'memory')).filter((f) => /^migrations-/.test(f)) : [];
  return logs.length === 0 ? null : read(root, path.join('memory', logs[0]));
};

test('M2: the consensus proposal says where it departs from the architecture, treasury under consent when no System exists', () => {
  const root = instance({ governance: CONSENSUS, members: TWO });
  const r = run(root);
  assert.match(r.stdout, /departs from the architecture's example/);
  assert.match(r.stdout, /treasury/);
  assert.match(r.stdout, /no System/i);
  // Nothing is decided for the org: treasury stays among the consent classes.
  const g = yaml.load(r.stdout.split('Rules, proposed')[1].split('\n').filter((l) => /^ {6}/.test(l)).map((l) => l.slice(6)).join('\n'));
  assert.deepEqual(g.rules.map((x) => x.id), ['records', 'governance']);
  assert.ok(g.rules[1].applies_to.includes('treasury'));
});

test('M2: where data/systems.yaml names one Safe, the proposal sends treasury to it, and what it writes validates clean', () => {
  const root = instance({ governance: CONSENSUS, members: TWO });
  writeFileSync(path.join(root, 'data', 'systems.yaml'), SAFE_SYSTEMS);
  const r = run(root);
  assert.match(r.stdout, /departs from the architecture's example/);
  assert.match(r.stdout, /treasury-safe/);
  const w = run(root, '--confirm', 'all');
  assert.equal(w.status, 0, w.stdout + w.stderr);
  const rules = governanceOf(root).rules;
  assert.deepEqual(rules.map((x) => x.id), ['records', 'governance', 'treasury']);
  assert.ok(!rules[1].applies_to.includes('treasury'));
  assert.deepEqual(rules[2], { id: 'treasury', applies_to: ['treasury'], propose: 'maintainer', decide: { by: 'system', system: 'treasury-safe' } });
  for (const script of [VALIDATE_DATA, VALIDATE_GOVERNANCE]) {
    const v = check(script, root);
    assert.equal(v.status, 0, `${path.basename(script)}: ${v.stdout}`);
    assert.match(v.stdout, /0 warnings/, `${path.basename(script)}: ${v.stdout}`);
  }
});

test('M2: two Safes are not guessed between: treasury stays under consent and the proposal says why', () => {
  const root = instance({ governance: CONSENSUS, members: TWO });
  writeFileSync(path.join(root, 'data', 'systems.yaml'), SAFE_SYSTEMS + `  - id: "second-safe"\n    kind: "safe"\n    name: "Second"\n`);
  const r = run(root);
  assert.match(r.stdout, /more than one Safe/i);
  assert.ok(!/system: "?treasury-safe/.test(r.stdout));
});

test('L2: a second run with nothing to do adds nothing to the receipt', () => {
  const root = instance();
  run(root);
  const once = receipt(root);
  assert.match(once, /v0\.5-to-v0\.6-governance-rules/);
  const r = run(root);
  assert.equal(r.status, 0);
  assert.equal(receipt(root), once);
  const confirmed = instance({ governance: CONSENSUS, members: TWO });
  run(confirmed, '--confirm', 'all');
  const first = receipt(confirmed);
  run(confirmed, '--confirm', 'all');
  assert.equal(receipt(confirmed), first);
});

test('L3: the output, the receipt and the --confirm hint never carry an absolute path of this machine', () => {
  const root = instance({ governance: CONSENSUS, members: TWO });
  const r = run(root);
  assert.ok(!r.stdout.includes(root), r.stdout);
  assert.match(r.stdout, /run, from the instance root: node scripts\/migrations\/v0\.5-to-v0\.6-governance-rules\.mjs \. --confirm roles,rules/);
  const solo = instance();
  const s = run(solo);
  assert.ok(!s.stdout.includes(solo), s.stdout);
  assert.ok(!receipt(solo).includes(solo), receipt(solo));
  assert.ok(!/\/(?:tmp|var|private|Users|home)\//.test(receipt(solo)), receipt(solo));
});

// ── DAO-OS L5 Task 11 (F-L3-1, spec §8.1 point 4): no rules that lock an org out ─────────────────────────
// Even with --confirm, rules are written only when a person in each role that proposes under them has a git or wallet
// handle; otherwise nothing is written and the owner's claim command is printed. Each repo here is a fresh temp dir.
const NO_HANDLES = TWO.replace('    handles: { git: ["ana@example.org"] }\n', '');

test('--confirm all with no person holding a handle writes nothing and prints the owner\'s claim command', () => {
  const root = instance({ governance: CONSENSUS, members: NO_HANDLES });
  const before = read(root);
  const r = run(root, '--confirm', 'all');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(read(root), before);
  assert.ok(!existsSync(path.join(root, 'memory')), 'no receipt: nothing was written');
  assert.match(r.stdout, /nobody could propose under them/);
  assert.match(r.stdout, /node scripts\/claim-handle\.mjs --repo <instance> --owner --member did:fixture:ana \(--git <email> \| --wallet <CAIP-10>\)/);
  assert.ok(!r.stdout.includes(root), 'no absolute path of this machine');
});

test('a wallet is a handle: a maintainer with a CAIP-10 wallet lets the rules be written', () => {
  const wallet = NO_HANDLES.replace('    stakeholder_group: "core-team"\n  - id: "did:fixture:bruno"',
    '    stakeholder_group: "core-team"\n    handles: { wallet: "eip155:42220:0x00000000000000000000000000000000000000a1" }\n  - id: "did:fixture:bruno"');
  const root = instance({ governance: CONSENSUS, members: wallet });
  const r = run(root, '--confirm', 'all');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(governanceOf(root).rules.map((x) => x.id), ['records', 'governance']);
});

test('with a membership tree known, a wallet on another chain is no handle here, and nothing is written', () => {
  const wallet = NO_HANDLES.replace('    stakeholder_group: "core-team"\n  - id: "did:fixture:bruno"',
    '    stakeholder_group: "core-team"\n    handles: { wallet: "eip155:1:0x00000000000000000000000000000000000000a1" }\n  - id: "did:fixture:bruno"');
  const root = instance({ governance: CONSENSUS, members: wallet });
  writeFileSync(path.join(root, 'data', 'systems.yaml'), 'systems:\n  - id: "hats-main"\n    kind: "hats-tree"\n    name: "Hats"\n    chain: "eip155:42220"\n    address: "13"\n');
  const before = read(root);
  const r = run(root, '--confirm', 'all');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(read(root), before);
  assert.match(r.stdout, /--owner --member did:fixture:ana/);
});
