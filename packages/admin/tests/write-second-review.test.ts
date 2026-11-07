// What the second review of the write path found (2026-10-11), N1 to N5, each
// held by a test that failed on the code it reviewed. The inputs are the reviewer's.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureRepo, removeFixtureRepo } from './fixtures.ts'
import { createApp } from '../server/app.ts'
import { readRegistry } from '../server/registry.ts'
import { unintendedChange } from '../server/verify.ts'

let repo: string
let app: ReturnType<typeof createApp>
beforeEach(() => { repo = makeFixtureRepo(); app = createApp(repo) })
afterEach(() => removeFixtureRepo(repo))

const json = (method: string, body: unknown) => ({
  method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
})
/** A body sent as written: `JSON.stringify` drops a key named `__proto__`. */
const raw = (method: string, body: string) => ({ method, body, headers: { 'content-type': 'application/json' } })
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

// N1. A request that replaces a list or object sends the whole value, and the
// numbers in it are the ones `GET` showed: JSON numbers, about 16 digits. The
// new value was written from those, so a 20-digit integer beside the element
// that changed came back rounded; and the check compared two rounded values.
describe('N1: a long integer inside a list or object the request replaces is kept digit for digit', () => {
  const BIG = '12345678901234567890'
  const ROUNDED = 12345678901234567000 // what GET shows, and what a caller sends back

  it('a flow list keeps the element the request did not mean to change', async () => {
    seed('projects', `projects:\n  - id: a\n    name: A\n    amounts: [${BIG}, 2]\n`)
    const res = await put('projects', 'a', { id: 'a', name: 'A', amounts: [ROUNDED, 3] })
    expect(res.status).toBe(200)
    expect(read('projects')).toBe(`projects:\n  - id: a\n    name: A\n    amounts: [${BIG}, 3]\n`)
  })

  it('a block list keeps it too', async () => {
    seed('projects', `projects:\n  - id: a\n    amounts:\n      - ${BIG}\n      - 2\n`)
    expect((await put('projects', 'a', { id: 'a', amounts: [ROUNDED, 3] })).status).toBe(200)
    expect(read('projects')).toContain(`- ${BIG}\n`)
    expect(read('projects')).not.toContain('12345678901234567000')
  })

  it('an object keeps it, at any depth, when the element moves', async () => {
    seed('projects', `projects:\n  - id: a\n    ledger:\n      paid: [1, ${BIG}]\n      note: x\n`)
    const res = await put('projects', 'a', { id: 'a', ledger: { paid: [ROUNDED], note: 'y' } })
    expect(res.status).toBe(200)
    expect(read('projects')).toContain(`paid: [${BIG}]`)
  })

  it('a number the caller really changed is written as sent', async () => {
    seed('projects', `projects:\n  - id: a\n    amounts: [${BIG}, 2]\n`)
    expect((await put('projects', 'a', { id: 'a', amounts: [5, 3] })).status).toBe(200)
    expect(read('projects')).toContain('amounts: [5, 3]')
  })

  it('two long integers that round to the same number are refused in words: the app cannot tell which was meant', async () => {
    const text = `projects:\n  - id: a\n    amounts: [${BIG}, 12345678901234567891, 2]\n`
    seed('projects', text)
    const before = commits()
    const res = await put('projects', 'a', { id: 'a', amounts: [ROUNDED, 3] })
    expect(res.status).toBe(409)
    const { error } = await res.json()
    expect(error).toMatch(/not saved/i)
    expect(error).toMatch(/"a".*amounts/s)
    expect(error).toContain(BIG)
    expect(error).toContain('12345678901234567891')
    expect(error).toMatch(/nothing was written/i)
    expect(read('projects')).toBe(text)
    expect(commits()).toBe(before)
  })

  it('a decimal with more digits than JSON carries, in a replaced list, is refused in words', async () => {
    const text = 'projects:\n  - id: a\n    rates: [0.1000000000000000055511151231257827, 2]\n'
    seed('projects', text)
    const res = await put('projects', 'a', { id: 'a', rates: [0.1, 3] })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/"a".*rates.*0\.1000000000000000055511151231257827/s)
    expect(read('projects')).toBe(text)
  })

  describe('the check itself can fail on this input', () => {
    const src = `projects:\n  - id: a\n    name: A\n    amounts: [${BIG}, 2]\n`
    const edit = { kind: 'update', index: 0, entity: { id: 'a', name: 'A', amounts: [ROUNDED, 3] } } as const
    it('sees the rounded element', () => {
      const rounded = src.replace(`[${BIG}, 2]`, '[12345678901234567000, 3]')
      expect(unintendedChange(src, rounded, 'projects', edit)).toMatch(/"a".*amounts.*12345678901234567890.*12345678901234567000/s)
    })
    it('accepts the file\'s own digits', () => {
      expect(unintendedChange(src, src.replace(', 2]', ', 3]'), 'projects', edit)).toBeNull()
    })
  })
})

