import { describe, it, expect } from 'vitest'
import { projectPublic, checkNoLeak, readable, RESTRICTED_TITLE } from '../../lib/standards/project.mjs'
import {
  fixtureInput, fixtureReads, P, A, CELO, ETHEREUM, ORIGIN, OPS_SAFE, SAFE, POOL, TX_CELO, TX_ETH, TX_OPS, SNAPSHOT_VOTE,
  HAT_STEWARD, HAT_CONTRIBUTOR, HAT_OTHER_TREE, AS_ACCOUNT, addr, withheldPoolInput,
} from './fixtures.ts'

const withReads = () => projectPublic(fixtureInput({ reads: fixtureReads() }))
const text = (v: unknown) => JSON.stringify(v)
/** Every spelling of a placeholder address: lower case and EIP-55 (the hex digits, without 0x). */
const hexOf = (address: string) => address.slice(2).toLowerCase()
const proposal = (pub: ReturnType<typeof projectPublic>['pub'], id: string) => {
  const found = pub.proposals.find(p => p.id === id)
  if (!found) throw new Error(`no proposal ${id} in pub`)
  return found
}

describe('projectPublic: nothing stricter than public passes', () => {
  it('members-level records, fields and reads are absent from pub', () => {
    for (const r of [projectPublic(fixtureInput()), withReads()]) {
      const s = text(r.pub)
      expect(s).not.toContain('WITHHELD-')
      expect(s).not.toContain('steward-b')
      expect(s.toLowerCase()).not.toContain(hexOf(OPS_SAFE))
    }
  })

  it('every SHOWN- marker of the input survives (so the test above cannot pass vacuously)', () => {
    const input = fixtureInput({ reads: fixtureReads() })
    const markers = new Set(text(input).match(/SHOWN-\d+/g))
    expect(markers.size).toBeGreaterThanOrEqual(30)
    const s = text(projectPublic(input).pub)
    for (const m of markers) expect(s, m).toMatch(new RegExp(`${m}\\b`))
  })

  it('carries no raw op, rationale, statement, event text, vote direction, decision by or summary', () => {
    const { pub } = withReads()
    for (const p of pub.proposals) {
      expect(Object.keys(p).sort()).toEqual(['attached', 'author', 'closed', 'events', 'id', 'opened', 'restricted', 'rules', 'state', 'title'])
      for (const e of p.events) expect(Object.keys(e).sort()).toEqual(['actor', 'at', 'id', 'kind'])
    }
    for (const d of pub.decisions) {
      expect(Object.keys(d).sort()).toEqual(['date', 'id', 'method', 'proposal', 'restricted', 'rule', 'status', 'title'])
    }
  })

  it("an event's as.account and as.wearers appear nowhere in pub", () => {
    const s = text(withReads().pub).toLowerCase()
    expect(s).not.toContain(hexOf(A.a7))
    expect(s).not.toContain(hexOf(A.a8))
    expect(s).not.toContain(AS_ACCOUNT.toLowerCase())
  })

  it('reads of a members-level System are dropped; public Systems keep theirs', () => {
    const { pub } = withReads()
    expect(Object.keys(pub.reads).sort()).toEqual(['grants', 'roles', 'treasury', 'votes'])
    expect(pub.systems.map(s => s.id)).toEqual(['treasury', 'roles', 'votes', 'grants', 'forum'])
    expect(pub.systems.find(s => s.id === 'forum')).not.toHaveProperty('notes')
  })

  it("a public read keeps its facts, never its sections (a driver names members there)", () => {
    const { pub } = withReads()
    expect(pub.reads.treasury!.facts).toEqual(fixtureReads().treasury!.facts)
    for (const r of Object.values(pub.reads)) expect(r.sections).toEqual([])
  })

  it('the git copy has no reads', () => {
    expect(projectPublic(fixtureInput()).pub.reads).toEqual({})
  })

  it('members: public records only, each with its published id; email and handles never', () => {
    const { pub } = withReads()
    expect(pub.members.map(m => m.id)).toEqual([`${ORIGIN}/members/steward-a`, `${ORIGIN}/members/contributor-c`])
    const a = pub.members[0]!.record
    expect(a).toMatchObject({ id: 'steward-a', name: 'SHOWN-3 Steward A', kind: 'person' })
    expect(a).not.toHaveProperty('email')
    expect(a).not.toHaveProperty('handles')
    expect(a).not.toHaveProperty('role')
  })
})

