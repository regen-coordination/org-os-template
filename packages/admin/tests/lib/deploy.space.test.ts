// DAO-OS L7 Task 13 (spec §8.2 step 8, §8.4, §9): the Snapshot space is prepared as settings and links, never posted.
// The strategy is `erc1155-balance-of` as snapshot-labs/snapshot-strategies defines it at commit 91abd258f10b
// (src/strategies/erc1155-balance-of/schema.json: `address`, `tokenId` (text), `decimals` required, `symbol`; no other
// key): one wearer of the council hat, one vote (Hats v1 balanceOf is 1 for a wearer). Pure: the chain state is built
// from the recorded fixtures (tests/deploy/fixtures/readings.ts) with the hub's answer added by hand.
import { describe, it, expect } from 'vitest'
import { checksumAddress } from '../../lib/caip.mjs'
import { prettyHatId } from '../../lib/hats.mjs'
import { DEPLOYMENTS } from '../../lib/deployments.mjs'
import { planDeployment } from '../../lib/deploy/plan.mjs'
import { SPACE_STRATEGY, spaceSettingsDraft, spaceSteps } from '../../lib/deploy/space.mjs'
import { compositionProblems } from '../../lib/compose.mjs'
import { COUNCIL, TREASURER, SEPOLIA, SPACE_RECORD, STAGES, SYSTEMS, composition } from '../deploy/fixtures/readings.ts'
import type { ChainState } from '../../server/deploy/state.ts'

const HATS = checksumAddress(DEPLOYMENTS[SEPOLIA]!.hats.address)
const c = () => composition([...SYSTEMS, SPACE_RECORD])
const space = () => c().spaces[0]!
/** A stage's chain state with the testnet hub's answer for the space. */
const at = (stage: keyof typeof STAGES, found: Record<string, unknown> | null | { error: string } = null): ChainState => ({
  ...structuredClone(STAGES[stage].state),
  spaces: { 'test-dao-votes': found !== null && 'error' in found ? { found: null, error: found.error as string } : { found: found as never } },
})
const step = (s: ChainState) => spaceSteps(c(), s).find(x => x.id === 'space:settings')!
const COUNCIL_DECIMAL = BigInt(COUNCIL).toString()
/** The space as the hub would answer it after the draft was pasted. */
const pasted = (over: Record<string, unknown> = {}) => ({
  id: 'test-dao.eth', name: 'Test DAO', network: '11155111',
  strategies: [{ name: SPACE_STRATEGY, network: '11155111', params: { symbol: 'VOTE', address: HATS, tokenId: COUNCIL_DECIMAL, decimals: 0 } }],
  filters: { minScore: 0, onlyMembers: true }, voting: { delay: 0, period: 259200, quorum: 0, type: null }, admins: [], ...over,
})

