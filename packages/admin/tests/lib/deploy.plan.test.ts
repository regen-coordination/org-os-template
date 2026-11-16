// packages/admin/tests/lib/deploy.plan.test.ts
//
// The pure deployment planner (L7 spec §8.2, L7-D4 waves): which step is ready, which waits and for what, which is done,
// on the ChainState each recorded stage of tests/deploy/fixtures/readings.ts reads as. No network.
import { describe, it, expect } from 'vitest'
import { planDeployment, predictions, topsOf, STEP_TITLES, type PlannedStep } from '../../lib/deploy/plan.mjs'
import {
  claimSignersCall, createHatsCall, createSafeCall, deployGateCall, gateInitializer, mintHatsCall, mintTopHatCall, wireGateCall,
} from '../../lib/deploy/encode.mjs'
import { DEPLOYMENTS } from '../../lib/deployments.mjs'
import { selector } from '../../lib/abi.mjs'
import { caip10, checksumAddress } from '../../lib/caip.mjs'
import { hatRef, topHatId } from '../../lib/hats.mjs'
import {
  A1, A2, A3, A9, COUNCIL, GATE, LAST_TOP, OWNERS, SAFE, SEPOLIA, STAGES, SYSTEMS, TOP, TOP_AGAIN, TREASURER, composition, recordedSystems,
} from '../deploy/fixtures/readings.ts'
import type { ChainState } from '../../server/deploy/state.ts'

const D = DEPLOYMENTS[SEPOLIA]!
const c = composition()
const plan = (s: ChainState, extra?: Parameters<typeof planDeployment>[2]) => planDeployment(c, s, extra)
const step = (steps: PlannedStep[], id: string) => {
  const found = steps.find(x => x.id === id)
  if (!found) throw new Error(`no step ${id}`)
  return found
}
const statuses = (steps: PlannedStep[]) => Object.fromEntries(steps.map(x => [x.id, x.status]))

const IDS = ['safe:create', 'tree:top', 'tree:hats', 'tree:wearers', 'gate:deploy', 'gate:wire', 'gate:claim']

describe('the steps (spec §8.2): ids, titles, signers', () => {
  it('lists the seven steps in order, with the spec\'s exact titles', () => {
    const { steps } = plan(STAGES.nothing.state)
    expect(steps.map(x => x.id)).toEqual(IDS)
    expect(steps.map(x => x.title)).toEqual([
      'Create the Safe', 'Mint the top hat to the Safe', 'Create the child hats', 'Give the hats to their first wearers',
      'Deploy the Hats Signer Gate', 'Wire the gate to the Safe', 'Register the signers',
    ])
    expect(steps.map(x => x.title)).toEqual(IDS.map(id => STEP_TITLES[id as keyof typeof STEP_TITLES]))
    expect(steps.map(x => x.system)).toEqual(['test-dao-safe', 'test-dao-roles', 'test-dao-roles', 'test-dao-roles', 'test-dao-safe', 'test-dao-safe', 'test-dao-safe'])
    const safeSigned = { kind: 'safe', system: 'test-dao-safe' }
    expect(steps.map(x => x.signer)).toEqual([
      { kind: 'account' }, { kind: 'account' }, safeSigned, safeSigned, { kind: 'account' }, safeSigned, { kind: 'account' },
    ])
  })
})

