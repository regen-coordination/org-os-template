import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadEntries, LIBRARY_DIR } from '../../server/library/read.ts'
import { builtinBoards } from '../../server/boards/read.ts'
import { validateEntry } from '../../lib/data-validate.mjs'

const scratch: string[] = []
afterEach(() => { for (const d of scratch.splice(0)) rmSync(d, { recursive: true, force: true }) })
/** A copy of the shipped library, to break one thing in. */
function copy(): string {
  const dir = mkdtempSync(join(tmpdir(), 'library-'))
  scratch.push(dir)
  cpSync(LIBRARY_DIR, dir, { recursive: true })
  return dir
}

describe('the framework shelf (Q6 answered as the design recommends, §4.9)', () => {
  const entries = loadEntries()
  const ids = entries.map(e => e.id)

  it('lists the 15 built-in boards as Built in: previewable, not installable', () => {
    const builtin = entries.filter(e => e.builtin)
    expect(builtin.map(e => e.id)).toEqual(builtinBoards().map(b => `board:${b.id}`))
    expect(builtin).toHaveLength(15)
    for (const e of builtin) { expect(e.shelf).toBe('board'); expect(e.installs ?? []).toEqual([]) }
  })

  it('says what each built-in board is, in a line of its own', () => {
    const summaries = entries.filter(e => e.builtin).map(e => e.summary)
    expect(new Set(summaries).size).toBe(summaries.length)
    // C6 (ledger): Treasury and Home are the Hub's own boards now, several blocks each, so their lines are the count's
    expect(entries.find(e => e.id === 'board:treasury')!.summary).toBe('5 blocks, laid out as flow.')
    expect(entries.find(e => e.id === 'board:organization')!.summary).toBe('The organization map: how its records connect.')
    expect(entries.find(e => e.id === 'board:home')!.summary).toBe('3 blocks, laid out as flow.')
    expect(entries.find(e => e.id === 'board:projects')!.summary).toBe('The projects section: its list, with a switch to its map.')
  })

  it('puts what the framework adds before the boards every instance already has', () => {
    const order = entries.map(e => (e.builtin ? 'built-in' : e.shelf))
    const first = order.indexOf('built-in')
    expect(first).toBeGreaterThan(0)
    expect(order.slice(first).every(x => x === 'built-in')).toBe(true)
  })

  it('adds the three new board templates under ids of their own, and not Meetings', () => {
    for (const id of ['board:treasury-council', 'board:funding-pipeline', 'board:onboarding']) expect(ids).toContain(id)
    expect(ids).not.toContain('board:meetings-2')
    const taken = new Set(builtinBoards().map(b => b.id))
    for (const e of entries.filter(x => !x.builtin && x.shelf === 'board')) {
      for (const op of e.installs ?? []) {
        expect(taken.has(String(op.record).split(':')[1]), `${e.id} must replace no built-in board`).toBe(false)
      }
    }
  })

  it('holds the four rule sets and the solo entry, which installs nothing', () => {
    for (const id of ['rules:approve-one-maintainer', 'rules:consent-7d', 'rules:vote-quorum', 'rules:treasury-safe', 'rules:solo']) expect(ids).toContain(id)
    expect(entries.find(e => e.id === 'rules:solo')!.installs ?? []).toEqual([])
  })

  it('holds the system kinds: link and safe have drivers; docs, repo, database and snapshot-space are links', () => {
    for (const k of ['link', 'safe', 'docs', 'repo', 'database', 'snapshot-space']) expect(ids).toContain(`system:${k}`)
  })

  it('holds no toolkit content: no shelf of patterns, practices, tools, cases or resources, no source but the framework', () => {
    expect(new Set(entries.map(e => e.shelf))).toEqual(new Set(['board', 'rules', 'system']))
    expect(new Set(entries.map(e => e.source))).toEqual(new Set(['framework']))
  })

  it('has one entry per id, and every id begins with its shelf', () => {
    expect(new Set(ids).size).toBe(ids.length)
    for (const e of entries) expect(e.id.startsWith(`${e.shelf}:`), e.id).toBe(true)
  })

  it('writes every board template as a boards.yaml entry the platform accepts', () => {
    for (const e of entries.filter(x => !x.builtin && x.shelf === 'board')) {
      for (const op of e.installs ?? []) {
        expect(op.record).toBe(`boards:${(op.value as { id: string }).id}`)
        expect(validateEntry('boards', op.value as Record<string, unknown>), e.id).toEqual([])
      }
    }
  })

  it('offers a raw entry nowhere to install: maturity raw is shown, never offered (§4.3)', () => {
    for (const e of entries) expect(['raw', 'field-informed', 'reviewed']).toContain(e.tags?.maturity ?? 'field-informed')
  })
})