describe('projectPublic: proposals and rule 8', () => {
  it('a public proposal touching only public records is published whole', () => {
    const p = proposal(withReads().pub, P.public)
    expect(p).toMatchObject({
      title: 'SHOWN-40 Fund the treasury rotation', state: 'ratified', opened: '2026-10-01T10:00:00Z', closed: '2026-10-03T10:00:00Z',
      rules: ['records', 'treasury'], restricted: false,
    })
  })

  it('a proposal touching members:steward-b is restricted with a null title and nothing attached', () => {
    const p = proposal(withReads().pub, P.member)
    expect(p.restricted).toBe(true)
    expect(p.title).toBeNull()
    expect(p.attached).toEqual([])
    expect(p.state).toBe('open')
  })

  it('a proposal touching a deleted record is restricted', () => {
    const p = proposal(withReads().pub, P.deleted)
    expect(p.restricted).toBe(true)
    expect(p.title).toBeNull()
  })

  it('a proposal holding a private placeholder op is restricted', () => {
    const p = proposal(withReads().pub, P.privateOp)
    expect(p.restricted).toBe(true)
    expect(p.title).toBeNull()
  })

  it('a members-level proposal is not published', () => {
    expect(withReads().pub.proposals.map(p => p.id)).not.toContain(P.hidden)
  })

  it('an op on a public document is not restricting; on a non-public document or an unknown registry it is', () => {
    expect(proposal(withReads().pub, P.gardens).restricted).toBe(false)   // `governance`, public
    const input = fixtureInput()
    const ledger = input.records.proposals as Record<string, any>[]
    ledger.find(p => p.id === P.gardens)!.ops = [{ op: 'update', record: 'finances', set: { summary: 'x' } }]
    ledger.find(p => p.id === P.snapshot)!.ops = [{ op: 'update', record: 'nowhere:thing', set: {} }]
    const { pub } = projectPublic(input)
    expect(proposal(pub, P.gardens).restricted).toBe(true)
    expect(proposal(pub, P.snapshot).restricted).toBe(true)
  })

  it('an update that sets a field which is not public is restricted, though its record is public', () => {
    const input = fixtureInput()
    const p1 = (input.records.proposals as Record<string, any>[]).find(p => p.id === P.public)!
    p1.ops = [{ op: 'update', record: 'members:steward-a', set: { email: 'WITHHELD-90-xxxxxx@example.org' } }]
    expect(proposal(projectPublic(input).pub, P.public).restricted).toBe(true)
  })

  it('a malformed proposal never throws: it is restricted or dropped, and a problem says so', () => {
    const input = fixtureInput()
    const ledger = input.records.proposals as unknown[]
    ledger.push('not a proposal')
    ledger.push({ id: 'p-2026-10-29-008-2a2b', title: 'WITHHELD-91-xxxxxx', state: 'open', opened: '2026-10-12T10:00:00Z', rules: [], ops: [{ op: 'update', record: 42 }], events: 'nope' })
    ledger.push({ id: 'p-2026-10-29-009-3a3b', title: 'WITHHELD-92-xxxxxx', state: 'open', opened: '2026-10-12T10:00:00Z', rules: [], ops: 'nope', events: [] })
    const r = projectPublic(input)
    expect(text(r.pub)).not.toContain('WITHHELD-')
    expect(proposal(r.pub, 'p-2026-10-29-008-2a2b')).toMatchObject({ restricted: true, title: null, events: [] })
    expect(proposal(r.pub, 'p-2026-10-29-009-3a3b')).toMatchObject({ restricted: true, title: null })
    expect(r.problems.filter(p => p.file === 'data/proposals.yaml').length).toBeGreaterThanOrEqual(3)
  })

  it('attached refs of public Systems in their published form; never a members-level System or a wearer', () => {
    const { pub } = withReads()
    expect(proposal(pub, P.public).attached).toEqual([
      `${CELO}:0x0000000000000000000000000000000000005aFE?safeTxHash=${TX_CELO}`,
      `${ETHEREUM}:0x0000000000000000000000000000000000005aFE?safeTxHash=${TX_ETH}`,
    ])
    expect(proposal(pub, P.snapshot).attached).toEqual([`https://snapshot.box/#/s:test-dao.eth/proposal/${SNAPSHOT_VOTE}`])
    expect(proposal(pub, P.gardens).attached).toEqual([`${CELO}:0x000000000000000000000000000000000000B001?proposalId=1`, HAT_CONTRIBUTOR])
    expect(text(pub)).not.toContain(TX_OPS)
    expect(SAFE).toBe('0x0000000000000000000000000000000000005afe')
    expect(POOL).toBe('0x000000000000000000000000000000000000b001')
  })

  describe('published refs come from the public System view only', () => {
    /** The fixture with one attach event on the public proposal, replacing its own; `edit` adjusts the input. */
    const attaching = (ref: Record<string, unknown>, edit: (input: ReturnType<typeof fixtureInput>) => void = () => {}) => {
      const input = fixtureInput()
      const p1 = (input.records.proposals as Record<string, any>[]).find(p => p.id === P.public)!
      p1.events = [{ id: 'e-x-01', at: '2026-10-02T09:00:00Z', by: 'steward-a', kind: 'attach', rev: p1.rev, ref }]
      edit(input)
      return projectPublic(input).pub
    }
    const system = (input: ReturnType<typeof fixtureInput>, id: string) => (input.records.systems as Record<string, unknown>[]).find(s => s.id === id)!
    const gardensRef = (pool: string) => ({ system: 'grants', id: `${pool}-1`, payload: { kind: 'gardens-proposal' } })
    const hatsRef = (h: string) => ({ system: 'roles', id: h, payload: { kind: 'hats-hat', details: 'd' } })

    it('(A) a Gardens ref publishes nothing when the pool address is withheld by a field rule', () => {
      const pub = attaching(gardensRef(POOL), input => { input.policy.collections.systems!.fields.address = 'members' })
      expect(proposal(pub, P.public).attached).toEqual([])
      expect(text(pub).toLowerCase()).not.toContain(hexOf(POOL))
    })

    it('(B) a Gardens ref naming another pool than the public System\'s publishes nothing', () => {
      const pub = attaching(gardensRef(OPS_SAFE), input => {
        ;(input.records.systems as Record<string, unknown>[]).push({ id: 'ops-pool', visibility: 'members', kind: 'gardens-pool', name: 'WITHHELD-93-xxxxxx', chain: CELO, address: OPS_SAFE })
      })
      expect(proposal(pub, P.public).attached).toEqual([])
      expect(text(pub).toLowerCase()).not.toContain(hexOf(OPS_SAFE))
    })

    it('(C) a Hats ref naming a hat of another tree than the public System\'s publishes nothing', () => {
      const pub = attaching(hatsRef(HAT_OTHER_TREE))
      expect(proposal(pub, P.public).attached).toEqual([])
      expect(text(pub)).not.toContain(HAT_OTHER_TREE.split(':')[2])
    })

    it('(D) a Hats ref publishes nothing when the tree address is withheld by a field rule', () => {
      const pub = attaching(hatsRef(HAT_STEWARD), input => {
        input.policy.collections.systems!.fields.address = 'members'
        // the actor of an act under that hat is not the hat either: the tree is no public tree
        const p1 = (input.records.proposals as Record<string, any>[]).find(p => p.id === P.public)!
        p1.events[0].as = { hat: HAT_STEWARD }
      })
      expect(proposal(pub, P.public).attached).toEqual([])
      expect(proposal(pub, P.public).author).toBe(`${ORIGIN}/members/steward-a`)
      expect(text(pub)).not.toContain(HAT_STEWARD)
    })

    it('a Hats ref on the right tree but another chain publishes nothing', () => {
      const pub = attaching(hatsRef(HAT_STEWARD.replace(CELO, ETHEREUM)))
      expect(proposal(pub, P.public).attached).toEqual([])
    })

    it("a ref whose payload kind is not its System's kind publishes nothing", () => {
      expect(proposal(attaching({ system: 'treasury', id: `${POOL}-1`, payload: { kind: 'gardens-proposal' } }), P.public).attached).toEqual([])
      expect(proposal(attaching({ system: 'votes', id: HAT_STEWARD, payload: { kind: 'hats-hat', details: 'd' } }), P.public).attached).toEqual([])
      expect(proposal(attaching({ system: 'grants', id: TX_CELO, chain: CELO, payload: { to: A.a1, value: '0', data_hash: TX_ETH, operation: 0, nonce: 1 } }), P.public).attached).toEqual([])
      expect(proposal(attaching({ system: 'roles', id: SNAPSHOT_VOTE, payload: { kind: 'snapshot-proposal', choice: 'x' } }), P.public).attached).toEqual([])
    })

    it("a Safe ref publishes nothing when the Safe's address or chains are withheld", () => {
      const ref = { system: 'treasury', id: TX_CELO, chain: CELO, payload: { to: A.a1, value: '0', data_hash: TX_ETH, operation: 0, nonce: 1 } }
      expect(proposal(attaching(ref, i => { i.policy.collections.systems!.fields.address = 'members' }), P.public).attached).toEqual([])
      expect(proposal(attaching(ref, i => {
        i.policy.collections.systems!.fields.chain = 'members'; i.policy.collections.systems!.fields.chains = 'members'
      }), P.public).attached).toEqual([])
    })

    it('a Snapshot ref publishes nothing when the space and url are withheld', () => {
      const ref = { system: 'votes', id: SNAPSHOT_VOTE, payload: { kind: 'snapshot-proposal', choice: 'x' } }
      expect(proposal(attaching(ref, i => {
        i.policy.collections.systems!.fields.space = 'members'; i.policy.collections.systems!.fields.url = 'members'
      }), P.public).attached).toEqual([])
      expect(system(fixtureInput(), 'votes').space).toBe('test-dao.eth')
    })
  })

  it('a proposal whose state is withheld by a field rule is not published, and counted withheld', () => {
    const input = fixtureInput()
    input.policy.collections.proposals!.fields.state = 'members'
    const r = projectPublic(input)
    expect(r.pub.proposals).toEqual([])
    expect(r.withheld.find(w => w.collection === 'proposals')).toEqual({ collection: 'proposals', records: 7, fields: 0 })
    // their decision rows stay masked entries, without the proposal ids
    for (const d of r.pub.decisions.filter(d => d.id !== 'gov-2026-001')) expect(d).toMatchObject({ proposal: null, title: null, restricted: true })
  })

  it('opened is read from the public view', () => {
    const input = fixtureInput()
    input.policy.collections.proposals!.fields.opened = 'members'
    for (const p of projectPublic(input).pub.proposals) expect(p.opened).toBe('')
  })

  it('actors: a recorded public hat becomes that hat ref; a public member its URI; a members-level member and a CAIP-10 actor null', () => {
    const p = proposal(withReads().pub, P.public)
    const actor = Object.fromEntries(p.events.map(e => [e.id, e.actor]))
    expect(p.author).toBe(HAT_STEWARD)                                    // opened_as.hat, tree 13 is public
    expect(actor['e-a1-01']).toBe(HAT_STEWARD)                            // as.hat
    expect(actor['e-a1-02']).toBeNull()                                   // steward-b: members-level
    expect(actor['e-a1-03']).toBe(`${ORIGIN}/members/contributor-c`)     // public agent
    expect(actor['e-a1-04']).toBeNull()                                   // a CAIP-10 actor
    expect(actor['e-a1-05']).toBe(`${ORIGIN}/members/steward-a`)         // as.hat of a tree that is no public System
    expect(actor['e-a1-07']).toBeNull()                                   // `system`: no member
    expect(actor['e-a1-08']).toBe(HAT_STEWARD)                            // a closing: closed.as.hat
    const g = proposal(withReads().pub, P.gardens)
    expect(g.author).toBe(HAT_CONTRIBUTOR)
    expect(proposal(withReads().pub, P.deleted).author).toBe(`${ORIGIN}/members/contributor-c`)
  })

  it('a hat is not used when its tree System is members-level', () => {
    const input = fixtureInput()
    const roles = (input.records.systems as Record<string, unknown>[]).find(s => s.id === 'roles')!
    roles.visibility = 'members'
    const p = proposal(projectPublic(input).pub, P.public)
    expect(p.author).toBe(`${ORIGIN}/members/steward-a`)
    expect(p.events[0]!.actor).toBe(`${ORIGIN}/members/steward-a`)
  })

  it('every event is kept, reduced (Task 7 chooses the kinds and adds `opened`)', () => {
    const p = proposal(withReads().pub, P.public)
    expect(p.events.map(e => e.kind)).toEqual(['approve', 'comment', 'vote', 'object', 'approve', 'attach', 'system', 'ratify'])
    expect(p.events[0]).toEqual({ id: 'e-a1-01', kind: 'approve', at: '2026-10-01T11:00:00Z', actor: HAT_STEWARD })
  })
})