describe('waves (L7-D4)', () => {
  it('nothing deployed: only the Safe is ready; every other step waits, saying for what', () => {
    const { steps, problems } = plan(STAGES.nothing.state)
    expect(problems).toEqual([])
    expect(statuses(steps)).toEqual({
      'safe:create': 'ready', 'tree:top': 'waits', 'tree:hats': 'waits', 'tree:wearers': 'waits',
      'gate:deploy': 'waits', 'gate:wire': 'waits', 'gate:claim': 'waits',
    })
    expect(steps.filter(x => x.status === 'waits').map(x => [x.id, x.waits])).toEqual([
      ['tree:top', 'Waits for the Safe to be read back.'],
      ['tree:hats', 'Waits for the top hat to be read back.'],
      ['tree:wearers', 'Waits for the top hat to be read back.'],
      ['gate:deploy', 'Waits for the child hats to be read back.'],
      ['gate:wire', 'Waits for the Safe to be read back.'],
      ['gate:claim', 'Waits for the gate to be read back as the Safe\'s module and guard.'],
    ])
    // A step that waits is never prepared: no call, no prediction that could be signed against.
    for (const x of steps.filter(x => x.status === 'waits')) { expect(x.call).toBeUndefined(); expect(x.predicts).toEqual([]) }
    const create = step(steps, 'safe:create')
    const expected = createSafeCall(SEPOLIA, OWNERS, 2, '1')
    expect(create.call).toMatchObject({ to: expected.to, value: '0', data: expected.data, operation: 0 })
    expect(create.call!.summary).toEqual(expect.any(String))
    expect(create.predicts).toEqual([{ kind: 'address', value: caip10(SEPOLIA, SAFE) }])
  })

  it('the Safe deployed: Create the Safe is done; the top hat is ready, predicted (lastTopHatId+1) << 224', () => {
    const { steps } = plan(STAGES.safe.state)
    expect(statuses(steps)).toMatchObject({ 'safe:create': 'done', 'tree:top': 'ready', 'tree:hats': 'waits' })
    expect(step(steps, 'safe:create').call).toBeUndefined()
    const top = step(steps, 'tree:top')
    expect(top.predicts).toEqual([
      { kind: 'hat', value: hatRef(SEPOLIA, topHatId(LAST_TOP + 1)) },
      { kind: 'tree', value: `${SEPOLIA}:${LAST_TOP + 1}` },
    ])
    const expected = mintTopHatCall(SEPOLIA, SAFE, 'Test DAO', '')
    expect(top.call).toMatchObject({ to: caip10(SEPOLIA, D.hats.address), data: expected.data, operation: 0 })
    expect(step(steps, 'tree:hats').waits).toBe('Waits for the top hat to be read back.')
  })

  it('the top hat worn by the Safe: the child hats and their first wearers are ready in one wave, consecutive Safe steps', () => {
    const { steps } = plan(STAGES.top.state)
    expect(statuses(steps)).toMatchObject({ 'safe:create': 'done', 'tree:top': 'done', 'tree:hats': 'ready', 'tree:wearers': 'ready', 'gate:deploy': 'waits' })
    const ready = steps.filter(x => x.status === 'ready')
    expect(ready.map(x => x.id)).toEqual(['tree:hats', 'tree:wearers'])
    expect(steps.indexOf(ready[1]!) - steps.indexOf(ready[0]!)).toBe(1)
    expect(ready.every(x => x.signer.kind === 'safe' && x.signer.system === 'test-dao-safe')).toBe(true)
    // The admin is created before its child, whatever order the record lists them in.
    const hats = step(steps, 'tree:hats')
    expect(hats.call!.data).toBe(createHatsCall(SEPOLIA, [
      { admin: TOP, details: 'Council', maxSupply: 5, eligibility: SAFE, toggle: SAFE, mutable: true, image: '' },
      { admin: COUNCIL, details: 'Treasurer', maxSupply: 1, eligibility: SAFE, toggle: SAFE, mutable: true, image: '' },
    ]).data)
    expect(hats.predicts).toEqual([{ kind: 'hat', value: hatRef(SEPOLIA, COUNCIL) }, { kind: 'hat', value: hatRef(SEPOLIA, TREASURER) }])
    const wearers = step(steps, 'tree:wearers')
    expect(wearers.call!.data).toBe(mintHatsCall(SEPOLIA, [
      { hat: COUNCIL, wearer: A1 }, { hat: COUNCIL, wearer: A2 }, { hat: COUNCIL, wearer: A3 }, { hat: TREASURER, wearer: A1 },
    ]).data)
    expect(wearers.predicts).toEqual([
      ...[A1, A2, A3].map(a => ({ kind: 'wearer', value: caip10(SEPOLIA, a), on: hatRef(SEPOLIA, COUNCIL) })),
      { kind: 'wearer', value: caip10(SEPOLIA, A1), on: hatRef(SEPOLIA, TREASURER) },
    ])
    expect(step(steps, 'gate:deploy').waits).toBe('Waits for the child hats to be read back.')
    expect(step(steps, 'gate:wire').waits).toBe('Waits for the child hats to be read back.')
  })

  it('the hats and wearers read back: the gate is ready, its address predicted (CREATE2 through the ModuleProxyFactory)', () => {
    const { steps } = plan(STAGES.hats.state)
    expect(statuses(steps)).toMatchObject({ 'tree:hats': 'done', 'tree:wearers': 'done', 'gate:deploy': 'ready', 'gate:wire': 'waits', 'gate:claim': 'waits' })
    const gate = step(steps, 'gate:deploy')
    const init = gateInitializer({ ownerHat: TOP, signerHats: [COUNCIL], safe: SAFE, threshold: { type: 'absolute', min: 2, target: 2 }, locked: false, claimableFor: true })
    expect(gate.call!.data).toBe(deployGateCall(SEPOLIA, init, '1').data)
    expect(gate.call!.to).toBe(caip10(SEPOLIA, D.hsg.moduleProxyFactory))
    expect(gate.predicts).toEqual([{ kind: 'address', value: caip10(SEPOLIA, GATE) }])
    expect(step(steps, 'gate:wire').waits).toBe('Waits for the Hats Signer Gate to be read back.')
  })

  it('the gate read back: wiring is one Safe step, outer operation 1 to MultiSendCallOnly', () => {
    const { steps } = plan(STAGES.gate.state)
    expect(statuses(steps)).toMatchObject({ 'gate:deploy': 'done', 'gate:wire': 'ready', 'gate:claim': 'waits' })
    const wire = step(steps, 'gate:wire')
    const expected = wireGateCall(SEPOLIA, SAFE, GATE)
    expect(wire.signer).toEqual({ kind: 'safe', system: 'test-dao-safe' })
    expect(wire.call).toMatchObject({ to: caip10(SEPOLIA, D.safe.multiSendCallOnly), data: expected.data, operation: 1 })
    expect(wire.predicts).toEqual([
      { kind: 'module', value: caip10(SEPOLIA, GATE), on: caip10(SEPOLIA, SAFE) },
      { kind: 'guard', value: caip10(SEPOLIA, GATE), on: caip10(SEPOLIA, SAFE) },
    ])
  })

  it('the wiring read back: registering the signers is ready, every council wearer for the council hat', () => {
    const { steps } = plan(STAGES.wired.state)
    expect(statuses(steps)).toMatchObject({ 'gate:wire': 'done', 'gate:claim': 'ready' })
    const claim = step(steps, 'gate:claim')
    expect(claim.call!.data).toBe(claimSignersCall(SEPOLIA, GATE, [COUNCIL, COUNCIL, COUNCIL], [A1, A2, A3]).data)
    expect(claim.call!.to).toBe(caip10(SEPOLIA, GATE))
    expect(claim.predicts).toEqual([A1, A2, A3].map(a => ({ kind: 'signer', value: caip10(SEPOLIA, a), on: caip10(SEPOLIA, GATE) })))
  })

  it('all deployed: every step is done, and nothing is prepared', () => {
    const { steps, problems } = plan(STAGES.all.state)
    expect(steps.map(x => x.status)).toEqual(IDS.map(() => 'done'))
    expect(steps.every(x => x.call === undefined && x.waits === undefined)).toBe(true)
    expect(problems).toEqual([])
  })
})

