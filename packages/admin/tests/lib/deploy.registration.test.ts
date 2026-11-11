// DAO-OS L7 Task 14 (spec §8.2 step 9, §8.5): "Register the daoURI" is an account step, `setText(node, "daouri",
// identity.daoURI)` to the resolver the Universal Resolver names for the ENS name (findResolver), signed by the name's
// owner outside the Hub. The resolver is ENSv2's on Sepolia; contracts-v2 at 48b3e2d39513 has PermissionedResolver
// `setText(bytes32 node, string key, string value)` and answers supportsInterface for ITextResolver (0x59d1d43c).
// Pure: the chain state is the recorded fixtures' with the ENS reading added by hand.
import { describe, it, expect } from 'vitest'
import { decodeResult, selector } from '../../lib/abi.mjs'
import { checksumAddress } from '../../lib/caip.mjs'
import { planDeployment } from '../../lib/deploy/plan.mjs'
import { registrationSteps } from '../../lib/deploy/registration.mjs'
import { ENS_SIGNATURES, namehash } from '../../lib/ens.mjs'
import { REGISTRATION_RECORD, SEPOLIA, STAGES, SYSTEMS, composition } from '../deploy/fixtures/readings.ts'
import type { ChainState } from '../../server/deploy/state.ts'

const URI = 'https://dao.example.org/.well-known/dao.json'
const RESOLVER = '0x00000000000000000000000000000000000000e5'
const NODE = namehash('test-dao.eth')
const c = () => composition([...SYSTEMS, REGISTRATION_RECORD])
type Reg = NonNullable<ChainState['registrations']>[string]
const at = (reg: Partial<Reg> | null): ChainState => ({
  ...structuredClone(STAGES.nothing.state),
  ...(reg ? { registrations: { 'test-dao-registration': { node: NODE, resolver: RESOLVER, own: true, takesText: true, text: null, ...reg } } } : {}),
})
const step = (s: ChainState, uri: string | null = URI) => registrationSteps(uri)(c(), s).find(x => x.id === 'registration:daouri')!

describe('Register the daoURI (spec §8.2 step 9)', () => {
  it('is ready on a resolver that takes text: setText(namehash(name), "daouri", identity.daoURI) to that resolver, an account signs', () => {
    const s = step(at({}))
    expect(s).toMatchObject({ id: 'registration:daouri', system: 'test-dao-registration', title: 'Register the daoURI', status: 'ready', signer: { kind: 'account' } })
    expect(s.call!.to).toBe(`${SEPOLIA}:${checksumAddress(RESOLVER)}`)
    expect(s.call!.operation).toBe(0)
    expect(s.call!.value).toBe('0')
    expect(s.call!.data.slice(0, 10)).toBe(selector(ENS_SIGNATURES.setText))
    expect(decodeResult(['bytes32', 'string', 'string'], `0x${s.call!.data.slice(10)}`)).toEqual([NODE, 'daouri', URI])
    expect(s.predicts).toEqual([{ kind: 'text', value: URI, on: 'test-dao.eth' }])
  })

  // fix M-2 (Tasks 13/14 review): the summary says whose account signs it, and what else reverts
  it('its summary says the composer\'s account must own the name, or hold ROLE_SET_TEXT on its resolver', () => {
    expect(step(at({})).call!.summary).toBe(
      `Set the text record daouri of test-dao.eth to ${URI}, on its resolver ${checksumAddress(RESOLVER)}. `
      + 'Your account must own test-dao.eth (or hold ROLE_SET_TEXT on that resolver) and sign it from your own wallet; '
      + 'from any other account the resolver refuses it.')
  })

  it('is done when the text record equals identity.daoURI', () => {
    expect(step(at({ text: URI })).status).toBe('done')
  })

  it('another text there is replaced: ready, with a warning saying what it reads now', () => {
    const s = step(at({ text: 'https://elsewhere.example.org/dao.json' }))
    expect(s.status).toBe('ready')
    expect(s.differs).toEqual(['test-dao.eth\'s daouri reads https://elsewhere.example.org/dao.json now; this step replaces it.'])
  })

  it('waits, in words, for what it needs', () => {
    expect(step(at({}), null).waits).toBe('Waits for identity.daoURI in federation.yaml: the address the name registers.')
    expect(step(at(null)).waits).toBe('Waits for the ENS name to be read.')
    expect(step(at({ error: 'the node answered an error' })).waits).toBe('Waits for the ENS name to be read: the node answered an error')
    expect(step(at({ resolver: null })).waits).toBe('Waits for test-dao.eth to be registered on Sepolia with a resolver: https://sepolia.app.ens.domains/test-dao.eth')
    expect(step(at({ own: false })).waits).toBe('test-dao.eth has no resolver of its own (a parent name\'s answers for it): set one in the ENS app, https://sepolia.app.ens.domains/test-dao.eth')
    expect(step(at({ takesText: false })).waits).toBe('This name\'s resolver does not take text records; set daouri in the ENS app.')
    expect(step(at({ takesText: null })).waits).toBe('Waits for the name\'s resolver to say whether it takes text records.')
    for (const r of [null, { resolver: null }, { takesText: false }] as const) expect(step(at(r)).call).toBeUndefined()
  })

  it('comes last through the planner\'s registration hook', () => {
    expect(planDeployment(c(), at({}), { registration: registrationSteps(URI) }).steps.map(x => x.id).slice(-1)).toEqual(['registration:daouri'])
  })
})
