import { describe, it, expect } from 'vitest'
import { isComposed, compositionOf, compositionProblems, type Composition } from '../../lib/compose.mjs'
import { composedSafe, composedTree, composedSpace, OWNERS } from './compose.fixtures.ts'

const records = () => [composedSafe(), composedTree(), composedSpace()] as Record<string, unknown>[]
const comp = (edit?: (c: Composition) => void) => { const c = compositionOf(records())!; edit?.(c); return c }
const messages = (c: Composition) => compositionProblems(c).map(p => p.message)

describe('compositionOf', () => {
  it('is null when nothing is composed', () => {
    expect(compositionOf([])).toBeNull()
    expect(compositionOf([{ id: 'a', kind: 'safe', deployment: { status: 'deployed' } }])).toBeNull()
    expect(isComposed({ deployment: { status: 'deployed' } })).toBe(false)
    expect(isComposed({ deployment: { status: 'composed' } })).toBe(true)
  })
  it("turns spec 4.1's records into a Composition", () => {
    expect(compositionOf(records())).toEqual({
      chain: 'eip155:11155111',
      safes: [{ id: 'test-dao-safe', chain: 'eip155:11155111', owners: OWNERS, threshold: 2, salt: '1', gate: { hats: ['test-dao-roles/council'], threshold: { type: 'absolute', min: 2, target: 2 }, claimableFor: true } }],
      trees: [{ id: 'test-dao-roles', chain: 'eip155:11155111', top: { details: 'Test DAO', image: '', wornBy: 'test-dao-safe' },
        hats: [{ key: 'council', details: 'Council', admin: 'top', max_supply: 5, mutable: true, wearers: OWNERS, role: 'decides', hat: null }] }],
      // `elects`: the hat whose wearers vote, from the space's `relates` (L7 Task 13)
      spaces: [{ id: 'test-dao-votes', space: 'test-dao.eth', network: 'eip155:11155111', settings: { name: 'Test DAO', symbol: 'VOTE' }, elects: 'test-dao-roles/council' }],
      registrations: [], links: [],
    })
  })
  it('carries a recorded top hat (deployment.top.hat, a hat ref) into top.hat, and nothing else as one', () => {
    const ref = 'eip155:11155111:0x0000012400000000000000000000000000000000000000000000000000000000'
    const t = composedTree()
    const withHat = { ...t, deployment: { ...t.deployment, top: { ...t.deployment.top, hat: ref } } }
    expect(compositionOf([composedSafe(), withHat])!.trees[0]!.top).toEqual({ details: 'Test DAO', image: '', wornBy: 'test-dao-safe', hat: ref })
    const bad = { ...t, deployment: { ...t.deployment, top: { ...t.deployment.top, hat: '0x124' } } }
    expect(compositionOf([composedSafe(), bad])!.trees[0]!.top).not.toHaveProperty('hat')
  })
})