describe('projectPublic: governance and decision rows', () => {
  it('governance keeps its description and rules', () => {
    const { pub } = withReads()
    expect(pub.governance?.description).toBe('SHOWN-20 How Test DAO decides')
    expect(pub.governance?.rules.map(r => r.id)).toEqual(['records', 'treasury'])
  })

  it("a decision row's by and summary never appear; restricted rows are masked; members-level rows are dropped", () => {
    const { pub } = withReads()
    expect(pub.decisions.map(d => d.id)).toEqual(['gov-2026-010', 'gov-2026-011', 'gov-2026-001', 'gov-2026-013'])
    const row = Object.fromEntries(pub.decisions.map(d => [d.id, d]))
    expect(row['gov-2026-010']).toEqual({
      id: 'gov-2026-010', proposal: P.public, title: 'SHOWN-40 Fund the treasury rotation', status: 'ratified', date: '2026-10-03',
      rule: 'records,treasury', method: 'system', restricted: false,
    })
    expect(row['gov-2026-011']).toMatchObject({ proposal: P.deleted, title: null, restricted: true })
    expect(row['gov-2026-001']).toEqual({
      id: 'gov-2026-001', proposal: null, title: 'SHOWN-21 Adopt the charter', status: 'approved', date: '2026-01-10', rule: null, method: null, restricted: false,
    })
    // a members-level proposal: the row stays a masked entry, and the proposal's id is not carried
    expect(row['gov-2026-013']).toMatchObject({ proposal: null, title: null, restricted: true })
    expect(text(pub)).not.toContain(P.hidden)
    for (const d of pub.decisions) { expect(d).not.toHaveProperty('by'); expect(d).not.toHaveProperty('summary') }
  })

  it('governance is null, and no row is published, when the document is not public', () => {
    const input = fixtureInput()
    delete input.policy.collections.governance
    const { pub } = projectPublic(input)
    expect(pub.governance).toBeNull()
    expect(pub.decisions).toEqual([])
  })
})

