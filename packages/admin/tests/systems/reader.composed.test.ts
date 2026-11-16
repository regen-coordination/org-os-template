import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeFixtureRepo, removeFixtureRepo } from '../fixtures.ts'
import { SystemReader } from '../../server/systems/reader.ts'
import type { FetchLike } from '../../server/systems/driver.ts'
import { composedSafe, composedTree } from '../lib/compose.fixtures.ts'

let repo: string
beforeEach(() => { repo = makeFixtureRepo() })
afterEach(() => removeFixtureRepo(repo))

describe('SystemReader and a composed System', () => {
  it('a composed System reads "Composed, not deployed" with no request', async () => {
    const calls: string[] = []
    const fetch: FetchLike = async url => { calls.push(url); throw new Error('no request expected') }
    const reader = new SystemReader({ repo, fetch })
    const read = await reader.read(composedSafe())
    expect(read).toMatchObject({ ok: true, facts: { composed: true }, sections: [], open: null, note: 'Composed, not deployed' })
    expect(calls).toEqual([])
  })

  it('outcome, prepare, wearer, wearers and prepareAction refuse a composed System with no request', async () => {
    const calls: string[] = []
    const fetch: FetchLike = async url => { calls.push(url); throw new Error('no request expected') }
    const reader = new SystemReader({ repo, fetch })
    const tree = composedTree()
    const words = 'Composed, not deployed'
    expect(await reader.outcome(composedSafe(), { kind: 'safe-tx', id: 'x' } as any, '2026-10-30')).toMatchObject({ ok: false, error: words })
    expect(await reader.prepare(composedSafe(), {} as any)).toMatchObject({ ok: false, error: words })
    expect(await reader.wearer(tree, '0x00000000000000000000000000000000000000a1')).toMatchObject({ ok: false, error: words })
    expect(await reader.wearers(tree, '1')).toMatchObject({ ok: false, error: words })
    expect(await reader.prepareAction(composedSafe(), { proposal: { classes: [] }, action: 'x', params: {} }, null)).toMatchObject({ ok: false, error: words })
    expect(calls).toEqual([])
  })
})
