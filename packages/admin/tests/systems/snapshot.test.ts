import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { snapshotSpace, spaceOf, snapshotLink, snapshotOutcome, SNAPSHOT_ACTIONS, SNAPSHOT_HUB, type SnapshotProposal } from '../../server/systems/snapshot.ts'
import { guardedPost, type DriverContext, type FetchLike, type ForeignRef } from '../../server/systems/driver.ts'
import { DRIVERS } from '../../server/systems/drivers.ts'

// Synthetic fixtures in the shape the Snapshot hub answered on 2026-10-29 (tests/systems/fixtures/snapshot/): space
// `example-dao.eth`, Ethereum mainnet, a two-week voting period, the `whitelist` strategy. Editor route `create/:key?`:
// https://github.com/snapshot-labs/sx-monorepo/blob/61e3ed2/apps/ui/src/routes/common.ts
const DIR = new URL('./fixtures/snapshot/', import.meta.url)
const load = <T>(file: string): T => JSON.parse(readFileSync(new URL(file, DIR), 'utf8')) as T
const NOW = new Date('2026-10-29T12:00:00Z')
const SYSTEM = { id: 'snap', kind: 'snapshot-space', url: 'https://snapshot.box/#/s:example-dao.eth', driver: 'snapshot-space' }
const ID = '0x' + '4'.repeat(64)
const ref = (choice: string): ForeignRef => ({ system: 'snap', id: ID, payload: { kind: 'snapshot-proposal', choice } })
const proposal = (over: Partial<SnapshotProposal> = {}): SnapshotProposal => ({ ...load<any>('proposal-passed.json').data.proposal, ...over })

type Seen = { url: string; init: { method: string }; body: any }
function world(over: { space?: unknown; proposal?: unknown } = {}) {
  const seen: Seen[] = []
  const fetch: FetchLike = async (url, init) => {
    const body = JSON.parse(init.body!)
    seen.push({ url, init, body })
    const answer = body.query.startsWith('query Q') ? over.space ?? load('space.json') : over.proposal ?? load('proposal-passed.json')
    return { ok: true, status: 200, json: async () => answer }
  }
  const ctx = (): DriverContext & { opened: string } => ({
    fetchJson: async () => { throw new Error('no GET') },
    postJson: guardedPost(snapshotSpace, fetch, new AbortController().signal),
    now: () => NOW, members: [], opened: '2026-10-01T00:00:00Z',
  })
  return { seen, ctx }
}