describe('projectPublic: extras, withheld, problems', () => {
  it('extras hold public records and fields only', () => {
    const { extras } = withReads().pub
    expect(extras.meetings.map(m => m.id)).toEqual(['meeting-2026-10-01'])
    expect(extras.projects).toEqual([{ id: 'project-one', name: 'SHOWN-31 Project One', status: 'active' }])
    expect(extras.ideas.map(i => i.id)).toEqual(['idea-one'])
    expect(extras.sources.map(s => s.id)).toEqual(['source-one'])
    expect(extras.finances).toEqual({})
    expect(extras.knowledge).toEqual({ title: 'SHOWN-33 What we know', domains: ['SHOWN-34 regeneration'] })
  })

  it('withheld counts records and fields per collection', () => {
    expect(withReads().withheld).toEqual([
      { collection: 'members', records: 1, fields: 3 },      // steward-b; steward-a's role, email, handles
      { collection: 'systems', records: 1, fields: 1 },      // ops-safe; the forum's notes
      { collection: 'proposals', records: 1, fields: 0 },    // the members-level proposal
      { collection: 'governance', records: 1, fields: 0 },   // one members-level decision row
      { collection: 'meetings', records: 1, fields: 0 },
      { collection: 'projects', records: 1, fields: 1 },     // project-two; project-one's budget
      { collection: 'finances', records: 1, fields: 0 },     // the document
      { collection: 'ideas', records: 1, fields: 0 },
    ])
  })

  it('a policy problem is a warn on data/visibility.yaml, and the bad entry reads as members', () => {
    const input = fixtureInput()
    ;(input.policy.collections as Record<string, unknown>).meetings = { default: 'pub' }
    const r = projectPublic(input)
    expect(r.problems).toContainEqual(expect.objectContaining({ level: 'warn', file: 'data/visibility.yaml' }))
    expect(r.pub.extras.meetings.map(m => m.id)).toEqual(['meeting-2026-10-01'])
  })

  it("a record's unreadable visibility is a warn naming collection and id, and the record is not public", () => {
    const input = fixtureInput()
    ;(input.records.members as Record<string, unknown>[])[2]!.visibility = 'hat:ops'
    const r = projectPublic(input)
    const w = r.problems.find(p => p.text.includes('contributor-c'))
    expect(w).toMatchObject({ level: 'warn' })
    expect(w!.text).toContain('members')
    expect(r.pub.members.map(m => m.id)).toEqual([`${ORIGIN}/members/steward-a`])
  })

  it('no daoURI origin: one error and an empty projection', () => {
    const input = fixtureInput()
    input.identity.daoURI = 'not a url'
    const r = projectPublic(input)
    expect(r.problems.filter(p => p.level === 'error')).toHaveLength(1)
    expect(r.pub.members).toEqual([])
    expect(r.pub.proposals).toEqual([])
    expect(r.pub.systems).toEqual([])
    expect(r.pub.governance).toBeNull()
    expect(text(r.pub)).not.toContain('WITHHELD-')
  })

  it('the fixture yields no problem', () => {
    expect(withReads().problems).toEqual([])
  })
})

