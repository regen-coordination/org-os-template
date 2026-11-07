import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeSyntheticRepo, git } from '../changes/fixtures.ts'
import { parseTrailers } from '../../lib/trailers.mjs'
import { revOf, CLOCK_SKEW_MS } from '../../lib/proposals.mjs'
import { Refusal } from '../../server/changes/apply.ts'
import { HttpError } from '../../server/errors.ts'
import {
  readLedger, createEntry, appendEvent, updateEntry, setState, resolveTrunk, type LedgerWho,
} from '../../server/proposals/ledger.ts'

// Every test builds a throwaway repository under the temp directory (makeSyntheticRepo); nothing here
// touches a real instance. The clock is injected.
const GOV = `schema_version: "2.0"
governance:
  model: "consensus"
  roles:
    maintainer: { members: [bruno] }
    member: { all: true }
  rules:
    - { id: records, applies_to: [records], propose: member, decide: { by: maintainer, method: approve, count: 1 } }
  decisions: []
`
const VOTE_GOV = GOV.replace('method: approve, count: 1', 'method: vote, window: P3D, quorum: 1, threshold: 0.5')
const T = (iso: string) => () => new Date(iso)
const NOW = T('2026-10-18T12:00:00Z')
const OPS = [{ op: 'update', record: 'projects:proj-001', set: { status: 'develop' }, base: 'a'.repeat(64) }]
const RULE = { id: 'records', applies_to: ['records'], propose: 'member', decide: { by: 'maintainer', method: 'approve', count: 1 } }
const VOTE_RULE = { ...RULE, decide: { by: 'maintainer', method: 'vote', window: 'P3D', quorum: 1, threshold: 0.5 } }
const entry = (over: Record<string, unknown> = {}) => ({
  id: 'p-2026-10-18-001', title: 'Move one project', author: 'ana', classes: ['records'], rules: [RULE],
  state: 'open', opened: '2026-10-18T10:00:00Z', rev: revOf(OPS), ops: OPS, events: [], closed: null, ...over,
})
const who: LedgerWho = { actor: 'ana', rule: 'records/approve', change: 'chg_1' }
const bruno: LedgerWho = { actor: 'bruno', rule: 'records/approve' }
const LEDGER_TEXT = `schema_version: "1.0"
# The ledger. Written by the proposal routes; a hand edit is caught by validate:governance.
proposals:
  # the first proposal
  - id: p-2026-10-18-001
    title: Move one project
    author: ana
    classes: [records]
    rules:
      - { id: records, applies_to: [records], propose: member, decide: { by: maintainer, method: approve, count: 1 } }
    state: open
    opened: 2026-10-18T10:00:00Z
    rev: ${revOf(OPS)}
    ops:
      - { op: update, record: "projects:proj-001", set: { status: develop }, base: ${'a'.repeat(64)} }
    events:
      - { id: e-1, at: 2026-10-18T10:30:00Z, by: bruno, kind: comment, text: first } # a trailing comment
      # a comment between events
      - { id: e-2, at: 2026-10-18T10:40:00Z, by: ana, kind: comment, text: second }
    closed: null

  # the second proposal
  - id: p-2026-10-18-002
    title: Another
    author: ana
    classes: [records]
    rules:
      - { id: records, applies_to: [records], propose: member, decide: { by: maintainer, method: approve, count: 1 } }
    state: open
    opened: 2026-10-18T10:05:00Z
    rev: ${revOf(OPS)}
    ops:
      - { op: update, record: "projects:proj-001", set: { status: develop }, base: ${'a'.repeat(64)} }
    events: []
    closed: null
`
let repo: string
const file = () => join(repo, 'data', 'proposals.yaml')
const text = () => readFileSync(file(), 'utf8')
const head = () => git(repo, 'rev-parse HEAD').trim()
const commits = () => Number(git(repo, 'rev-list --count HEAD').trim())
const trailers = () => parseTrailers(git(repo, 'log -1 --format=%B'))
const numstat = () => git(repo, 'diff HEAD~1 HEAD --numstat').trim().split('\n')
function commitLedger(body = LEDGER_TEXT) {
  writeFileSync(file(), body)
  git(repo, 'add data/proposals.yaml')
  git(repo, 'commit -qm "fixture: a ledger"')
}
const rejection = async (p: Promise<unknown>) => { try { await p } catch (e) { return e } throw new Error('expected a refusal') }
beforeEach(() => { repo = makeSyntheticRepo(GOV) })
afterEach(() => { vi.restoreAllMocks(); removeFixtureRepo(repo) })

