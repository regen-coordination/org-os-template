import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readNotionExport, COMMENTS_NOT_CARRIED, HTML_NOT_BUILT } from '../../lib/imports/notion.mjs'
import { parseNotionCell } from '../../lib/imports/notion-csv.mjs'
import { TITLE_MAX } from '../../lib/imports/bundle.mjs'
import { href, IDS, LONG_TITLE, makeNotionExport, nid } from '../fixtures/notion-export.ts'

// DAO-OS L6 §9.4, Task 12: the Notion reader. It reads only the folder it is given (an unzipped Markdown & CSV export) and
// gives an ImportBundle: pages and subpages by folder, databases from their CSV (the `_all.csv` preferred), rows from their
// pages, cells read in the forms §9.4 names, and everything it cannot read said by name in `notRead`. Every relation and
// link is resolved by the 32-hex id; a title is matched only where no id is given, and only when it is unique.
// Fixtures are synthetic (tests/fixtures/notion-export.ts); no real export is read.

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
const temp = (): string => { const d = mkdtempSync(join(tmpdir(), 'notion-')); dirs.push(d); return d }
const read = (spec?: Parameters<typeof makeNotionExport>[1]) => readNotionExport(makeNotionExport(temp(), spec), { exported: '2026-11-01' })

describe('the Notion reader: pages', () => {
  it('reads pages and subpages by folder, their ids from the 32-hex suffix', () => {
    const b = read()
    expect(b.source).toBe('notion')
    expect(b.exported).toBe('2026-11-01')
    const handbook = b.pages.find(p => p.sid === IDS.handbook)!
    expect(handbook).toMatchObject({ title: 'Handbook', parent: null })
    expect(handbook.body).toContain('Welcome.')
    expect(handbook.body).not.toMatch(/^# Handbook/)
    expect(b.pages.find(p => p.sid === IDS.rhythm)).toMatchObject({ title: 'Meeting rhythm', parent: IDS.handbook, body: 'We meet on the first Monday.\n' })
    expect(handbook.attachments.map(a => a.name)).toEqual(['diagram.png'])
    // A database's rows are its records, not pages.
    expect(b.pages.some(p => p.sid === IDS.stewards)).toBe(false)
  })
})

describe('the Notion reader: databases', () => {
  it('prefers a database\'s _all.csv to the view\'s CSV beside it', () => {
    const db = nid('d', 0x21)
    const b = read({ databases: [{
      name: 'Things', id: db, columns: ['Name', 'Status'], rows: [{ title: 'One', id: nid('1', 1), cells: { Status: 'Open' } }],
      all: { columns: ['Name', 'Status', 'Owner'], rows: [
        { title: 'One', id: nid('1', 1), cells: { Status: 'Open', Owner: 'Steward A' } },
        { title: 'Two', id: nid('1', 2), cells: { Status: 'Done' } },
      ] },
    }] })
    const things = b.collections.find(c => c.sid === db)!
    expect(things.name).toBe('Things')
    expect(things.fields.map(f => f.name)).toEqual(['Name', 'Status', 'Owner'])
    expect(things.rows.map(r => r.title).sort()).toEqual(['One', 'Two'])
  })

  it('ends a row page\'s property lines at the first blank line: the rest is its body', () => {
    const db = nid('d', 0x22)
    const b = read({ databases: [{ name: 'Log', id: db, columns: ['Name', 'Status'],
      rows: [{ title: 'Entry', id: nid('2', 1), cells: { Status: 'Open' }, body: 'Status: this line is the body\n\nMore body.\n' }] }] })
    const row = b.collections.find(c => c.sid === db)!.rows[0]!
    expect(row.values.status).toBe('Open')
    expect(row.body).toBe('Status: this line is the body\n\nMore body.\n')
  })

  it('reads a row with an empty body as one with no body', () => {
    const tasks = read().collections.find(c => c.sid === IDS.tasks)!
    expect(tasks.rows.find(r => r.sid === IDS.water)!.body).toBe('')
  })
})

describe('the Notion reader: cells (§9.4)', () => {
  it('reads dates, a date with a time, and ranges, in English', () => {
    expect(parseNotionCell('October 29, 2026')).toEqual({ value: '2026-10-29', type: 'date' })
    expect(parseNotionCell('October 29, 2026 10:00 AM')).toEqual({ value: '2026-10-29T10:00', type: 'date' })
    expect(parseNotionCell('October 29, 2026 12:30 PM')).toEqual({ value: '2026-10-29T12:30', type: 'date' })
    expect(parseNotionCell('October 1, 2026 → December 15, 2026')).toEqual({ value: { start: '2026-10-01', end: '2026-12-15' }, type: 'daterange' })
    expect(parseNotionCell('29 octobre 2026', 'date')).toHaveProperty('problem')
    expect(parseNotionCell('29 octobre 2026')).toEqual({ value: '29 octobre 2026', type: 'text' })
  })

  it('reads checkboxes, numbers, multi-select, URLs, e-mails and people', () => {
    expect(parseNotionCell('Yes')).toEqual({ value: true, type: 'checkbox' })
    expect(parseNotionCell('No')).toEqual({ value: false, type: 'checkbox' })
    expect(parseNotionCell('1200')).toEqual({ value: 1200, type: 'number' })
    expect(parseNotionCell('governance, core', 'multiselect')).toEqual({ value: ['governance', 'core'], type: 'multiselect' })
    expect(parseNotionCell('https://example.org/charter')).toEqual({ value: 'https://example.org/charter', type: 'url' })
    expect(parseNotionCell('garden@example.invalid')).toEqual({ value: 'garden@example.invalid', type: 'email' })
    expect(parseNotionCell('Steward A, Ops Lead', 'person')).toEqual({ value: ['Steward A', 'Ops Lead'], type: 'person' })
    expect(parseNotionCell('', 'number')).toEqual({ value: null, type: 'number' })
  })

  it('reads relations as items by their 32-hex id, a title alone when no link is given', () => {
    const a = nid('3', 1), b = nid('3', 2)
    const cell = `Garden (${href(`Projects ${nid('d', 4)}/Garden ${a}.md`)}), Shed, roof (${href(`Projects ${nid('d', 4)}/Shed, roof ${b}.md`)})`
    expect(parseNotionCell(cell, 'relation')).toEqual({ value: [{ title: 'Garden', sid: a }, { title: 'Shed, roof', sid: b }], type: 'relation' })
    expect(parseNotionCell('Shared', 'relation')).toEqual({ value: [{ title: 'Shared', sid: null }], type: 'relation' })
    expect(parseNotionCell(cell)).toMatchObject({ type: 'relation' })
  })
})

describe('the Notion reader: a real export\'s quirks (Review Focus 3)', () => {
  it('the export\'s quirks land or are reported, never guessed', () => {
    const b = read()
    // Two pages with one title in one folder are two pages (their ids differ).
    expect(b.pages.filter(p => p.title === 'Notes').map(p => p.sid).sort()).toEqual([IDS.notesA, IDS.notesB])
    // Two rows with one title in one database are two rows.
    expect(b.collections.find(c => c.sid === IDS.docs)!.rows.filter(r => r.title === 'Charter')).toHaveLength(2)
    // A 230-character title (the file name cut by Notion, the heading whole) is cut to 200 with "…".
    const long = b.pages.find(p => p.sid === IDS.long)!
    expect([...LONG_TITLE].length).toBe(230)
    expect([...long.title].length).toBe(TITLE_MAX)
    expect(long.title).toBe(`${[...LONG_TITLE].slice(0, TITLE_MAX - 1).join('')}…`)
    // An emoji title is kept as it is.
    expect(b.pages.find(p => p.sid === IDS.seeds)!.title).toBe('🌱 Seeds')
    // A relation to a page not in the export is reported by name and not carried.
    const projects = b.collections.find(c => c.sid === IDS.projects)!
    expect(projects.rows.find(r => r.sid === IDS.garden)!.values.related).toEqual([])
    expect(b.notRead).toContainEqual(expect.objectContaining({ what: 'Projects · Garden · Related', why: expect.stringContaining('not in the export') }))
    // A relation by a title two rows of the target share is reported, never matched to either.
    const tasks = b.collections.find(c => c.sid === IDS.tasks)!
    expect(tasks.rows.find(r => r.sid === IDS.plan)!.values.project).toEqual([])
    expect(tasks.rows.find(r => r.sid === IDS.water)!.values.project).toEqual([IDS.garden])
    expect(b.notRead).toContainEqual(expect.objectContaining({ what: 'Tasks · Plan · Project', why: expect.stringContaining('2 rows') }))
    expect(tasks.fields.find(f => f.id === 'project')).toMatchObject({ type: 'relation', to: IDS.projects, many: true })
    // A date in another language is kept as text, and its column with it; both are reported.
    const meetings = b.collections.find(c => c.sid === IDS.meetings)!
    expect(meetings.fields.find(f => f.id === 'date')!.type).toBe('text')
    expect(meetings.rows.find(r => r.sid === IDS.retro)!.values.date).toBe('29 octobre 2026')
    expect(b.notRead).toContainEqual(expect.objectContaining({ what: 'Meetings · Retro · Date', why: expect.stringContaining('kept as text') }))
  })

  it('types a people-shaped column as person and an authorship column as an author, never as text members may read', () => {
    const b = read()
    const circles = b.collections.find(c => c.sid === IDS.circles)!
    expect(circles.fields.find(f => f.id === 'lead')).toMatchObject({ type: 'person', many: true })
    expect(circles.rows.find(r => r.sid === IDS.stewards)!.values.members).toEqual(['Steward A', 'Steward B'])
    const docs = b.collections.find(c => c.sid === IDS.docs)!
    expect(docs.fields.find(f => f.id === 'created_by')).toMatchObject({ type: 'person', author: true })
  })
})

describe('the Notion reader: comments', () => {
  it('with no --html, comments are reported not carried', () => {
    const b = read()
    expect(b.comments).toEqual([])
    expect(b.notRead).toContainEqual({ what: 'comments', why: COMMENTS_NOT_CARRIED })
  })

  it('with --html, comments are still not carried: that part is not built until its markup is confirmed (Q4)', () => {
    const html = temp()
    const b = readNotionExport(makeNotionExport(temp()), { exported: '2026-11-01', html })
    expect(b.comments).toEqual([])
    expect(b.notRead).toContainEqual({ what: 'comments', why: HTML_NOT_BUILT })
  })

  it('reports a zip left in the export, and reads nothing the export does not hold', () => {
    const b = read({ files: { 'Part-2.zip': 'PK' } })
    expect(b.notRead).toContainEqual(expect.objectContaining({ what: 'Part-2.zip', why: expect.stringContaining('unzip') }))
  })
})