describe('spaceSettingsDraft (spec §8.4)', () => {
  it('the template\'s space: Sepolia, erc1155-balance-of on Hats v1 with the council hat id as decimal text, members only, two links', () => {
    const d = spaceSettingsDraft(space(), c(), at('hats'))!
    expect(d.network).toBe(SEPOLIA)
    expect(d.space).toBe('test-dao.eth')
    expect(d.settings).toMatchObject({ name: 'Test DAO', symbol: 'VOTE', network: '11155111', voting: { delay: 0, period: 259200, quorum: 0 } })
    expect(d.settings.strategies).toEqual([{ name: 'erc1155-balance-of', network: '11155111', params: { symbol: 'VOTE', address: HATS, tokenId: COUNCIL_DECIMAL, decimals: 0 } }])
    expect(d.settings.filters).toMatchObject({ onlyMembers: true })
    expect(d.links).toEqual({
      name: 'https://sepolia.app.ens.domains/test-dao.eth',
      create: 'https://testnet.snapshot.box/#/create',
      space: 'https://testnet.snapshot.box/#/s:test-dao.eth',
    })
  })

  it('the hat is named by the space\'s `elects` relation when its strategy names none', () => {
    const rec = structuredClone(SPACE_RECORD)
    rec.deployment.settings.strategies = [{ name: 'erc1155-balance-of', params: { symbol: 'VOTE' } as never }]
    const comp = composition([...SYSTEMS, rec])
    const d = spaceSettingsDraft(comp.spaces[0]!, comp, at('hats'))!
    expect(d.settings.strategies[0]!.params).toMatchObject({ tokenId: COUNCIL_DECIMAL })
  })

  it('is null while the hat\'s id cannot be predicted (no top hat yet)', () => {
    expect(spaceSettingsDraft(space(), c(), at('safe'))).toBeNull()
  })

  // fix I-2 (Tasks 13/14 review): each strategy counts the hat it names, not the first hat named anywhere in the space
  const withStrategies = (strategies: Record<string, unknown>[]) => {
    const rec = structuredClone(SPACE_RECORD)
    rec.deployment.settings.strategies = strategies as never
    return composition([...SYSTEMS, rec])
  }
  it('two erc1155-balance-of strategies, [council, treasurer], each count their own hat', () => {
    const comp = withStrategies([
      { name: 'erc1155-balance-of', params: { tokenId: '${hat.test-dao-roles/council}' } },
      { name: 'erc1155-balance-of', params: { tokenId: '${hat.test-dao-roles/treasurer}' } },
    ])
    const d = spaceSettingsDraft(comp.spaces[0]!, comp, at('hats'))!
    expect(d.settings.strategies.map(x => x.params.tokenId)).toEqual([COUNCIL_DECIMAL, BigInt(TREASURER).toString()])
  })

  it('a strategy naming a contract that is not Hats v1 is refused in words, a composition problem of the space, never rewritten', () => {
    const comp = withStrategies([{ name: 'erc1155-balance-of', params: { address: '0x00000000000000000000000000000000000000b7', tokenId: '${hat.test-dao-roles/council}' } }])
    const problems = compositionProblems(comp).filter(p => p.system === 'test-dao-votes')
    expect(problems).toEqual([{
      system: 'test-dao-votes', field: 'deployment.settings.strategies',
      message: 'strategy 1 (erc1155-balance-of) names the contract 0x00000000000000000000000000000000000000b7, not Hats v1: it counts a composed hat on Hats v1; leave `address` out.',
    }])
    expect(spaceSettingsDraft(comp.spaces[0]!, comp, at('hats'))).toBeNull()
    const st = spaceSteps(comp, at('hats')).find(x => x.id === 'space:settings')!
    expect(st.status).toBe('waits')
    expect(st.waits).toBe(problems[0]!.message)
  })

  it('a strategy naming a token id itself, not a composed hat, is refused in words', () => {
    const comp = withStrategies([{ name: 'erc1155-balance-of', params: { address: HATS, tokenId: '123' } }])
    expect(compositionProblems(comp).filter(p => p.system === 'test-dao-votes').map(p => p.message)).toEqual([
      'strategy 1 (erc1155-balance-of) names token id "123" itself: name the hat it counts as ${hat.<tree>/<key>}, or leave `tokenId` out to count the hat the space elects.',
    ])
    expect(spaceSettingsDraft(comp.spaces[0]!, comp, at('hats'))).toBeNull()
  })
})

