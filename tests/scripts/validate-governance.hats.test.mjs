// tests/scripts/validate-governance.hats.test.mjs
//
// validate:governance reads the house (DAO-OS L5 spec §6.4, §7.5): a commit the house authored is judged as made by
// its Org-Actor, any other by its author's email as in 0.6; an act by an address carries the reading it was judged on
// (`as`), of its own account, on a hat of the membership tree, and is judged by the book its proposal recorded up to
// it, offline; a direct apply by an address carries Org-Hat, and the role of that hat must decide alone.
// Every repository is a throwaway one built under the OS temp dir by the test itself (`-C <root>` on every git call).
// Placeholders only: members steward-a, steward-b; addresses 0x…a1 to 0x…a3; tree eip155:42220:13.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { ORG_ROOT } from '../helpers/repo-paths.mjs'
import { revOf, BY_ADDRESS } from '../../packages/admin/lib/proposals.mjs'

const SCRIPT = path.join(ORG_ROOT, 'scripts', 'validate-governance.mjs')

const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', CI: '' }
for (const key of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE']) delete ENV[key]
const HOUSE = 'house@org-os.invalid'
const EMAIL = { 'steward-a': 'steward-a@example.invalid', 'steward-b': 'steward-b@example.invalid', house: HOUSE }

function vcs(root, args, { who = 'steward-a', date } = {}) {
  const email = EMAIL[who] ?? who
  const name = who === 'house' ? 'org-os house' : who
  const r = spawnSync('git', ['-C', root, '-c', 'commit.gpgsign=false', ...args], {
    encoding: 'utf-8',
    env: { ...ENV, GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email,
      ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) },
  })
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}
function commit(root, files, message, opts) {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    writeFileSync(path.join(root, rel), text)
    vcs(root, ['add', '--', rel])
  }
  vcs(root, ['commit', '-q', '-m', message], opts)
  return vcs(root, ['rev-parse', '--short', 'HEAD'])
}
const run = (args) => spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', env: ENV })
const lines = (out) => out.split('\n').map((l) => l.trim()).filter(Boolean)
const findingsOf = (r) => lines(r.stdout).filter((l) => l.startsWith('✗') || l.startsWith('⚠'))

const COUNCIL = 'eip155:42220:0x0000000d00010000000000000000000000000000000000000000000000000000'
const OPS_HAT = 'eip155:42220:0x0000000d00010001000000000000000000000000000000000000000000000000'
const OUTSIDE = 'eip155:42220:0x0000000e00010000000000000000000000000000000000000000000000000000'
const A1 = 'eip155:42220:0x00000000000000000000000000000000000000A1'
const A2 = 'eip155:42220:0x00000000000000000000000000000000000000A2'
const A3 = 'eip155:42220:0x00000000000000000000000000000000000000A3'

const MEMBERS = `members:
  - { id: steward-a, name: Steward A, handles: { git: [steward-a@example.invalid] } }
  - { id: steward-b, name: Steward B, handles: { git: [steward-b@example.invalid] } }
`
const SYSTEMS = 'systems:\n  - { id: hats-main, kind: hats-tree, name: Hats, chain: "eip155:42220", address: "13" }\n'
/** Records: the council proposes and `decide` decides; everything else is steward-a's alone. */
const rulesWith = (decide, propose = 'council') => `governance:
  model: consensus
  membership: { tree: hats-main }
  roles:
    council: { hat: "${COUNCIL}" }
    maintainer: { members: [steward-a] }
  rules:
    - id: records
      applies_to: [records]
      propose: ${propose}
      decide: ${decide}
    - id: rest
      applies_to: [members, governance, identity, systems, treasury, operations, publication]
      propose: maintainer
      decide: { by: maintainer, method: direct }
  decisions: []
`
const APPROVE_RULES = rulesWith('{ by: council, method: approve, count: 1 }')
const COUNCIL_DIRECT = rulesWith('{ by: council, method: direct }')
const MAINTAINER_DIRECT = rulesWith('{ by: maintainer, method: direct }', 'maintainer')
const SOLO = 'governance:\n  model: solo-maintainer\n  membership: { tree: hats-main }\n'

const RULE = { id: 'records', applies_to: ['records'], propose: 'council', decide: { by: 'council', method: 'approve', count: 1 } }
const ID = 'p-2026-10-29-001-a3f9'
const OPS = [{ op: 'create', record: 'projects:p2', value: { id: 'p2', title: 'Two' }, base: null }]
const START = '2026-10-29T10:00:00Z'
const OPENED = '2026-10-29T10:02:00Z'
const at = (hhmm) => `2026-10-29T${hhmm}:00Z`
/** A reading as the house records it (§7.2). */
const reading = (account, block, readAt, over = {}) => ({ hat: COUNCIL, account, block, readAt, wearers: [A1, A2], complete: true, ...over })

const proposal = (over = {}) => ({
  id: ID, title: 'Add project two', author: A1, classes: ['records'], rules: [RULE], state: 'open', opened: OPENED,
  opened_as: reading(A1, 100, OPENED), rev: revOf(OPS), base: null, branch: `proposal/${ID}`, ops: OPS, events: [], closed: null, ...over,
})
const ledger = (...entries) => `proposals:\n${entries.map((e) => `  - ${JSON.stringify(e)}\n`).join('')}`
const trailers = (actor, more = '') => `\n\nOrg-Actor: ${actor}${more}`