// N2. `git update-index --assume-unchanged` tells git not to look at a file.
// `git status` then calls it clean whatever it holds, which is all the check
// for uncommitted edits asked: the unreviewed entry went into the commit.
describe('N2: a registry file git has been told not to look at is refused, not trusted', () => {
  const WIP = '  - id: wip\n    title: UNREVIEWED\n'
  const edit = { id: 'proj-001', title: 'Renamed', status: 'develop', type: 'program', lead: 'ana' }

  for (const flag of ['assume-unchanged', 'skip-worktree']) {
    it(`${flag}: the save answers 409 naming the file and the flag, and commits nothing`, async () => {
      git(`update-index --${flag} data/projects.yaml`)
      writeFileSync(file('projects'), read('projects') + WIP)
      const held = read('projects')
      const res = await put('projects', 'proj-001', edit)
      expect(res.status).toBe(409)
      const { error } = await res.json()
      expect(error).toMatch(/not saved/i)
      expect(error).toContain('data/projects.yaml')
      expect(error).toContain(flag)
      expect(error).toContain(`git update-index --no-${flag} data/projects.yaml`) // what to do
      expect(read('projects')).toBe(held)
      expect(commits()).toBe(1)
      expect(git('show HEAD:data/projects.yaml')).not.toContain('UNREVIEWED')
    })
  }

  it('a file with no such flag saves as before', async () => {
    expect((await put('projects', 'proj-001', edit)).status).toBe(200)
    expect(commits()).toBe(2)
  })
})