describe('readLedger', () => {
  it('a missing file is an empty ledger', () => {
    expect(readLedger(repo)).toEqual({ entries: [], problems: [], exists: false })
  })
  it('an empty file, or one holding only comments, is an empty ledger', () => {
    writeFileSync(file(), '')
    expect(readLedger(repo)).toMatchObject({ entries: [], problems: [], exists: true })
    writeFileSync(file(), '# nothing yet\n')
    expect(readLedger(repo)).toMatchObject({ entries: [], problems: [] })
    writeFileSync(file(), 'proposals: []\n')
    expect(readLedger(repo)).toMatchObject({ entries: [], problems: [] })
  })
  it('a good file gives its entries, events and all', () => {
    commitLedger()
    const { entries, problems } = readLedger(repo)
    expect(problems).toEqual([])
    expect(entries.map(e => e.id)).toEqual(['p-2026-10-18-001', 'p-2026-10-18-002'])
    expect(entries[0]!.events.map(e => e.id)).toEqual(['e-1', 'e-2'])
    expect(entries[0]!.opened).toBe('2026-10-18T10:00:00Z')
  })
  it('a file of several YAML documents is a problem in words, not a throw', () => {
    writeFileSync(file(), 'proposals: []\n---\nproposals: []\n')
    const read = readLedger(repo)
    expect(read.entries).toEqual([])
    expect(read.problems[0]).toMatch(/holds 2 YAML documents/)
  })
  it('invalid YAML, a top level that is not a mapping, and a list that is not a list: problems', () => {
    writeFileSync(file(), 'proposals: [unclosed\n')
    expect(readLedger(repo).problems[0]).toMatch(/is not valid YAML/)
    writeFileSync(file(), '- just\n- a list\n')
    expect(readLedger(repo).problems[0]).toMatch(/not a mapping/)
    writeFileSync(file(), 'proposals: nope\n')
    expect(readLedger(repo).problems[0]).toMatch(/`proposals:` is not a list/)
  })
})

describe('createEntry', () => {
  it('makes the file with its top key, in one commit carrying the trailers of spec §3.13', async () => {
    const before = commits()
    const { commit } = await createEntry(repo, entry(), who, { now: NOW, startBranch: 'main' })
    expect(commit).toBe(head())
    expect(commits()).toBe(before + 1)
    expect(text()).toMatch(/^proposals:\n {2}- id: p-2026-10-18-001\n/)
    expect(readLedger(repo).entries).toEqual([entry()])
    expect(git(repo, 'log -1 --format=%s').trim()).toBe('proposals: open p-2026-10-18-001 — Move one project')
    expect(trailers()).toEqual({ actor: 'ana', change: 'chg_1', rule: 'records/approve', proposal: 'p-2026-10-18-001' })
    expect(git(repo, 'status --porcelain').trim()).toBe('')
  })
  it('appends to a file that is there, keeping every byte of the others and the comments', async () => {
    commitLedger()
    await createEntry(repo, entry({ id: 'p-2026-10-18-003', title: 'Third' }), who, { now: NOW, startBranch: 'main' })
    expect(text().startsWith(LEDGER_TEXT.trimEnd())).toBe(true)
    expect(readLedger(repo).entries.map(e => e.id)).toEqual(['p-2026-10-18-001', 'p-2026-10-18-002', 'p-2026-10-18-003'])
  })
  it('refuses an id that is already there, and writes nothing', async () => {
    commitLedger()
    const before = head()
    const err = await rejection(createEntry(repo, entry(), who, { now: NOW, startBranch: 'main' }))
    expect(String((err as Error).message)).toMatch(/already exists/)
    expect(head()).toBe(before)
    expect(text()).toBe(LEDGER_TEXT)
  })
  it('refuses an entry the schema refuses, as a 422 with its fields, and writes nothing', async () => {
    const err = await rejection(createEntry(repo, entry({ state: 'draft' }), who, { now: NOW, startBranch: 'main' })) as HttpError & { errors: { field: string }[] }
    expect(err.status).toBe(422)
    expect(err.errors.map(e => e.field)).toContain('state')
    expect(existsSync(file())).toBe(false)
  })
  it('refuses an entry whose events or rules are wrong (the cross-checks), naming what', async () => {
    const bad = entry({ events: [{ id: 'e-1', at: '2026-10-18T10:30:00Z', by: 'zed', kind: 'comment', text: 'hi' }] })
    const err = await rejection(createEntry(repo, bad, who, { now: NOW, startBranch: 'main' })) as HttpError & { errors: { message: string }[] }
    expect(err.status).toBe(422)
    expect(err.errors[0]!.message).toMatch(/"zed" is not a member/)
  })
})

