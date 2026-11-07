import { describe, it, expect } from 'vitest'
import { projectPublic } from '../../lib/standards/project.mjs'
import { proposalsDoc, activitiesDoc, snapshotEntries, ACTIVITY_KINDS } from '../../lib/standards/proposals.mjs'
import { validateStandards } from '../../lib/standards/validate.mjs'
import { fixtureInput, fixtureReads, DAO_URI, P, SNAPSHOT_VOTE, SNAPSHOT_CLOSED } from './fixtures.ts'

const pubOf = (edit?: (i: ReturnType<typeof fixtureInput>) => void) => {
  const input = fixtureInput()
  edit?.(input)
  return projectPublic(input).pub
}
const idOf = (p: string) => `${DAO_URI}?proposalId=${p}`
const entries = (pub = pubOf(), urls?: any, snap?: any) => (proposalsDoc(pub, urls, snap) as any).proposals as any[]
const byId = (list: any[], id: string) => list.find(e => e.id === id)
const acts = (pub = pubOf()) => (activitiesDoc(pub) as any).activities as any[]

describe('proposalsDoc', () => {
  it('a public ledger proposal carries its ledger facts', () => {
    const e = byId(entries(), idOf(P.public))
    expect(e.type).toBe('proposal')
    expect(e.name).toBe('SHOWN-40 Fund the treasury rotation')
    expect(e.status).toBe('ratified')
    expect(e.extensions['org-os.opened']).toBe('2026-10-01T10:00:00Z')
    expect(e.extensions['org-os.closed']).toBe('2026-10-03T10:00:00Z')
    expect(e.extensions['org-os.rules']).toEqual(['records', 'treasury'])
    expect(e.extensions['org-os.decision']).toBe('gov-2026-010')
  })
  it('its decision row folds in: no second entry', () => {
    const list = entries()
    expect(byId(list, `${DAO_URI}?proposalId=gov-2026-010`)).toBeUndefined()
    expect(byId(list, `${DAO_URI}?proposalId=gov-2026-011`)).toBeUndefined()
  })
  it('a pre-P2 decision row is its own entry with org-os.date', () => {
    const e = byId(entries(), `${DAO_URI}?proposalId=gov-2026-001`)
    expect(e.name).toBe('SHOWN-21 Adopt the charter')
    expect(e.status).toBe('approved')
    expect(e.extensions['org-os.date']).toBe('2026-01-10')
  })
  it('a restricted decision row with no published proposal is a masked entry', () => {
    const e = byId(entries(), `${DAO_URI}?proposalId=gov-2026-013`)
    expect(e.name).toBe('A change to a restricted collection')
    expect(e.status).toBe('expired')
  })
  it('a restricted proposal keeps id and status, a masked name, and no executes', () => {
    for (const id of [P.member, P.deleted, P.privateOp]) {
      const e = byId(entries(), idOf(id))
      expect(e.name).toBe('A change to a restricted collection')
      expect(e.status).toBeTruthy()
      expect(e.extensions?.['org-os.executes']).toBeUndefined()
    }
    expect(byId(entries(), idOf(P.deleted)).extensions['org-os.decision']).toBe('gov-2026-011')
  })
  it('attached refs of public Systems appear as org-os.executes, deduped and sorted', () => {
    const e = byId(entries(), idOf(P.public))
    const ex: string[] = e.extensions['org-os.executes']
    expect(ex).toHaveLength(2)
    expect(ex.some(r => /^eip155:42220:0x[0-9a-fA-F]{36}5aFE\?safeTxHash=0xa{64}$/.test(r))).toBe(true)
    expect([...ex].sort()).toEqual(ex)
    const dup = pubOf(); dup.proposals[0].attached.push(dup.proposals[0].attached[0])
    expect(byId(entries(dup), idOf(P.public)).extensions['org-os.executes']).toHaveLength(2)
  })
  it('contentURI only when urls.proposal is given', () => {
    expect(byId(entries(), idOf(P.public)).contentURI).toBeUndefined()
    const e = byId(entries(pubOf(), { proposal: (id: string) => `https://dao.example.org/p/${id}` }), idOf(P.public))
    expect(e.contentURI).toBe(`https://dao.example.org/p/${P.public}`)
  })
  it('omits opened when withheld, and never emits null or empty strings', () => {
    const pub = pubOf(); pub.proposals[0].opened = ''
    expect(byId(entries(pub), idOf(P.public)).extensions['org-os.opened']).toBeUndefined()
    const s = JSON.stringify(proposalsDoc(pub))
    expect(s).not.toContain('null')
    expect(s).not.toContain('""')
  })
  it('no calls, summary or by key anywhere', () => {
    const s = JSON.stringify(proposalsDoc(pubOf()))
    for (const k of ['"calls"', '"summary"', '"by"']) expect(s).not.toContain(k)
  })
  it('sorted by id; snapshot entries are merged', () => {
    const snap = { entries: [{ type: 'proposal', id: 'https://snapshot.box/#/s:x/proposal/1', name: 'S', status: 'closed' }] }
    const list = entries(pubOf(), undefined, snap)
    expect(byId(list, snap.entries[0].id)).toBeTruthy()
    const ids = list.map(e => e.id)
    expect([...ids].sort()).toEqual(ids)
  })
  it('passes validateStandards', () => {
    expect(validateStandards({ 'proposals.json': proposalsDoc(pubOf()) })).toEqual([])
  })
})