describe('compositionProblems', () => {
  it('is empty for the spec records', () => expect(compositionProblems(comp())).toEqual([]))
  it('refuses a threshold beyond the owners', () => {
    expect(messages(comp(c => { c.safes[0]!.threshold = 3 }))).toEqual(['threshold is 3, and the Safe has 2 owners; it is between 1 and the number of owners.'])
  })
  it('refuses a signer gate naming a hat that is not composed', () => {
    expect(messages(comp(c => { c.safes[0]!.gate!.hats = ['test-dao-roles/treasurer'] }))).toEqual(['the signer gate names test-dao-roles/treasurer, which is not a composed hat.'])
  })
  it('refuses an admin that is not a hat of the tree', () => {
    expect(messages(comp(c => { c.trees[0]!.hats.push({ ...c.trees[0]!.hats[0]!, key: 'treasurer', admin: 'ops', wearers: [] }) }))).toEqual(['hat treasurer\'s admin is "ops", which is not a hat of this tree.'])
  })
  it('refuses more wearers than max_supply', () => {
    expect(messages(comp(c => { const h = c.trees[0]!.hats[0]!; h.max_supply = 2; h.wearers = [...OWNERS, OWNERS[0]!.replace(/a1$/, 'a3')] }))).toEqual(['hat council has 3 wearers and room for 2 (max_supply).'])
  })
  it('refuses a top hat worn by something that is not a composed Safe', () => {
    expect(messages(comp(c => { c.trees[0]!.top.wornBy = 'elsewhere' }))).toEqual(['the top hat is worn by "elsewhere", which is not a composed Safe on eip155:11155111.'])
  })
  it('refuses any chain but Sepolia, naming the System', () => {
    const c = comp(c => { c.safes[0]!.chain = 'eip155:1'; c.trees[0]!.top.wornBy = 'nobody' })
    expect(compositionProblems(c)[0]).toEqual({ system: 'test-dao-safe', field: 'chain', message: 'Deploying is built for Sepolia (eip155:11155111) only.' })
  })
  it('a Safe on another chain than its composed tree is caught, though the tree is on Sepolia', () => {
    const r = { ...composedSafe(), chain: 'eip155:1' }
    const c = compositionOf([r, composedTree()] as Record<string, unknown>[])!
    expect(compositionProblems(c).map(p => p.system)).toContain('test-dao-safe')
  })
  it('a space on another network is refused; a composition of one Sepolia space alone is fine', () => {
    const space = composedSpace() as any
    expect(compositionProblems(compositionOf([{ ...space, deployment: { ...space.deployment, network: 'eip155:1' } }])!))
      .toEqual([{ system: 'test-dao-votes', field: 'deployment.network', message: 'Deploying is built for Sepolia (eip155:11155111) only.' }])
    expect(compositionProblems(compositionOf([space])!)).toEqual([])
  })
  it('refuses a signer gate whose owner hat (the top hat of its first hat\'s tree) another composed Safe wears (L7 T10 fix I4)', () => {
    const other = { ...composedSafe(), id: 'other-safe', signer_gate: null, deployment: { ...composedSafe().deployment, salt: '2' } }
    const tree = composedTree()
    const c = compositionOf([composedSafe(), other, { ...tree, deployment: { ...tree.deployment, top: { ...tree.deployment.top, worn_by: 'other-safe' } } }] as Record<string, unknown>[])!
    expect(compositionProblems(c)).toEqual([{
      system: 'test-dao-safe', field: 'signer_gate.hats',
      message: 'the signer gate\'s owner hat is the top hat of test-dao-roles, which other-safe wears, not this Safe: the gate\'s first hat is in a tree whose top hat this Safe wears.',
    }])
  })
  it('refuses an owner or a wearer that is neither a 0x address nor an account on the composition’s chain (review M1)', () => {
    const A = '0x' + 'ab'.repeat(20)
    for (const bad of [`cosmos:cosmoshub-4:${A}`, `eip155:1:${A}`, 'not-an-address']) {
      const c = comp(x => { x.safes[0]!.owners = [bad, OWNERS[1]!]; x.trees[0]!.hats[0]!.wearers = [bad] })
      expect(compositionProblems(c), bad).toEqual([
        { system: 'test-dao-safe', field: 'deployment.owners', message: `owner "${bad}" is neither a 0x address nor an account on eip155:11155111 (eip155:11155111:0x…).` },
        { system: 'test-dao-roles', field: 'hats.council.wearers', message: `wearer "${bad}" of hat council is neither a 0x address nor an account on eip155:11155111 (eip155:11155111:0x…).` },
      ])
    }
    expect(compositionProblems(comp(x => { x.safes[0]!.owners = [A, `eip155:11155111:${A.slice(0, -2)}cd`] }))).toEqual([])
  })
  it('refuses a space not named by a .eth name', () => {
    expect(messages(comp(c => { c.spaces[0]!.space = 'test-dao' }))).toEqual(['a Snapshot space is named by an ENS name ending in .eth.'])
  })
})

describe('a partly flipped composition (spec §9)', () => {
  it('a deployed Safe the composed tree names still resolves, with no "not a composed Safe" problem', () => {
    const safe = { id: 'test-dao-safe', kind: 'safe', name: 'S', chain: 'eip155:11155111', address: '0x0000000000000000000000000000000000005afe', deployment: { status: 'deployed', read_back: '2026-10-30', on_deploy: {} } }
    const c = compositionOf([safe, composedTree(), composedSpace()] as Record<string, unknown>[])!
    expect(c.safes).toEqual([expect.objectContaining({ id: 'test-dao-safe', deployed: true, address: safe.address })])
    expect(compositionProblems(c)).toEqual([])
  })
})
