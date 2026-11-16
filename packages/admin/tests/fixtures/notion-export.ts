// The synthetic Notion export (DAO-OS L6 spec §19, Task 12): the shape of Notion's Markdown & CSV export as the spec
// describes it (§9.4), with invented content only. Six databases (circles, docs, meetings, projects, proposals, tasks)
// with the property kinds an org's workspace has (relation lists, people, date ranges, checkbox, status, select), and
// standalone pages, a duplicate title, an emoji title, a 230-character title, a relation to a page outside the export, a
// relation by a title two rows share, a date in another language, and a row with an empty body. No real name, e-mail or
// address appears; members are the placeholders `Steward A`, `Steward B`, `Ops Lead`.
//
// `makeNotionExport(dir, spec?)` writes the folder as an unzipped export: a page is `<Title> <32 hex>.md` with its
// subpages and attachments in `<Title> <32 hex>/`; a database is `<Name> <32 hex>.csv` (and `_all.csv` when asked) with
// its rows' pages in `<Name> <32 hex>/`, each opening with `# <Title>`, a blank line, `Property: value` lines, a blank line
// and the body.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface PageSpec { title: string; id: string; body?: string; children?: PageSpec[]; attachments?: Record<string, string | Buffer>; fileTitle?: string }
export interface RowSpec { title: string; id: string; cells?: Record<string, string>; body?: string; noPage?: boolean; fileTitle?: string }
export interface DbSpec { name: string; id: string; columns: string[]; rows: RowSpec[]; all?: { columns: string[]; rows: RowSpec[] } }
export interface ExportSpec { pages?: PageSpec[]; databases?: DbSpec[]; files?: Record<string, string> }

/** A synthetic Notion id: 32 hex digits ending in `n` (hex). */
export const nid = (prefix: string, n: number): string => `${prefix}${n.toString(16)}`.padStart(32, '0')

/** As Notion links a file in its export: the path with spaces as %20. */
export const href = (path: string): string => path.split('/').map(p => encodeURIComponent(p).replace(/%2F/g, '/')).join('/')

const csvCell = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
const csvLine = (cells: string[]): string => cells.map(csvCell).join(',')

function writePage(dir: string, p: PageSpec): void {
  const base = `${p.fileTitle ?? p.title} ${p.id}`
  writeFileSync(join(dir, `${base}.md`), `# ${p.title}\n\n${p.body ?? ''}`)
  const kids = p.children ?? []
  const files = Object.entries(p.attachments ?? {})
  if (kids.length === 0 && files.length === 0) return
  const sub = join(dir, base)
  mkdirSync(sub, { recursive: true })
  for (const k of kids) writePage(sub, k)
  for (const [name, bytes] of files) writeFileSync(join(sub, name), bytes)
}

function csvOf(columns: string[], rows: RowSpec[]): string {
  return `﻿${[csvLine(columns), ...rows.map(r => csvLine(columns.map((c, i) => (i === 0 ? r.title : r.cells?.[c] ?? ''))))].join('\n')}\n`
}

function writeDb(dir: string, db: DbSpec): void {
  const base = `${db.name} ${db.id}`
  writeFileSync(join(dir, `${base}.csv`), csvOf(db.columns, db.rows))
  if (db.all) writeFileSync(join(dir, `${base}_all.csv`), csvOf(db.all.columns, db.all.rows))
  const sub = join(dir, base)
  mkdirSync(sub, { recursive: true })
  const rows = db.all?.rows ?? db.rows
  const columns = db.all?.columns ?? db.columns
  for (const r of rows) {
    if (r.noPage) continue
    const props = columns.slice(1).filter(c => (r.cells?.[c] ?? '') !== '').map(c => `${c}: ${r.cells![c]}`)
    const head = props.length > 0 ? `${props.join('\n')}\n\n` : ''
    writeFileSync(join(sub, `${r.fileTitle ?? r.title} ${r.id}.md`), `# ${r.title}\n\n${head}${r.body ?? ''}`)
  }
}

/** Writes `spec` (the synthetic export by default) into `dir` as an unzipped Notion Markdown & CSV export. */
export function makeNotionExport(dir: string, spec: ExportSpec = NOTION_EXPORT): string {
  mkdirSync(dir, { recursive: true })
  for (const p of spec.pages ?? []) writePage(dir, p)
  for (const db of spec.databases ?? []) writeDb(dir, db)
  for (const [rel, text] of Object.entries(spec.files ?? {})) {
    mkdirSync(join(dir, rel, '..'), { recursive: true })
    writeFileSync(join(dir, rel), text)
  }
  return dir
}

// ── the synthetic export ────────────────────────────────────────────────────────────────────────────────────────