describe('projectPublic: secrets', () => {
  it('holds every canary of a withheld record or field, of the dropped reads, and of what proposals never carry', () => {
    const { secrets } = withReads()
    const canaries = new Set(text(fixtureInput({ reads: fixtureReads() })).match(/WITHHELD-\d+-xxxxxx/g))
    for (const c of canaries) expect([...secrets].some(s => s.includes(c)), c).toBe(true)
    expect(secrets.has('steward-b')).toBe(true)
    expect([...secrets].some(s => s.toLowerCase().includes(hexOf(OPS_SAFE)))).toBe(true)
    expect(secrets.has(AS_ACCOUNT)).toBe(true)
  })

  it('holds no string shorter than 6 characters; a kept read\'s facts count as shown, a dropped read\'s do not (R38, C1)', () => {
    const { secrets } = withReads()
    for (const s of secrets) expect(s.length).toBeGreaterThanOrEqual(6)
    // R38: the treasury System is public in every field, so its kept read's facts (its owners' CAIP-10s) count as shown,
    // and so do its Signers rows' addresses, which those facts carry. No builder publishes owners (contracts.json carries
    // counts): "no Safe owner address appears in any file" in build.test.ts holds that.
    for (const o of [A.a1, A.a2, A.a3, A.a4]) expect([...secrets].some(s => s.toLowerCase().includes(hexOf(o))), o).toBe(false)
    // the members-level Safe's read is dropped: its address stays a secret (C1)
    expect([...secrets].some(s => s.toLowerCase().includes(hexOf(OPS_SAFE)))).toBe(true)
  })

  it('a withheld value that only a dropped read repeats stays a secret; a kept read\'s facts carrying it count as shown (C1, R38)', () => {
    const input = fixtureInput({ reads: fixtureReads() })
    const steward = (input.records.members as Record<string, unknown>[])[1]!   // steward-b, members-level
    steward.wallet = 'WITHHELD-90-xxxxxx-in-a-read'
    ;(input.reads!['ops-safe']!.facts as Record<string, unknown>).note = 'WITHHELD-90-xxxxxx-in-a-read'
    const dropped = projectPublic(input)
    expect(Object.keys(dropped.pub.reads)).not.toContain('ops-safe')          // the members-level Safe's read is dropped
    expect(dropped.secrets.has('WITHHELD-90-xxxxxx-in-a-read')).toBe(true)    // and the value stays a secret

    ;(input.reads!.grants!.facts as Record<string, unknown>).note = 'WITHHELD-90-xxxxxx-in-a-read'
    const kept = projectPublic(input)
    expect(Object.keys(kept.pub.reads)).toContain('grants')                   // a System public in every field
    expect(kept.secrets.has('WITHHELD-90-xxxxxx-in-a-read')).toBe(false)      // R38: its read's facts are shown
  })

  it('a string that is both withheld and public is not a secret', () => {
    const input = fixtureInput()
    ;(input.records.members as Record<string, unknown>[])[1]!.name = 'SHOWN-3 Steward A'
    const { secrets } = projectPublic(input)
    expect(secrets.has('SHOWN-3 Steward A')).toBe(false)
    expect(secrets.has('WITHHELD-6-xxxxxx@example.org')).toBe(true)
  })
})

