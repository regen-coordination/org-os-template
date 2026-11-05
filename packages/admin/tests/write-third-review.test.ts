// What the third review of the write path found (2026-10-11), N6 and N8, each
// held by a test that failed on the code it reviewed. The inputs are the
// reviewer's. N7 is a fault of the form and is held in EntityForm.test.tsx.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isMap, isScalar, isSeq, parseDocument } from 'yaml'
import { makeFixtureRepo, removeFixtureRepo } from './fixtures.ts'
import { createApp } from '../server/app.ts'
import { readRegistry, updateEntity, type Entity } from '../server/registry.ts'
import { exactNumber, unintendedChange } from '../server/verify.ts'

let repo: string
let app: ReturnType<typeof createApp>
beforeEach(() => { repo = makeFixtureRepo(); app = createApp(repo) })
afterEach(() => removeFixtureRepo(repo))

const json = (method: string, body: unknown) => ({
  method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
})
const git = (cmd: string) => execSync(`git ${cmd}`, { cwd: repo, stdio: 'pipe' }).toString()
const commits = () => Number(git('rev-list --count HEAD').trim())
const file = (name: string) => join(repo, 'data', `${name}.yaml`)
const read = (name: string) => readFileSync(file(name), 'utf8')
/** Put a registry file in place as committed work, so the save starts from a clean file. */
const seed = (name: string, text: string) => {
  writeFileSync(file(name), text)
  git('add -A'); git('commit -qm seed')
}
const put = (name: string, id: string, body: unknown) => app.request(`/api/registries/${name}/${id}`, json('PUT', body))
const NUMBER_ADVICE = /number with more digits/i

/**
 * A number as written, as a fraction in lowest terms. The tests' own reading
 * of a spelling, written apart from `exactNumber` in the server on purpose:
 * a check compared with itself cannot fail.
 */
function fraction(spelling: string): string {
  let s = spelling.trim().toLowerCase()
  const negative = s.startsWith('-')
  if (/^[-+]/.test(s)) s = s.slice(1)
  let top: bigint; let bottom = 1n
  if (/^0[xo]/.test(s)) top = BigInt(s)
  else {
    const [mantissa = '', exponent = '0'] = s.split('e')
    const [whole = '', decimals = ''] = mantissa.split('.')
    top = BigInt((whole || '0') + decimals)
    bottom = 10n ** BigInt(decimals.length)
    if (Number(exponent) >= 0) top *= 10n ** BigInt(Number(exponent)); else bottom *= 10n ** BigInt(-Number(exponent))
  }
  const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b))
  const g = gcd(top, bottom)
  return `${negative && top !== 0n ? '-' : ''}${top / g}/${bottom / g}`
}

/** The numbers written under a node of a parsed file, as they are spelled there. */
function spellings(node: unknown, found: string[] = []): string[] {
  if (isMap(node)) for (const pair of node.items) spellings(pair.value, found)
  else if (isSeq(node)) for (const item of node.items) spellings(item, found)
  else if (isScalar(node) && (typeof node.value === 'number' || typeof node.value === 'bigint')) found.push(node.source ?? String(node.value))
  return found
}