describe('the space step (spec §8.2 step 8)', () => {
  it('waits while the council hat does not exist', () => {
    const s = step(at('top'))
    expect(s).toMatchObject({ id: 'space:settings', system: 'test-dao-votes', title: 'The Snapshot space', status: 'waits', signer: { kind: 'account' } })
    expect(s.waits).toBe('Waits for the child hats to be read back.')
    expect(s.draft).toBeUndefined()
  })

  it('is ready once the council hat exists and the hub has no space: the draft, no transaction', () => {
    const s = step(at('hats'))
    expect(s.status).toBe('ready')
    expect(s.call).toBeUndefined()
    expect(s.draft?.settings.strategies[0]!.params.tokenId).toBe(COUNCIL_DECIMAL)
    expect(s.predicts).toEqual([{ kind: 'space', value: 'test-dao.eth' }])
  })

  it('is done when the testnet hub returns the space with the composed name, network and strategies', () => {
    expect(step(at('all', pasted())).status).toBe('done')
    // whatever the order: the space read back before the hats are is done when it counts the predicted hat
    expect(step(at('top', pasted())).status).toBe('done')
  })

  it('is a mismatch when the hub returns it otherwise, saying what it holds; the draft stays to paste again', () => {
    const s = step(at('all', pasted({ name: 'Other DAO', network: '1', strategies: [{ name: 'whitelist', network: '1', params: {} }] })))
    expect(s.status).toBe('mismatch')
    expect(s.differs).toEqual([
      'the space on the Snapshot hub is named "Other DAO", not "Test DAO"',
      'the space on the Snapshot hub votes on network 1, not 11155111 (Sepolia)',
      `the space's strategies are whitelist on network 1, not erc1155-balance-of of hat ${prettyHatId(COUNCIL)} on Hats v1`,
    ])
    expect(s.draft).toBeDefined()
  })

  it('a strategy on another token id is a mismatch', () => {
    const other = pasted({ strategies: [{ name: SPACE_STRATEGY, network: '11155111', params: { symbol: 'VOTE', address: HATS, tokenId: '1', decimals: 0 } }] })
    expect(step(at('all', other)).status).toBe('mismatch')
  })

  // fix I-1 (Tasks 13/14 review): the same contract and token id counted on another chain, or scaled otherwise, is not
  // the composed strategy
  it('a strategy counting the votes on another network is a mismatch, said so', () => {
    const other = pasted({ strategies: [{ name: SPACE_STRATEGY, network: '1', params: { symbol: 'VOTE', address: HATS, tokenId: COUNCIL_DECIMAL, decimals: 0 } }] })
    const s = step(at('all', other))
    expect(s.status).toBe('mismatch')
    expect(s.differs).toEqual([`the space's strategies are erc1155-balance-of of hat ${prettyHatId(COUNCIL)} on Hats v1 on network 1, not erc1155-balance-of of hat ${prettyHatId(COUNCIL)} on Hats v1`])
  })

  it('a strategy with no network of its own counts on the space\'s: a space on network 1 is a mismatch on both counts', () => {
    const other = pasted({ network: '1', strategies: [{ name: SPACE_STRATEGY, params: { symbol: 'VOTE', address: HATS, tokenId: COUNCIL_DECIMAL, decimals: 0 } }] })
    expect(step(at('all', other)).differs).toHaveLength(2)
    const same = pasted({ strategies: [{ name: SPACE_STRATEGY, params: { symbol: 'VOTE', address: HATS, tokenId: COUNCIL_DECIMAL, decimals: 0 } }] })
    expect(step(at('all', same)).status).toBe('done')
  })

  it('a strategy with decimals 18 is a mismatch, said so', () => {
    const other = pasted({ strategies: [{ name: SPACE_STRATEGY, network: '11155111', params: { symbol: 'VOTE', address: HATS, tokenId: COUNCIL_DECIMAL, decimals: 18 } }] })
    const s = step(at('all', other))
    expect(s.status).toBe('mismatch')
    expect(s.differs).toEqual([`the space's strategies are erc1155-balance-of of hat ${prettyHatId(COUNCIL)} on Hats v1 with decimals 18, not erc1155-balance-of of hat ${prettyHatId(COUNCIL)} on Hats v1`])
  })

  it('waits, never done, when the hub could not be read', () => {
    const s = step(at('all', { error: 'testnet.hub.snapshot.org answered no data' }))
    expect(s.status).toBe('waits')
    expect(s.waits).toBe('Waits for the Snapshot hub to answer: testnet.hub.snapshot.org answered no data')
  })

  it('comes after the seven chain steps through the planner\'s space hook; without the hook there is none', () => {
    const s = at('hats')
    expect(planDeployment(c(), s, { space: spaceSteps }).steps.map(x => x.id).slice(-1)).toEqual(['space:settings'])
    expect(planDeployment(c(), s).steps.some(x => x.id === 'space:settings')).toBe(false)
  })
})
