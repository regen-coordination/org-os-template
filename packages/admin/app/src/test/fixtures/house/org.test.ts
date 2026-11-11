import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fakeAddress, ORG, ROLES, SAFE, SAFE_CHAINS } from './org.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

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

  // walk I16, D2 (spec §16.4: no real names in the distribution): the fixtures every group and the portal draw from name an
  // invented org on example.test, never a real one, its ENS name, its links or its public addresses
  it('name no real org: no ReFi DAO, no refidao.eth, no real outside link, no real public address', () => {
    const dirs = [HERE, join(HERE, '..', '..', '..', 'parts', 'groups')]
    const REAL = /refi[ -]?dao|refidao|karmahq|gitcoin\.co|68060388c7d97b4bf779a2ead46c86e5588f073f|0f52002482c3188575f2e751dc948ab2fdd39d10|cb857f1f2e36e0ee393125efa39802ece6363f80|13e71c56c5b048e9b8b6a9dbb4a4f346b5dab986/i
    const found = dirs.flatMap(d => readdirSync(d).filter(f => /\.tsx?$/.test(f) && !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'))
      .filter(f => REAL.test(readFileSync(join(d, f), 'utf8'))).map(f => f))
    expect(found).toEqual([])
  })
})