// N6. The check added for N1 asked whether a number about to be written has
// "other digits" than the one the field held, and compared two texts to find
// out. It had one form for an integer (`10`) and another for a number with a
// point or an exponent (`1e1`), so `10.0` in the file and `10` in the request
// counted as different numbers, and a save that changed something else in the
// same list was refused, with the advice about long numbers.
describe('N6: a number spelled 10.0, 1.0 or 1e3 in a replaced list or object does not refuse the save', () => {
  const inputs: [string, string, unknown][] = [
    ['[10.0, 2] with one element changed', 'amounts: [10.0, 2]', [10, 3]],
    ['[10.0, 2] with an element added', 'amounts: [10.0, 2]', [10, 2, 5]],
    ['[1e3, 2]', 'amounts: [1e3, 2]', [1000, 3]],
    ['{eur: 10.0}', 'amounts: {eur: 10.0}', { eur: 10, usd: 3 }],
    ['[1.0, 1]', 'amounts: [1.0, 1]', [1, 1, 2]],
    ['[41.0, 2.0], a pair of coordinates', 'amounts: [41.0, 2.0]', [41, 2.5]],
    ['[0.50]', 'amounts: [0.50]', [0.5, 1]],
    ['[0x10]', 'amounts: [0x10]', [16, 1]],
  ]
  for (const [what, line, sent] of inputs) {
    it(`${what}: 200, one commit, and the file reads as the request`, async () => {
      seed('projects', `projects:\n  - id: a\n    name: A\n    ${line}\n`)
      const before = commits()
      const res = await put('projects', 'a', { id: 'a', name: 'A', amounts: sent })
      expect(res.status, JSON.stringify(await res.clone().json())).toBe(200)
      expect(readRegistry(repo, 'projects').entries![0]).toEqual({ id: 'a', name: 'A', amounts: sent })
      expect(commits()).toBe(before + 1)
    })
  }

  describe('the check itself', () => {
    const src = 'projects:\n  - id: a\n    amounts: [10.0, 2]\n'
    const edit = { kind: 'update', index: 0, entity: { id: 'a', amounts: [10, 3] } } as const
    it('passes 10.0 written as 10: the same value', () => {
      expect(unintendedChange(src, src.replace('[10.0, 2]', '[10, 3]'), 'projects', edit)).toBeNull()
    })
    it('still fails on another value in that place', () => {
      expect(unintendedChange(src, src.replace('[10.0, 2]', '[11, 3]'), 'projects', edit)).toMatch(/amounts/)
    })
    it('still fails on a long decimal written rounded, naming it', () => {
      const long = 'projects:\n  - id: a\n    amounts: [0.1000000000000000055511151231257827, 2]\n'
      const rounded = long.replace('0.1000000000000000055511151231257827, 2', '0.1, 3')
      expect(unintendedChange(long, rounded, 'projects', { kind: 'update', index: 0, entity: { id: 'a', amounts: [0.1, 3] } }))
        .toMatch(/amounts.*0\.1000000000000000055511151231257827.*0\.1/s)
    })
  })
})

describe('exactNumber: one form for one value, whatever the spelling', () => {
  const same: [string, string][] = [
    ['10.0', '10'], ['1.0', '1'], ['1e3', '1000'], ['1E3', '1e+3'], ['0x1F', '31'], ['0x1f', '0x1F'], ['.5', '0.5'],
    ['0.50', '0.5'], ['-10.0', '-10'], ['-.5', '-0.5'], ['1.', '1'], ['0o17', '15'], ['+1', '1'], ['012', '12'],
    ['100', '1e2'], ['1.5e1', '15'], ['1e21', '1000000000000000000000'], ['-0.0', '0'], ['-0', '0'], ['0.0', '0e5'],
    ['12345678901234567890', '1234567890123456789e1'], ['1e-7', '0.0000001'],
  ]
  for (const [a, b] of same) {
    it(`${a} and ${b} are the same number`, () => expect(exactNumber(a)).toBe(exactNumber(b)))
  }
  const different: [string, string][] = [
    ['12345678901234567890', '12345678901234567000'], ['0.1000000000000000055511151231257827', '0.1'],
    ['0.10000000000000001', '0.1'], ['10', '100'], ['1e3', '1e4'], ['-1', '1'], ['9007199254740993', '9007199254740992'],
    ['10.5', '10'], ['.inf', '-.inf'], ['.nan', '.inf'],
  ]
  for (const [a, b] of different) {
    it(`${a} and ${b} are not`, () => expect(exactNumber(a)).not.toBe(exactNumber(b)))
  }
  it('agrees with the tests\' own reading of each spelling', () => {
    for (const pair of [...same, ...different].filter(([a]) => !a.startsWith('.inf') && !a.startsWith('.nan'))) {
      const [a, b] = pair
      expect(exactNumber(a) === exactNumber(b), `${a} and ${b}`).toBe(fraction(a) === fraction(b))
    }
  })
})