describe('checkNoLeak', () => {
  it('a file containing a secret is one error naming the file', () => {
    const files = { 'dao.json': { name: 'Test DAO', members: [{ id: 'x', note: 'has WITHHELD-1-xxxxxx inside' }] }, 'members.json': { members: [] } }
    const problems = checkNoLeak(files, new Set(['WITHHELD-1-xxxxxx']))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({ level: 'error', file: 'dao.json' })
    expect(problems[0]!.text).not.toContain('WITHHELD-1-xxxxxx')   // the error is printed: it must not leak it either
  })

  it('scans string files and object keys, and reports each (file, secret) once', () => {
    const files = { 'governance.md': '# How\nWITHHELD-1-xxxxxx and WITHHELD-1-xxxxxx again', 'x.json': { 'WITHHELD-2-xxxxxx': 1 } }
    const problems = checkNoLeak(files, new Set(['WITHHELD-1-xxxxxx', 'WITHHELD-2-xxxxxx']))
    expect(problems.map(p => p.file)).toEqual(['governance.md', 'x.json'])
  })

  it('a secret shorter than 6 characters is not scanned', () => {
    expect(checkNoLeak({ 'dao.json': { name: 'abcde' } }, new Set(['abcde']))).toEqual([])
  })

  it('the fixture projection, serialised, leaks nothing it withholds', () => {
    const { pub, secrets } = withReads()
    // reads are not output (builders publish some of their facts, and build.test scans what they publish)
    expect(checkNoLeak({ 'pub.json': { ...pub, reads: {} } }, secrets)).toEqual([])
  })

  it('RESTRICTED_TITLE is the words of L4b and L5', () => {
    expect(RESTRICTED_TITLE).toBe('A change to a restricted collection')
  })
})

describe('projectPublic: finances entries', () => {
  it('a public finances document carries its public entries, without their visibility key; others are withheld and counted', () => {
    const input = fixtureInput()
    input.records.finances = {
      visibility: 'public',
      budgets: [{ id: 'b1', name: 'SHOWN-90 Budget' }, { id: 'b2', visibility: 'members', name: 'WITHHELD-90-xxxxxx' }, { id: 'b3', visibility: 'public', name: 'SHOWN-91 Open' }],
      expenses: 'not a list',
    }
    const r = projectPublic(input)
    expect(r.pub.extras.finances).toEqual({
      budgets: [{ id: 'b1', name: 'SHOWN-90 Budget' }, { id: 'b3', name: 'SHOWN-91 Open' }],
    })
    expect(r.withheld).toContainEqual({ collection: 'finances', records: 1, fields: 0 })
    expect(r.secrets.has('WITHHELD-90-xxxxxx')).toBe(true)
  })

  it("the collection's field rules apply to each entry's fields", () => {
    const input = fixtureInput()
    ;(input.policy.collections as Record<string, unknown>).finances = { default: 'public', fields: { amount: 'members' } }
    input.records.finances = { budgets: [{ id: 'b1', name: 'SHOWN-92 Budget', amount: 'WITHHELD-91-amount-canary-xxxx' }], expenses: [{ id: 'e1', visibility: 'public', amount: 'WITHHELD-92-amount-canary-xxxx' }] }
    const r = projectPublic(input)
    expect(r.pub.extras.finances).toEqual({ budgets: [{ id: 'b1', name: 'SHOWN-92 Budget' }], expenses: [{ id: 'e1' }] })
    expect(JSON.stringify(r.pub)).not.toContain('amount-canary')
    expect(r.secrets.has('WITHHELD-91-amount-canary-xxxx')).toBe(true)
    expect(r.secrets.has('WITHHELD-92-amount-canary-xxxx')).toBe(true)
    expect(r.withheld).toContainEqual({ collection: 'finances', records: 0, fields: 2 })
  })

  it('a top-level key rule still works', () => {
    const input = fixtureInput()
    ;(input.policy.collections as Record<string, unknown>).finances = { default: 'public', fields: { expenses: 'members' } }
    input.records.finances = { budgets: [{ id: 'b1', name: 'SHOWN-93 B' }], expenses: [{ id: 'e1', amount: 'WITHHELD-93-expense-canary-xxxx' }] }
    const r = projectPublic(input)
    expect(r.pub.extras.finances).toEqual({ budgets: [{ id: 'b1', name: 'SHOWN-93 B' }] })
    expect(r.secrets.has('WITHHELD-93-expense-canary-xxxx')).toBe(true)
  })
})