describe('Review Focus 3: a step run twice, or out of order', () => {
  it('a step whose prediction is on chain is done, whatever the order', () => {
    // The gate was deployed before the child hats exist: its address is a prediction, and it is on chain.
    const { steps } = plan(STAGES.gateBeforeHats.state)
    expect(statuses(steps)).toEqual({
      'safe:create': 'done', 'tree:top': 'done', 'tree:hats': 'ready', 'tree:wearers': 'ready',
      'gate:deploy': 'done', 'gate:wire': 'waits', 'gate:claim': 'waits',
    })
    expect(step(steps, 'gate:deploy').call).toBeUndefined()
    // Wiring now would leave the Safe with a guard and no valid signer: it waits for the hats and their wearers.
    expect(step(steps, 'gate:wire').waits).toBe('Waits for the child hats to be read back.')
  })

  it('the Safe created twice (the second reverted): Create the Safe reads done and is never offered again', () => {
    for (const s of [STAGES.safe, STAGES.top, STAGES.all]) {
      const create = step(plan(s.state).steps, 'safe:create')
      expect(create.status).toBe('done')
      expect(create.call).toBeUndefined()
    }
  })

  it('a top hat minted to the predicted Safe before the Safe exists is done; the Safe-signed steps wait for the Safe', () => {
    const s = structuredClone(STAGES.top.state)
    s.safes['test-dao-safe'] = { ...s.safes['test-dao-safe']!, code: false, read: null }
    const { steps } = plan(s)
    expect(statuses(steps)).toMatchObject({ 'safe:create': 'ready', 'tree:top': 'done', 'tree:hats': 'waits', 'tree:wearers': 'waits' })
    expect(step(steps, 'tree:hats').waits).toBe('Waits for the Safe to be read back.')
  })

  it('a wearer already given its hat is left out of the call; the step is done when all wear theirs', () => {
    const s = structuredClone(STAGES.hats.state)
    s.trees['test-dao-roles']!.children.council!.wearers[OWNERS[2]!] = false
    const wearers = step(plan(s).steps, 'tree:wearers')
    expect(wearers.status).toBe('ready')
    expect(wearers.call!.data).toBe(mintHatsCall(SEPOLIA, [{ hat: COUNCIL, wearer: A3 }]).data)
    expect(step(plan(s).steps, 'gate:deploy').waits).toBe('Waits for the first wearers to be read back.')
  })
})