// The brief's test over spellings. A caller reads the entry (GET), changes
// something else in the list or object that holds the number, and sends the
// whole value back. The number's value was not changed by the request, so the
// save must go through, and the file must then hold that number: with its own
// spelling, or with another spelling of exactly the same value.
describe('a number the request did not change never refuses a save, however the file spells it', () => {
  const SPELLINGS = [
    '1.0', '10.0', '1e3', '0x1F', '.5', '12345678901234567890', '123456789012345678901234567890',
    '-12345678901234567890', '-10.0', '-1.5e2', '-.5', '-31', '0.50', '1.', '1E3', '1e+3', '+1', '012', '0o17', '100',
    '1e21', '1e-7', '0', '-0.0', '0.1', '9007199254740993', '0xFFFFFFFFFFFFFFFFFFFF',
  ]
  type Change = (held: any) => void
  // [what, the entry's lines given the spelling S, what the caller changes beside it, how often S is written]
  const BLOCK: [string, (s: string) => string, Change, number][] = [
    ['a list on one line', s => `  - id: a\n    v: [${s}, 7]\n`, e => { e.v[1] = 8 }, 1],
    ['a list on one line, an element added', s => `  - id: a\n    v: [${s}, 7]\n`, e => { e.v.push(9) }, 1],
    ['a list on one line, the number moved', s => `  - id: a\n    v: [${s}, 7]\n`, e => { e.v.reverse() }, 1],
    ['a list on one line, the number twice', s => `  - id: a\n    v: [${s}, ${s}, 7]\n`, e => { e.v[2] = 8 }, 2],
    ['a list over several lines', s => `  - id: a\n    v:\n      - ${s}\n      - 7\n`, e => { e.v.push(9) }, 1],
    ['an object on one line', s => `  - id: a\n    v: {eur: ${s}, n: 7}\n`, e => { e.v.n = 8 }, 1],
    ['an object over several lines', s => `  - id: a\n    v:\n      eur: ${s}\n      n: 7\n`, e => { e.v.usd = 9 }, 1],
    ['a list inside an object inside a list', s => `  - id: a\n    v: [{pt: [${s}, 7], k: x}]\n`, e => { e.v[0].k = 'y' }, 1],
    ['a list inside nested objects', s => `  - id: a\n    v:\n      a:\n        b: [7, ${s}]\n      n: 7\n`, e => { e.v.n = 8 }, 1],
  ]
  // An entry written on one line is not edited line by line: the whole file is written again.
  const FLOW: [string, (s: string) => string, Change, number][] = [
    ['a list, in an entry on one line', s => `  - {id: a, v: [${s}, 7]}\n`, e => { e.v[1] = 8 }, 1],
    ['an object, in an entry on one line', s => `  - {id: a, v: {eur: ${s}, n: 7}}\n`, e => { e.v.n = 8 }, 1],
    ['nested, in an entry on one line', s => `  - {id: a, v: [{pt: [${s}, 7], k: x}]}\n`, e => { e.v[0].k = 'y' }, 1],
  ]
  /** The numbers written in entry `a`, field `v`, of the file as it now is. */
  const written = () => {
    const entry = (parseDocument(read('projects')).get('projects', true) as any).items[0]
    return spellings(entry.get('v', true))
  }

  for (const spelling of SPELLINGS) {
    it(`${spelling}: saved in every shape, and the file still holds that value`, () => {
      const outcome: string[] = []
      for (const [what, lines, change, times] of [...BLOCK, ...FLOW]) {
        // A second entry holds the same spelling and is not edited: it must come through too.
        const text = `projects:\n${lines(spelling)}  - id: other\n    v: [${spelling}]\n`
        writeFileSync(file('projects'), text)
        const held = readRegistry(repo, 'projects').entries![0]! // what GET answers
        change(held)
        const sent = JSON.parse(JSON.stringify(held)) as Entity // what a caller can send
        expect(() => updateEntity(repo, 'projects', 'a', sent), `${what}: ${text}`).not.toThrow()
        const after = written()
        const kept = after.filter(s => fraction(s) === fraction(spelling))
        expect(kept.length, `${what}: ${spelling} is written as ${JSON.stringify(after)} in\n${read('projects')}`).toBe(times)
        expect(readRegistry(repo, 'projects').entries![0], what).toEqual(sent)
        const other = (parseDocument(read('projects')).get('projects', true) as any).items[1]
        expect(spellings(other.get('v', true)).map(fraction), what).toEqual([fraction(spelling)])
        outcome.push(...kept.map(s => (s === spelling ? 'kept' : 'respelled')))
      }
      // Each was one or the other; which one is recorded in the README, not decided here.
      expect(outcome.every(o => o === 'kept' || o === 'respelled')).toBe(true)
    })
  }

  it('a long integer is kept digit for digit in every shape (N1, still)', () => {
    for (const spelling of ['12345678901234567890', '-12345678901234567890', '123456789012345678901234567890', '9007199254740993']) {
      for (const [what, lines, change, times] of [...BLOCK, ...FLOW]) {
        writeFileSync(file('projects'), `projects:\n${lines(spelling)}`)
        const held = readRegistry(repo, 'projects').entries![0]!
        change(held)
        updateEntity(repo, 'projects', 'a', JSON.parse(JSON.stringify(held)))
        expect(written().filter(s => s === spelling).length, `${what}: ${read('projects')}`).toBe(times)
      }
    }
  })

  it('a number the request did change is written as sent, whatever it was spelled as', () => {
    for (const spelling of ['10.0', '1e3', '0x1F', '.5', '12345678901234567890']) {
      writeFileSync(file('projects'), `projects:\n  - id: a\n    v: [${spelling}, 7]\n`)
      updateEntity(repo, 'projects', 'a', { id: 'a', v: [4, 7] })
      expect(read('projects')).toBe('projects:\n  - id: a\n    v: [4, 7]\n')
    }
  })
})