describe('the snapshot-space driver', () => {
  it('is declared and registered', () => {
    expect(snapshotSpace.name).toBe('snapshot-space')
    expect(snapshotSpace.hosts).toEqual(['hub.snapshot.org'])
    expect(snapshotSpace.minGapMs).toBe(1000)
    expect(DRIVERS).toContain(snapshotSpace)
    expect(SNAPSHOT_ACTIONS.map(a => [a.id, a.class])).toEqual([['draft-proposal', null]])
  })

  it('one POST, a query: the read sends one request to the hub', async () => {
    const w = world()
    const read = await snapshotSpace.read(SYSTEM, w.ctx())
    expect(w.seen).toHaveLength(1)
    expect(w.seen[0].url).toBe(SNAPSHOT_HUB)
    expect(w.seen[0].init.method).toBe('POST')
    expect(w.seen[0].body.query.startsWith('query Q')).toBe(true)
    expect(w.seen[0].body.variables).toEqual({ s: 'example-dao.eth' })
    expect(read.ok).toBe(true)
    expect(read.facts).toMatchObject({ space: 'example-dao.eth', name: 'Example DAO', chain: 'eip155:1', strategies: ['whitelist'], validation: 'basic', open: 2 })
    expect((read.facts.admins as string[])[0]).toBe('eip155:1:0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed') // EIP-55 vector: https://eips.ethereum.org/EIPS/eip-55
    expect(read.facts.voting).toEqual({ type: null, period: 1209600, delay: 0, quorum: 0, privacy: 'any' })
    expect(read.open).toEqual({ url: 'https://snapshot.box/#/s:example-dao.eth', embeddable: false })
  })

  it('facts.proposals lists active, pending and closed in that order, with their fields', async () => {
    const read = await snapshotSpace.read(SYSTEM, world().ctx())
    const data = load<any>('space.json').data
    const all = [...data.active, ...data.pending, ...data.closed]
    expect(read.facts.proposals).toEqual(all.map((p: any) => ({ id: p.id, title: p.title, state: p.state, type: p.type, start: p.start, end: p.end, created: p.created })))
    expect((read.facts.proposals as any[]).length).toBeGreaterThan(0)
  })

  it('a shielded open vote shows no scores and reads pending', async () => {
    const read = await snapshotSpace.read(SYSTEM, world().ctx())
    const open = read.sections.find(s => s.title === 'Open votes')!
    expect(open.rows).toHaveLength(2)
    expect(open.rows[0].cells[3]).toBe('shielded until it closes')
    expect(open.rows[0].cells[2]).toBe('ends in 23 h')
    expect(open.rows[0].attention).toBe('alert')
    expect(open.rows[0].href).toBe(snapshotLink('example-dao.eth', '0x' + '1'.repeat(64)))
    expect(open.rows[1].cells[3]).toBe('For 75%')
    const shielded = load<any>('proposal-shielded.json').data.proposal
    expect(snapshotOutcome(shielded, ref('For'), 'example-dao.eth', '2026-10-01T00:00:00Z')).toMatchObject({ ok: true, outcome: 'pending' })
  })

  it('shows recent results and the settings', async () => {
    const read = await snapshotSpace.read(SYSTEM, world().ctx())
    const recent = read.sections.find(s => s.title === 'Recent results')!
    expect(recent.rows[0].cells.slice(0, 3)).toEqual(['Elect the council roles', 'Steward B', '9 votes'])
    expect(recent.rows[1].cells.slice(0, 3)).toEqual(['Adopt the charter', 'For', '12 votes'])
    const settings = read.sections.find(s => s.title === 'Settings')!
    expect(settings.rows.map(r => r.cells)).toEqual([['Voting', 'any'], ['Period', '14 days'], ['Delay', '0'], ['Quorum', '0'], ['Strategies', 'whitelist'], ['Validation', 'basic'], ['Admins', '2']])
  })

  it('a closed vote whose scores are not final shows "counting", or "shielded until it closes" when shielded; never "no votes"', async () => {
    const space = load<any>('space.json')
    const [quad, charter] = space.data.closed
    const counting = { ...charter, scores: [0, 0, 0], scores_total: 0, scores_state: 'pending' }
    const shielded = { ...quad, privacy: 'shutter', scores: [0, 0, 0], scores_total: 0, scores_state: 'pending' }
    const read = await snapshotSpace.read(SYSTEM, world({ space: { data: { ...space.data, closed: [shielded, counting] } } }).ctx())
    const recent = read.sections.find(s => s.title === 'Recent results')!
    expect(recent.rows.map(r => r.cells.slice(0, 2))).toEqual([['Elect the council roles', 'shielded until it closes'], ['Adopt the charter', 'counting']])
  })

  it('a space the hub does not know is a failed read', async () => {
    await expect(snapshotSpace.read(SYSTEM, world({ space: { data: { space: null, active: [], pending: [], closed: [] } } }).ctx())).rejects.toThrow('Snapshot has no space example-dao.eth')
  })
})

describe('spaceOf', () => {
  it('reads the id from a Snapshot address', () => {
    for (const url of ['https://snapshot.box/#/s:example-dao.eth', 'https://snapshot.box/#/s:example-dao.eth/proposals', 'https://snapshot.org/#/example-dao.eth']) {
      expect(spaceOf({ url })).toBe('example-dao.eth')
    }
    expect(spaceOf({ space: 'other.eth', url: 'https://example.org' })).toBe('other.eth')
  })
  it('refuses what is not one', () => {
    for (const url of ['https://example.org', 'javascript:alert(1)']) expect(() => spaceOf({ url })).toThrow()
    expect(() => spaceOf({ space: '../x' })).toThrow()
  })
})

