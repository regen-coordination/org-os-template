import { describe, it, expect } from 'vitest'
import { fakeAddress, ORG, ROLES, SAFE, SAFE_CHAINS } from './org.ts'

describe('the house fixtures: the org, its roles, its Safe (spec §17)', () => {
  it('names the org and draws no mark of its own (a neutral seal, never a logo)', () => {
    expect(ORG).toEqual({ name: 'Example DAO', mark: null })
  })
  it('uses the placeholder roles with their monograms', () => {
    expect(ROLES.map(r => [r.name, r.monogram])).toEqual([
      ['Council steward', 'CS'], ['Steward A', 'SA'], ['Steward B', 'SB'], ['Ops lead', 'OL'], ['Treasury steward', 'TS'],
    ])
  })
  it('generates addresses: deterministic, well formed, distinct', () => {
    expect(fakeAddress(1)).toMatch(/^0x[0-9a-f]{40}$/i)
    expect(fakeAddress(1)).toBe(fakeAddress(1))
    expect(new Set(Array.from({ length: 50 }, (_, i) => fakeAddress(i))).size).toBe(50)
  })
  it('the public Safe on its seven chains', () => {
    expect(SAFE).toBe('0x6AFFe5105DE869fE4A27b3353468eFb51a55343a')
    expect(SAFE_CHAINS).toEqual(['eip155:1', 'eip155:10', 'eip155:42161', 'eip155:100', 'eip155:137', 'eip155:8453', 'eip155:42220'])
  })
})
