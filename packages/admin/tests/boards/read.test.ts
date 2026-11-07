import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureRepo, removeFixtureRepo, BOARDS_YAML as FIXTURE_BOARDS } from '../fixtures.ts'
import { BUILTIN_DIR, BUILTIN_ORDER, builtinBoards, boardsOf } from '../../server/boards/read.ts'
import { SECTION_IDS, sectionBoardId, validateBoard } from '../../lib/board-query.mjs'
import { boardFieldsOf } from '../../lib/data-validate.mjs'

describe('the built-in boards (P4 §5.2)', () => {
  const boards = builtinBoards()
  it('are the home board, one per section and the two maps, in menu order', () => {
    expect(boards.map(b => b.id)).toEqual(BUILTIN_ORDER)
    expect(BUILTIN_ORDER).toEqual(['home', ...SECTION_IDS.map(sectionBoardId), 'organization', 'systems'])
  })
  it('are each in a file named after its id', () => {
    expect(readdirSync(BUILTIN_DIR).filter(f => f.endsWith('.yaml')).sort()).toEqual(BUILTIN_ORDER.map(id => `${id}.yaml`).sort())
  })
  it('each pass validateBoard', () => {
    for (const b of boards) expect(validateBoard(b, { fieldsOf: boardFieldsOf }), b.id).toEqual([])
  })
  it('give each section its list, and each map its map', () => {
    expect(boards.find(b => b.id === 'outside-systems')!.blocks).toEqual([{ id: 'list', type: 'list', source: { section: 'systems' }, view: { switch: true, filter: true, new: true } }])
    expect(boards.find(b => b.id === 'systems')!.blocks).toMatchObject([{ id: 'map', type: 'map', source: { map: 'systems' } }])
  })
  it('have no governance board (P4-C10)', () => {
    expect(boards.some(b => b.id === 'governance')).toBe(false)
  })
})

// The fixture's board is id "treasury", which is also a built-in; these tests need one that is not.
const BOARDS_YAML = FIXTURE_BOARDS.replace('id: "treasury"', 'id: "council"')

describe('boardsOf', () => {
  let repo: string
  beforeEach(() => { repo = makeFixtureRepo() })
  afterEach(() => removeFixtureRepo(repo))

  it('serves the built-ins as built-in while the instance has no file', () => {
    const all = boardsOf(repo)
    expect(all.map(b => b.id)).toEqual(BUILTIN_ORDER)
    expect(all.every(b => b.origin === 'builtin' && !b.overrides)).toBe(true)
  })
  it('replaces a built-in wholesale with the instance\'s board of that id, and appends the rest', () => {
    writeFileSync(join(repo, 'data', 'boards.yaml'), `${BOARDS_YAML}  - id: "projects"\n    name: "Our projects"\n    layout: "flow"\n    blocks: []\n`)
    const all = boardsOf(repo)
    expect(all.find(b => b.id === 'projects')).toEqual({ id: 'projects', name: 'Our projects', audience: 'members', layout: 'flow', blocks: [], origin: 'instance', overrides: true })
    expect(all.at(-1)).toMatchObject({ id: 'council', origin: 'instance', overrides: false })
  })
  it('lets the fixture\'s "treasury" board replace the built-in section board in place', () => {
    writeFileSync(join(repo, 'data', 'boards.yaml'), FIXTURE_BOARDS)
    const all = boardsOf(repo)
    expect(all.map(b => b.id)).toEqual(BUILTIN_ORDER)
    expect(all.find(b => b.id === 'treasury')).toMatchObject({ name: 'Treasury & council', origin: 'instance', overrides: true })
  })
  it('keeps the first of two boards with one id', () => {
    writeFileSync(join(repo, 'data', 'boards.yaml'), 'boards:\n  - { id: a, name: First, layout: flow, blocks: [] }\n  - { id: a, name: Second, layout: flow, blocks: [] }\n')
    expect(boardsOf(repo).filter(b => b.id === 'a').map(b => b.name)).toEqual(['First'])
  })
  it('refuses a file with YAML errors with the writes\' own 409', () => {
    writeFileSync(join(repo, 'data', 'boards.yaml'), 'boards:\n  - id: a\n    name: [unclosed\n')
    expect(() => boardsOf(repo)).toThrow(expect.objectContaining({ status: 409 }))
  })
})