describe('snapshotOutcome', () => {
  const o = (p: SnapshotProposal, choice = 'For') => snapshotOutcome(p, ref(choice), 'example-dao.eth', '2026-10-01T00:00:00Z')
  it('the attached choice winning is executed; another winning is failed', () => {
    expect(o(proposal())).toMatchObject({ ok: true, outcome: 'executed' })
    expect(o(proposal(), 'Against')).toMatchObject({ ok: true, outcome: 'failed' })
  })
  it('a tie, a missed quorum and no votes are failed', () => {
    expect(o(proposal({ scores: [20, 20, 5], scores_total: 45 }))).toMatchObject({ outcome: 'failed', detail: expect.stringContaining('a tie') })
    expect(o(proposal({ quorum: 100, scores_total: 40, scores: [30, 10, 0] }))).toMatchObject({ outcome: 'failed', detail: expect.stringContaining('quorum not met') })
    expect(o(proposal({ scores: [0, 0, 0], scores_total: 0 }))).toMatchObject({ outcome: 'failed', detail: expect.stringContaining('no votes') })
  })
  it('a label the vote does not have is a mismatch', () => {
    expect(o(proposal(), 'Maybe')).toEqual({ ok: true, outcome: 'mismatch', detail: 'the vote has no choice "Maybe"' })
  })
  it('a label the vote does not have is a mismatch while the vote is still active, too', () => {
    const active = proposal({ state: 'active', scores: [3, 1, 0], scores_total: 4, scores_state: 'pending' })
    expect(o(active, 'Maybe')).toEqual({ ok: true, outcome: 'mismatch', detail: 'the vote has no choice "Maybe"' })
    expect(o(active)).toMatchObject({ ok: true, outcome: 'pending' })
  })
  it('a quadratic vote is read by score', () => {
    const q = load<any>('proposal-quadratic.json').data.proposal
    expect(o(q, 'Steward B')).toMatchObject({ outcome: 'executed' })
    expect(o(q, 'Steward A')).toMatchObject({ outcome: 'failed' })
  })
  it('a type with no single result is attention, never passed', () => {
    expect(o(proposal({ type: 'copeland' }))).toEqual({ ok: false, error: 'a copeland vote has no single result the platform reads as passed' })
  })
  it('a vote still open or not final is pending', () => {
    expect(o(proposal({ scores_state: 'pending' }))).toMatchObject({ ok: true, outcome: 'pending' })
    expect(o(proposal({ state: 'active' }))).toMatchObject({ ok: true, outcome: 'pending' })
  })
  it('another space is a mismatch', () => {
    expect(snapshotOutcome(proposal({ space: { id: 'other.eth' } }), ref('For'), 'example-dao.eth', '2026-10-01T00:00:00Z')).toMatchObject({ outcome: 'mismatch' })
  })
})

describe('the outcome read', () => {
  it('reads one proposal by id with a query', async () => {
    const w = world()
    const r = await snapshotSpace.outcome!(SYSTEM, ref('For'), w.ctx())
    expect(r).toMatchObject({ ok: true, outcome: 'executed' })
    expect(w.seen).toHaveLength(1)
    expect(w.seen[0].body.variables).toEqual({ id: ID })
    expect(w.seen[0].body.query).toContain('proposal(id: $id)')
  })
  it('a proposal the hub does not have is pending and not submitted', async () => {
    const r = await snapshotSpace.outcome!(SYSTEM, ref('For'), world({ proposal: { data: { proposal: null } } }).ctx())
    expect(r).toEqual({ ok: true, outcome: 'pending', submitted: false, detail: 'not on Snapshot yet: post the draft in Snapshot, then attach its id' })
  })
  it('a vote posted before the proposal opened is a mismatch', async () => {
    const r = await snapshotSpace.outcome!(SYSTEM, ref('For'), { ...world().ctx(), opened: '2027-01-01T00:00:00Z' })
    expect(r).toMatchObject({ ok: true, outcome: 'mismatch', detail: 'posted before the proposal opened' })
  })
  it('a vote of another space is a mismatch', async () => {
    const other = load<any>('proposal-passed.json'); other.data.proposal.space.id = 'other.eth'
    expect(await snapshotSpace.outcome!(SYSTEM, ref('For'), world({ proposal: other }).ctx())).toMatchObject({ outcome: 'mismatch' })
  })
  it('refuses a Safe ref', async () => {
    await expect(snapshotSpace.outcome!(SYSTEM, { system: 'snap', id: '0x1', payload: { to: '', value: '0', data_hash: '', operation: 0, nonce: 0 } }, world().ctx())).rejects.toThrow()
  })
})

