import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
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
  // no real value (R2 review I-1): only each listed token's length and digest. Every substring of a listed length, within
  // each word, each pair of adjacent words joined and each hex run, is hashed and compared (R2b I-5), so a name inside a
  // longer identifier, a name with a year, and an address inside padded calldata or a 32-byte topic are all found.
  it('the guard can fail: a listed token is found inside a word, a joined pair, a host, an address, calldata and a topic', () => {
    // Synthetic stand-ins, never the real values: a 7-letter name, a host's joined labels, a placeholder address.
    const ADDR = `${'0'.repeat(36)}0b1d`
    const listed = listedOf(['zedcorp', 'zedhostcom', ADDR])
    expect(keptOutIn('By ZedCorp.', listed)).toEqual(['zedcorp'])
    expect(keptOutIn('"Zed Corp" and zed-corp.eth', listed)).toEqual(['zedcorp'])
    expect(keptOutIn('const zedCorpSafe = 1', listed)).toEqual(['zedcorp'])
    expect(keptOutIn('round: zedcorp2025', listed)).toEqual(['zedcorp'])
    expect(keptOutIn('https://grants.zedhost.com/x', listed)).toEqual(['zedhostcom'])
    expect(keptOutIn(`safe: '0x${ADDR.toUpperCase()}'`, listed)).toEqual([ADDR])
    const calldata = `0xa9059cbb${'0'.repeat(24)}${ADDR}${'0'.repeat(63)}1`
    expect(keptOutIn(`data: "${calldata}"`, listed)).toEqual([ADDR])
    expect(keptOutIn(`topics: ['0x${'0'.repeat(24)}${ADDR}']`, listed)).toEqual([ADDR])
    expect(keptOutIn(`A zed company at zedcorx.test, zed-host.co, 0x${'0'.repeat(36)}0b1e`, listed)).toEqual([])
  })
  it('name no real org: no real org name, ENS name, outside link or public address (by digest)', () => {
    const FIXTURES = join(HERE, '..')
    const dirs = [FIXTURES, join(HERE, '..', '..', '..', 'parts', 'groups')]
    const files = dirs.flatMap(d => filesUnder(d))
    expect(files.filter(f => f.startsWith(HERE)).length).toBeGreaterThanOrEqual(10)
    expect(files.length).toBeGreaterThan(20)
    const found = files.filter(f => keptOutIn(readFileSync(f, 'utf8')).length > 0).map(f => relative(FIXTURES, f))
    expect(found).toEqual([])
  })
  // R3 scan 6: the same guard over every fixture folder 0.7 adds outside the app, in every text form they hold (Markdown,
  // YAML, scripts, CSV, HTML as well as .ts and .json): the server's, the import's, the deploy's, the shelf's, kms's and the
  // federation map's, and the root's.
  it('name no real org in the fixture folders 0.7 adds outside the app either (by digest)', () => {
    const ADMIN = join(HERE, '..', '..', '..', '..', '..')
    const ROOT = join(ADMIN, '..', '..')
    const roots = [
      join(ADMIN, 'tests', 'fixtures'), join(ADMIN, 'tests', 'deploy', 'fixtures'), join(ADMIN, 'tests', 'library', 'fixtures'),
      join(ADMIN, 'tests', 'lib', 'compose.fixtures.ts'), join(ADMIN, 'tests', 'server', 'knowledge', 'fixture.ts'),
      join(ROOT, 'packages', 'org-os-kms', 'test', 'fixtures'), join(ROOT, 'packages', 'org-os-federation-map', 'test', 'fixtures'),
      join(ROOT, 'tests', 'scripts', 'fixtures'),
    ]
    const files = roots.flatMap(r => (statSync(r).isDirectory() ? textFilesUnder(r) : [r]))
    expect(files.length).toBeGreaterThan(50)
    const found = files.filter(f => keptOutIn(readFileSync(f, 'utf8')).length > 0).map(f => relative(ROOT, f))
    expect(found).toEqual([])
  })
})

/** Every text file under `dir` a fixture is written in, its subfolders too. */
function textFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const path = join(dir, e.name)
    if (e.isDirectory()) return textFilesUnder(path)
    return /\.(tsx?|mts|mjs|js|json|md|ya?ml|csv|html|txt)$/.test(e.name) ? [path] : []
  })
}

/** The fixture sources under `dir`, its subfolders too: .ts, .tsx and .json, the tests themselves left out. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const path = join(dir, e.name)
    if (e.isDirectory()) return filesUnder(path)
    return /\.(tsx?|json)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [path] : []
  })
}

/** The lowercased tokens no house fixture may hold, as [length, SHA-256 hex]: two real orgs' names, a real outside link's
 *  host (its labels joined, both endings) and four real public addresses (their 40 hex digits). Only lengths and digests
 *  are kept, so the tree never holds the values themselves. */
const KEPT_OUT: readonly (readonly [number, string])[] = [
  [7, '2a7e451a13b35cbaab3ba4e613411bb7a1068601b8c328d81802a0a8c962aa27'],
  [7, '8836ded6d5b0a1f9f2c782b8cd752dfd2038e5ab529f94ccbe0441bb5f4fb97f'],
  [9, 'd87b0d85c4c57b93e8d47e22702f4b15e18124fa2b3c74e111a879dac53e89ea'],
  [10, '0201c1179f766a75dea7d4b8ae7bf0880d1613865a9082a5d97c063602030b7a'],
  [40, '6713e65b2109c6a7ac6751dde9028f8f0f9c4a9f862a8984b80bfa9f0449b847'],
  [40, '7888b1573262e475e15a1bb0f4738259eae2f31d7860e01bccd89aab61afddea'],
  [40, 'fffeec7eae09746e8aadb1d52926e589866c6dbf89e06de1d2f964d2d93fcea3'],
  [40, 'fd0cef29f7ca5b152ebcb306cf398d383cd6176e3d981fda81857dfc796051d8'],
]

function digest(token: string): string { return createHash('sha256').update(token).digest('hex') }

/** The [length, digest] pairs of synthetic tokens (the self-test's stand-ins). */
function listedOf(tokens: readonly string[]): (readonly [number, string])[] { return tokens.map(t => [t.length, digest(t)] as const) }

/** The strings a text is searched in, lowercased: each word (letters and digits), each pair of adjacent words joined (so
 *  "Two Words", "two-words" and "two.words" read as "twowords", which also covers a host's last two labels), and each hex
 *  run (an address in calldata or a topic). */
function haystacksOf(text: string): Set<string> {
  const lower = text.toLowerCase()
  const words = lower.split(/[^a-z0-9]+/).filter(Boolean)
  const out = new Set<string>(lower.match(/[0-9a-f]{40,}/g) ?? [])
  words.forEach((w, i) => { out.add(w); if (i > 0) out.add(words[i - 1] + w) })
  return out
}

/** The listed tokens found in `text`, in the order found: every substring of a listed length of each haystack, hashed. */
function keptOutIn(text: string, listed: readonly (readonly [number, string])[] = KEPT_OUT): string[] {
  const byLength = new Map<number, Set<string>>()
  for (const [n, d] of listed) byLength.set(n, (byLength.get(n) ?? new Set()).add(d))
  const found = new Set<string>()
  for (const hay of haystacksOf(text)) {
    for (const [n, digests] of byLength) {
      for (let i = 0; i + n <= hay.length; i++) {
        const sub = hay.slice(i, i + n)
        if (!found.has(sub) && digests.has(digest(sub))) found.add(sub)
      }
    }
  }
  return [...found]
}
