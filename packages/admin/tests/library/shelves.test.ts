import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, cpSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { loadEntries, loadLibrary } from '../../server/library/read.ts'
import { createApp } from '../../server/app.ts'

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'test-shelf')
let repo: string
beforeEach(() => { repo = mkdtempSync(join(tmpdir(), 'shelves-')) })
afterEach(() => rmSync(repo, { recursive: true, force: true }))

const federation = (body: string) => writeFileSync(join(repo, 'federation.yaml'), `identity:\n  name: Test org\n  slug: test-org\n${body}`)
const shelfCopy = (as = 'shelves/test-shelf') => { cpSync(FIXTURE, join(repo, as), { recursive: true }); return join(repo, as) }
const register = (...paths: string[]) => federation(`library:\n  shelves:\n${paths.map(p => `    - { path: ${p} }`).join('\n')}\n`)
const frameworkIds = () => loadEntries().map(e => e.id)
const edit = (file: string, from: string, to: string) => writeFileSync(file, readFileSync(file, 'utf8').replace(from, to))
const deskCopy = (as: string) => readFileSync(join(FIXTURE, 'board/test-desk/entry.yaml'), 'utf8').replaceAll('test-desk', as)

/** The framework is still served, the list still answers 200, and the problems are the given ones. */
async function expectServed(problems: unknown[], extra: string[] = []) {
  const lib = loadLibrary(repo)
  expect(lib.entries.map(e => e.id)).toEqual([...frameworkIds(), ...extra])
  expect(lib.problems).toEqual(problems)
  const res = await createApp(repo).request('/api/library')
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.entries.map((e: { id: string }) => e.id)).toEqual([...frameworkIds(), ...extra])
  expect(body.problems).toEqual(problems)
}

describe('loadLibrary', () => {
  it('with no library key is the framework shelf alone', () => {
    federation('')
    expect(loadLibrary(repo)).toEqual({ entries: loadEntries(), sources: ['framework'], problems: [] })
  })
  it('with no federation.yaml at all is the framework shelf alone', () => {
    expect(loadLibrary(repo)).toEqual({ entries: loadEntries(), sources: ['framework'], problems: [] })
  })
  it("serves a registered shelf after the framework's, and previews its entry", async () => {
    shelfCopy(); register('shelves/test-shelf')
    const lib = loadLibrary(repo)
    expect(lib.entries.map(e => e.id)).toEqual([...frameworkIds(), 'board:test-desk', 'system:test-link'])
    expect(lib.sources).toEqual(['framework', 'test-shelf'])
    expect(lib.problems).toEqual([])
    const app = createApp(repo)
    const res = await app.request('/api/library/board%3Atest-desk/preview')
    expect(res.status).toBe(200)
    expect((await res.json()).source.name).toBe('test-shelf')
    expect((await (await app.request('/api/library')).json()).sources).toEqual(['framework', 'test-shelf'])
  })
  it('reads an absolute path too', () => {
    const dir = shelfCopy('elsewhere'); register(dir)
    expect(loadLibrary(repo).sources).toEqual(['framework', 'test-shelf'])
  })
})