describe('the top hat sent twice, or lost from sight', () => {
  it('step 2 sent again after the hats: the plan stays on the first tree, its hats done, and says the second', () => {
    const { steps } = plan(STAGES.twice.state)
    expect(statuses(steps)).toMatchObject({ 'tree:top': 'done', 'tree:hats': 'done', 'tree:wearers': 'done', 'gate:deploy': 'ready' })
    expect(step(steps, 'tree:top').differs).toEqual([
      'the Safe also wears the top hat at 0x00000125 with the same details; the plan stays on 0x00000124 (it has the child hats)',
    ])
    expect(step(steps, 'tree:top').predicts[0]).toEqual({ kind: 'hat', value: hatRef(SEPOLIA, TOP) })
    expect(step(steps, 'gate:deploy').predicts).toEqual([{ kind: 'address', value: caip10(SEPOLIA, GATE) }])
    expect(TOP_AGAIN).not.toBe(TOP)
  })

  // Replaced on purpose in fix round 2 (ruling): "a Safe whose nonce moved and whose top hat is beyond the search: a
  // mismatch, never minted again". A Safe used outside the plan (a transfer before step 2) has a nonce too; the recorded
  // top hat id is the definitive signal, and without it the step is ready with a warning.
  it('nothing recorded, none found, and the Safe has sent transactions: ready at the next id, with the warning', () => {
    const { steps } = plan(STAGES.lostTop.state)
    const top = step(steps, 'tree:top')
    expect(top.status).toBe('ready')
    expect(top.call).toBeDefined()
    expect(top.differs).toEqual(['The Safe has sent 2 transactions. If a top hat was already minted for it, read back first; preparing this again makes a second tree.'])
  })

  it('a recorded top hat worn by the Safe is done, its tree planned on it', () => {
    const s = structuredClone(STAGES.top.state)
    s.trees['test-dao-roles']!.recordedTop = { id: TOP, worn: true, details: 'Test DAO' }
    s.trees['test-dao-roles']!.topHatsSearched = 0
    const { steps } = planDeployment(composition(recordedSystems(TOP)), s)
    expect(statuses(steps)).toMatchObject({ 'tree:top': 'done', 'tree:hats': 'ready', 'tree:wearers': 'ready' })
    expect(step(steps, 'tree:top').differs).toBeUndefined()
  })

  it('a recorded top hat the Safe does not wear, or with other details, is a mismatch naming it; nothing is prepared', () => {
    const s = structuredClone(STAGES.frontRun.state)
    s.trees['test-dao-roles']!.recordedTop = { id: TOP, worn: false, details: 'Someone else' }
    s.trees['test-dao-roles']!.topHatsSearched = 0
    const { steps } = planDeployment(composition(recordedSystems(TOP)), s)
    const top = step(steps, 'tree:top')
    expect(top.status).toBe('mismatch')
    expect(top.differs).toEqual([
      'the recorded top hat 0x00000124 is not worn by the Safe',
      'the recorded top hat 0x00000124 reads "Someone else", not "Test DAO"',
    ])
    expect(top.predicts).toEqual([{ kind: 'hat', value: hatRef(SEPOLIA, TOP) }])
    expect(steps.filter(x => x.call).map(x => x.id)).toEqual([])
  })

  it('the warning is not given to a Safe that has sent nothing', () => {
    expect(step(plan(STAGES.safe.state).steps, 'tree:top').differs).toBeUndefined()
  })
})

