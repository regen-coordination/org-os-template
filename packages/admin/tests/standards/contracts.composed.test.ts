import { describe, it, expect } from 'vitest'
import { projectPublic } from '../../lib/standards/project.mjs'
import { contractsDoc } from '../../lib/standards/contracts.mjs'
import { fixtureInput } from './fixtures.ts'
import { composedSafe, composedTree } from '../lib/compose.fixtures.ts'

describe('contractsDoc and composed Systems', () => {
  it('a composed Safe and tree produce no contracts.json entry', () => {
    const input = fixtureInput()
    const before = (contractsDoc(projectPublic(input).pub).doc as any).contracts.length
    // Even with an address a stale draft might carry, a composed System is not a contract.
    ;(input.records.systems as any[]).push({ ...composedSafe(), address: '0x0000000000000000000000000000000000005afe' }, { ...composedTree(), address: '13' })
    const r = contractsDoc(projectPublic(input).pub)
    expect((r.doc as any).contracts).toHaveLength(before)
    expect(JSON.stringify(r)).not.toContain('test-dao')
  })
})