describe('appendEvent', () => {
  it('writes one line, keeps the comments, the other events and the other entry byte for byte', async () => {
    commitLedger()
    await appendEvent(repo, 'p-2026-10-18-001', { kind: 'comment', text: 'third' }, bruno, { now: NOW, startBranch: 'main' })
    expect(numstat()).toEqual(['1\t0\tdata/proposals.yaml'])
    const added = git(repo, 'diff HEAD~1 HEAD -U0').split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'))
    expect(added).toEqual(['+      - { id: ' + readLedger(repo).entries[0]!.events[2]!.id + ', at: 2026-10-18T12:00:00Z, by: bruno, kind: comment, text: third }'])
    // the new line sits right after the last event; everything else is as it was
    const lines = LEDGER_TEXT.split('\n')
    const at = lines.findIndex(l => l.includes('id: e-2')) + 1
    expect(text().split('\n').filter((_, i) => i !== at)).toEqual(lines)
    expect(text()).toContain('# a trailing comment')
    expect(text()).toContain('# a comment between events')
  })
  it('fills in the id, the time and the writer itself: the server’s clock and the resolved actor, never the request', async () => {
    commitLedger()
    await appendEvent(repo, 'p-2026-10-18-001', { kind: 'comment', text: 'hi', by: 'ana', at: '1999-01-01T00:00:00Z', id: 'e-forged' } as never, bruno, { now: NOW, startBranch: 'main' })
    const added = readLedger(repo).entries[0]!.events.at(-1)!
    expect(added).toMatchObject({ by: 'bruno', at: '2026-10-18T12:00:00Z', kind: 'comment', text: 'hi' })
    expect(added.id).toMatch(/^e-[0-9a-z]+-[0-9a-f]{2}$/)
    expect(added.id).not.toBe('e-forged')
  })
  it('two events written at the same instant never share an id (a fixed clock in a test, a very fast machine): the second draws again', async () => {
    // The id is the time in base 36 and two hex of a random: 1 in 256 collide at one instant. The first draw of the
    // second event repeats the first event's; the writer notices and draws again.
    commitLedger()
    const draws = [0.5, 0.5, 0.25]
    vi.spyOn(Math, 'random').mockImplementation(() => draws.shift() ?? 0.75)
    await appendEvent(repo, 'p-2026-10-18-001', { kind: 'comment', text: 'one' }, bruno, { now: NOW, startBranch: 'main' })
    await appendEvent(repo, 'p-2026-10-18-001', { kind: 'comment', text: 'two' }, bruno, { now: NOW, startBranch: 'main' })
    const [a, b] = readLedger(repo).entries[0]!.events.slice(-2).map(e => e.id)
    expect(a).toMatch(/-80$/)
    expect(b).toMatch(/-40$/)
  })
  it('an empty `events: []` becomes a block list of one line, and the rest of the file is untouched', async () => {
    commitLedger()
    await appendEvent(repo, 'p-2026-10-18-002', { kind: 'comment', text: 'hello' }, bruno, { now: NOW, startBranch: 'main' })
    const lines = text().split('\n')
    const at = lines.lastIndexOf('    events:') // the second proposal's, which was `events: []`
    expect(lines[at + 1]).toMatch(/^ {6}- \{ id: e-[0-9a-z]+-[0-9a-f]{2}, at: 2026-10-18T12:00:00Z, by: bruno, kind: comment, text: hello \}$/)
    expect(lines.filter((_, i) => i !== at && i !== at + 1)).toEqual(LEDGER_TEXT.split('\n').filter(l => l !== '    events: []'))
    expect(readLedger(repo).entries[1]!.events).toHaveLength(1)
  })
  it('quotes what must be quoted and keeps a long text on its one line', async () => {
    commitLedger()
    const long = 'This moves the stage before the budget is agreed: that harms the aim. '.repeat(6).trim()
    await appendEvent(repo, 'p-2026-10-18-001', { kind: 'object', rev: revOf(OPS), text: long }, bruno, { now: NOW, startBranch: 'main' })
    expect(numstat()).toEqual(['1\t0\tdata/proposals.yaml'])
    expect(readLedger(repo).entries[0]!.events.at(-1)!.text).toBe(long)
  })
  it('commits with the actor, the rule and the proposal as trailers', async () => {
    commitLedger()
    await appendEvent(repo, 'p-2026-10-18-001', { kind: 'approve', rev: revOf(OPS) }, bruno, { now: NOW, startBranch: 'main' })
    expect(git(repo, 'log -1 --format=%s').trim()).toBe('proposals: approve p-2026-10-18-001')
    expect(trailers()).toEqual({ actor: 'bruno', rule: 'records/approve', proposal: 'p-2026-10-18-001' })
  })
  it('refuses a proposal that is not there', async () => {
    commitLedger()
    const err = await rejection(appendEvent(repo, 'p-2026-10-18-009', { kind: 'comment', text: 'x' }, bruno, { now: NOW, startBranch: 'main' }))
    expect(String((err as Error).message)).toMatch(/no proposal p-2026-10-18-009/)
  })
  it('refuses an event that is malformed (an objection with no text), and writes nothing', async () => {
    commitLedger()
    const before = head()
    const err = await rejection(appendEvent(repo, 'p-2026-10-18-001', { kind: 'object', rev: revOf(OPS) }, bruno, { now: NOW, startBranch: 'main' })) as HttpError & { errors: { message: string }[] }
    expect(err.status).toBe(422)
    expect(err.errors[0]!.message).toMatch(/an objection needs its text/)
    expect(head()).toBe(before)
    expect(text()).toBe(LEDGER_TEXT)
  })
  it('refuses to write into a ledger it cannot read (several documents), saying so', async () => {
    commitLedger('proposals: []\n---\nproposals: []\n')
    const err = await rejection(appendEvent(repo, 'p-2026-10-18-001', { kind: 'comment', text: 'x' }, bruno, { now: NOW, startBranch: 'main' }))
    expect(String((err as Error).message)).toMatch(/holds 2 YAML documents/)
  })
})