// A refusal says what the cause is. The sentence about a number with more
// digits was added to every refusal of this kind, whatever the cause.
describe('a refusal names its real cause', () => {
  it('a decimal longer than JSON carries, in a replaced list: the number is named, with the advice about digits', async () => {
    const text = 'projects:\n  - id: a\n    rates: [0.1000000000000000055511151231257827, 2]\n'
    seed('projects', text)
    const res = await put('projects', 'a', { id: 'a', rates: [0.1, 3] })
    expect(res.status).toBe(409)
    const { error } = await res.json()
    expect(error).toMatch(/"a".*rates.*0\.1000000000000000055511151231257827/s)
    expect(error).toMatch(NUMBER_ADVICE)
    expect(error).toMatch(/nothing was written/i)
    expect(read('projects')).toBe(text)
  })

  it('a refusal that is not about a number does not speak of numbers', async () => {
    // 120 lists inside one another: more than the check will follow.
    const deep = '['.repeat(120) + ']'.repeat(120)
    const text = `projects:\n  - id: a\n    name: A\n  - id: b\n    nest: ${deep}\n`
    seed('projects', text)
    const res = await put('projects', 'a', { id: 'a', name: 'A2' })
    expect(res.status).toBe(409)
    const { error } = await res.json()
    expect(error).toMatch(/not saved/i)
    expect(error).toMatch(/too deeply/)
    expect(error).not.toMatch(NUMBER_ADVICE)
    expect(error).toMatch(/nothing was written/i)
    expect(error).toMatch(/by hand/i) // what to do
    expect(read('projects')).toBe(text)
  })
})

// N8. `*name` reuses the value marked `&name`. When no value carries that
// mark the file cannot be read, and the YAML library says so only when the
// value is asked for: a PUT answered 500, a POST 409 with the sentence about
// numbers, and a DELETE went through.
describe('N8: an alias to an anchor that is not in the file is refused for what it is', () => {
  it('every save answers 409 naming the alias and where it is', async () => {
    const text = 'projects:\n  - id: a\n    name: *nope\n  - id: b\n    name: B\n'
    seed('projects', text)
    const before = commits()
    for (const res of [
      await put('projects', 'a', { id: 'a', name: 'x' }),
      await put('projects', 'b', { id: 'b', name: 'x' }),
      await app.request('/api/registries/projects', json('POST', { id: 'new' })),
      await app.request('/api/registries/projects/b', { method: 'DELETE' }),
      await app.request('/api/registries/projects/a', { method: 'DELETE' }),
    ]) {
      expect(res.status).toBe(409)
      const { error } = await res.json()
      expect(error).toMatch(/not (saved|deleted)/i)
      expect(error).toContain('data/projects.yaml')
      expect(error).toContain('*nope')
      expect(error).toMatch(/line 3, column 11/)
      expect(error).toMatch(/nothing was written/i)
      expect(error).toMatch(/in the file, write the value in place of \*nope/i) // what to do
      expect(error).not.toMatch(NUMBER_ADVICE)
    }
    expect(read('projects')).toBe(text)
    expect(commits()).toBe(before)
  })

  it('a read of that file answers 409 with the same words, where it answered 500', async () => {
    seed('projects', 'projects:\n  - id: a\n    name: *nope\n')
    const res = await app.request('/api/registries/projects')
    expect(res.status).toBe(409)
    const { error } = await res.json()
    expect(error).toContain('data/projects.yaml cannot be read')
    expect(error).toMatch(/line 3, column 11/)
    expect(error).toContain('*nope')
    // The other registries and the list of registries still answer.
    expect((await app.request('/api/registries/members')).status).toBe(200)
    expect((await app.request('/api/registries')).status).toBe(200)
  })

  it('an alias whose anchor is there saves as before', async () => {
    seed('projects', 'projects:\n  - id: a\n    name: &n A\n  - id: b\n    name: *n\n    status: x\n')
    expect((await put('projects', 'b', { id: 'b', name: 'A', status: 'y' })).status).toBe(200)
    expect(read('projects')).toBe('projects:\n  - id: a\n    name: &n A\n  - id: b\n    name: *n\n    status: y\n')
  })
})