describe('projectPublic: what the leak scan does not treat as secret (R20)', () => {
  /** The secrets of the fixture with steward-b (a members-level member) carrying `extra`. */
  const secretsWith = (extra: Record<string, unknown>) => {
    const input = fixtureInput()
    Object.assign((input.records.members as Record<string, unknown>[])[1]!, extra)
    return projectPublic(input).secrets
  }

  it('ISO-8601 dates and timestamps are not secrets: builders write dates of their own', () => {
    const s = secretsWith({ joined: '2031-02-03', left: '2031-02-03T04:05:06Z', seen: '2031-02-03T04:05:06.789+02:00', at: '2031-02-03 04:05' })
    for (const d of ['2031-02-03', '2031-02-03T04:05:06Z', '2031-02-03T04:05:06.789+02:00', '2031-02-03 04:05']) expect(s.has(d), d).toBe(false)
    expect(secretsWith({ joined: 'WITHHELD-99-2031-02-03' }).has('WITHHELD-99-2031-02-03')).toBe(true)
  })

  it("DAOIP-5's funding mechanisms and application statuses are not secrets", () => {
    const s = secretsWith({ how: 'Quadratic Funding', where: 'in_review', also: 'completed' })
    expect(s.has('Quadratic Funding')).toBe(false)
    expect(s.has('in_review')).toBe(false)
    expect(s.has('completed')).toBe(false)
  })

  it("the ledger's states are not secrets", () => {
    const s = secretsWith({ a: 'ratified', b: 'withdrawn', c: 'expired', d: 'rejected' })
    for (const w of ['ratified', 'withdrawn', 'expired', 'rejected']) expect(s.has(w), w).toBe(false)
  })

  it('event and activity kinds are not secrets', () => {
    const s = secretsWith({ a: 'approve', b: 'retract', c: 'opened', d: 'comment', e: 'replay' })
    for (const w of ['approve', 'retract', 'opened', 'comment', 'replay']) expect(s.has(w), w).toBe(false)
  })

  it('attach payload kinds are not secrets', () => {
    const s = secretsWith({ a: 'snapshot-proposal', b: 'gardens-proposal', c: 'hats-wearer' })
    for (const w of ['snapshot-proposal', 'gardens-proposal', 'hats-wearer']) expect(s.has(w), w).toBe(false)
  })

  it('registry names are not secrets (the builders write them into URLs)', () => {
    const s = secretsWith({ a: 'meetings', b: 'governance', c: 'funding-opportunities' })
    for (const w of ['meetings', 'governance', 'funding-opportunities']) expect(s.has(w), w).toBe(false)
  })

  it('the words the builders write themselves (entity and document types, 0.6 defaults) are not secrets, in any case', () => {
    const s = secretsWith({ a: 'organization', b: 'PERSON', c: 'planned', d: 'Integrate', e: 'proposal', f: 'MeetingRegistry' })
    for (const w of ['organization', 'PERSON', 'planned', 'Integrate', 'proposal', 'MeetingRegistry']) expect(s.has(w), w).toBe(false)
  })

  it('a vocabulary word inside a longer withheld string is still a secret, and a real canary still errors', () => {
    const s = secretsWith({ note: 'ratified by WITHHELD-98-xxxxxx' })
    expect(s.has('ratified by WITHHELD-98-xxxxxx')).toBe(true)
    expect(checkNoLeak({ 'x.json': { a: 'see: ratified by WITHHELD-98-xxxxxx' } }, s)).toHaveLength(1)
    // and an output that only carries the vocabulary word itself is no leak
    expect(checkNoLeak({ 'x.json': { status: 'ratified', at: '2031-02-03T04:05:06Z' } }, secretsWith({ a: 'ratified', b: '2031-02-03' }))).toEqual([])
  })
})

describe('VOCABULARY keeps up with the lists it copies', () => {
  it("holds every ledger state, event kind and registry name (lib/proposals.mjs and lib/registries.mjs)", async () => {
    const { VOCABULARY } = await import('../../lib/standards/project.mjs')
    const { PROPOSAL_STATES, EVENT_KINDS } = await import('../../lib/proposals.mjs')
    const { REGISTRIES } = await import('../../lib/registries.mjs')
    const { ACTIVITY_KINDS } = await import('../../lib/standards/proposals.mjs')
    const { GARDENS_STATUS } = await import('../../lib/standards/grants.mjs')
    const { POOL_TYPES } = await import('../../server/systems/gardens.ts')
    for (const w of [...PROPOSAL_STATES, ...EVENT_KINDS, ...ACTIVITY_KINDS, ...REGISTRIES.map(r => r.name), ...Object.keys(GARDENS_STATUS), ...POOL_TYPES]) {
      expect(VOCABULARY, w).toContain(w)
    }
  })
})