describe('the file guards (the same 409 as Apply)', () => {
  it('refuses a proposals.yaml with changes that are not committed, naming what to do', async () => {
    commitLedger()
    writeFileSync(file(), `${LEDGER_TEXT}# edited by hand\n`)
    const err = await rejection(appendEvent(repo, 'p-2026-10-18-001', { kind: 'comment', text: 'x' }, bruno, { now: NOW, startBranch: 'main' })) as Refusal
    expect(err).toBeInstanceOf(Refusal)
    expect(err.status).toBe(409)
    expect(err.body).toMatchObject({ code: 'DIRTY' })
    expect(String(err.body.error)).toMatch(/data\/proposals\.yaml has changes that are not committed yet/)
    expect(text()).toBe(`${LEDGER_TEXT}# edited by hand\n`)
  })
  it('refuses a proposals.yaml git has been told not to look at (assume-unchanged)', async () => {
    commitLedger()
    git(repo, 'update-index --assume-unchanged data/proposals.yaml')
    const err = await rejection(appendEvent(repo, 'p-2026-10-18-001', { kind: 'comment', text: 'x' }, bruno, { now: NOW, startBranch: 'main' })) as Refusal
    expect(err.status).toBe(409)
    expect(String(err.body.error)).toMatch(/is marked assume-unchanged in git/)
  })
  it('refuses a ledger that is not tracked yet when an event is written to it', async () => {
    writeFileSync(file(), LEDGER_TEXT) // there, but never committed
    const err = await rejection(appendEvent(repo, 'p-2026-10-18-001', { kind: 'comment', text: 'x' }, bruno, { now: NOW, startBranch: 'main' })) as Refusal
    expect(err.status).toBe(409)
    expect(err.body).toMatchObject({ code: 'DIRTY' })
  })
})