describe('a front-run top hat (orchestrator ruling; the read-back half is Task 12\'s)', () => {
  it('someone else took the predicted id: the Safe wears no top hat, and the top hat is ready again at the next id', () => {
    const { steps } = plan(STAGES.frontRun.state)
    const top = step(steps, 'tree:top')
    expect(top.status).toBe('ready')
    expect(top.predicts[0]).toEqual({ kind: 'hat', value: hatRef(SEPOLIA, topHatId(LAST_TOP + 2)) })
    expect(statuses(steps)).toMatchObject({ 'tree:hats': 'waits', 'tree:wearers': 'waits', 'gate:deploy': 'waits' })
  })

  it('a top hat at the predicted id that the Safe does not wear is a mismatch, and nothing after it is prepared', () => {
    const { steps } = plan(STAGES.taken.state)
    const top = step(steps, 'tree:top')
    expect(top.status).toBe('mismatch')
    expect(top.differs).toEqual(['the top hat at 0x00000124 is worn by another account, not the Safe'])
    expect(top.call).toBeUndefined()
    expect(steps.filter(x => x.call).map(x => x.id)).toEqual([])
  })

  it('names the wearer when the state knows it', () => {
    const s = structuredClone(STAGES.taken.state)
    s.trees['test-dao-roles']!.predictedTopTaken = { wearer: caip10(SEPOLIA, A9) }
    expect(step(plan(s).steps, 'tree:top').differs).toEqual([`the top hat at 0x00000124 is worn by ${checksumAddress(A9)}, not the Safe`])
  })
})

describe('mismatches', () => {
  it('hats already created under the top hat by someone else: the child hats are a mismatch, the wearers wait', () => {
    const s = structuredClone(STAGES.top.state)
    s.trees['test-dao-roles']!.lastHatId = 2
    const { steps } = plan(s)
    expect(step(steps, 'tree:hats').status).toBe('mismatch')
    expect(step(steps, 'tree:hats').differs).toEqual(['the top hat at 0x00000124 already has 2 child hats made outside this deployment, so the composed hats would not get these ids'])
    expect(step(steps, 'tree:wearers')).toMatchObject({ status: 'waits', waits: 'Waits for the child hats to be read back.' })
  })

  it('a child hat with other details is a mismatch', () => {
    const s = structuredClone(STAGES.hats.state)
    s.trees['test-dao-roles']!.children.council!.details = 'Board'
    expect(step(plan(s).steps, 'tree:hats').differs).toEqual(['the hat at 0x00000124.0001 reads "Board" with room for 5, not "Council" with room for 5'])
  })

  it('half-wired (the gate is the module, not the guard): the wiring is a mismatch, not offered again', () => {
    const { steps } = plan(STAGES.halfWired.state)
    const wire = step(steps, 'gate:wire')
    expect(wire.status).toBe('mismatch')
    expect(wire.differs).toEqual(['the gate is the Safe\'s module but not its guard'])
    expect(wire.call).toBeUndefined()
  })
})

