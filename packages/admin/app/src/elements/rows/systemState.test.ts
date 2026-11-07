import { describe, it, expect } from 'vitest'
import type { Resource } from '../../api.ts'
import { SAFE, SAFE_CHAINS } from '../../test/fixtures/house/org.ts'
import {
  COUNCIL_SAFE, GARDEN, LOCAL_STARTER, NETWORK_PROJECTS, OPS_WALLET, ROLES, SYSTEMS, TREASURY_SYSTEM, VOTES,
} from '../../test/fixtures/house/systems.ts'
import { systemFacts, systemKind, systemState } from './systemState.ts'

/** A copy of a fixture System with its driver's read changed by `edit`. */
function withRead(r: Resource, edit: (read: Record<string, any>) => void): Resource {
  const copy = structuredClone(r)
  edit(copy.facts.driver as Record<string, any>)
  return copy
}
/** The Treasury with one chain's read changed. */
const treasuryWith = (chain: string, edit: (c: Record<string, any>) => void) => withRead(TREASURY_SYSTEM, d => {
  d.facts.agree = false
  edit(d.facts.chains.find((c: { chain: string }) => c.chain === chain))
})

describe('systemKind: one fallback for the kind (E-37)', () => {
  const bare = (facts: Record<string, unknown>, status: string | null): Resource =>
    ({ id: 'system:x', kind: 'system', board: 'systems', name: 'X', status, attention: null, changed: null, facts, source: null })
  it('reads the entry’s kind, else the status, else "system" — and systemFacts and systemState read it the same way', () => {
    expect(systemKind(bare({ kind: 'safe' }, 'link'))).toBe('safe')
    expect(systemKind(bare({}, 'link'))).toBe('link')
    expect(systemKind(bare({ kind: '' }, null))).toBe('system')
    expect(systemFacts(bare({}, 'link')).kind).toBe('link')
    expect(systemState(bare({}, 'link'))).toEqual({ mark: 'closed', words: 'Linked, not read' })
  })
})

describe('systemState: one mark and its words for a System (§9.2), from its driver’s facts', () => {
  it('the plan’s five cases, on the house fixtures', () => {
    expect(systemState(TREASURY_SYSTEM)).toEqual({ mark: 'needs', words: '1 to sign' })
    expect(systemState(ROLES)).toEqual({ mark: 'needs', words: '3 empty hats' })
    expect(systemState(VOTES)).toEqual({ mark: 'ok', words: 'Up to date' })
    expect(systemState(GARDEN)).toEqual({ mark: 'failed', words: 'Couldn’t read' })
    expect(systemState(OPS_WALLET)).toEqual({ mark: 'closed', words: 'Linked, not read' })
  })

  it('a read in flight is running, a proposed change staged, an old read aged', () => {
    expect(systemState(COUNCIL_SAFE)).toEqual({ mark: 'running', words: 'Reading…' })
    expect(systemState(NETWORK_PROJECTS, { proposed: 'Return proposed' })).toEqual({ mark: 'staged', words: 'Return proposed' })
    expect(systemState(LOCAL_STARTER)).toEqual({ mark: 'aged', words: 'Old read' })
  })

  it('takes the first that holds, in the brief’s order', () => {
    // a link is never read, whatever its driver says
    expect(systemState(withRead(OPS_WALLET, d => { d.ok = false }))).toEqual({ mark: 'closed', words: 'Linked, not read' })
    // a failed read outranks reading again and what the last good read waited on
    expect(systemState(withRead(TREASURY_SYSTEM, d => { d.ok = false; d.state = 'reading' }))).toEqual({ mark: 'failed', words: 'Couldn’t read' })
    expect(systemState(withRead(TREASURY_SYSTEM, d => { d.state = 'reading' }))).toEqual({ mark: 'running', words: 'Reading…' })
    // what needs a person outranks a proposal and an old read
    expect(systemState(withRead(ROLES, d => { d.state = 'aged' }), { proposed: 'Return proposed' })).toEqual({ mark: 'needs', words: '3 empty hats' })
    expect(systemState(withRead(NETWORK_PROJECTS, d => { d.state = 'aged' }), { proposed: 'Return proposed' })).toEqual({ mark: 'staged', words: 'Return proposed' })
  })

  it('a Safe whose good chains differ disagrees, ahead of what waits to be signed', () => {
    const gnosis = treasuryWith('eip155:100', c => { c.owners = [...c.owners, `eip155:100:${SAFE}`] })
    expect(systemState(gnosis)).toEqual({ mark: 'needs', words: 'Chains disagree' })
    const threshold = treasuryWith('eip155:10', c => { c.threshold = 5 })
    expect(systemState(threshold)).toEqual({ mark: 'needs', words: 'Chains disagree' })
  })

  it('a chain that failed is a warning, not a disagreement (L2-C8): the Safe still reads what waits', () => {
    const failed = treasuryWith('eip155:137', c => { for (const k of ['threshold', 'owners', 'nonce', 'pending', 'version']) delete c[k]; c.ok = false; c.error = 'polygon answered 500' })
    expect(systemState(failed)).toEqual({ mark: 'needs', words: '1 to sign' })
  })

  // L7 fix r1 M1: a Safe read from the chain (the service did not answer) does not say what waits; it is not "Up to date".
  it('a Safe read from the chain, with no `pending`, is not fully read; one chain of several so read too, unless signatures are known to wait', () => {
    const fromChain = withRead(COUNCIL_SAFE, d => {
      d.state = 'fresh'; delete d.facts.pending
      d.facts.source = 'chain'; d.facts.note = 'Read from the chain: the Safe Transaction Service did not answer (429)'
    })
    expect(systemState(fromChain)).toEqual({ mark: 'failed', words: 'Not fully read' })
    const oneChain = withRead(TREASURY_SYSTEM, d => {
      d.facts.pending = 0
      const c = d.facts.chains.find((x: { chain: string }) => x.chain === 'eip155:10')
      delete c.pending; c.source = 'chain'
    })
    expect(systemState(oneChain)).toEqual({ mark: 'failed', words: 'Not fully read' })
    const waiting = withRead(oneChain, d => { d.facts.pending = 1 })
    expect(systemState(waiting)).toEqual({ mark: 'needs', words: '1 to sign' })
  })

  it('owners are compared by address, whatever their case and chain prefix', () => {
    const recased = treasuryWith('eip155:8453', c => { c.owners = [...c.owners].reverse().map((o: string) => o.toUpperCase().replace('EIP155', 'eip155').replace('0X', '0x')) })
    expect(systemState(recased)).toEqual({ mark: 'needs', words: '1 to sign' })
  })

  it('counts what waits: nothing waiting is up to date, two hats empty is "2 empty hats"', () => {
    expect(systemState(withRead(TREASURY_SYSTEM, d => { d.facts.pending = 0 }))).toEqual({ mark: 'ok', words: 'Up to date' })
    expect(systemState(withRead(TREASURY_SYSTEM, d => { d.facts.pending = 2 }))).toEqual({ mark: 'needs', words: '2 to sign' })
    // an inactive hat with no wearer is not waiting on anyone
    const two = withRead(ROLES, d => { d.facts.hats.find((h: { supply: number }) => h.supply === 0).active = false })
    expect(systemState(two)).toEqual({ mark: 'needs', words: '2 empty hats' })
    expect(systemState(withRead(ROLES, d => { d.facts.hats = d.facts.hats.filter((h: { supply: number }) => h.supply > 0) }))).toEqual({ mark: 'ok', words: 'Up to date' })
  })

  it('a System nothing has read yet is open, "Not read yet"', () => {
    const unread = structuredClone(VOTES)
    delete unread.facts.driver
    expect(systemState(unread)).toEqual({ mark: 'open', words: 'Not read yet' })
  })
})

