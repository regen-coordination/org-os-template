import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
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
  // invented org on example.test, never a real one, its ENS name, its links or its public addresses. The guard holds
  // no real value (R2 review I-1): each candidate token of a fixture file is hashed and compared with KEPT_OUT.
  it('the guard can fail: a listed token is found as a word, an address, two words joined or a host; others are not', () => {
    const listed = ['examplecorp', 'b'.repeat(40), 'zedhost'].map(digest)
    expect(keptOutIn('By ExampleCorp.', listed)).toEqual(['examplecorp'])
    expect(keptOutIn('"Example Corp" and example-corp.eth', listed)).toEqual(['examplecorp'])
    expect(keptOutIn(`safe: '0x${'B'.repeat(40)}'`, listed)).toEqual(['b'.repeat(40)])
    expect(keptOutIn('https://grants.zed.host/x', listed)).toEqual(['zedhost'])
    expect(keptOutIn('An example corporation at examplecorps.test', listed)).toEqual([])
  })
  it('name no real org: no real org name, ENS name, outside link or public address (by digest)', () => {
    const dirs = [HERE, join(HERE, '..', '..', '..', 'parts', 'groups')]
    const files = dirs.flatMap(d => readdirSync(d).filter(f => /\.tsx?$/.test(f) && !f.endsWith('.test.ts') && !f.endsWith('.test.tsx')).map(f => join(d, f)))
    expect(files.length).toBeGreaterThan(10)
    const found = files.filter(f => keptOutIn(readFileSync(f, 'utf8')).length > 0).map(f => f.slice(HERE.length))
    expect(found).toEqual([])
  })
})

/** SHA-256 (hex) of the lowercased tokens no house fixture may hold: two real orgs' names, a real outside link's host
 *  (both endings) and four real public addresses (their 40 hex digits). Only digests are kept, so the tree never holds
 *  the values themselves. */
const KEPT_OUT: readonly string[] = [
  '2a7e451a13b35cbaab3ba4e613411bb7a1068601b8c328d81802a0a8c962aa27',
  '8836ded6d5b0a1f9f2c782b8cd752dfd2038e5ab529f94ccbe0441bb5f4fb97f',
  'd87b0d85c4c57b93e8d47e22702f4b15e18124fa2b3c74e111a879dac53e89ea',
  '0201c1179f766a75dea7d4b8ae7bf0880d1613865a9082a5d97c063602030b7a',
  '6713e65b2109c6a7ac6751dde9028f8f0f9c4a9f862a8984b80bfa9f0449b847',
  '7888b1573262e475e15a1bb0f4738259eae2f31d7860e01bccd89aab61afddea',
  'fffeec7eae09746e8aadb1d52926e589866c6dbf89e06de1d2f964d2d93fcea3',
  'fd0cef29f7ca5b152ebcb306cf398d383cd6176e3d981fda81857dfc796051d8',
]

function digest(token: string): string { return createHash('sha256').update(token).digest('hex') }

/** The candidate tokens of a text, lowercased: each word (letters and digits), each word without a leading 0x (an
 *  address's 40 hex digits), and each pair of adjacent words joined (so "Two Words", "two-words" and "two.words" read
 *  as "twowords", which also covers a host's last two labels). */
function tokensOf(text: string): Set<string> {
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  const out = new Set<string>()
  words.forEach((w, i) => {
    out.add(w)
    if (/^0x[0-9a-f]{40}$/.test(w)) out.add(w.slice(2))
    if (i > 0) out.add(words[i - 1] + w)
  })
  return out
}

/** The tokens of `text` whose digest is listed, in the order found. */
function keptOutIn(text: string, listed: readonly string[] = KEPT_OUT): string[] {
  const set = new Set(listed)
  return [...tokensOf(text)].filter(t => set.has(digest(t)))
}
