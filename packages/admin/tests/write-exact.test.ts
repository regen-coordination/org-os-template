// What the review of the write path found (2026-10-11), each held by a test
// that failed on the code it reviewed. The inputs are the reviewer's.
//
// Here: a save must change the entry it was asked to change and nothing else
// in the file, or be refused with a sentence before anything is written.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureRepo, removeFixtureRepo } from './fixtures.ts'
import { createApp } from '../server/app.ts'
import { updateEntity, createEntity, deleteEntity, readRegistry } from '../server/registry.ts'
import { unintendedChange } from '../server/verify.ts'

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
const del = (name: string, id: string) => app.request(`/api/registries/${name}/${id}`, { method: 'DELETE' })

// F1. When the line editor declines a layout (a flow-style entry), the whole
// document is re-serialized. That text was written unchecked, and the YAML
// library reads an integer into a JavaScript number: 12345678901234567890 came
// back as 12345678901234567000, in entries nobody edited.
describe('F1: a number the app cannot hold exactly is kept exactly or the save is refused', () => {
  const BIG = '12345678901234567890'

  it('an untouched entry keeps a 20-digit integer when another entry forces a re-serialize', async () => {
    seed('projects', `projects:\n  - {id: a, status: x}\n  - id: b\n    tx: ${BIG}\n    status: x\n`)
    const res = await put('projects', 'a', { id: 'a', status: 'y' })
    expect(res.status).toBe(200)
    expect(read('projects')).toContain(`tx: ${BIG}\n`)
    expect(readRegistry(repo, 'projects').entries![0]!.status).toBe('y')
  })

  it('the edited entry keeps a 20-digit integer in a field the edit did not change', async () => {
    seed('projects', `projects: [{id: a, tx: ${BIG}, status: x}]\n`)
    // What a caller holds after GET: the number as JSON could carry it.
    const held = (await (await app.request('/api/registries/projects')).json()).entries[0]
    const res = await put('projects', 'a', { ...held, status: 'y' })
    expect(res.status).toBe(200)
    expect(read('projects')).toContain(BIG)
    expect(read('projects')).not.toContain('12345678901234567000')
  })

  it('a decimal that would be rounded is refused in words and nothing is written', async () => {
    const text = 'projects:\n  - {id: a, status: x}\n  - id: b\n    rate: 0.12345678901234567890123\n'
    seed('projects', text)
    const before = commits()
    const res = await put('projects', 'a', { id: 'a', status: 'y' })
    expect(res.status).toBe(409)
    const { error } = await res.json()
    expect(error).toMatch(/not saved/i)
    expect(error).toContain('data/projects.yaml')
    expect(error).toMatch(/"b".*rate.*0\.12345678901234567890123/s) // names the entry, the field and the value
    expect(error).toMatch(/nothing was written/i)
    expect(read('projects')).toBe(text)
    expect(commits()).toBe(before)
    expect(git('status --porcelain')).toBe('')
  })

  it('the same re-serialize is accepted when every number survives it', async () => {
    seed('projects', 'projects:\n  - {id: a, status: x}\n  - id: b\n    big: 1e3\n    hex: 0x1F\n    n: 42\n')
    expect((await put('projects', 'a', { id: 'a', status: 'y' })).status).toBe(200)
    expect(readRegistry(repo, 'projects').entries![1]).toEqual({ id: 'b', big: 1000, hex: 31, n: 42 })
  })

  // The reviewer's point: comparing two parsed JavaScript numbers cannot see
  // this, because both have already lost the digits. The check reads the digits.
  describe('the check itself can fail on this input', () => {
    const edit = { kind: 'update', index: 0, entity: { id: 'a', status: 'y' } } as const
    const src = `projects:\n  - id: a\n    status: x\n  - id: b\n    tx: ${BIG}\n`
    it('sees a rounded integer in an untouched entry', () => {
      const rounded = src.replace('status: x', 'status: y').replace(BIG, '12345678901234567000')
      expect(Number(BIG)).toBe(Number('12345678901234567000')) // why a value comparison is blind
      expect(unintendedChange(src, rounded, 'projects', edit)).toMatch(/"b".*tx.*12345678901234567890.*12345678901234567000/s)
    })
    it('accepts the edit that was asked for', () => {
      expect(unintendedChange(src, src.replace('status: x', 'status: y'), 'projects', edit)).toBeNull()
    })
    it('accepts the same number written another way', () => {
      const a = 'projects:\n  - id: a\n    status: x\n  - id: b\n    n: 1e3\n    h: 0x1F\n    f: 1.50\n'
      const b = 'projects:\n  - id: a\n    status: y\n  - id: b\n    n: 1e+3\n    h: 0x1f\n    f: 1.5\n'
      expect(unintendedChange(a, b, 'projects', edit)).toBeNull()
    })
    it('sees an edit that did not do what was asked', () => {
      expect(unintendedChange(src, src, 'projects', edit)).toMatch(/status/)
    })
    it('sees a change outside the list', () => {
      const withVersion = `schema_version: "2.0"\n${src}`
      const changed = withVersion.replace('"2.0"', '"2.1"').replace('status: x', 'status: y')
      expect(unintendedChange(withVersion, changed, 'projects', edit)).toMatch(/schema_version/)
    })
    it('sees an entry that went missing', () => {
      expect(unintendedChange(src, 'projects:\n  - id: a\n    status: y\n', 'projects', edit)).not.toBeNull()
    })
  })
})