describe('the trunk (P2-R17)', () => {
  it('refuses off the trunk, naming the branch it is on and the trunk', async () => {
    commitLedger()
    git(repo, 'checkout -q -b feature/x')
    const err = await rejection(appendEvent(repo, 'p-2026-10-18-001', { kind: 'comment', text: 'x' }, bruno, { now: NOW, startBranch: 'main' })) as Refusal
    expect(err.status).toBe(409)
    expect(err.body).toMatchObject({ code: 'OFF_TRUNK' })
    expect(String(err.body.error)).toMatch(/on the branch "feature\/x".*the trunk, "main"/)
  })
  it('governance.trunk names the trunk when it is written, whatever branch the server started on', async () => {
    writeFileSync(join(repo, 'data', 'governance.yaml'), GOV.replace('  decisions: []', '  trunk: release/1.0\n  decisions: []'))
    git(repo, 'add -A'); git(repo, 'commit -qm "fixture: a trunk"')
    commitLedger()
    expect(await resolveTrunk(repo, 'main')).toBe('release/1.0')
    const err = await rejection(appendEvent(repo, 'p-2026-10-18-001', { kind: 'comment', text: 'x' }, bruno, { now: NOW, startBranch: 'main' })) as Refusal
    expect(String(err.body.error)).toMatch(/on the branch "main".*the trunk, "release\/1\.0"/)
    git(repo, 'checkout -q -b release/1.0')
    await appendEvent(repo, 'p-2026-10-18-001', { kind: 'comment', text: 'x' }, bruno, { now: NOW, startBranch: 'main' })
    expect(readLedger(repo).entries[0]!.events).toHaveLength(3)
  })
  it('without a startBranch and without governance.trunk, the trunk is the branch the repository is on', async () => {
    commitLedger()
    expect(await resolveTrunk(repo)).toBe('main')
    await appendEvent(repo, 'p-2026-10-18-001', { kind: 'comment', text: 'x' }, bruno, { now: NOW })
  })
  it.each([
    ['+main', /"\+main" cannot be the trunk: a branch name cannot begin with \+ \(git reads it as a forcing refspec\)/],
    ['MERGE_HEAD', /"MERGE_HEAD" cannot be the trunk: MERGE_HEAD is reserved: git keeps its own state under that name/],
  ])('refuses a trunk named %s, with its sentence, and writes nothing', async (name, sentence) => {
    commitLedger()
    git(repo, `checkout -q -b ${name}`)
    const before = head()
    const err = await rejection(appendEvent(repo, 'p-2026-10-18-001', { kind: 'comment', text: 'x' }, bruno, { now: NOW })) as Refusal
    expect(err.status).toBe(409)
    expect(err.body).toMatchObject({ code: 'TRUNK' })
    expect(String(err.body.error)).toMatch(sentence)
    expect(head()).toBe(before)
  })
  it('refuses a governance.trunk that fails validTrunkName even when the repository is on it', async () => {
    writeFileSync(join(repo, 'data', 'governance.yaml'), GOV.replace('  decisions: []', '  trunk: "+main"\n  decisions: []'))
    git(repo, 'add -A'); git(repo, 'commit -qm "fixture: a bad trunk"')
    commitLedger()
    const err = await rejection(appendEvent(repo, 'p-2026-10-18-001', { kind: 'comment', text: 'x' }, bruno, { now: NOW, startBranch: 'main' })) as Refusal
    expect(String(err.body.error)).toMatch(/"\+main" cannot be the trunk/)
  })
})