function start(rules, { systems = SYSTEMS, files = {} } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'validate-governance-hats-'))
  vcs(root, ['init', '-q', '-b', 'main'])
  commit(root, {
    'data/members.yaml': MEMBERS, 'data/governance.yaml': rules, 'data/systems.yaml': systems,
    'data/projects.yaml': 'projects:\n  - { id: p1, title: One }\n', ...files,
  }, 'start', { date: START })
  return root
}
/** The house opens a proposal for `actor`. */
const open = (root, entry, actor = entry.author) =>
  commit(root, { 'data/proposals.yaml': ledger(entry) }, `proposals: open ${entry.id}${trailers(actor, `\nOrg-Proposal: ${entry.id}`)}`, { who: 'house', date: OPENED })
/** The house writes `events` for `actor`. */
function event(root, entry, events, actor, date) {
  const next = { ...entry, events: [...entry.events, ...events] }
  const sha = commit(root, { 'data/proposals.yaml': ledger(next) }, `proposals: ${events[0].kind} ${entry.id}${trailers(actor, `\nOrg-Proposal: ${entry.id}`)}`, { who: 'house', date })
  return { sha, entry: next }
}
/** A direct apply: data/projects.yaml gains a record, in one commit by `who` with `message`. */
const apply = (root, message, who = 'house', id = 'p3') =>
  commit(root, { 'data/projects.yaml': `projects:\n  - { id: p1, title: One }\n  - { id: ${id}, title: Three }\n` }, message, { who, date: at('11:00') })