describe('a registered shelf that cannot be served (Review Focus 3)', () => {
  it('a path with no directory is reported, and the framework is served', async () => {
    register('shelves/nope')
    await expectServed([{ shelf: 'shelves/nope', sentence: 'federation.yaml registers the shelf shelves/nope, and there is no such directory.' }])
  })
  it('a shelf.yaml with no entries list is reported', async () => {
    const dir = shelfCopy(); writeFileSync(join(dir, 'shelf.yaml'), 'name: test-shelf\ntitle: Test shelf\n'); register('shelves/test-shelf')
    await expectServed([{ shelf: 'test-shelf', sentence: 'shelves/test-shelf/shelf.yaml must hold a name and an entries: list of entry ids.' }])
  })
  it('a shelf.yaml with no name is reported under the path as written', async () => {
    const dir = shelfCopy(); writeFileSync(join(dir, 'shelf.yaml'), 'entries: [board:test-desk]\n'); register('shelves/test-shelf')
    await expectServed([{ shelf: 'shelves/test-shelf', sentence: 'shelves/test-shelf/shelf.yaml must hold a name and an entries: list of entry ids.' }])
  })
  it('an unparseable shelf.yaml is reported', async () => {
    const dir = shelfCopy(); writeFileSync(join(dir, 'shelf.yaml'), 'name: [unclosed\n'); register('shelves/test-shelf')
    await expectServed([{ shelf: 'shelves/test-shelf', sentence: 'shelves/test-shelf/shelf.yaml must hold a name and an entries: list of entry ids.' }])
  })
  it('an entry failing the schema is left out alone', async () => {
    const dir = shelfCopy()
    mkdirSync(join(dir, 'board/second'), { recursive: true })
    writeFileSync(join(dir, 'board/second/entry.yaml'), deskCopy('second'))
    writeFileSync(join(dir, 'shelf.yaml'), 'name: test-shelf\ntitle: Test shelf\nentries: [board:test-desk, board:second]\n')
    edit(join(dir, 'board/test-desk/entry.yaml'), /summary: .*\n/.exec(readFileSync(join(dir, 'board/test-desk/entry.yaml'), 'utf8'))![0], '')
    register('shelves/test-shelf')
    const lib = loadLibrary(repo)
    expect(lib.entries.map(e => e.id)).toEqual([...frameworkIds(), 'board:second'])
    expect(lib.problems).toHaveLength(1)
    expect(lib.problems[0]!.shelf).toBe('test-shelf')
    // The path as the instance wrote it, never where the server resolved it (M5).
    expect(lib.problems[0]!.sentence).toMatch(/^shelves\/test-shelf\/board\/test-desk\/entry\.yaml: .*summary.*entry\.schema\.json/)
    expect(lib.problems[0]!.sentence).not.toContain(repo)
    expect((await createApp(repo).request('/api/library')).status).toBe(200)
  })
  it('an entry whose source is not the shelf is left out', async () => {
    const dir = shelfCopy(); edit(join(dir, 'board/test-desk/entry.yaml'), 'source: test-shelf', 'source: framework'); register('shelves/test-shelf')
    await expectServed([{ shelf: 'test-shelf', sentence: 'test-shelf: board:test-desk says it comes from framework, but it is on the test-shelf shelf.' }], ['system:test-link'])
  })
  it('an entry that reuses a framework id is left out, and the framework copy wins', async () => {
    const dir = shelfCopy()
    mkdirSync(join(dir, 'board/onboarding'), { recursive: true })
    writeFileSync(join(dir, 'board/onboarding/entry.yaml'), deskCopy('onboarding'))
    writeFileSync(join(dir, 'shelf.yaml'), 'name: test-shelf\ntitle: Test shelf\nentries: [board:onboarding]\n')
    register('shelves/test-shelf')
    await expectServed([{ shelf: 'test-shelf', sentence: 'test-shelf: board:onboarding is also on the framework shelf, so this copy is left out. Ids are unique across shelves.' }])
    const one = await (await createApp(repo).request('/api/library/board%3Aonboarding')).json()
    expect(one.source).toBe('framework')
  })
  it('two shelves with one name: the second is left out', async () => {
    shelfCopy(); shelfCopy('shelves/again'); register('shelves/test-shelf', 'shelves/again')
    await expectServed([{ shelf: 'shelves/again', sentence: 'Two shelves are named test-shelf; the second, shelves/again, is left out.' }], ['board:test-desk', 'system:test-link'])
  })
  it('library.shelves that is not a list of { path } is one problem', async () => {
    federation('library:\n  shelves: nonsense\n')
    await expectServed([{ shelf: 'federation.yaml', sentence: 'federation.yaml: library.shelves must be a list of { path }.' }])
    federation('library:\n  shelves:\n    - { dir: x }\n')
    await expectServed([{ shelf: 'federation.yaml', sentence: 'federation.yaml: library.shelves must be a list of { path }.' }])
  })
  it('a federation.yaml that will not parse is one problem, and the framework is served', async () => {
    const text = 'identity:\n  name: Test org\nlibrary:\n  shelves:\n    - { path: [unclosed\n'
    writeFileSync(join(repo, 'federation.yaml'), text)
    let first = ''
    try { parse(text) } catch (err) { first = (err as Error).message.split('\n')[0]! }
    expect(first).not.toBe('')
    await expectServed([{ shelf: 'federation.yaml', sentence: `federation.yaml cannot be read: ${first}; the shelves it registers are left out.` }])
  })
  it('a good shelf is served beside a bad one', () => {
    shelfCopy(); register('shelves/nope', 'shelves/test-shelf')
    const lib = loadLibrary(repo)
    expect(lib.sources).toEqual(['framework', 'test-shelf'])
    expect(lib.problems).toHaveLength(1)
  })
})