describe('time (P2-R30): an event the evaluator would ignore is not written', () => {
  const at = (iso: string) => ({ now: T(iso), startBranch: 'main' })
  it('refuses a write when the server’s clock is more than CLOCK_SKEW behind the newest event in the ledger', async () => {
    commitLedger()
    const err = await rejection(appendEvent(repo, 'p-2026-10-18-001', { kind: 'comment', text: 'x' }, bruno, at('2026-10-18T07:40:00Z'))) as Refusal
    expect(err.status).toBe(409)
    expect(err.body).toMatchObject({ code: 'CLOCK' })
    expect(String(err.body.error)).toMatch(/clock is 3 hours 0 minutes behind this ledger’s newest event|clock is 3 hours behind/)
    expect(String(err.body.error)).toMatch(/Fix the clock and try again/)
  })
  it('allows a clock slightly behind (within CLOCK_SKEW), and refuses just past it', async () => {
    commitLedger()
    const newest = Date.parse('2026-10-18T10:40:00Z')
    await appendEvent(repo, 'p-2026-10-18-001', { kind: 'comment', text: 'ok' }, bruno, at(new Date(newest - CLOCK_SKEW_MS + 1000).toISOString()))
    const err = await rejection(appendEvent(repo, 'p-2026-10-18-001', { kind: 'comment', text: 'late' }, bruno, at(new Date(newest - CLOCK_SKEW_MS - 60e3).toISOString())))
    expect((err as Refusal).body).toMatchObject({ code: 'CLOCK' })
  })
  it('refuses a vote at or after the vote closed (closedAt), not before', async () => {
    writeFileSync(join(repo, 'data', 'governance.yaml'), VOTE_GOV); git(repo, 'add -A'); git(repo, 'commit -qm "fixture: vote rule"')
    const voteLedger = LEDGER_TEXT.replaceAll('method: approve, count: 1', 'method: vote, window: P3D, quorum: 1, threshold: 0.5')
    commitLedger(voteLedger)
    const vote = { kind: 'vote' as const, vote: 'yes', rev: revOf(OPS) }
    // the window is opened + 3 days = 2026-10-21T10:00:00Z
    await appendEvent(repo, 'p-2026-10-18-001', vote, bruno, at('2026-10-21T09:59:59Z'))
    const err = await rejection(appendEvent(repo, 'p-2026-10-18-002', vote, bruno, at('2026-10-21T10:05:00Z'))) as Refusal
    expect(err.status).toBe(409)
    expect(err.body).toMatchObject({ code: 'IGNORED' })
    expect(String(err.body.error)).toMatch(/Voting on this proposal has closed/)
  })
  it('refuses an approval after the expiry (P30D), and says how to start the clock again', async () => {
    commitLedger()
    // p-001 was opened at 10:00, p-002 at 10:05: their thirty days end at those times on 2026-11-17
    const ok = await appendEvent(repo, 'p-2026-10-18-002', { kind: 'approve', rev: revOf(OPS) }, bruno, at('2026-11-17T09:59:00Z')).then(() => true, () => false)
    expect(ok).toBe(true)
    const err = await rejection(appendEvent(repo, 'p-2026-10-18-001', { kind: 'approve', rev: revOf(OPS) }, bruno, at('2026-11-17T10:00:00Z'))) as Refusal
    expect(err.body).toMatchObject({ code: 'IGNORED' })
    expect(String(err.body.error)).toMatch(/ran out on 2026-11-17T10:00:00Z.*revise/)
  })
  it('a comment is still written after the expiry: the evaluator ignores it, but it is how a person is heard', async () => {
    commitLedger()
    await appendEvent(repo, 'p-2026-10-18-002', { kind: 'comment', text: 'late thought' }, bruno, at('2027-01-01T00:00:00Z'))
    expect(readLedger(repo).entries[1]!.events).toHaveLength(1)
  })
})

