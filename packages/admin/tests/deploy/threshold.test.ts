// L7 Task 18 review M-4: a ready Safe step carries the threshold its card shows: the threshold read from the Safe on
// chain (the composed one only while the Safe is not read). Recorded chain only (fixtures/readings.ts); no network.
import { describe, it, expect } from 'vitest'
import { stepsOf } from '../../server/deploy/prepare.ts'
import { STAGES, composition } from './fixtures/readings.ts'

const SAFE_ID = 'test-dao-safe'

describe('a ready Safe step carries the Safe\'s threshold (M-4)', () => {
  it('the threshold read on chain, on every ready step that Safe signs', async () => {
    const { steps } = await stepsOf(composition(), STAGES.top.state)
    const signed = steps.filter(s => s.status === 'ready' && s.signer.kind === 'safe')
    expect(signed.map(s => s.id)).toEqual(['tree:hats', 'tree:wearers'])
    for (const s of signed) expect(s.threshold).toBe(2)
  })

  it('the read threshold, not the composed one, when they differ', async () => {
    const state = structuredClone(STAGES.top.state)
    state.safes[SAFE_ID]!.read!.threshold = 3
    const { steps } = await stepsOf(composition(), state)
    expect(steps.filter(s => s.status === 'ready' && s.signer.kind === 'safe').map(s => s.threshold)).toEqual([3, 3])
  })

  it('an account step carries none', async () => {
    const { steps } = await stepsOf(composition(), STAGES.top.state)
    expect(steps.filter(s => s.signer.kind === 'account').map(s => s.threshold)).toEqual(steps.filter(s => s.signer.kind === 'account').map(() => undefined))
  })
})