describe('systemFacts: what a System’s row and header show, from its Resource', () => {
  it('the Treasury: seven chains all agreeing, its address as a chip, 4 of 8 signers, Open in Safe', () => {
    expect(systemFacts(TREASURY_SYSTEM)).toEqual({
      kind: 'safe', chains: [...SAFE_CHAINS], agree: 7, address: { chip: SAFE }, governs: '4 of 8 signers',
      read: TREASURY_SYSTEM.facts.driver, open: { label: 'Open in Safe', href: `https://app.safe.global/home?safe=eth:${SAFE}` },
    })
  })

  it('agree counts the chains whose good read matches the first; a failed chain is not counted against it', () => {
    expect(systemFacts(treasuryWith('eip155:100', c => { c.threshold = 5 })).agree).toBe(6)
    expect(systemFacts(treasuryWith('eip155:100', c => { c.ok = false; delete c.threshold; delete c.owners })).agree).toBe(7)
  })

  it('a one-chain Safe: its chain from the entry, all of one agreeing', () => {
    expect(systemFacts(COUNCIL_SAFE)).toMatchObject({ kind: 'safe', chains: ['eip155:42220'], agree: 1, governs: '3 of 5 signers' })
  })

  it('a Hats tree’s address is Mono "<chain id> / <tree>"; a Snapshot space’s is its host', () => {
    expect(systemFacts(ROLES)).toMatchObject({ kind: 'hats-tree', chains: ['eip155:42220'], address: { mono: '42220 / 13' }, governs: '13 hats', open: { label: 'Open in Hats' } })
    expect(systemFacts(VOTES)).toMatchObject({ kind: 'snapshot-space', chains: ['eip155:1'], address: { host: 'snapshot.box' }, governs: null, open: { label: 'Open in Snapshot' } })
  })

  it('a Gardens community and pool show their address as a chip; a failed read keeps its last good facts', () => {
    expect(systemFacts(GARDEN)).toMatchObject({ kind: 'gardens-community', address: { chip: GARDEN.facts.address }, governs: '42 members', read: { ok: false }, open: { label: 'Open in Gardens' } })
    expect(systemFacts(NETWORK_PROJECTS)).toMatchObject({ kind: 'gardens-pool', address: { chip: NETWORK_PROJECTS.facts.address } })
  })

  it('a link: its chain and address as given, opened as itself', () => {
    expect(systemFacts(OPS_WALLET)).toMatchObject({ kind: 'link', chains: ['eip155:1'], address: { chip: OPS_WALLET.facts.address }, open: { label: 'Open', href: OPS_WALLET.facts.url } })
  })

  it('opens only an http(s) address, and nothing for a System nothing has read', () => {
    expect(systemFacts(withRead(VOTES, d => { d.open = { url: 'javascript:alert(1)', embeddable: false } })).open).toBeNull()
    const unread = structuredClone(ROLES)
    delete unread.facts.driver
    expect(systemFacts(unread)).toMatchObject({ read: null, open: null, address: { mono: '42220 / 13' }, governs: null })
  })

  it('every house System has a kind, a chain and an address to show', () => {
    for (const r of SYSTEMS) {
      const f = systemFacts(r)
      expect(f.chains.length, r.id).toBeGreaterThan(0)
      expect(f.address, r.id).not.toBeNull()
    }
  })
})