describe('the founding owners after wiring (spec §3, answered from hats-zodiac v2.0.0)', () => {
  // https://github.com/Hats-Protocol/hats-zodiac/blob/v2.0.0/src/HatsSignerGate.sol (there is no HatsSignerGateBase.sol
  // at v2.0.0; it was v1's):
  //   L259  claimSignersFor adds a signer as a Safe owner only `if (!s.isOwner(signer))`: founding owners who wear a
  //         signer hat are registered, not added twice and not swapped out.
  //   L278–280 the Safe's threshold is then set from the owner count (`_getNewThreshold(newNumOwners)`).
  //   L484  checkTransaction requires `threshold == _getRequiredValidSignatures(owners.length)` (ThresholdTooLow).
  //   L682  _countValidSignatures counts a signature only `if (isValidSigner(currentOwner))`: an owner who wears no
  //         registered signer hat signs for nothing.
  //   L285–286 removeSigner(address) is public and refuses only a valid signer: anyone can remove such an owner.
  // So no step removes the founding owners: those who wear the gate's hats become its signers by "Register the signers",
  // and one who does not keeps a seat that counts for nothing, which anyone may clear with removeSigner.
  const REMOVE_OWNER = selector('removeOwner(address,address,uint256)')
  const SWAP_OWNER = selector('swapOwner(address,address,address)')

  it('no step is needed: the plan has exactly the seven steps, and no call removes or swaps an owner', () => {
    for (const s of Object.values(STAGES)) {
      const { steps } = plan(s.state)
      expect(steps.map(x => x.id)).toEqual(IDS)
      for (const x of steps) {
        if (!x.call) continue
        expect(x.call.data.includes(REMOVE_OWNER.slice(2))).toBe(false)
        expect(x.call.data.includes(SWAP_OWNER.slice(2))).toBe(false)
      }
    }
  })

  it('a founding owner who wears none of the gate\'s hats is said, as a problem, not removed by a step', () => {
    const systems = structuredClone(SYSTEMS)
    const tree = systems[1] as { hats: { key: string; wearers: string[] }[] }
    tree.hats.find(h => h.key === 'council')!.wearers = [OWNERS[0]!, OWNERS[1]!]
    const { steps, problems } = planDeployment(composition(systems), STAGES.nothing.state)
    expect(steps.map(x => x.id)).toEqual(IDS)
    expect(problems).toEqual([
      `${checksumAddress(A3)} owns test-dao-safe but wears none of its gate's signer hats: from the wiring on its signature counts for nothing and anyone may remove it (HatsSignerGate.removeSigner); "Register the signers" does not add it back.`,
    ])
  })

  it('the wiring says the window before the claim: every founding owner is unregistered, removable, and the Safe cannot sign (fix M1)', () => {
    const wire = step(plan(STAGES.gate.state).steps, 'gate:wire')
    expect(wire.status).toBe('ready')
    expect(wire.differs).toEqual([
      'Between this step and "Register the signers", every founding owner is unregistered: anyone may remove any of them (HatsSignerGate.removeSigner) until the claim adds them back, and the Safe cannot sign in that window.',
    ])
  })
})

describe('fold-ins (review round 1)', () => {
  it('code at the predicted Safe address that is not a readable Safe: Create the Safe is a mismatch', () => {
    const s = structuredClone(STAGES.safe.state)
    s.safes['test-dao-safe']!.read = null
    const create = step(plan(s).steps, 'safe:create')
    expect(create).toMatchObject({ status: 'mismatch', differs: ['the predicted address holds a contract that is not a Safe the Hub can read'] })
    expect(create.call).toBeUndefined()
  })

  it('a step not planned is not done: with no first wearers composed, the gate waits for them', () => {
    const systems = structuredClone(SYSTEMS)
    for (const h of (systems[1] as { hats: { wearers: string[] }[] }).hats) h.wearers = []
    const s = structuredClone(STAGES.hats.state)
    const { steps } = planDeployment(composition(systems), s)
    expect(steps.map(x => x.id)).not.toContain('tree:wearers')
    expect(step(steps, 'gate:deploy')).toMatchObject({ status: 'waits', waits: 'Waits for the first wearers to be read back.' })
  })
})