export const IDS = {
  handbook: nid('a', 1), rhythm: nid('a', 2), notesA: nid('a', 3), notesB: nid('a', 4), seeds: nid('a', 5), long: nid('a', 6),
  circles: nid('d', 1), docs: nid('d', 2), meetings: nid('d', 3), projects: nid('d', 4), proposals: nid('d', 5), tasks: nid('d', 6),
  stewards: nid('c', 1), opsCircle: nid('c', 2),
  charter: nid('e', 1), charter2: nid('e', 2),
  sync: nid('f', 1), retro: nid('f', 2),
  garden: nid('b', 1), shared1: nid('b', 2), shared2: nid('b', 3),
  adopt: nid('9', 1),
  water: nid('8', 1), plan: nid('8', 2),
  gone: nid('7', 0xfff),
}

/** A title of 230 characters; Notion cuts the file's name, the heading holds it whole. */
export const LONG_TITLE = `A very long page title ${'that keeps going '.repeat(13)}`.padEnd(230, 'x').slice(0, 230)
/** A placeholder image's bytes. */
export const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex')

const C = `Circles ${IDS.circles}`
const P = `Projects ${IDS.projects}`

export const NOTION_EXPORT: ExportSpec = {
  pages: [
    {
      title: 'Handbook', id: IDS.handbook,
      body: `Welcome. See [Meeting rhythm](${href(`Handbook ${IDS.handbook}/Meeting rhythm ${IDS.rhythm}.md`)}).\n\n`
        + `![diagram](${href(`Handbook ${IDS.handbook}/diagram.png`)})\n`,
      children: [{ title: 'Meeting rhythm', id: IDS.rhythm, body: 'We meet on the first Monday.\n' }],
      attachments: { 'diagram.png': PNG },
    },
    { title: 'Notes', id: IDS.notesA, body: 'The first notes.\n' },
    { title: 'Notes', id: IDS.notesB, body: 'The second notes.\n' },
    { title: '🌱 Seeds', id: IDS.seeds, body: 'Ideas to plant.\n' },
    { title: LONG_TITLE, id: IDS.long, fileTitle: LONG_TITLE.slice(0, 50), body: 'A page with a long title.\n' },
  ],
  databases: [
    {
      name: 'Circles', id: IDS.circles, columns: ['Name', 'Lead', 'Members', 'Status'],
      rows: [
        { title: 'Stewards', id: IDS.stewards, cells: { Lead: 'Steward A', Members: 'Steward A, Steward B', Status: 'Active' }, body: 'The stewards hold the season.\n' },
        { title: 'Ops', id: IDS.opsCircle, cells: { Lead: 'Ops Lead', Status: 'Active' } },
      ],
    },
    {
      name: 'Docs', id: IDS.docs, columns: ['Name', 'Created by', 'Tags', 'URL'],
      rows: [
        { title: 'Charter', id: IDS.charter, cells: { 'Created by': 'Steward B', Tags: 'governance, core', URL: 'https://example.org/charter' }, body: 'The charter text.\n' },
        { title: 'Charter', id: IDS.charter2, cells: { 'Created by': 'Steward B', Tags: 'governance' } },
      ],
    },
    {
      name: 'Meetings', id: IDS.meetings, columns: ['Name', 'Date', 'Attendees', 'Circle'],
      rows: [
        {
          title: 'Council sync', id: IDS.sync,
          cells: { Date: 'October 29, 2026 10:00 AM', Attendees: 'Steward A, Ops Lead', Circle: `Stewards (${href(`../${C}/Stewards ${IDS.stewards}.md`)})` },
          body: 'We agreed the season.\n',
        },
        { title: 'Retro', id: IDS.retro, cells: { Date: '29 octobre 2026', Attendees: 'Steward B' } },
      ],
    },
    {
      name: 'Projects', id: IDS.projects, columns: ['Name', 'Dates', 'Active', 'Budget', 'Contact', 'Related'],
      rows: [
        {
          title: 'Garden', id: IDS.garden,
          cells: { Dates: 'October 1, 2026 → December 15, 2026', Active: 'Yes', Budget: '1200', Contact: 'garden@example.invalid', Related: `Gone (${href(`../Gone ${IDS.gone}.md`)})` },
          body: 'A garden for the commons.\n',
        },
        { title: 'Shared', id: IDS.shared1, cells: { Active: 'No', Budget: '10' } },
        { title: 'Shared', id: IDS.shared2, cells: { Active: 'No' } },
      ],
    },
    {
      name: 'Proposals', id: IDS.proposals, columns: ['Name', 'Status', 'Created by'],
      rows: [{ title: 'Adopt the charter', id: IDS.adopt, cells: { Status: 'Passed', 'Created by': 'Steward A' }, body: 'We adopt it.\n' }],
    },
    {
      name: 'Tasks', id: IDS.tasks, columns: ['Name', 'Status', 'Assignee', 'Due', 'Project'],
      rows: [
        { title: 'Water the garden', id: IDS.water, cells: { Status: 'Doing', Assignee: 'Steward A', Due: 'November 2, 2026', Project: `Garden (${href(`../${P}/Garden ${IDS.garden}.md`)})` }, body: '' },
        { title: 'Plan', id: IDS.plan, cells: { Status: 'Todo', Project: 'Shared' } },
      ],
    },
  ],
}