// N3. `key in entity` is true for every name an object inherits, so a field
// called `toString`, `constructor` or `__proto__` was never seen as left out.
describe('N3: a field named like something every object inherits is a field like any other', () => {
  for (const key of ['toString', 'constructor', 'hasOwnProperty', '__proto__']) {
    it(`a PUT that leaves out "${key}" removes it`, async () => {
      seed('projects', `projects:\n  - id: b\n    name: B\n    ${key}: {x: 1}\n  - id: c\n`)
      const res = await put('projects', 'b', { id: 'b', name: 'B2' })
      expect(res.status).toBe(200)
      expect(read('projects')).toBe('projects:\n  - id: b\n    name: B2\n  - id: c\n')
    })
  }

  it('"toString" and "constructor" can be added, read and changed', async () => {
    seed('projects', 'projects:\n  - id: b\n')
    expect((await put('projects', 'b', { id: 'b', toString: 'x', constructor: { prototype: 1 } })).status).toBe(200)
    expect((await put('projects', 'b', { id: 'b', toString: 'y', constructor: { prototype: 1 } })).status).toBe(200)
    expect(read('projects')).toBe('projects:\n  - id: b\n    toString: y\n    constructor:\n      prototype: 1\n')
  })

  // Decided: `__proto__` is refused on the way in. It is the one key that a
  // caller's ordinary JavaScript (`target[key] = value`) turns into something
  // other than data, and no registry needs it.
  it('a body that holds "__proto__" is refused with 422 naming it, on create and on update, at any depth', async () => {
    seed('projects', 'projects:\n  - id: b\n    name: B\n')
    const text = read('projects')
    const bodies = ['{"id":"b","name":"B","__proto__":{"polluted":"yes"}}', '{"id":"b","name":"B","meta":{"deep":[{"__proto__":"str"}]}}']
    for (const body of bodies) {
      for (const res of [
        await app.request('/api/registries/projects/b', raw('PUT', body)),
        await app.request('/api/registries/projects', raw('POST', body.replace('"id":"b"', '"id":"new"'))),
      ]) {
        expect(res.status).toBe(422)
        const { errors } = await res.json()
        expect(errors[0].field).toMatch(/__proto__$/)
        expect(errors[0].message).toMatch(/__proto__/)
        expect(errors[0].message).toMatch(/leave it out/i)
      }
    }
    expect(read('projects')).toBe(text)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})

// N4. A file the YAML library reads with errors was refused, which is right,
// but with the sentence about numbers. The refusal now says what is wrong with
// the file and on which line.
describe('N4: a registry file that is not valid YAML is refused for what it is', () => {
  const cases: [string, string, RegExp, RegExp][] = [
    ['a key written twice in one entry', 'projects:\n  - id: a\n    name: A\n    name: B\n  - id: b\n', /line 4, column 5/, /same key twice|written twice/i],
    ['a second document', 'projects:\n  - id: a\n  - id: b\n---\nmore: 1\n', /line 4, column 1/, /more than one YAML document/i],
    ['a tab used to indent', 'projects:\n  - id: a\n\t  name: A\n  - id: b\n', /line 3, column 1/, /tab/i],
  ]
  for (const [what, text, where, words] of cases) {
    it(`${what}: every save answers 409 saying so and where`, async () => {
      seed('projects', text)
      const before = commits()
      for (const res of [
        await put('projects', 'b', { id: 'b', name: 'x' }),
        await app.request('/api/registries/projects', json('POST', { id: 'new' })),
        await app.request('/api/registries/projects/b', { method: 'DELETE' }),
      ]) {
        expect(res.status).toBe(409)
        const { error } = await res.json()
        expect(error).toMatch(/not (saved|deleted)/i)
        expect(error).toContain('data/projects.yaml')
        expect(error).toMatch(where)
        expect(error).toMatch(words)
        expect(error).toMatch(/nothing was written/i)
        expect(error).not.toMatch(NUMBER_ADVICE)
        expect(error).not.toMatch(/parseAllDocuments|stringified/) // the library's words, not a reader's
      }
      expect(read('projects')).toBe(text)
      expect(commits()).toBe(before)
    })
  }
})

// N5. Not a bug, a sentence in the README that listed two respellings where
// there are more. This pins the list the README gives: same value, other text,
// in entries nobody edited, only when the whole file is re-serialized.
describe('N5: what a re-serialized file may respell, as the README lists it', () => {
  it('the same values, in the YAML library\'s spelling', async () => {
    const lines = ['e: 1e3', 'h: 0x1F', 'f: .5', 'p: +1', 'z: 012', 'n: .NaN', 't: !!int "3"']
    seed('projects', `projects:\n  - {id: a, status: x}\n  - id: b\n${lines.map(l => `    ${l}\n`).join('')}`)
    expect((await put('projects', 'a', { id: 'a', status: 'y' })).status).toBe(200)
    const after = read('projects')
    for (const line of ['e: 1e+3', 'h: 0x1f', 'f: 0.5', 'p: 1', 'z: 12', 'n: .nan', 't: !!int 3']) expect(after).toContain(`    ${line}\n`)
    expect(readRegistry(repo, 'projects').entries![1]).toMatchObject({ e: 1000, h: 31, f: 0.5, p: 1, z: 12, t: 3 })
  })
})