describe('the gate\'s owner hat (L7 T10 fix I4)', () => {
  const NOT_WORN = 'The Safe does not wear the gate\'s owner hat.'
  it('not read (a state without it): Deploy the gate waits, nothing is prepared on it', () => {
    const s = structuredClone(STAGES.hats.state) as ChainState
    delete (s.gates['test-dao-safe'] as Partial<ChainState['gates'][string]>).ownerHatWorn
    expect(step(plan(s).steps, 'gate:deploy')).toMatchObject({ status: 'waits', waits: 'Waits for the gate\'s owner hat to be read as the Safe\'s.' })
  })
  it('read false with the gate deployed and the owner tree done: a mismatch, and the wiring is not ready', () => {
    const s = structuredClone(STAGES.gate.state)
    s.gates['test-dao-safe']!.ownerHatWorn = false
    const { steps } = plan(s)
    expect(step(steps, 'gate:deploy')).toMatchObject({ status: 'mismatch', differs: [NOT_WORN] })
    expect(step(steps, 'gate:wire')).toMatchObject({ status: 'waits', waits: 'Waits for the Hats Signer Gate to be read back.' })
  })
  it('read true: the stages plan as before', () => {
    expect(step(plan(STAGES.hats.state).steps, 'gate:deploy').status).toBe('ready')
    expect(step(plan(STAGES.gate.state).steps, 'gate:deploy').status).toBe('done')
  })
})

describe('a reading made for another composition (L7 T10 fix I2)', () => {
  const READ_AGAIN = 'The reading was made for another composition: read again.'
  const doneOrReady = (steps: PlannedStep[], system: string) => steps.filter(x => x.system === system && (x.status === 'done' || x.status === 'ready')).map(x => x.id)

  it('the gate composed otherwise since the read (its threshold): nothing on the gate is done or ready, and the plan says to read again', () => {
    const systems = structuredClone(SYSTEMS)
    ;(systems[0] as { signer_gate: { threshold: { min: number; target: number } } }).signer_gate.threshold = { type: 'absolute', min: 3, target: 3 } as never
    const { steps, problems } = planDeployment(composition(systems), STAGES.all.state)
    expect(steps.filter(x => x.id.startsWith('gate:') && (x.status === 'done' || x.status === 'ready')).map(x => x.id)).toEqual([])
    expect(steps.filter(x => x.id.startsWith('gate:')).every(x => x.status === 'waits' && x.waits === READ_AGAIN)).toBe(true)
    expect(problems).toContain(READ_AGAIN)
    // The tree and the Safe were read where this composition puts them: their steps stand.
    expect(doneOrReady(steps, 'test-dao-roles')).toEqual(['tree:top', 'tree:hats', 'tree:wearers'])
  })

  it('the Safe composed otherwise since the read (its salt): nothing on it, its tree or its gate is done or ready', () => {
    const systems = structuredClone(SYSTEMS)
    ;(systems[0] as { deployment: { salt: string } }).deployment.salt = '2'
    const { steps, problems } = planDeployment(composition(systems), STAGES.all.state)
    expect(steps.filter(x => x.status === 'done' || x.status === 'ready').map(x => x.id)).toEqual([])
    expect(problems).toContain(READ_AGAIN)
  })

  it('a child hat composed otherwise (one more hat under the top): the tree and its gate are not done', () => {
    const systems = structuredClone(SYSTEMS)
    ;(systems[1] as { hats: unknown[] }).hats.unshift({ key: 'auditor', details: 'Auditor', admin: 'top', max_supply: 1, mutable: true, wearers: [], hat: null })
    const { steps, problems } = planDeployment(composition(systems), STAGES.all.state)
    expect(doneOrReady(steps, 'test-dao-roles')).toEqual([])
    expect(steps.filter(x => x.id.startsWith('gate:') && (x.status === 'done' || x.status === 'ready'))).toEqual([])
    expect(problems).toContain(READ_AGAIN)
  })

  it('a reading made for this composition says nothing of the kind', () => {
    for (const s of Object.values(STAGES)) expect(plan(s.state).problems).not.toContain(READ_AGAIN)
  })
})