describe('draft-proposal', () => {
  const start = Date.parse('2026-11-02T10:00:00Z') / 1000, end = Date.parse('2026-11-16T10:00:00Z') / 1000
  const base = { title: 'Fund a steward', body: 'Why.', choices: ['Steward A', 'Steward B'], start, end }
  const draft = async (params: Record<string, unknown>, space?: unknown) => {
    const w = world(space ? { space } : {})
    return { r: await snapshotSpace.prepareAction!(SYSTEM, { action: 'draft-proposal', params, via: null }, w.ctx()), w }
  }
  const refused = async (params: Record<string, unknown>, text: string, space?: unknown) => {
    const { r } = await draft(params, space)
    expect(r.ok).toBe(false)
    expect((r as { error: string }).error).toContain(text)
  }
  it('is settings and a link; one query POST and nothing else', async () => {
    const { r, w } = await draft({ ...base, discussion: 'https://forum.example.org/t/1' })
    expect(r).toEqual({ ok: true, action: 'draft-proposal', steps: [], attach: null, link: 'https://snapshot.box/#/s:example-dao.eth/create',
      draft: { space: 'example-dao.eth', type: 'single-choice', title: 'Fund a steward', body: 'Why.', choices: ['Steward A', 'Steward B'], start, end, discussion: 'https://forum.example.org/t/1' } })
    expect(w.seen).toHaveLength(1)
    expect(typeof w.seen[0].body.query).toBe('string')
    expect(w.seen[0].body.query).not.toMatch(/mutation|subscription/)
  })
  it('a basic vote defaults to For, Against, Abstain', async () => {
    const { r } = await draft({ title: 'T', body: 'B', type: 'basic', start, end })
    expect(r).toMatchObject({ ok: true, draft: { type: 'basic', choices: ['For', 'Against', 'Abstain'] } })
  })
  it('refuses, in words', async () => {
    await refused({ ...base, end: end + 3600 }, 'voting period is 14 days')
    await refused({ ...base, start: Date.parse('2026-10-29T11:00:00Z') / 1000, end: Date.parse('2026-11-12T11:00:00Z') / 1000 }, 'before')
    await refused({ ...base, end: start - 10 }, 'ends before')
    await refused({ ...base, type: 'basic' }, 'basic')
    await refused({ ...base, title: 'x'.repeat(257) }, '256')
    await refused({ title: 'T', body: 'B', start, end }, 'choices')
    const fixed = load<any>('space.json'); fixed.data.space.voting.type = 'approval'
    await refused({ ...base, type: 'quadratic' }, 'fixes the type', fixed)
  })
  it('a space the hub does not know is a thrown read', async () => {
    await expect(draft(base, { data: { space: null, active: [], pending: [], closed: [] } })).rejects.toThrow('no space')
  })
})

describe('checkRef', () => {
  const check = (raw: unknown) => snapshotSpace.checkRef!(SYSTEM, raw)
  it('accepts a 0x proposal id and an IPFS id with a label', () => {
    expect(check({ system: 'snap', id: ID.toUpperCase().replace('0X', '0x'), payload: { kind: 'snapshot-proposal', choice: 'For' } })).toMatchObject({ ok: true, ref: { id: ID } })
    expect(check({ system: 'snap', id: 'Qm' + 'a'.repeat(44), payload: { kind: 'snapshot-proposal', choice: 'Steward A' } })).toMatchObject({ ok: true })
  })
  it('refuses an empty or numeric choice, a missing payload and a path', () => {
    expect(check({ system: 'snap', id: ID, payload: { kind: 'snapshot-proposal', choice: '' } }).ok).toBe(false)
    expect(check({ system: 'snap', id: ID, payload: { kind: 'snapshot-proposal', choice: 1 } }).ok).toBe(false)
    expect(check({ system: 'snap', id: ID }).ok).toBe(false)
    expect(check({ system: 'snap', id: '../x', payload: { kind: 'snapshot-proposal', choice: 'For' } }).ok).toBe(false)
  })
})