describe('proposalsDoc: a decision row with no status (I1, R30)', () => {
  it('is published as draft, never ""', () => {
    const list = entries(pubOf(i => {
      i.records.governance = { decisions: [{ id: 'gov-001', title: 'Adopt the charter', date: '2025-01-01' }] }
    }))
    const e = byId(list, idOf('gov-001'))
    expect(e.status).toBe('draft')
    expect(JSON.stringify(list)).not.toContain('"status":""')
  })
  it('the builder itself never writes "" for a status it is handed empty', () => {
    const pub = pubOf()
    pub.decisions.push({ id: 'gov-x', proposal: null, title: 't', status: '', date: '2025-01-01', rule: null, method: null, restricted: false })
    expect(byId(entries(pub), idOf('gov-x')).status).toBe('draft')
  })
})

describe('activitiesDoc', () => {
  it('an opened activity per proposal, with the author as member', () => {
    const a = byId(acts(), `${idOf(P.public)}#opened`)
    expect(a.type).toBe('activity')
    expect(a.proposal).toEqual({ type: 'proposal', id: idOf(P.public) })
    expect(a.extensions['org-os.event']).toBe('opened')
    expect(a.extensions['org-os.at']).toBe('2026-10-01T10:00:00Z')
    expect(a.member.id).toMatch(/^eip155:42220:0x0000000d0001/)
  })
  it('one activity per published-kind event; none for comment or replay', () => {
    const list = acts().filter(a => a.proposal.id === idOf(P.public))
    const ids = list.map(a => a.id)
    expect(ids).toContain(`${idOf(P.public)}#e-a1-01`)
    expect(ids).not.toContain(`${idOf(P.public)}#e-a1-02`) // comment
    expect(list).toHaveLength(8) // opened + 7 non-comment events
    for (const a of list) expect(ACTIVITY_KINDS).toContain(a.extensions['org-os.event'])
    expect(ACTIVITY_KINDS).not.toContain('comment')
    expect(ACTIVITY_KINDS).not.toContain('replay')
  })
  it('replay events produce none', () => {
    const pub = pubOf(); pub.proposals[0].events.push({ id: 'e-r', kind: 'replay', at: '2026-10-04T00:00:00Z', actor: null })
    expect(byId(acts(pub), `${idOf(P.public)}#e-r`)).toBeUndefined()
  })
  it('a vote activity carries no direction', () => {
    const a = byId(acts(), `${idOf(P.public)}#e-a1-03`)
    expect(a.extensions['org-os.event']).toBe('vote')
    expect(JSON.stringify(a)).not.toMatch(/for|against|abstain|direction/)
  })
  it('member is the actor when set, else absent', () => {
    expect(byId(acts(), `${idOf(P.public)}#e-a1-03`).member).toEqual({ id: 'https://dao.example.org/members/contributor-c' })
    expect(byId(acts(), `${idOf(P.public)}#e-a1-04`).member).toBeUndefined()
  })
  it('sorted by id, no null or empty strings, passes validateStandards', () => {
    const list = acts()
    const ids = list.map(a => a.id)
    expect([...ids].sort()).toEqual(ids)
    const doc = activitiesDoc(pubOf())
    const s = JSON.stringify(doc)
    expect(s).not.toContain('null')
    expect(s).not.toContain('""')
    expect(validateStandards({ 'activities.json': doc })).toEqual([])
  })
})

describe('snapshotEntries', () => {
  const live = (edit?: (i: ReturnType<typeof fixtureInput>) => void, reads: any = fixtureReads()) => {
    const input = fixtureInput({ reads })
    edit?.(input)
    return projectPublic(input).pub
  }
  const link = (id: string) => `https://snapshot.box/#/s:test-dao.eth/proposal/${id}`
  it('each proposal of a public space read is an entry, with its state and link', () => {
    const r = snapshotEntries(live())!
    expect(r.entries).toHaveLength(2)
    const e: any = r.entries.find((x: any) => x.id === link(SNAPSHOT_VOTE))
    expect(e).toEqual({ type: 'proposal', id: link(SNAPSHOT_VOTE), name: 'SHOWN-54 Ask the token holders', status: 'active', contentURI: link(SNAPSHOT_VOTE) })
    expect((r.entries as any[]).find(x => x.id === link(SNAPSHOT_CLOSED)).status).toBe('closed')
  })
  it('no read: null, and the git copy is unchanged', () => {
    const pub = pubOf()
    expect(snapshotEntries(pub)).toBeNull()
    expect(entries(pub, undefined, snapshotEntries(pub))).toEqual(entries(pub))
  })
  it('a failed read contributes nothing', () => {
    const reads = fixtureReads(); (reads.votes as any).ok = false
    expect(snapshotEntries(live(undefined, reads))).toBeNull()
  })
  it('a members-level space contributes nothing', () => {
    const pub = live(i => { (i.records.systems as any[]).find(s => s.id === 'votes').visibility = 'members' })
    expect(snapshotEntries(pub)).toBeNull()
  })
  it('a proposal without title or state is skipped; duplicates collapse', () => {
    const reads = fixtureReads()
    const props = (reads.votes as any).facts.proposals
    props.push({ ...props[0] }, { id: '0xabc', title: '', state: 'closed' }, { id: '0xdef', title: 'T', state: '' })
    const r = snapshotEntries(live(undefined, reads))!
    expect(r.entries).toHaveLength(2)
  })
  it('merged into proposalsDoc, sorted by id', () => {
    const pub = live()
    const list = entries(pub, undefined, snapshotEntries(pub))
    expect(byId(list, link(SNAPSHOT_VOTE))).toBeTruthy()
    const ids = list.map(e => e.id)
    expect([...ids].sort()).toEqual(ids)
  })
  it('a ledger proposal that attached a public space vote lists it in org-os.executes', () => {
    const e = byId(entries(), idOf(P.snapshot))
    expect(e.extensions['org-os.executes']).toEqual([link(SNAPSHOT_VOTE)])
  })
})
