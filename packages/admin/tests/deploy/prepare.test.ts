// DAO-OS L7 Task 11, fix wave M3: the ready steps of one Safe are prepared on consecutive nonces (L2-R8). Once one of
// them cannot be prepared it waits, and so does every later ready step of that Safe: none takes the nonce the one that
// waits would have had. prepareSafeTx is replaced here by one that refuses its first call (L2 refuses a call it cannot
// hash, say); everything else is the recorded chain of fixtures/readings.ts.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../server/systems/safe.ts', async importOriginal => {
  const real = await importOriginal<typeof import('../../server/systems/safe.ts')>()
  let calls = 0
  return {
    ...real,
    prepareSafeTx: vi.fn(async (...args: Parameters<typeof real.prepareSafeTx>) => {
      calls += 1
      return calls === 1 ? { ok: false as const, error: 'Not prepared: the call could not be hashed.' } : real.prepareSafeTx(...args)
    }),
  }
})

const { stepsOf } = await import('../../server/deploy/prepare.ts')
const { STAGES, composition } = await import('./fixtures/readings.ts')

describe('stepsOf: a Safe step that cannot be prepared holds back that Safe\'s later ready steps', () => {
  it('"Create the child hats" refused: "Give the hats to their first wearers" waits too, with no nonce taken', async () => {
    const { steps, problems } = await stepsOf(composition(), STAGES.top.state)
    const hats = steps.find(s => s.id === 'tree:hats')!, wearers = steps.find(s => s.id === 'tree:wearers')!
    expect(hats).toMatchObject({ status: 'waits', waits: 'Not prepared: the call could not be hashed.' })
    expect(wearers.status).toBe('waits')
    expect(wearers.step).toBeUndefined()
    expect(wearers.waits).toBe('Waits for "Create the child hats" to be prepared first: it takes the Safe\'s next nonce.')
    expect(problems).toContain('Not prepared: the call could not be hashed.')
  })
})