describe('the first set is a list, so Q6 can be reversed by editing it', () => {
  it('serves what first-set.yaml names (grouped by shelf, in its order within one), and not a folder it does not name', () => {
    const dir = copy()
    writeFileSync(join(dir, 'first-set.yaml'), 'built_in_boards: false\nentries: [system:safe, system:link, board:onboarding]\n')
    expect(loadEntries(dir).map(e => e.id)).toEqual(['board:onboarding', 'system:safe', 'system:link'])
  })
  it('refuses a name with no file, in words', () => {
    const dir = copy()
    writeFileSync(join(dir, 'first-set.yaml'), 'built_in_boards: false\nentries: [board:nope]\n')
    expect(() => loadEntries(dir)).toThrow(/first-set\.yaml names board:nope, but there is no library\/board\/nope\/entry\.yaml/)
  })
})

describe('the entry shape can fail (a check that cannot fail is worse than none)', () => {
  const breakIt = (file: string, from: string, to: string): string => {
    const dir = copy()
    const path = join(dir, file)
    const text = readFileSync(path, 'utf8') as string
    expect(text).toContain(from)
    writeFileSync(path, text.replace(from, to))
    return dir
  }
  it('refuses an unknown shelf', () => {
    const dir = breakIt('board/onboarding/entry.yaml', 'shelf: board', 'shelf: gadget')
    expect(() => loadEntries(dir)).toThrow(/board\/onboarding\/entry\.yaml.*shelf/s)
  })
  it('refuses an entry that is missing its summary', () => {
    const dir = breakIt('board/onboarding/entry.yaml', /summary:.*\n/.exec(readFileSync(join(LIBRARY_DIR, 'board/onboarding/entry.yaml'), 'utf8'))![0], '')
    expect(() => loadEntries(dir)).toThrow(/summary/)
  })
  it('refuses an id that does not begin with its shelf or does not match its folder', () => {
    const dir = breakIt('board/onboarding/entry.yaml', 'id: board:onboarding', 'id: board:welcome')
    expect(() => loadEntries(dir)).toThrow(/its id board:welcome is not board:onboarding, the id its folder library\/board\/onboarding gives it/)
  })
  it('refuses a board install whose id is a built-in board (§4.5: never shadowed)', () => {
    const dir = copy()
    const path = join(dir, 'board/onboarding/entry.yaml')
    const text = (readFileSync(path, 'utf8') as string).replace(/record: boards:onboarding/, 'record: boards:home').replace(/^(\s+)id: onboarding/m, '$1id: home')
    writeFileSync(path, text)
    expect(() => loadEntries(dir)).toThrow(/with the id home, which is a built-in board/)
  })
  it('refuses an unreadable file by naming it', () => {
    const dir = copy()
    mkdirSync(join(dir, 'board/broken'), { recursive: true })
    writeFileSync(join(dir, 'board/broken/entry.yaml'), 'id: [unclosed\n')
    writeFileSync(join(dir, 'first-set.yaml'), 'built_in_boards: false\nentries: [board:broken]\n')
    expect(() => loadEntries(dir)).toThrow(/board\/broken\/entry\.yaml/)
  })
})