describe('setState and updateEntry', () => {
  it('setState writes the closing fields and the closing event in one commit, touching nothing else', async () => {
    commitLedger()
    const closed = { at: '2026-10-18T12:00:00Z', by: 'bruno', decision: 'gov-20261018-001' }
    await setState(repo, 'p-2026-10-18-001', { state: 'ratified', closed, event: { kind: 'ratify' } }, { ...bruno, decision: 'gov-20261018-001' }, { now: NOW, startBranch: 'main' })
    const [first, second] = readLedger(repo).entries
    expect(first).toMatchObject({ state: 'ratified', closed })
    expect(first!.events.at(-1)).toMatchObject({ kind: 'ratify', by: 'bruno', at: '2026-10-18T12:00:00Z' })
    expect(second).toEqual(parse(LEDGER_TEXT).proposals[1])
    expect(git(repo, 'log -1 --format=%s').trim()).toBe('proposals: ratify p-2026-10-18-001')
    expect(trailers()).toEqual({ actor: 'bruno', rule: 'records/approve', proposal: 'p-2026-10-18-001', decision: 'gov-20261018-001' })
    expect(commits()).toBe(5) // the fixture's three (the synthetic members the third), the ledger, the closing
    // only the lines of `state`, `closed` and the new event differ
    const removed = git(repo, 'diff HEAD~1 HEAD -U0').split('\n').filter(l => l.startsWith('-') && !l.startsWith('---'))
    expect(removed).toEqual(['-    state: open', '-    closed: null'])
  })
  it('a closing needs a final state and a `closed`', async () => {
    commitLedger()
    const err = await rejection(setState(repo, 'p-2026-10-18-001', { state: 'open' as never, closed: null as never, event: { kind: 'ratify' } }, bruno, { now: NOW, startBranch: 'main' }))
    expect(String((err as Error).message)).toMatch(/closed|state/i)
  })
  it('updateEntry changes the named fields and appends the event (a replay records the new base)', async () => {
    commitLedger()
    await updateEntry(repo, 'p-2026-10-18-001', { fields: { base: 'c0ffee1' }, event: { kind: 'replay', base: 'c0ffee1' } }, bruno, { now: NOW, startBranch: 'main' })
    expect(readLedger(repo).entries[0]).toMatchObject({ base: 'c0ffee1' })
    expect(readLedger(repo).entries[0]!.events.at(-1)).toMatchObject({ kind: 'replay', base: 'c0ffee1' })
  })
  it('refuses to change a field that is not the entry’s to change (id, author, opened, events)', async () => {
    commitLedger()
    for (const field of ['id', 'author', 'opened', 'events']) {
      const err = await rejection(updateEntry(repo, 'p-2026-10-18-001', { fields: { [field]: 'x' }, event: { kind: 'replay' } }, bruno, { now: NOW, startBranch: 'main' }))
      expect(String((err as Error).message), field).toMatch(/is not a field a write may change/)
    }
  })
})

describe('a write that fails leaves the file as it was', () => {
  it('a failing write puts the bytes back and commits nothing', async () => {
    commitLedger()
    const before = head()
    const err = await rejection(appendEvent(repo, 'p-2026-10-18-001', { kind: 'comment', text: 'x' }, bruno, {
      now: NOW, startBranch: 'main', write: (path, body) => { writeFileSync(path, `${body.slice(0, 40)}`); throw new Error('disk full') },
    })) as HttpError
    expect(err.status).toBe(503)
    expect(err.message).toMatch(/could not be written \(disk full\)/)
    expect(text()).toBe(LEDGER_TEXT)
    expect(head()).toBe(before)
    expect(git(repo, 'status --porcelain').trim()).toBe('')
  })
  it('a hook that refuses the commit puts the bytes back and leaves the index as it was', async () => {
    commitLedger()
    const before = head()
    writeFileSync(join(repo, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho "no commits today" >&2\nexit 1\n', { mode: 0o755 })
    const err = await rejection(appendEvent(repo, 'p-2026-10-18-001', { kind: 'comment', text: 'x' }, bruno, { now: NOW, startBranch: 'main' })) as HttpError
    expect(err.status).toBe(503)
    expect(err.message).toMatch(/git refused the commit to data\/proposals\.yaml/)
    expect(text()).toBe(LEDGER_TEXT)
    expect(head()).toBe(before)
    expect(git(repo, 'status --porcelain').trim()).toBe('')
  })
})