function finds(root, sha, sentence) {
  const r = run([root, '--strict'])
  assert.equal(r.status, 1, r.stdout + r.stderr)
  const found = findingsOf(r).filter((l) => l.includes(sha))
  assert.ok(found.some((l) => (sentence instanceof RegExp ? sentence.test(l) : l.includes(sentence))), `no finding for ${sha} says ${sentence}:\n${r.stdout}`)
  return found
}
function clean(root) {
  const r = run([root, '--strict'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(lines(r.stdout).at(-1), 'Results: 2 passed, 0 failed, 0 warnings', r.stdout)
}

test('a house commit is judged as its Org-Actor', () => {
  const root = start(MAINTAINER_DIRECT)
  apply(root, `projects: add p3${trailers('steward-a', '\nOrg-Rule: records/direct')}`)
  clean(root)

  const other = start(MAINTAINER_DIRECT)
  const sha = apply(other, `projects: add p3${trailers('steward-b', '\nOrg-Rule: records/direct')}`)
  const found = finds(other, sha, '"steward-b" does not hold the maintainer role')
  assert.ok(found.every((l) => !l.includes('no member of data/members.yaml commits with that address')), found.join('\n'))

  const nobody = start(MAINTAINER_DIRECT)
  const sha2 = apply(nobody, 'projects: add p3')
  finds(nobody, sha2, `the house (${HOUSE}) made it and it names no Org-Actor`)
})

test('a house commit with a CAIP-10 actor and valid `as` passes offline', () => {
  const root = start(APPROVE_RULES)
  const entry = proposal()
  open(root, entry)
  event(root, entry, [{ id: 'e-1', at: at('11:00'), by: A2, kind: 'approve', rev: revOf(OPS), as: reading(A2, 101, at('11:00')) }], A2, at('11:00'))
  clean(root)
})

test('the same with an event\'s `as` removed fails with the Task 8 sentence', () => {
  const root = start(APPROVE_RULES)
  const entry = proposal()
  open(root, entry)
  const { sha } = event(root, entry, [{ id: 'e-1', at: at('11:00'), by: A2, kind: 'approve', rev: revOf(OPS) }], A2, at('11:00'))
  finds(root, sha, BY_ADDRESS)
})

test('`as.account` differing from `by` fails', () => {
  const root = start(APPROVE_RULES)
  const entry = proposal()
  open(root, entry)
  const as = reading(A3, 101, at('11:00'), { wearers: [A1, A2, A3] })
  const { sha } = event(root, entry, [{ id: 'e-1', at: at('11:00'), by: A2, kind: 'approve', rev: revOf(OPS), as }], A2, at('11:00'))
  finds(root, sha, `event e-1: its \`as\` reads the account ${A3}, and the event is by ${A2}: an act records the reading of its own account.`)

  // The proposal's own reading, likewise.
  const again = start(APPROVE_RULES)
  const sha2 = open(again, proposal({ opened_as: reading(A2, 100, OPENED) }))
  finds(again, sha2, `\`opened_as\` reads the account ${A2}, and the proposal is by ${A1}: an act records the reading of its own account.`)
})

test('an open proposal\'s `opened_as` is fixed when it is opened', () => {
  // A later commit that rewrites the reading the proposal was opened on (who wears the hat, read whole or not) changes the book.
  const root = start(APPROVE_RULES)
  const entry = proposal()
  open(root, entry)
  const rewritten = { ...entry, opened_as: reading(A1, 100, OPENED, { wearers: [A1, A2, A3], complete: false }) }
  const { sha } = event(root, rewritten, [{ id: 'e-1', at: at('11:00'), by: A2, kind: 'comment', as: reading(A2, 101, at('11:00')) }], A2, at('11:00'))
  finds(root, sha, 'its `opened_as` changed; it is fixed when the proposal is opened.')
})

test('an `as` that cannot be read, or names a hat outside the membership tree, is a finding', () => {
  const root = start(APPROVE_RULES)
  const entry = proposal()
  open(root, entry)
  const { block: _block, ...noBlock } = reading(A2, 101, at('11:00'))
  const { sha } = event(root, entry, [{ id: 'e-1', at: at('11:00'), by: A2, kind: 'comment', as: noBlock }], A2, at('11:00'))
  finds(root, sha, 'event e-1: its `as` cannot be read (its block is not a whole number), so it says nothing of who wears the hat.')

  const outside = start(APPROVE_RULES)
  const sha2 = open(outside, proposal({ opened_as: reading(A1, 100, OPENED, { hat: OUTSIDE }) }))
  finds(outside, sha2, `\`opened_as\` names the hat ${OUTSIDE}, which is not a hat of the membership tree eip155:42220:13.`)
})

test('an approval is judged by the book its proposal recorded up to it', () => {
  // A3 is read wearing the council hat only by its own approval's reading; the opening's complete list did not hold it,
  // and its own reading, read later, stands.
  const root = start(APPROVE_RULES)
  const entry = proposal()
  open(root, entry)
  event(root, entry, [{ id: 'e-1', at: at('11:00'), by: A3, kind: 'approve', rev: revOf(OPS), as: reading(A3, 101, at('11:00'), { wearers: [A1, A2, A3] }) }], A3, at('11:00'))
  clean(root)

  // An approval made under another hat (the lowest its author wears, R-L5-8.2): the opening's complete list of the council
  // did not hold its author, so the book at that event says it does not decide.
  const off = start(APPROVE_RULES)
  const first = proposal()
  open(off, first)
  const { sha } = event(off, first, [{ id: 'e-1', at: at('11:00'), by: A3, kind: 'approve', rev: revOf(OPS), as: reading(A3, 101, at('11:00'), { hat: OPS_HAT, wearers: [A3] }) }], A3, at('11:00'))
  finds(off, sha, `event e-1: "${A3}" does not hold the council role`)
})

test('a withdraw by an address carries `closed.as` of its own account', () => {
  const root = start(APPROVE_RULES)
  const entry = proposal()
  open(root, entry)
  const closing = (as) => ({ ...entry, state: 'withdrawn', events: [{ id: 'e-1', at: at('11:00'), by: A1, kind: 'withdraw' }], closed: { at: at('11:00'), by: A1, decision: null, as } })
  commit(root, { 'data/proposals.yaml': ledger(closing(reading(A1, 102, at('11:00')))) }, `proposals: withdraw ${ID}${trailers(A1, `\nOrg-Proposal: ${ID}`)}`, { who: 'house', date: at('11:00') })
  clean(root)

  const wrong = start(APPROVE_RULES)
  open(wrong, entry)
  const sha = commit(wrong, { 'data/proposals.yaml': ledger(closing(reading(A2, 102, at('11:00')))) }, `proposals: withdraw ${ID}${trailers(A1, `\nOrg-Proposal: ${ID}`)}`, { who: 'house', date: at('11:00') })
  finds(wrong, sha, `\`closed.as\` reads the account ${A2}, and the closing is by ${A1}: an act records the reading of its own account.`)
})

test('a direct apply by a CAIP-10 actor without Org-Hat fails', () => {
  const root = start(COUNCIL_DIRECT)
  const sha = apply(root, `projects: add p3${trailers(A1, '\nOrg-Rule: records/direct')}`)
  finds(root, sha, 'a direct apply by an address carries the hat it acted under (Org-Hat: <hat ref> @<block>), and this one carries none.')

  // With it: the role of that hat decides alone.
  const ok = start(COUNCIL_DIRECT)
  apply(ok, `projects: add p3${trailers(A1, `\nOrg-Rule: records/direct\nOrg-Hat: ${COUNCIL} @100`)}`)
  clean(ok)

  // A hat outside the membership tree.
  const outside = start(COUNCIL_DIRECT)
  const sha2 = apply(outside, `projects: add p3${trailers(A1, `\nOrg-Rule: records/direct\nOrg-Hat: ${OUTSIDE} @100`)}`)
  finds(outside, sha2, `its Org-Hat names the hat ${OUTSIDE}, which is not a hat of the membership tree eip155:42220:13.`)

  // Under the solo default as well: any hat of the membership tree lets it decide alone (R-L5-8.9), but one it must carry.
  const solo = start(SOLO)
  const sha3 = apply(solo, `projects: add p3${trailers(A1, '\nOrg-Rule: solo/direct')}`)
  finds(solo, sha3, 'a direct apply by an address carries the hat it acted under (Org-Hat: <hat ref> @<block>), and this one carries none.')
  const soloOk = start(SOLO)
  apply(soloOk, `projects: add p3${trailers(A1, `\nOrg-Rule: solo/direct\nOrg-Hat: ${COUNCIL} @100`)}`)
  clean(soloOk)
})

test('a direct apply of restricted data alone changes no file: its Org-Hat is judged by the rules its Org-Rule names (R-L5-18.4)', () => {
  // L5 §10.3: the empty commit "A change to a restricted collection"; which class it changed is in the private store.
  const restricted = (root, more) => {
    vcs(root, ['commit', '-q', '--allow-empty', '-m', `A change to a restricted collection${trailers(A1, more)}`], { who: 'house', date: at('11:00') })
    return vcs(root, ['rev-parse', '--short', 'HEAD'])
  }
  const ok = start(COUNCIL_DIRECT)
  restricted(ok, `\nOrg-Rule: records/direct\nOrg-Hat: ${COUNCIL} @100`)
  clean(ok)

  // A hat that decides none of the rules it names is still a finding, as is a rule the governance file does not hold.
  const other = start(COUNCIL_DIRECT)
  const sha = restricted(other, `\nOrg-Rule: records/direct\nOrg-Hat: ${OPS_HAT} @100`)
  finds(other, sha, `its Org-Hat names the hat ${OPS_HAT}, which is the hat of no role that proposes or decides records`)
  const unknown = start(COUNCIL_DIRECT)
  const sha2 = restricted(unknown, `\nOrg-Rule: grants/direct\nOrg-Hat: ${COUNCIL} @100`)
  finds(unknown, sha2, `its Org-Hat names the hat ${COUNCIL}, which is the hat of no role that proposes or decides what it changes`)
  // A rule that is not direct is no rule of a direct apply, whatever the trailer says.
  const approving = start(APPROVE_RULES)
  const sha3 = restricted(approving, `\nOrg-Rule: records/direct\nOrg-Hat: ${COUNCIL} @100`)
  finds(approving, sha3, `its Org-Hat names the hat ${COUNCIL}, which is the hat of no role that proposes or decides what it changes`)
})

test('a direct apply with a git part and a private part of another class is judged by both (R-L5-18.4, fix round 1)', () => {
  // Records are decided directly by Council, members by Ops; the actor wears both. Its git part changes data/members.yaml
  // (members); its private part, invisible offline, is a record of a private collection (records). The house writes both
  // rules in Org-Rule and both deciding hats in Org-Hat, as applyAs does.
  const TREASURER = 'eip155:42220:0x0000000d00020000000000000000000000000000000000000000000000000000'
  const BOTH = `governance:
  model: consensus
  membership: { tree: hats-main }
  roles:
    council: { hat: "${COUNCIL}" }
    ops: { hat: "${OPS_HAT}" }
    maintainer: { members: [steward-a] }
  rules:
    - { id: records, applies_to: [records], propose: council, decide: { by: council, method: direct } }
    - { id: people, applies_to: [members], propose: ops, decide: { by: ops, method: direct } }
    - { id: rest, applies_to: [governance, identity, systems, treasury, operations, publication], propose: maintainer, decide: { by: maintainer, method: direct } }
  decisions: []
`
  const mixed = (root, rule, hats) => commit(root, { 'data/members.yaml': MEMBERS.replace('name: Steward B,', 'name: Steward B, role: Treasurer,') },
    `members: update steward-b${trailers(A1, `\nOrg-Rule: ${rule}\nOrg-Hat: ${hats}`)}`, { who: 'house', date: at('11:00') })
  const ok = start(BOTH)
  mixed(ok, 'records/direct,people/direct', `${COUNCIL} @100, ${OPS_HAT} @100`)
  clean(ok)

  // A hat that decides neither the file's class nor a class of the rules it names is still the finding.
  const other = start(BOTH)
  const sha = mixed(other, 'records/direct,people/direct', `${TREASURER} @100, ${OPS_HAT} @100`)
  finds(other, sha, `its Org-Hat names the hat ${TREASURER}, which is the hat of no role that proposes or decides members, records`)
})

test('a non-house commit is judged by its author email, as 0.6', () => {
  // An Org-Actor trailer on a commit someone else authored names nobody: anyone can type one.
  const root = start(MAINTAINER_DIRECT)
  const sha = apply(root, `projects: add p3${trailers('steward-a', '\nOrg-Rule: records/direct')}`, 'stranger@example.invalid')
  finds(root, sha, 'no member of data/members.yaml commits with that address')

  const member = start(MAINTAINER_DIRECT)
  apply(member, 'projects: add p3', 'steward-a')
  clean(member)
})

// ── A narrowing (DAO-OS L5 spec §9.7, C-14; R-L5-10.7) ─────────────────────────────────────────────────────────────
// A commit carrying `Org-Rule: visibility/narrow` applies at once, outside the rules: here records need the council's
// approval, and steward-a's narrowing of projects.yaml is still accepted, because everything it changes narrows. The
// ledger's ops that wrote the value become placeholders in the same commit, open and closed proposals alike.

const NARROW_TRAILERS = trailers('steward-a', '\nOrg-Rule: visibility/narrow')
const PLAIN_POLICY = 'visibility:\n  collections:\n    projects: { default: members }\n'
const BUDGET_POLICY = `visibility:\n  collections:\n    projects: { default: members, fields: { budget: "hat:${COUNCIL}" } }\n`
const WITH_BUDGET = 'projects:\n  - { id: p1, title: One, budget: 9 }\n'
const WITHOUT_BUDGET = 'projects:\n  - { id: p1, title: One }\n'
const BUDGET_OPS = [{ op: 'update', record: 'projects:p1', set: { title: 'Uno', budget: 12 }, base: null }]
const PLACEHOLDER = { op: 'private', ref: 'prv_00000000000000a1', class: 'records', digest: `sha256:${'d'.repeat(64)}` }
/** A proposal opened by A1 that writes the budget, and it after a narrowing: the budget out of its op, a placeholder after. */
const budgetProposal = () => proposal({ title: 'Rename and budget', ops: BUDGET_OPS, rev: revOf(BUDGET_OPS) })
function substituted(entry, placeholders = [PLACEHOLDER]) {
  const ops = [{ ...BUDGET_OPS[0], set: { title: 'Uno' } }, ...placeholders]
  return { ...entry, ops, rev: revOf(ops) }
}
const narrowStart = () => start(APPROVE_RULES, { files: { 'data/projects.yaml': WITH_BUDGET, 'data/visibility.yaml': PLAIN_POLICY } })
const narrowCommit = (root, files) => commit(root, files, `visibility: narrow budget of projects to hat:${COUNCIL}${NARROW_TRAILERS}`, { who: 'house', date: at('11:00') })

test('a narrowing that takes a field out of git, and its proposals\' ops with it, is accepted outside the rules', () => {
  const root = narrowStart()
  const entry = budgetProposal()
  open(root, entry)
  narrowCommit(root, { 'data/projects.yaml': WITHOUT_BUDGET, 'data/visibility.yaml': BUDGET_POLICY, 'data/proposals.yaml': ledger(substituted(entry)) })
  clean(root)

  // A narrowing of one record's level, and of a collection's, in git: accepted the same way.
  const record = start(APPROVE_RULES, { files: { 'data/projects.yaml': 'projects:\n  - { id: p1, title: One, visibility: public }\n' } })
  commit(record, { 'data/projects.yaml': 'projects:\n  - { id: p1, title: One, visibility: members }\n' }, `visibility: narrow projects:p1 to members${NARROW_TRAILERS}`, { who: 'house', date: at('11:00') })
  clean(record)
})

test('a commit under visibility/narrow that also adds or changes a value is said to be no narrowing, and judged as any other', () => {
  const root = narrowStart()
  const sha = narrowCommit(root, { 'data/projects.yaml': 'projects:\n  - { id: p1, title: Changed }\n', 'data/visibility.yaml': BUDGET_POLICY })
  finds(root, sha, 'its Org-Rule is visibility/narrow, and it changes data/projects.yaml otherwise than by taking budget out of its entries.')
  finds(root, sha, /records: .*needs someone else's say/)

  const other = narrowStart()
  const sha2 = narrowCommit(other, { 'data/projects.yaml': WITHOUT_BUDGET, 'data/visibility.yaml': BUDGET_POLICY, 'data/members.yaml': `${MEMBERS}  - { id: steward-c, name: Steward C }\n` })
  finds(other, sha2, `its Org-Rule is visibility/narrow, and it changes data/members.yaml, which narrowing budget of projects to hat:${COUNCIL} does not.`)
})

test('a commit under visibility/narrow that widens data/visibility.yaml is no narrowing', () => {
  const root = start(APPROVE_RULES, { files: { 'data/projects.yaml': WITHOUT_BUDGET, 'data/visibility.yaml': BUDGET_POLICY } })
  const sha = narrowCommit(root, { 'data/visibility.yaml': PLAIN_POLICY.replace('{ default: members }', '{ default: members, fields: { budget: members } }') })
  finds(root, sha, `its Org-Rule is visibility/narrow, and it changes data/visibility.yaml otherwise than by narrowing budget of projects to hat:${COUNCIL}.`)
  const public_ = start(APPROVE_RULES, { files: { 'data/visibility.yaml': PLAIN_POLICY } })
  const sha2 = commit(public_, { 'data/visibility.yaml': PLAIN_POLICY.replace('default: members', 'default: public') }, `visibility: narrow projects to public${NARROW_TRAILERS}`, { who: 'house', date: at('11:00') })
  finds(public_, sha2, 'its Org-Rule is visibility/narrow, and it changes data/visibility.yaml otherwise than by narrowing projects to public.')
})

test('a narrowing changes a proposal only by holding what left as placeholders: anything else of it is a finding', () => {
  const files = (entry) => ({ 'data/projects.yaml': WITHOUT_BUDGET, 'data/visibility.yaml': BUDGET_POLICY, 'data/proposals.yaml': ledger(entry) })

  // Its title changed in the same commit.
  const title = narrowStart()
  const entry = budgetProposal()
  open(title, entry)
  const sha = narrowCommit(title, files({ ...substituted(entry), title: 'Something else' }))
  finds(title, sha, 'its Org-Rule is visibility/narrow, and it changes the `title` of proposal p-2026-10-29-001-a3f9.')

  // The budget dropped from the op with no placeholder to hold it.
  const dropped = narrowStart()
  open(dropped, entry)
  const sha2 = narrowCommit(dropped, files(substituted(entry, [])))
  finds(dropped, sha2, 'proposal p-2026-10-29-001-a3f9 holds 0 new placeholders for the 1 op this narrowing takes from')

  // The rev left as it was.
  const stale = narrowStart()
  open(stale, entry)
  const sha3 = narrowCommit(stale, files({ ...substituted(entry), rev: entry.rev }))
  finds(stale, sha3, /the rev of proposal p-2026-10-29-001-a3f9 is not the rev of its ops/)

  // A closed proposal is substituted the same way, and nothing else of it changes.
  const closed = narrowStart()
  open(closed, entry)
  const withdrawn = { ...entry, state: 'withdrawn', closed: { at: at('10:30'), by: A1, decision: null, as: reading(A1, 100, at('10:30')) },
    events: [{ id: 'e-1', at: at('10:30'), by: A1, kind: 'withdraw' }] }
  commit(closed, { 'data/proposals.yaml': ledger(withdrawn) }, `proposals: withdraw ${ID}${trailers(A1, `\nOrg-Proposal: ${ID}`)}`, { who: 'house', date: at('10:30') })
  narrowCommit(closed, files(substituted(withdrawn)))
  clean(closed)
})

test('a narrowing carries the approvals, votes and objections on the old rev to the new one, and nothing else (C1)', () => {
  const files = (entry) => ({ 'data/projects.yaml': WITHOUT_BUDGET, 'data/visibility.yaml': BUDGET_POLICY, 'data/proposals.yaml': ledger(entry) })
  const root = narrowStart()
  const opened = budgetProposal()
  open(root, opened)
  const { entry } = event(root, opened, [{ id: 'e-1', at: at('10:30'), by: A2, kind: 'object', rev: opened.rev, text: 'Not this budget.', as: reading(A2, 101, at('10:30')) }], A2, at('10:30'))
  const next = substituted(entry)
  narrowCommit(root, files({ ...next, events: entry.events.map((e) => ({ ...e, rev: next.rev })) }))
  clean(root)

  // Left on the old rev, the objection would read as answered: not a narrowing.
  const left = narrowStart()
  open(left, opened)
  const { entry: e2 } = event(left, opened, [{ id: 'e-1', at: at('10:30'), by: A2, kind: 'object', rev: opened.rev, text: 'Not this budget.', as: reading(A2, 101, at('10:30')) }], A2, at('10:30'))
  const sha = narrowCommit(left, files(substituted(e2)))
  finds(left, sha, 'it changes the events of proposal p-2026-10-29-001-a3f9 otherwise than by carrying its approvals, votes and objections to its new rev')
})

test('a narrowing takes what it narrows out of the ops a revise event recorded too, and leaving it there is a finding (final review MF-2)', () => {
  const files = (entry) => ({ 'data/projects.yaml': WITHOUT_BUDGET, 'data/visibility.yaml': BUDGET_POLICY, 'data/proposals.yaml': ledger(entry) })
  const RENAME = [{ op: 'update', record: 'projects:p1', set: { title: 'Uno' }, base: null }]
  /** Opened as a rename, then revised to each of `revisions` in turn (event ids e-1, e-2, …). */
  const revised = (root, ...revisions) => {
    const opened = proposal({ title: 'Rename', ops: RENAME, rev: revOf(RENAME) })
    open(root, opened)
    return revisions.reduce((entry, ops, i) => {
      const when = at(`10:${20 + i * 10}`)
      return event(root, { ...entry, ops, rev: revOf(ops) },
        [{ id: `e-${i + 1}`, at: when, by: A1, kind: 'revise', rev: revOf(ops), ops, as: reading(A1, 101 + i, when) }], A1, when).entry
    }, opened)
  }
  const withEvent = (entry, id, change) => ({ ...entry, events: entry.events.map((e) => (e.id === id ? change(e) : e)) })

  // An earlier revision wrote the budget: its revise event holds a placeholder where it was; the proposal is unchanged.
  const earlier = narrowStart()
  const e1 = revised(earlier, BUDGET_OPS, RENAME)
  narrowCommit(earlier, files(withEvent(e1, 'e-1', (e) => ({ ...e, ops: [{ ...BUDGET_OPS[0], set: { title: 'Uno' } }, PLACEHOLDER] }))))
  clean(earlier)

  // The revision the proposal holds now: its revise event holds the proposal's new ops, at its new rev.
  const latest = narrowStart()
  const e2 = revised(latest, BUDGET_OPS)
  const next = substituted(e2)
  narrowCommit(latest, files(withEvent(next, 'e-1', (e) => ({ ...e, ops: next.ops, rev: next.rev }))))
  clean(latest)

  // Left in clear in that revise event: no narrowing.
  const left = narrowStart()
  const e3 = revised(left, BUDGET_OPS)
  const sha = narrowCommit(left, files(substituted(e3)))
  finds(left, sha, `its Org-Rule is visibility/narrow, and it changes the ops of revise event e-1 of proposal ${ID} otherwise than by taking out what it narrows.`)

  // Its other keys changed beside the substitution: no narrowing either.
  const other = narrowStart()
  const e4 = revised(other, BUDGET_OPS, RENAME)
  const sha2 = narrowCommit(other, files(withEvent(e4, 'e-1', (e) => ({ ...e, by: A2, ops: [{ ...BUDGET_OPS[0], set: { title: 'Uno' } }, PLACEHOLDER] }))))
  finds(other, sha2, `its Org-Rule is visibility/narrow, and it changes the \`by\` of revise event e-1 of proposal ${ID}.`)

  // A narrowing that leaves the ledger untouched: the tree it leaves holds the value, and the check of the tree says so.
  const untouched = narrowStart()
  revised(untouched, BUDGET_OPS, RENAME)
  narrowCommit(untouched, { 'data/projects.yaml': WITHOUT_BUDGET, 'data/visibility.yaml': BUDGET_POLICY })
  const r = run([untouched, '--strict'])
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.match(r.stdout, /events\.0\.ops\.0: op 1 of revise event e-1 on projects:p1 writes budget, which data\/visibility\.yaml restricts/)
})

test('under visibility/narrow, removing anything the narrowing does not name is judged as any commit (I1)', () => {
  const subject = `visibility: narrow budget of projects to hat:${COUNCIL}${NARROW_TRAILERS}`
  const under = (root, files, message = subject) => commit(root, files, message, { who: 'house', date: at('11:00') })

  // An unrelated record taken out.
  const record = start(APPROVE_RULES, { files: { 'data/projects.yaml': 'projects:\n  - { id: p1, title: One, budget: 9 }\n  - { id: p2, title: Two }\n', 'data/visibility.yaml': PLAIN_POLICY } })
  const sha1 = under(record, { 'data/projects.yaml': WITHOUT_BUDGET, 'data/visibility.yaml': BUDGET_POLICY })
  finds(record, sha1, 'its Org-Rule is visibility/narrow, and it changes data/projects.yaml otherwise than by taking budget out of its entries.')

  // A member's handles stripped: under this subject, and under one that names them.
  const handles = narrowStart()
  const sha2 = under(handles, { 'data/members.yaml': 'members:\n  - { id: steward-a, name: Steward A }\n  - { id: steward-b, name: Steward B, handles: { git: [steward-b@example.invalid] } }\n' })
  finds(handles, sha2, /its Org-Rule is visibility\/narrow, and .*does not narrow budget of projects/)
  const named = narrowStart()
  const sha3 = under(named, { 'data/members.yaml': 'members:\n  - { id: steward-a, name: Steward A }\n  - { id: steward-b, name: Steward B }\n' }, `visibility: narrow handles of members to hat:${COUNCIL}${NARROW_TRAILERS}`)
  finds(named, sha3, 'its Org-Rule is visibility/narrow, and members.handles stays in the repository: the rules count it.')
  const member = narrowStart()
  const sha4 = under(member, { 'data/members.yaml': 'members:\n  - { id: steward-a, name: Steward A, handles: { git: [steward-a@example.invalid] } }\n' }, `visibility: narrow members:steward-b to hat:${COUNCIL}${NARROW_TRAILERS}`)
  finds(member, sha4, "its Org-Rule is visibility/narrow, and a member's record stays in the repository: the rules count it.")

  // A whole file deleted.
  const file = narrowStart()
  vcs(file, ['rm', '-q', '--', 'data/projects.yaml'])
  writeFileSync(path.join(file, 'data/visibility.yaml'), BUDGET_POLICY)
  vcs(file, ['add', '--', 'data/visibility.yaml'])
  vcs(file, ['commit', '-q', '-m', subject], { who: 'house', date: at('11:00') })
  const sha5 = vcs(file, ['rev-parse', '--short', 'HEAD'])
  finds(file, sha5, 'its Org-Rule is visibility/narrow, and it deletes data/projects.yaml.')

  // A ratified proposal's op that writes no budget, put behind a placeholder.
  const RENAME = [{ op: 'update', record: 'projects:p1', set: { title: 'Uno' }, base: null }]
  const ratified = proposal({ id: 'p-2026-10-29-002-b4e1', title: 'Rename', ops: RENAME, rev: revOf(RENAME), state: 'ratified',
    closed: { at: at('10:10'), by: A2, decision: 'd-1', as: reading(A2, 100, at('10:10')) } })
  const fake = narrowStart()
  commit(fake, { 'data/proposals.yaml': ledger(ratified) }, 'ledger by hand', { date: at('10:20') })
  const hidden = [PLACEHOLDER]
  const sha6 = under(fake, { 'data/projects.yaml': WITHOUT_BUDGET, 'data/visibility.yaml': BUDGET_POLICY, 'data/proposals.yaml': ledger({ ...ratified, ops: hidden, rev: revOf(hidden) }) })
  finds(fake, sha6, 'its Org-Rule is visibility/narrow, and it changes proposal p-2026-10-29-002-b4e1, which holds nothing this narrowing takes out.')
})

test('a narrowing out of git of a record data/governance.yaml names, or other entries reference, is no narrowing (fix round 2)', () => {
  // The membership tree's system: every hat would stop counting.
  const tree = start(APPROVE_RULES)
  const sha = commit(tree, { 'data/systems.yaml': 'systems: []\n' }, `visibility: narrow systems:hats-main to hat:${COUNCIL}${NARROW_TRAILERS}`, { who: 'house', date: at('11:00') })
  finds(tree, sha, 'its Org-Rule is visibility/narrow, and systems:hats-main is named by data/governance.yaml "governance" (membership.tree), so it stays in the repository.')

  // A system a rule decides by.
  const rules = APPROVE_RULES.replace('  decisions: []\n', '    - { id: grants, applies_to: [treasury], propose: maintainer, decide: { by: system, system: vote-pool } }\n  decisions: []\n')
  const pool = start(rules, { systems: `${SYSTEMS}  - { id: vote-pool, kind: gardens-pool, name: Votes, chain: "eip155:42220", address: "0x00000000000000000000000000000000000000b1" }\n` })
  const sha2 = commit(pool, { 'data/systems.yaml': SYSTEMS }, `visibility: narrow systems:vote-pool to hat:${COUNCIL}${NARROW_TRAILERS}`, { who: 'house', date: at('11:00') })
  finds(pool, sha2, 'systems:vote-pool is named by data/governance.yaml "grants" (decide.system), so it stays in the repository.')

  // An idea a project names.
  const idea = start(APPROVE_RULES, { files: {
    'data/projects.yaml': 'projects:\n  - { id: p1, title: One, related_ideas: [i1] }\n', 'data/ideas.yaml': 'ideas:\n  - { id: i1, title: Idea }\n' } })
  const sha3 = commit(idea, { 'data/ideas.yaml': 'ideas: []\n' }, `visibility: narrow ideas:i1 to hat:${COUNCIL}${NARROW_TRAILERS}`, { who: 'house', date: at('11:00') })
  finds(idea, sha3, 'ideas:i1 is named by projects "p1" (related_ideas), so it stays in the repository.')
})

test('narrowing members.email gives a member with no handles.git the e-mail as that handle in the same commit, and nothing else (Q78)', () => {
  const PLAIN_MEMBERS = 'visibility:\n  collections:\n    members: { default: members }\n'
  const EMAIL_POLICY = `visibility:\n  collections:\n    members: { default: members, fields: { email: "hat:${COUNCIL}" } }\n`
  const WITH = `${MEMBERS}  - { id: steward-c, name: Steward C, email: steward-c@example.invalid }\n`
  const begin = () => start(APPROVE_RULES, { files: { 'data/members.yaml': WITH, 'data/visibility.yaml': PLAIN_MEMBERS } })
  const narrowEmail = (root, members) => commit(root, { 'data/members.yaml': members, 'data/visibility.yaml': EMAIL_POLICY },
    `visibility: narrow email of members to hat:${COUNCIL}${NARROW_TRAILERS}`, { who: 'house', date: at('11:00') })

  const kept = begin()
  narrowEmail(kept, `${MEMBERS}  - { id: steward-c, name: Steward C, handles: { git: steward-c@example.invalid } }\n`)
  clean(kept)

  // The identity dropped with the e-mail: no narrowing.
  const dropped = begin()
  const sha = narrowEmail(dropped, `${MEMBERS}  - { id: steward-c, name: Steward C }\n`)
  finds(dropped, sha, 'its Org-Rule is visibility/narrow, and it changes data/members.yaml otherwise than by taking email out of its entries.')

  // A handle that was not the e-mail: no narrowing either.
  const other = begin()
  const sha2 = narrowEmail(other, `${MEMBERS}  - { id: steward-c, name: Steward C, handles: { git: someone-else@example.invalid } }\n`)
  finds(other, sha2, 'otherwise than by taking email out of its entries.')
})

test('Org-Hat carries the proposing hat too, and a role is granted only from a hat it names (Task 10 M1)', () => {
  // A member id proposes under the council hat and decides by a members list, directly: the house names the council hat.
  const MEMBERS_DECIDE = rulesWith('{ by: maintainer, method: direct }')
  const member = start(MEMBERS_DECIDE)
  apply(member, `projects: add p3${trailers('steward-a', `\nOrg-Rule: records/direct\nOrg-Hat: ${COUNCIL} @100`)}`)
  clean(member)

  // An address proposes under Ops and decides under Council: both hats are named, or the proposing role is not held.
  const OPS_PROPOSE = `governance:
  model: consensus
  membership: { tree: hats-main }
  roles:
    council: { hat: "${COUNCIL}" }
    ops: { hat: "${OPS_HAT}" }
    maintainer: { members: [steward-a] }
  rules:
    - { id: records, applies_to: [records], propose: ops, decide: { by: council, method: direct } }
    - { id: rest, applies_to: [members, governance, identity, systems, treasury, operations, publication], propose: maintainer, decide: { by: maintainer, method: direct } }
  decisions: []
`
  const both = start(OPS_PROPOSE)
  apply(both, `projects: add p3${trailers(A1, `\nOrg-Rule: records/direct\nOrg-Hat: ${COUNCIL} @100, ${OPS_HAT} @100`)}`)
  clean(both)
  const deciding = start(OPS_PROPOSE)
  const sha = apply(deciding, `projects: add p3${trailers(A1, `\nOrg-Rule: records/direct\nOrg-Hat: ${COUNCIL} @100`)}`)
  finds(deciding, sha, /records: .*ops/)
})