// F2. `&L` marks a value with a name (an anchor) and `*L` reuses it (an alias).
// Editing the marked value in place changed every entry that reused it, and
// removing it left the aliases pointing at nothing (a 500).
describe('F2: an edit never reaches another entry through a YAML anchor', () => {
  const ANCHORED = 'projects:\n  - id: a\n    lead: &L steward-a\n  - id: b\n    lead: *L\n'

  it('a read shows an alias as the value it stands for', async () => {
    seed('projects', ANCHORED)
    const { entries } = await (await app.request('/api/registries/projects')).json()
    // was {source: "L"}; each record carries its level, as every record leaving the gate does (L5 §9.5, Task 13)
    expect(entries).toEqual([{ id: 'a', lead: 'steward-a', visibility: 'members' }, { id: 'b', lead: 'steward-a', visibility: 'members' }])
  })

  it('an edit to another field of an entry that reuses a value keeps the alias', async () => {
    seed('projects', ANCHORED)
    expect((await put('projects', 'b', { id: 'b', lead: 'steward-a', status: 'x' })).status).toBe(200)
    expect(read('projects')).toBe(`${ANCHORED}    status: x\n`)
  })

  it('changing a value other entries reuse is refused, naming the anchor and who reuses it', async () => {
    seed('projects', ANCHORED)
    const before = commits()
    const res = await put('projects', 'a', { id: 'a', lead: 'ana' })
    expect(res.status).toBe(409)
    const { error } = await res.json()
    expect(error).toMatch(/not saved/i)
    expect(error).toContain('data/projects.yaml')
    expect(error).toContain('&L')
    expect(error).toContain('"b"')
    expect(read('projects')).toBe(ANCHORED)
    expect(commits()).toBe(before)
  })

  it('changing the entry that reuses the value changes only that entry', async () => {
    seed('projects', ANCHORED)
    expect((await put('projects', 'b', { id: 'b', lead: 'ana' })).status).toBe(200)
    expect(read('projects')).toBe(ANCHORED.replace('lead: *L', 'lead: ana'))
  })

  it('an edit to another field of the anchor\'s holder goes through', async () => {
    seed('projects', ANCHORED)
    expect((await put('projects', 'a', { id: 'a', lead: 'steward-a', status: 'x' })).status).toBe(200)
    expect(readRegistry(repo, 'projects').entries).toEqual([{ id: 'a', lead: 'steward-a', status: 'x' }, { id: 'b', lead: 'steward-a' }])
  })

  it('deleting the entry that holds the anchor is refused in words, not a 500', async () => {
    seed('projects', ANCHORED)
    const res = await del('projects', 'a')
    expect(res.status).toBe(409)
    const { error } = await res.json()
    expect(error).toMatch(/not deleted/i)
    expect(error).toContain('&L')
    expect(error).toContain('"b"')
    expect(read('projects')).toBe(ANCHORED)
  })

  it('removing a merge key other entries reuse is refused in words, not a 500', async () => {
    const text = 'projects:\n  - id: a\n    <<: &base\n      status: x\n  - id: b\n    <<: *base\n'
    seed('projects', text)
    const res = await put('projects', 'a', { id: 'a', status: 'y' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/&base.*"b"/s)
    expect(read('projects')).toBe(text)
  })

  it('an anchor nobody reuses does not stand in the way', async () => {
    seed('projects', 'projects:\n  - id: a\n    lead: &L steward-a\n  - id: b\n    lead: ana\n')
    expect((await put('projects', 'a', { id: 'a', lead: 'ana' })).status).toBe(200)
    expect(readRegistry(repo, 'projects').entries).toEqual([{ id: 'a', lead: 'ana' }, { id: 'b', lead: 'ana' }])
  })
})

// F3. A file with Windows line endings got `\n` on the lines an edit wrote.
describe('F3: a CRLF file stays CRLF on every line', () => {
  const crlf = (text: string) => text.replace(/\n/g, '\r\n')
  const allCrlf = (text: string) => !/(^|[^\r])\n/.test(text)
  const BLOCK = crlf('# people\nmembers:\n  - id: a\n    name: Ana\n  - id: b\n    name: Bo\n')

  it('update', () => {
    writeFileSync(file('members'), BLOCK)
    updateEntity(repo, 'members', 'a', { id: 'a', name: 'Ana Silva' })
    expect(read('members')).toBe(BLOCK.replace('name: Ana', 'name: Ana Silva'))
  })
  it('create and delete', () => {
    writeFileSync(file('members'), BLOCK)
    createEntity(repo, 'members', { id: 'c', tags: ['x', 'y'] })
    expect(allCrlf(read('members'))).toBe(true)
    expect(read('members')).toContain('- id: c\r\n')
    deleteEntity(repo, 'members', 'b')
    expect(allCrlf(read('members'))).toBe(true)
    expect(readRegistry(repo, 'members').entries!.map(e => e.id)).toEqual(['a', 'c'])
  })
  it('a re-serialized file (flow-style entry) keeps them too', () => {
    writeFileSync(file('members'), crlf('members:\n  - {id: a, name: Ana}\n  - id: b\n    name: Bo\n'))
    updateEntity(repo, 'members', 'a', { id: 'a', name: 'Ana Silva' })
    expect(allCrlf(read('members'))).toBe(true)
    expect(read('members')).toContain('\r\n')
  })
})