describe('VOCABULARY holds the drivers\' own words in sections (R38)', () => {
  it('every section title a driver writes, and the fixed row labels of the Snapshot settings and the Gardens pool', async () => {
    const { VOCABULARY } = await import('../../lib/standards/project.mjs')
    const { readFileSync } = await import('node:fs')
    const titles = new Set<string>()
    for (const f of ['safe', 'hats', 'snapshot', 'gardens', 'registration']) {
      const src = readFileSync(new URL(`../../server/systems/${f}.ts`, import.meta.url), 'utf-8')
      for (const m of src.matchAll(/\btitle: '([^']+)'/g)) titles.add(m[1]!)
    }
    expect(titles.size).toBeGreaterThan(15)   // not vacuous
    for (const w of [...titles, 'Voting', 'Period', 'Delay', 'Quorum', 'Strategies', 'Validation', 'Admins', 'Funds', 'Community', 'Admin', 'Allowlist',
      'Version', 'Nonce', 'Guard', 'Fallback handler', 'Block', 'read from the chain', 'not known']) {
      expect(VOCABULARY, w).toContain(w)
    }
  })
})

describe('projectPublic: the documents\' keys are no secrets either', () => {
  it("a withheld string equal to a key the builders write (org-os.signers, description) is not a secret", () => {
    const input = fixtureInput()
    Object.assign((input.records.members as Record<string, unknown>[])[1]!, { a: 'Signers', b: 'description', c: 'org-os.threshold' })
    const { secrets } = projectPublic(input)
    for (const w of ['Signers', 'description', 'org-os.threshold']) expect(secrets.has(w), w).toBe(false)
  })
})

describe('projectPublic: a System with a withheld field is not read (C1)', () => {
  it('its read is dropped, counted and warned; neither withheld address appears anywhere in pub', () => {
    const input = withheldPoolInput()
    const { pub, withheld, secrets, problems } = projectPublic(input)
    expect(pub.systems.map(s => s.id)).toEqual(['pool-a'])
    expect(pub.reads).toEqual({})
    expect(withheld).toEqual([{ collection: 'systems', records: 0, fields: 2, reads: 1 }])
    expect(problems).toContainEqual({ level: 'warn', file: 'data/systems.yaml', text: 'systems pool-a: 2 fields are not public, so its live read is not published' })
    const s = text(pub).toLowerCase()
    expect(s).not.toContain(hexOf(POOL))
    expect(s).not.toContain(hexOf(addr('c0c0')))
    expect([...secrets].some(x => x.toLowerCase().includes(hexOf(POOL)))).toBe(true)
  })

  it('a fully public System keeps its read', () => {
    const input = withheldPoolInput()
    input.policy = { collections: { systems: { default: 'public', fields: {} } }, defaults: {} }
    expect(Object.keys(projectPublic(input).pub.reads)).toEqual(['pool-a'])
  })

  it('readable: public and every field public; the raw document and the parsed policy agree', () => {
    const system = withheldPoolInput().records.systems[0]
    expect(readable({ collections: { systems: { default: 'public', fields: { address: 'members' } } }, defaults: {} }, system)).toBe(false)
    expect(readable({ collections: { systems: { level: 'public' } } }, system)).toBe(true)
    expect(readable({ visibility: { collections: { systems: { default: 'public' } } } }, system)).toBe(true)
    expect(readable({ collections: { systems: { default: 'public' } } }, { ...system, visibility: 'members' })).toBe(false)
    expect(readable(undefined, system)).toBe(false)
  })
})

describe('buildStandards: a field withheld on each driven System drops its read, and nothing is refused for it (C1)', () => {
  for (const field of ['section', 'description', 'name']) {
    it(`fields.${field}: members — the composed on-chain ids and a dropped read's words are no leak`, async () => {
      const { buildStandards } = await import('../../lib/standards/index.mjs')
      const input = fixtureInput({ reads: fixtureReads() })
      ;(input.policy.collections as Record<string, { fields: Record<string, string> }>).systems!.fields[field] = 'members'
      const out = buildStandards(input)
      expect(out.problems.filter(p => /withheld value/.test(p.text))).toEqual([])
      expect(Object.keys(out.files)).toContain('contracts.json')
    })
  }
})

describe('projectPublic: a decision row with no status (I1, R30)', () => {
  it('is draft, with a warn naming the row; never ""', () => {
    const { pub, problems } = projectPublic({
      ...withheldPoolInput(),
      policy: { collections: { governance: { default: 'public', fields: {} } }, defaults: {} },
      records: { ...withheldPoolInput().records, systems: [], governance: { decisions: [{ id: 'gov-001', title: 'Adopt the charter', date: '2025-01-01' }, { id: 'gov-002', title: 'Blank', date: '2025-01-02', status: '  ' }] } },
      reads: null,
    })
    expect(pub.decisions.map(d => d.status)).toEqual(['draft', 'draft'])
    expect(problems).toContainEqual({ level: 'warn', file: 'data/governance.yaml', text: 'governance decision gov-001 has no status; published as draft' })
    expect(problems).toContainEqual({ level: 'warn', file: 'data/governance.yaml', text: 'governance decision gov-002 has no status; published as draft' })
  })
})

describe('projectPublic: members carry the names of their withheld fields (M3)', () => {
  it('names, never values', () => {
    const { pub } = projectPublic(fixtureInput())
    const a = pub.members.find(m => m.id.endsWith('steward-a'))!
    expect(a.withheld).toEqual(['email', 'handles', 'role'])
    expect(text(a)).not.toContain('WITHHELD-1-')
  })
})