describe('the Safe\'s modules and guard not known (L7 T10 fix I1)', () => {
  it('modules or guard not read is never "none": the wiring and the claim wait, nothing is prepared', () => {
    for (const unknown of [['modules', 'guard'], ['modules'], ['guard']] as const) {
      const s = structuredClone(STAGES.gate.state)
      const read = s.safes['test-dao-safe']!.read!
      s.safes['test-dao-safe']!.read = { ...read, ...(unknown.includes('modules' as never) ? { modules: null } : {}), ...(unknown.includes('guard' as never) ? { guard: null } : {}), unknown: [...unknown] }
      const { steps } = plan(s)
      expect(step(steps, 'gate:wire')).toMatchObject({ status: 'waits', waits: 'Waits for the Safe\'s modules and guard to be read.' })
      expect(step(steps, 'gate:claim').status).toBe('waits')
      expect(steps.filter(x => x.status === 'ready').map(x => x.id)).toEqual([])
    }
  })
})

describe('hooks, chains and problems', () => {
  it('the space and registration hooks are called only when given, and their steps come last', () => {
    expect(plan(STAGES.all.state).steps).toHaveLength(7)
    const seen: unknown[] = []
    const extra: PlannedStep = { id: 'space:settings', system: 'test-dao-votes', title: 'The Snapshot space', status: 'waits', waits: 'later', signer: { kind: 'account' }, predicts: [] }
    const reg: PlannedStep = { ...extra, id: 'registration:daouri', system: 'test-dao-registration', title: 'Register the daoURI' }
    const { steps } = plan(STAGES.all.state, {
      space: (cc, ss) => { seen.push(['space', cc, ss]); return [extra] },
      registration: (cc, ss) => { seen.push(['registration', cc, ss]); return [reg] },
    })
    expect(steps.map(x => x.id).slice(-2)).toEqual(['space:settings', 'registration:daouri'])
    expect(seen).toEqual([['space', c, STAGES.all.state], ['registration', c, STAGES.all.state]])
  })

  it('a composition on another chain is refused with the Sepolia sentence, and nothing is planned', () => {
    const systems = structuredClone(SYSTEMS).map(s => ({ ...s, chain: 'eip155:1' }))
    const { steps, problems } = planDeployment(composition(systems), STAGES.nothing.state)
    expect(steps).toEqual([])
    expect(problems).toEqual(['Deploying is built for Sepolia (eip155:11155111) only.'])
  })

  it('a gate that is not claimable for others is said: Register the signers would revert', () => {
    const systems = structuredClone(SYSTEMS)
    ;(systems[0] as { signer_gate: { claimable_for: boolean } }).signer_gate.claimable_for = false
    const c2 = composition(systems)
    // The state as read for this composition: its gate is predicted from claimable_for too (fix I2).
    const s = structuredClone(STAGES.nothing.state)
    s.gates['test-dao-safe']!.predicted = predictions(c2, { proxyCreationCode: s.proxyCreationCode, tops: topsOf(c2, s.trees) }).gates['test-dao-safe']!.predicted
    const { problems } = planDeployment(c2, s)
    expect(problems).toEqual(['the signer gate of test-dao-safe is not claimable for others (claimable_for: false), so "Register the signers" would revert; set claimable_for: true.'])
  })
})

describe('an owner or wearer the planner cannot read (L7 Tasks 19/17 review, M1)', () => {
  it('plans nothing and says why, never throwing (no 500 from GET /api/deploy)', () => {
    for (const bad of [`cosmos:cosmoshub-4:0x${'ab'.repeat(20)}`, `eip155:1:0x${'ab'.repeat(20)}`]) {
      const x = composition()
      x.safes[0]!.owners = [bad, ...x.safes[0]!.owners.slice(1)]
      x.trees[0]!.hats[0]!.wearers = [bad]
      let out: ReturnType<typeof planDeployment> | undefined
      expect(() => { out = planDeployment(x, STAGES.nothing.state) }, bad).not.toThrow()
      expect(out!.steps, bad).toEqual([])
      expect(out!.problems, bad).toContain(`test-dao-safe: owner "${bad}" is neither a 0x address nor an account on ${SEPOLIA} (${SEPOLIA}:0x…).`)
    }
  })
})

