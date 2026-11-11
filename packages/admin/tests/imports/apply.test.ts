import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { openPrivateStore, type PrivateStore } from '../../server/private/store.ts'
import { NO_STORE } from '../../server/private/ops.ts'
import type { KnownActor } from '../../server/actor.ts'
import { serverPidFile } from '../../server/state.ts'
import { applyImport, planImport, INTO_NOT_WORKSPACE, INTO_STRICTER, LEVEL_MOVED, NOT_PUBLIC, PAGE_LEVEL_MOVED, PARENT_LEVEL_TAKEN } from '../../server/workspace/imports.ts'
import { readNotionExport } from '../../lib/imports/notion.mjs'
import { pageEntries, pageLevel } from '../../lib/workspace/pages.mjs'
import { isPublic } from '../../lib/visibility.mjs'
import { readConfig } from '../../server/visibility/config.ts'
import { main } from '../../scripts/import.ts'
import { href, IDS, makeNotionExport, nid, NOTION_EXPORT, type ExportSpec } from '../fixtures/notion-export.ts'

// DAO-OS L6 §9 (Task 12): the import pipeline. A plan turns the bundle and the map into writes and a report; applying it is
// one workspace commit (`import: notion <date>`, `Org-Rule: workspace/direct`) with its private part in one store
// transaction around it (L5's order), and a receipt in data/imports.yaml that names no private item. Rule 10: everything
// lands members, a stricter level goes to the store, a looser one is refused; people and contact data land at
// defaults.contact; no name is guessed into a member id. A second run updates only what the Hub left as imported.
//
// Every test builds a fresh temporary repository (makeChangeRepo, whose git identity is steward-a) and keeps its private
// store in a temp folder of its own; the export is the synthetic one (tests/fixtures/notion-export.ts). No network.

const CELO = 'eip155:42220'
const COUNCIL = `${CELO}:0x0000000d0001${'0'.repeat(52)}`
const OPS = `${CELO}:0x0000000d0002${'0'.repeat(52)}`
const AT_OPS = `hat:${OPS}`
const EXPORTED = '2026-11-01'

const SOLO = `schema_version: "2.0"
governance:
  model: "solo-maintainer"
  membership: { tree: hats-main }
  roles:
    council: { hat: "${COUNCIL}" }
    ops: { hat: "${OPS}" }
  decisions: []
`
const SYSTEMS = `schema_version: "2.0"
systems:
  - { id: hats-main, kind: hats-tree, name: Hats, chain: "${CELO}", address: "13", driver: hats-tree }
`
const MEMBERS = `schema_version: "2.0"
members:
  - { id: steward-a, name: Steward A, kind: person, handles: { git: ["admin-test@local"] } }
  - { id: steward-b, name: Steward B, kind: person }
  - { id: ops-lead, name: Ops Lead, kind: person }
`
const POLICY = `visibility:
  defaults: { contact: "${AT_OPS}" }
  collections:
    pages: { default: members }
`
const STEWARD_A: KnownActor = { id: 'steward-a', name: 'Steward A', kind: 'person', via: 'git' }

const cleanup: string[] = []
const stores: PrivateStore[] = []
afterEach(() => {
  for (const s of stores.splice(0)) { try { s.close() } catch { /* closed by the test */ } }
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
})
const temp = (tag: string): string => { const d = mkdtempSync(join(tmpdir(), tag)); cleanup.push(d); return d }

interface World { repo: string; store: PrivateStore; dir: string }

async function world(spec: ExportSpec = NOTION_EXPORT, opts: { policy?: string, governance?: string } = {}): Promise<World> {
  const repo = makeChangeRepo(opts.governance ?? SOLO)
  cleanup.push(repo)
  writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  writeFileSync(join(repo, 'data', 'visibility.yaml'), opts.policy ?? POLICY)
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: the tree, three members, the policy"')
  const store = await openPrivateStore(repo, { dir: temp('import-store-') }); stores.push(store)
  const dir = makeNotionExport(temp('notion-export-'), spec)
  return { repo, store, dir }
}

const bundleOf = (w: World) => readNotionExport(w.dir, { exported: EXPORTED })
const head = (repo: string) => git(repo, 'rev-parse HEAD').trim()
const fileAt = (repo: string, rel: string, rev = 'HEAD') => git(repo, `show ${rev}:${rel}`)
const yamlAt = (repo: string, rel: string) => parse(fileAt(repo, rel)) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const status = (repo: string) => git(repo, 'status --porcelain').trim()
const pagesAt = (repo: string) => git(repo, 'ls-tree --name-only HEAD pages/').split('\n').filter(n => n.endsWith('.md'))
/** L5's sentinel scan (§10.5): every object in the repository's object store, reachable or not, read whole. */
function scan(repo: string, needles: string[]): string[] {
  const all = execFileSync('git', ['cat-file', '--batch-all-objects', '--batch'], { cwd: repo, maxBuffer: 1 << 28 }).toString('utf8')
  return needles.filter(n => all.includes(n))
}
const ops = { databases: { Circles: { level: AT_OPS } } }
const GOVERNANCE = fileURLToPath(new URL('../../../../scripts/validate-governance.mjs', import.meta.url))
const DATA = fileURLToPath(new URL('../../../../scripts/validate-data.mjs', import.meta.url))

describe('the import plan and its apply (L6 §9.2, §9.3)', () => {
  it('everything lands members; a database the map sets to a hat lands in the store as a private collection never named in git', async () => {
    const w = await world()
    const plan = planImport(bundleOf(w), ops, w.repo, w.store)
    await applyImport(w.repo, plan, STEWARD_A, w.store)
    const defs = (yamlAt(w.repo, 'data/collections.yaml').collections as { id: string }[]).map(d => d.id)
    expect(defs.sort()).toEqual(['notion-docs', 'notion-meetings', 'notion-projects', 'notion-proposals', 'notion-tasks'])
    for (const id of defs) expect(yamlAt(w.repo, `data/collections/${id}.yaml`)[id].length).toBeGreaterThan(0)
    // Pages: one root, the standalone pages under it, no level stricter than members in git.
    const files = pagesAt(w.repo)
    const texts = files.map(f => fileAt(w.repo, f))
    expect(texts.filter(t => t.includes('title: Notion archive · 2026-11-01'))).toHaveLength(1)
    for (const t of texts) expect(t).not.toMatch(/^visibility: (?!members|public)/m)
    // The private collection, its records and a row's notes page are in the store at the map's level.
    const circles = w.store.collections().find(c => c.id === 'notion-circles')!
    expect(circles.visibility).toBe(AT_OPS)
    expect(w.store.records('notion-circles').map(r => r.body.title).sort()).toEqual(['Ops', 'Stewards'])
    expect(w.store.records('notion-circles').every(r => r.visibility === AT_OPS)).toBe(true)
    const notes = w.store.records('pages').find(p => p.body.title === 'Stewards')!
    expect(notes.visibility).toBe(AT_OPS)
    expect(notes.body.markdown).toBe('The stewards hold the season.\n')
    // Nothing of it in any object git holds, reachable or not.
    expect(scan(w.repo, ['notion-circles', 'Stewards', 'The stewards hold', 'Circles'])).toEqual([])
    // A git collection's relation into the private one is not carried, and says so without naming it.
    const meetings = yamlAt(w.repo, 'data/collections/notion-meetings.yaml')['notion-meetings'] as Record<string, unknown>[]
    expect(meetings.every(m => !('circle' in m))).toBe(true)
    expect(plan.report.notCarried).toContainEqual(expect.objectContaining({ what: 'Meetings · Circle' }))
    expect(status(w.repo)).toBe('')
  })

  it('a map giving public is refused, NOT_PUBLIC, and nothing is written', async () => {
    const w = await world()
    const before = head(w.repo)
    expect(() => planImport(bundleOf(w), { databases: { Docs: { level: 'public' } } }, w.repo, w.store)).toThrow(NOT_PUBLIC('Docs'))
    expect(() => planImport(bundleOf(w), { pages: { level: 'public' } }, w.repo, w.store)).toThrow(NOT_PUBLIC('the pages'))
    expect(NOT_PUBLIC('Docs')).toBe('Nothing imported is public: the map gives Docs the level public. Nothing was written.')
    expect(head(w.repo)).toBe(before)
    expect(w.store.collections()).toEqual([])
  })

  it('person and author fields land at defaults.contact, and a name in people: becomes that member id', async () => {
    const w = await world()
    const plan = planImport(bundleOf(w), { ...ops, people: { 'Steward A': 'steward-a' } }, w.repo, w.store)
    await applyImport(w.repo, plan, STEWARD_A, w.store)
    const meetings = yamlAt(w.repo, 'data/collections/notion-meetings.yaml')['notion-meetings'] as Record<string, any>[] // eslint-disable-line @typescript-eslint/no-explicit-any
    const sync = meetings.find(m => m.from?.id === IDS.sync)!
    expect(sync.attendees).toEqual(['steward-a'])
    expect(sync).not.toHaveProperty('attendees_names')
    // The unlinked name is a restricted field at the contact level, declared so in data/visibility.yaml.
    expect(w.store.fields('notion-meetings', String(sync.id))).toEqual([
      expect.objectContaining({ field: 'attendees_names', visibility: AT_OPS, value: 'Ops Lead' }),
    ])
    expect(yamlAt(w.repo, 'data/visibility.yaml').visibility.collections['notion-meetings'].fields.attendees_names).toBe(AT_OPS)
    // An e-mail is contact data too.
    const projects = yamlAt(w.repo, 'data/collections/notion-projects.yaml')['notion-projects'] as Record<string, any>[] // eslint-disable-line @typescript-eslint/no-explicit-any
    const garden = projects.find(p => p.from?.id === IDS.garden)!
    expect(w.store.fields('notion-projects', String(garden.id))).toEqual([expect.objectContaining({ field: 'contact', visibility: AT_OPS, value: 'garden@example.invalid' })])
    // Authorship is not carried unless the map asks.
    expect(fileAt(w.repo, 'data/collections/notion-docs.yaml')).not.toContain('created_by')
    expect(plan.report.notCarried).toContainEqual(expect.objectContaining({ what: 'Docs · Created by' }))
    // The names are the members' own in data/members.yaml; none is in an imported record, and the e-mail is nowhere in git.
    expect(fileAt(w.repo, 'data/collections/notion-meetings.yaml')).not.toContain('Ops Lead')
    expect(fileAt(w.repo, 'data/collections/notion-docs.yaml')).not.toContain('Steward B')
    expect(scan(w.repo, ['garden@example.invalid'])).toEqual([])
    const kept = planImport(bundleOf(w), { ...ops, keep_authors: true }, w.repo, w.store)
    expect(kept.writes.private).toContainEqual(expect.objectContaining({ op: 'put-field', field: expect.objectContaining({ field: 'created_by_names', visibility: AT_OPS }) }))
  })

  it('the Proposals database becomes notion-proposals, never the ledger', async () => {
    const w = await world()
    await applyImport(w.repo, planImport(bundleOf(w), ops, w.repo, w.store), STEWARD_A, w.store)
    expect(yamlAt(w.repo, 'data/collections/notion-proposals.yaml')['notion-proposals'][0]).toMatchObject({ title: 'Adopt the charter' })
    expect(existsSync(join(w.repo, 'data', 'proposals.yaml'))).toBe(false)
    expect(() => planImport(bundleOf(w), { databases: { ...ops.databases, Proposals: { into: 'proposals' } } }, w.repo, w.store)).toThrow(INTO_NOT_WORKSPACE('Proposals', 'proposals'))
    expect(() => planImport(bundleOf(w), { databases: { ...ops.databases, Projects: { into: 'projects' } } }, w.repo, w.store)).toThrow(INTO_NOT_WORKSPACE('Projects', 'projects'))
    // A database imported at a hat is not moved by the map: its level is its visibility control's.
    expect(() => planImport(bundleOf(w), {}, w.repo, w.store)).toThrow(LEVEL_MOVED('Circles', AT_OPS))
  })

  it('lands a database in a workspace registry the map names (into: tasks), beside the tasks there', async () => {
    const w = await world()
    writeFileSync(join(w.repo, 'data', 'tasks.yaml'), 'tasks:\n  - { id: t-1, title: Write the brief, status: todo }\n')
    git(w.repo, 'add -A'); git(w.repo, 'commit -qm "fixture: a task"')
    await applyImport(w.repo, planImport(bundleOf(w), { databases: { ...ops.databases, Tasks: { into: 'tasks' } } }, w.repo, w.store), STEWARD_A, w.store)
    const tasks = yamlAt(w.repo, 'data/tasks.yaml').tasks as Record<string, any>[] // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(tasks.map(t => t.title).sort()).toEqual(['Plan', 'Water the garden', 'Write the brief'])
    expect(tasks[0]!.id).toBe('t-1')
    const water = tasks.find(t => t.from?.id === IDS.water)!
    expect(water).toMatchObject({ status: 'Doing', due: '2026-11-02', from: { source: 'notion', id: IDS.water, exported: EXPORTED } })
    expect(existsSync(join(w.repo, 'data', 'collections', 'notion-tasks.yaml'))).toBe(false)
    // tasks' own `project` names a project of data/projects.yaml: the export's relation to its Projects is not put there.
    expect(water).not.toHaveProperty('project')
    expect(() => planImport(bundleOf(w), { databases: { ...ops.databases, Docs: { into: 'tasks', level: AT_OPS } } }, w.repo, w.store)).toThrow(INTO_STRICTER('Docs', 'tasks'))
  })

  it('makes one commit, import: notion <date>, Org-Rule: workspace/direct, with a receipt naming no private collection or title', async () => {
    const w = await world()
    const before = head(w.repo)
    const plan = planImport(bundleOf(w), ops, w.repo, w.store)
    const { commit } = await applyImport(w.repo, plan, STEWARD_A, w.store)
    expect(commit).toBe(head(w.repo))
    expect(git(w.repo, 'rev-parse HEAD~1').trim()).toBe(before)
    const message = git(w.repo, 'log -1 --format=%B')
    expect(message.split('\n')[0]).toBe('import: notion 2026-11-01')
    expect(message).toContain('Org-Rule: workspace/direct')
    expect(message).toMatch(/Org-Change: imp_[0-9a-f]+/)
    const [receipt] = yamlAt(w.repo, 'data/imports.yaml').imports
    expect(receipt).toMatchObject({ source: 'notion', export: EXPORTED, by: 'steward-a', updated: 0, kept: 0 })
    // Counts take in the private collection, its records and pages: a count names nothing.
    expect(receipt.created).toEqual({ pages: plan.report.created.pages, records: plan.report.created.records, collections: 6 })
    expect(receipt.id).toMatch(/^imp_[0-9a-f]+$/)
    expect(Object.keys(receipt.blobs).length).toBeGreaterThan(0)
    expect(receipt.not_carried).toContainEqual(expect.objectContaining({ what: expect.stringMatching(/^\d+ items? in a restricted collection/) }))
    const text = fileAt(w.repo, 'data/imports.yaml')
    for (const name of ['circles', 'Circles', 'Stewards', 'Ops']) expect(text).not.toContain(name)
    // The attachment of a git page is in git, beside its page, and the page links to it there.
    const handbook = pagesAt(w.repo).map(f => fileAt(w.repo, f)).find(t => t.includes('title: Handbook'))!
    const id = /^id: (.+)$/m.exec(handbook)![1]
    expect(git(w.repo, `ls-tree --name-only HEAD pages/assets/${id}/`).trim()).toBe(`pages/assets/${id}/diagram.png`)
    expect(handbook).toContain(`![diagram](./assets/${id}/diagram.png)`)
    expect(handbook).toMatch(/\[Meeting rhythm\]\(\.\/meeting-rhythm-[0-9a-f]{4}\.md\)/)
  })

  it('validate:governance --strict and validate:data accept the import\'s commit', async () => {
    const w = await world()
    await applyImport(w.repo, planImport(bundleOf(w), { ...ops, people: { 'Steward A': 'steward-a' } }, w.repo, w.store), STEWARD_A, w.store)
    const at = head(w.repo).slice(0, 7)
    const gov = spawnSync('node', [GOVERNANCE, w.repo, '--strict'], { encoding: 'utf8', env: { ...process.env, CI: '' } })
    expect(gov.stdout.split('\n').filter(l => l.includes(at) && /^\s*[✗⚠]/.test(l))).toEqual([])
    const data = spawnSync('node', [DATA, w.repo], { encoding: 'utf8', env: { ...process.env, CI: '' } })
    expect([data.status, data.stdout.split('\n').filter(l => /✗|error/i.test(l))]).toEqual([0, []])
  })

  it('a second run changes nothing; an item edited in the Hub since is kept and reported', async () => {
    const w = await world()
    await applyImport(w.repo, planImport(bundleOf(w), ops, w.repo, w.store), STEWARD_A, w.store)
    const first = head(w.repo)
    const again = planImport(bundleOf(w), ops, w.repo, w.store)
    expect(again.writes.git).toEqual([])
    expect(again.writes.private).toEqual([])
    expect(again.report).toMatchObject({ created: { pages: 0, records: 0, collections: 0 }, updated: 0, kept: [] })
    expect(await applyImport(w.repo, again, STEWARD_A, w.store)).toEqual({ commit: null })
    expect(head(w.repo)).toBe(first)
    // The Handbook is edited in the Hub; then a newer export changes it and its subpage.
    const file = pagesAt(w.repo).find(f => fileAt(w.repo, f).includes('title: Handbook'))!
    writeFileSync(join(w.repo, file), `${readFileSync(join(w.repo, file), 'utf8')}\nAn edit made in the Hub.\n`)
    git(w.repo, `add ${file}`); git(w.repo, 'commit -qm "page: Handbook"')
    const newer = structuredClone(NOTION_EXPORT)
    newer.pages![0]!.body = 'Welcome, again.\n'
    newer.pages![0]!.children![0]!.body = 'We meet on the second Monday.\n'
    rmSync(w.dir, { recursive: true, force: true })
    makeNotionExport(w.dir, newer)
    const third = planImport(readNotionExport(w.dir, { exported: '2026-11-04' }), ops, w.repo, w.store)
    expect(third.report.updated).toBe(1)
    expect(third.report.kept).toEqual([{ what: 'Handbook', why: 'edited in the Hub since it was imported — kept' }])
    await applyImport(w.repo, third, STEWARD_A, w.store)
    expect(fileAt(w.repo, file)).toContain('An edit made in the Hub.')
    expect(fileAt(w.repo, file)).not.toContain('Welcome, again.')
    const rhythm = pagesAt(w.repo).map(f => fileAt(w.repo, f)).find(t => t.includes('title: Meeting rhythm'))!
    expect(rhythm).toContain('We meet on the second Monday.')
    expect(yamlAt(w.repo, 'data/imports.yaml').imports).toHaveLength(2)
  })

  it('an import with a private part refuses before its commit when the store is down (Review Focus 5)', async () => {
    const w = await world()
    const before = head(w.repo)
    const plan = planImport(bundleOf(w), ops, w.repo, w.store)
    await expect(applyImport(w.repo, plan, STEWARD_A, null)).rejects.toMatchObject({ status: 503, message: NO_STORE })
    w.store.close()
    await expect(applyImport(w.repo, plan, STEWARD_A, w.store)).rejects.toMatchObject({ status: 503 })
    expect(head(w.repo)).toBe(before)
    expect(status(w.repo)).toBe('')
  })
})

// The review of Task 12 (platform full, at 894612b9): each finding's shape, reproduced with synthetic fixtures, and the
// sentinel scan (every object in the object store, reachable or not) extended to each.
/** A 32-hex id written as Notion's URLs and API write it: 8-4-4-4-12. */
const dashed = (sid: string) => `${sid.slice(0, 8)}-${sid.slice(8, 12)}-${sid.slice(12, 16)}-${sid.slice(16, 20)}-${sid.slice(20)}`
const P = {
  index: nid('a', 0x11), payroll: nid('d', 0x11), plain: nid('c', 0x11), bonus: nid('c', 0x12), review: nid('c', 0x13), salary: nid('c', 0x14),
  projects: nid('d', 0x12), garden: nid('b', 0x11), shed: nid('b', 0x12),
}
const PAYROLL = `Payroll ${P.payroll}`
const payroll = (over: Partial<ExportSpec> = {}): ExportSpec => ({
  pages: over.pages ?? [],
  databases: [
    {
      name: 'Payroll', id: P.payroll, columns: ['Name', 'Status'],
      rows: [
        { title: 'Plain row', id: P.plain, cells: { Status: 'A' }, body: 'secret body one\n' },
        { title: 'Bonus (Q4)', id: P.bonus, cells: { Status: 'B' } },
        { title: 'Review [draft]', id: P.review, cells: { Status: 'C' } },
      ],
    },
    ...(over.databases ?? []),
  ],
  files: { [`${PAYROLL}/Plain row ${P.plain}/Salary bands (2026) ${P.salary}.md`]: '# Salary bands (2026)\n\nband text\n', ...(over.files ?? {}) },
})
const atOps = { databases: { Payroll: { level: AT_OPS } } }
const PRIVATE_WORDS = ['Payroll', 'Bonus (Q4)', 'Bonus', 'Review [draft]', 'Review', 'Salary bands', 'Plain row', 'secret body one', 'band text']
const privateIds = (...sids: string[]) => sids.flatMap(s => [s, dashed(s)])

describe('the import after its review (Task 12 review)', () => {
  it('C1: a git page\'s links into private items carry ↗ alone, whatever their labels and paths hold', async () => {
    const body = [
      `The database: [Payroll](${href(`${PAYROLL}.csv`)})`,
      `A row: [Plain row](${href(`${PAYROLL}/Plain row ${P.plain}.md`)})`,
      `A paren row: [Bonus (Q4)](${href(`${PAYROLL}/Bonus (Q4) ${P.bonus}.md`)})`,
      `A bracket row: [Review [draft]](${href(`${PAYROLL}/Review [draft] ${P.review}.md`)})`,
      `A paren page: [Salary bands (2026)](${href(`${PAYROLL}/Plain row ${P.plain}/Salary bands (2026) ${P.salary}.md`)})`,
      `On Notion: [Bonus (Q4)](https://www.notion.so/acme/Bonus-Q4-${P.bonus}) and [the bands](https://www.notion.so/${dashed(P.salary)}?pvs=4)`,
      `A label only: [Payroll](https://example.org/elsewhere) and <https://www.notion.so/Payroll-${P.payroll}>`,
      '',
    ].join('\n')
    const w = await world(payroll({ pages: [{ title: 'Index', id: P.index, body }] }))
    const plan = planImport(bundleOf(w), atOps, w.repo, w.store)
    await applyImport(w.repo, plan, STEWARD_A, w.store)
    const index = pagesAt(w.repo).map(f => fileAt(w.repo, f)).find(t => t.includes('title: Index'))!
    expect(index).toContain('The database: ↗')
    expect(index).toMatch(/A row: \[↗\]\(\.\/p-[0-9a-f]{12}\.md\)|A row: ↗/)
    expect(index).toContain('A paren row: ↗')
    expect(index).toContain('A bracket row: ↗')
    expect(index).toMatch(/A paren page: \[↗\]\(\.\/p-[0-9a-f]{12}\.md\)/)
    expect(index).toContain('On Notion: ↗ and ↗')
    expect(index).toContain('A label only: ↗ and ↗')
    expect(scan(w.repo, [...PRIVATE_WORDS, ...privateIds(P.payroll, P.plain, P.bonus, P.review, P.salary)])).toEqual([])
    expect(status(w.repo)).toBe('')
  })

  it('C1: a private item\'s id left in a git page\'s text outside a link refuses the import, naming the page, before any write', async () => {
    const w = await world(payroll({ pages: [{ title: 'Index', id: P.index, body: `See \`${dashed(P.bonus)}\` and Payroll%20${P.payroll}.csv for the figures.\n` }] }))
    const before = head(w.repo)
    let err: unknown
    try { planImport(bundleOf(w), atOps, w.repo, w.store) } catch (e) { err = e }
    expect(err).toMatchObject({ status: 422, code: 'PRIVATE_IN_TEXT' })
    expect((err as Error).message).toContain('Index')
    for (const word of ['Payroll', 'Bonus', P.bonus, P.payroll]) expect((err as Error).message).not.toContain(word)
    expect(head(w.repo)).toBe(before)
    expect(w.store.collections()).toEqual([])
  })

  it('C1: a git record\'s text naming a private item is not carried, and said so without naming it', async () => {
    const projects = {
      name: 'Projects', id: P.projects, columns: ['Name', 'Note'],
      rows: [
        { title: 'Garden', id: P.garden, cells: { Note: `see Plain row (${href(`../${PAYROLL}/Plain row ${P.plain}.md`)}), and more` } },
        { title: 'Shed', id: P.shed, cells: { Note: 'an ordinary note' } },
      ],
    }
    const w = await world(payroll({ databases: [projects] }))
    const plan = planImport(bundleOf(w), atOps, w.repo, w.store)
    await applyImport(w.repo, plan, STEWARD_A, w.store)
    const rows = yamlAt(w.repo, 'data/collections/notion-projects.yaml')['notion-projects'] as Record<string, unknown>[]
    expect(rows.find(r => r.title === 'Shed')).toMatchObject({ note: 'an ordinary note' })
    expect(rows.find(r => r.title === 'Garden')).not.toHaveProperty('note')
    expect(plan.report.notCarried).toContainEqual(expect.objectContaining({ what: 'Projects · Garden · Note' }))
    expect(scan(w.repo, [...PRIVATE_WORDS, ...privateIds(P.payroll, P.plain, P.bonus, P.review, P.salary)])).toEqual([])
  })

  it('I1: a column is contact data by its name or by any cell, and lands at defaults.contact, lists of addresses too', async () => {
    const people: NonNullable<ExportSpec['databases']>[number] = {
      name: 'People', id: P.projects, columns: ['Name', 'Email', 'Phone', 'Teléfono', 'Reach', 'Note'],
      rows: [
        { title: 'Garden', id: P.garden, cells: { Email: 'ana@example.invalid', Phone: '5550100111', 'Teléfono': '5550100333', Reach: 'ask at the desk', Note: 'plain words' } },
        { title: 'Shed', id: P.shed, cells: { Email: 'bo@example.invalid, cy@example.invalid', Phone: '5550100222', Reach: 'dee@example.invalid', Note: 'more words' } },
      ],
    }
    const w = await world({ databases: [people] })
    const plan = planImport(bundleOf(w), {}, w.repo, w.store)
    expect(plan.databases[0]!.fields).toMatchObject({ email: 'email', phone: 'phone', telefono: 'phone', reach: 'email', note: 'text' })
    await applyImport(w.repo, plan, STEWARD_A, w.store)
    const rows = yamlAt(w.repo, 'data/collections/notion-people.yaml')['notion-people'] as Record<string, unknown>[]
    const shed = rows.find(r => r.title === 'Shed')!
    expect(w.store.fields('notion-people', String(shed.id))).toContainEqual(expect.objectContaining({ field: 'email', visibility: AT_OPS, value: ['bo@example.invalid', 'cy@example.invalid'] }))
    const garden = rows.find(r => r.title === 'Garden')!
    expect(w.store.fields('notion-people', String(garden.id))).toContainEqual(expect.objectContaining({ field: 'reach', visibility: AT_OPS, value: 'ask at the desk' }))
    expect(garden).toMatchObject({ note: 'plain words' })
    expect(scan(w.repo, ['ana@example.invalid', 'bo@example.invalid', 'cy@example.invalid', 'dee@example.invalid', '5550100111', '5550100222', '5550100333', 'ask at the desk'])).toEqual([])
  })

  it('I2: the receipt quotes no cell; the printed report does', async () => {
    const projects = {
      name: 'Projects', id: P.projects, columns: ['Name', 'Reach', 'Link', 'Score', 'Due'],
      rows: [
        { title: 'Garden', id: P.garden, cells: { Reach: 'ana@example.invalid', Link: `Plain row (${href(`../${PAYROLL}/Plain row ${P.plain}.md`)})`, Score: '12', Due: 'November 2, 2026' } },
        { title: 'Shed', id: P.shed, cells: { Reach: 'ring Probe Person on 555 0100 after six', Link: `Shed (${href(`../Projects ${P.projects}/Shed ${P.shed}.md`)})`, Score: 'Probe Person 555 0100', Due: 'Probe Date 555 0199' } },
      ],
    }
    const w = await world(payroll({ databases: [projects] }))
    const plan = planImport(bundleOf(w), { databases: { Payroll: { level: AT_OPS }, Projects: { fields: { reach: 'email', score: 'number' } } } }, w.repo, w.store)
    const printed = plan.report.notCarried.map(n => `${n.what}: ${n.why}`).join('\n')
    expect(printed).toContain('Probe Person 555 0100')
    expect(printed).toContain('Probe Date 555 0199')
    await applyImport(w.repo, plan, STEWARD_A, w.store)
    const receipt = fileAt(w.repo, 'data/imports.yaml')
    expect(receipt).toContain('Projects · Shed · Score')
    // The cell kept as text (a column with a date in it) is the record's, at members; the receipt does not quote it.
    expect(receipt).not.toMatch(/Probe Date|555 0199/)
    expect(scan(w.repo, ['Probe Person', '555 0100', 'ana@example.invalid', ...PRIVATE_WORDS, ...privateIds(P.payroll, P.plain, P.bonus, P.review, P.salary)])).toEqual([])
  })

  it('I3: what sits in a private item\'s folder takes its level: a page under a row with no page, a database in a private row', async () => {
    const Q = { db: nid('d', 0x31), row: nid('c', 0x31), ghost: nid('c', 0x32), memo: nid('a', 0x31), inner: nid('d', 0x32), innerRow: nid('b', 0x31) }
    const base = `Payroll ${Q.db}`
    const spec: ExportSpec = {
      databases: [{ name: 'Payroll', id: Q.db, columns: ['Name'], rows: [{ title: 'Alice row', id: Q.row, body: 'row body\n' }, { title: 'Ghost row', id: Q.ghost, noPage: true }] }],
      files: {
        [`${base}/Ghost row ${Q.ghost}/Ghost salary memo ${Q.memo}.md`]: '# Ghost salary memo\n\nghost memo text\n',
        [`${base}/Alice row ${Q.row}/Alice reviews ${Q.inner}.csv`]: 'Name,Score\nQ3 review,2\n',
        [`${base}/Alice row ${Q.row}/Alice reviews ${Q.inner}/Q3 review ${Q.innerRow}.md`]: '# Q3 review\n\nScore: 2\n\nreview text\n',
      },
    }
    const w = await world(spec)
    const map = { databases: { Payroll: { level: AT_OPS } } }
    const plan = planImport(bundleOf(w), map, w.repo, w.store)
    expect(plan.databases.find(d => d.name === 'Alice reviews')).toMatchObject({ level: AT_OPS, within: 'Payroll · Alice row' })
    // The map may set it stricter, never looser.
    expect(() => planImport(bundleOf(w), { databases: { ...map.databases, 'Alice reviews': { level: 'members' } } }, w.repo, w.store))
      .toThrow(expect.objectContaining({ code: 'LOOSER_THAN_PARENT' }))
    await applyImport(w.repo, plan, STEWARD_A, w.store)
    expect(w.store.records('pages').map(r => [r.body.title, r.visibility])).toContainEqual(['Ghost salary memo', AT_OPS])
    expect(w.store.collections().map(c => [c.id, c.visibility])).toContainEqual(['notion-alice-reviews', AT_OPS])
    expect(scan(w.repo, ['Ghost salary memo', 'ghost memo text', 'Alice reviews', 'Q3 review', 'review text', 'Ghost row', 'Alice row', 'Payroll',
      ...privateIds(Q.db, Q.row, Q.ghost, Q.memo, Q.inner, Q.innerRow)])).toEqual([])
  })

  it('I3: a database inside a private standalone page takes the page\'s level, and the dry run\'s map shows where it sits', async () => {
    const Q = { vault: nid('a', 0x41), ledger: nid('d', 0x41), entry: nid('b', 0x41) }
    const spec: ExportSpec = {
      pages: [{ title: 'Vault', id: Q.vault, body: 'vault words\n' }],
      files: {
        [`Vault ${Q.vault}/Ledger ${Q.ledger}.csv`]: 'Name,Amount\nEntry one,5\n',
        [`Vault ${Q.vault}/Ledger ${Q.ledger}/Entry one ${Q.entry}.md`]: '# Entry one\n\nAmount: 5\n\nentry text\n',
      },
    }
    const w = await world(spec)
    const plan = planImport(bundleOf(w), { pages: { level: AT_OPS } }, w.repo, w.store)
    expect(plan.databases).toEqual([expect.objectContaining({ name: 'Ledger', level: AT_OPS, within: 'Vault' })])
    await applyImport(w.repo, plan, STEWARD_A, w.store)
    expect(w.store.records('notion-ledger').map(r => [r.body.title, r.visibility])).toEqual([['Entry one', AT_OPS]])
    expect(scan(w.repo, ['Vault', 'vault words', 'Ledger', 'Entry one', 'entry text', ...privateIds(Q.vault, Q.ledger, Q.entry)])).toEqual([])
    // The dry run's map file says where each nested database sits.
    const dry = await world(spec)
    expect(await main(['notion', dry.dir], { repo: dry.repo, out: () => {}, err: () => {} })).toBe(0)
    expect(parse(readFileSync(join(dry.dir, 'hub-import-map.yaml'), 'utf8')).databases.Ledger).toMatchObject({ within: 'Vault' })
  })

  it('I4: an import\'s private part is judged at its targets as the hand routes judge them, and refused 403 under a raised rule', async () => {
    const raised = (target: string) => `schema_version: "2.0"
governance:
  model: "consensus"
  membership: { tree: hats-main }
  roles:
    council: { hat: "${COUNCIL}" }
    ops: { hat: "${OPS}" }
    maintainer: { members: [steward-a] }
    member: { all: true }
  rules:
    - { id: held, applies_to: ["${target}"], propose: member, decide: { by: maintainer, method: approve, count: 1 } }
  decisions: []
`
    const spec: ExportSpec = {
      pages: [{ title: 'Index', id: P.index, body: 'index words\n' }],
      databases: [{ name: 'Payroll', id: P.payroll, columns: ['Name'], rows: [{ title: 'Alice row', id: P.plain }] }],
    }
    for (const [target, map] of [
      ['workspace:collections', atOps],
      ['workspace:notion-payroll', atOps],
      ['workspace:pages', { pages: { level: AT_OPS } }],
    ] as const) {
      const w = await world(spec, { governance: raised(target) })
      const before = head(w.repo)
      const plan = planImport(bundleOf(w), map, w.repo, w.store)
      await expect(applyImport(w.repo, plan, STEWARD_A, w.store)).rejects.toMatchObject({ status: 403, code: 'RAISED' })
      expect([target, head(w.repo)]).toEqual([target, before])
      expect([target, w.store.collections(), w.store.records('pages')]).toEqual([target, [], []])
    }
  })

  it('I5: nothing imported is public, whatever the policy\'s defaults; validate:governance --strict still accepts the commit', async () => {
    const policy = `visibility:
  defaults: { contact: "${AT_OPS}" }
  collections:
    pages: { default: public }
    notion-projects: { default: public }
    shelf: { default: public }
`
    const spec: ExportSpec = {
      pages: [{ title: 'Index', id: P.index, body: 'members-only words\n', children: [{ title: 'Child', id: nid('a', 0x51), body: 'child words\n' }] }],
      databases: [
        { name: 'Projects', id: P.projects, columns: ['Name', 'Note'], rows: [{ title: 'Garden', id: P.garden, cells: { Note: 'members-only note' }, body: 'garden notes\n' }] },
        { name: 'Tools', id: nid('d', 0x51), columns: ['Name', 'Note'], rows: [{ title: 'Rake', id: nid('b', 0x51), cells: { Note: 'tool note' } }] },
      ],
    }
    const w = await world(spec, { policy })
    writeFileSync(join(w.repo, 'data', 'collections.yaml'), 'collections:\n  - { id: shelf, name: Shelf, fields: [ { id: title, type: text, name: Title }, { id: note, type: text, name: Note } ] }\n')
    mkdirSync(join(w.repo, 'data', 'collections'), { recursive: true })
    writeFileSync(join(w.repo, 'data', 'collections', 'shelf.yaml'), 'shelf:\n  - { id: one, title: One }\n')
    git(w.repo, 'add -A'); git(w.repo, 'commit -qm "fixture: a shelf, public by default"')
    await applyImport(w.repo, planImport(bundleOf(w), { databases: { Tools: { into: 'shelf' } } }, w.repo, w.store), STEWARD_A, w.store)
    const pol = readConfig(w.repo)
    const byId = pageEntries(pagesAt(w.repo).map(f => ({ id: f.replace(/^pages\/|\.md$/g, ''), text: fileAt(w.repo, f) })), [])
    const imported = [...byId.values()].filter(e => (e.from as { source?: string } | undefined)?.source === 'notion')
    expect(imported.length).toBe(4) // the root, Index, Child, Garden's notes
    for (const e of imported) expect([e.title, pageLevel(e.id, byId, pol).level]).toEqual([e.title, 'members'])
    const projects = yamlAt(w.repo, 'data/collections/notion-projects.yaml')['notion-projects'] as Record<string, unknown>[]
    const shelf = (yamlAt(w.repo, 'data/collections/shelf.yaml').shelf as Record<string, unknown>[]).filter(r => r.from)
    expect(projects.length + shelf.length).toBe(2)
    for (const [c, r] of [...projects.map(r => ['notion-projects', r] as const), ...shelf.map(r => ['shelf', r] as const)]) expect([c, isPublic(pol, c, r)]).toEqual([c, false])
    const at = head(w.repo).slice(0, 7)
    const gov = spawnSync('node', [GOVERNANCE, w.repo, '--strict'], { encoding: 'utf8', env: { ...process.env, CI: '' } })
    expect(gov.stdout.split('\n').filter(l => l.includes(at) && /^\s*[✗⚠]/.test(l))).toEqual([])
  })

  it('I6: an attachment replaced in the Hub is kept on a re-run, which then makes no commit; one the Hub left is updated', async () => {
    const spec = (bytes: string): ExportSpec => ({ pages: [{ title: 'Index', id: P.index, body: `![d](${href(`Index ${P.index}/d.png`)})\n`, attachments: { 'd.png': Buffer.from(bytes) } }] })
    const w = await world(spec('EXPORT-BYTES'))
    await applyImport(w.repo, planImport(bundleOf(w), {}, w.repo, w.store), STEWARD_A, w.store)
    const asset = git(w.repo, 'ls-tree -r --name-only HEAD pages/assets/').trim()
    expect(Object.keys(yamlAt(w.repo, 'data/imports.yaml').imports[0].blobs)).toContain(asset)
    // The Hub replaces the image; the same export again keeps it, says so, and makes no commit.
    writeFileSync(join(w.repo, asset), 'HUB-EDITED-BYTES'); git(w.repo, 'add -A'); git(w.repo, 'commit -qm "hub: replace the image"')
    const hubbed = head(w.repo)
    const again = planImport(bundleOf(w), {}, w.repo, w.store)
    expect(again.writes.assets).toEqual([])
    expect(again.report.kept).toEqual([{ what: 'Index · d.png', why: 'edited in the Hub since it was imported — kept' }])
    expect(await applyImport(w.repo, again, STEWARD_A, w.store)).toEqual({ commit: null })
    expect([head(w.repo), fileAt(w.repo, asset)]).toEqual([hubbed, 'HUB-EDITED-BYTES'])
    // Another world: the Hub leaves it, a newer export changes it: it is updated.
    const v = await world(spec('EXPORT-BYTES'))
    await applyImport(v.repo, planImport(bundleOf(v), {}, v.repo, v.store), STEWARD_A, v.store)
    rmSync(v.dir, { recursive: true, force: true }); makeNotionExport(v.dir, spec('NEWER-BYTES'))
    await applyImport(v.repo, planImport(bundleOf(v), {}, v.repo, v.store), STEWARD_A, v.store)
    expect(fileAt(v.repo, git(v.repo, 'ls-tree -r --name-only HEAD pages/assets/').trim())).toBe('NEWER-BYTES')
  })

  it('minor: two attachments whose names clean to one are both carried, the second suffixed, and the links follow', async () => {
    const w = await world({ pages: [{ title: 'Index', id: P.index, body: `![a](${href(`Index ${P.index}/a b.png`)}) ![b](${href(`Index ${P.index}/a-b.png`)})\n`, attachments: { 'a b.png': Buffer.from('ONE'), 'a-b.png': Buffer.from('TWO') } }] })
    const plan = planImport(bundleOf(w), {}, w.repo, w.store)
    const paths = plan.writes.assets.map(a => a.path)
    expect(new Set(paths).size).toBe(2)
    expect(paths.map(p => p.split('/').pop()).sort()).toEqual(['a-b-2.png', 'a-b.png'])
    await applyImport(w.repo, plan, STEWARD_A, w.store)
    const index = pagesAt(w.repo).map(f => fileAt(w.repo, f)).find(t => t.includes('title: Index'))!
    const id = /^id: (.+)$/m.exec(index)![1]
    const byName = Object.fromEntries(['a-b.png', 'a-b-2.png'].map(n => [fileAt(w.repo, `pages/assets/${id}/${n}`), n]))
    expect(index).toContain(`![a](./assets/${id}/${byName.ONE})`)
    expect(index).toContain(`![b](./assets/${id}/${byName.TWO})`)
  })

  it('minor: an entry about an item of a private database stays a count in the receipt, whatever names it', async () => {
    const projects = {
      name: 'Projects', id: P.projects, columns: ['Name', 'Link'],
      rows: [
        { title: 'Garden', id: P.garden, cells: { Link: `Plain row (${href(`../${PAYROLL}/Plain row ${P.plain}.md`)})` } },
        { title: 'Shed', id: P.shed, cells: { Link: `Hall (${href(`../Projects ${P.projects}/Hall ${nid('b', 0x13)}.md`)})` } },
        { title: 'Hall', id: nid('b', 0x13), cells: { Link: `Shed (${href(`../Projects ${P.projects}/Shed ${P.shed}.md`)})` } },
      ],
    }
    const w = await world(payroll({ databases: [projects] }))
    const bundle = bundleOf(w)
    // As the reader says it: the item's database in `to`; and an entry that names the private item in its words alone.
    expect(bundle.notRead).toContainEqual(expect.objectContaining({ what: 'Projects · Garden · Link', to: P.payroll }))
    bundle.notRead.push({ what: 'Projects · Garden · Link', why: `a relation to an item of another database (${P.plain}): not carried`, at: P.projects })
    const plan = planImport(bundle, atOps, w.repo, w.store)
    await applyImport(w.repo, plan, STEWARD_A, w.store)
    const receipt = fileAt(w.repo, 'data/imports.yaml')
    expect(receipt).not.toContain('Projects · Garden · Link')
    expect(receipt).toMatch(/\d+ items in a restricted collection or page/)
    expect(scan(w.repo, [...PRIVATE_WORDS, ...privateIds(P.payroll, P.plain, P.bonus, P.review, P.salary)])).toEqual([])
  })

  it('minor: a re-run whose map moves the pages\' level is refused with a true sentence, nothing written', async () => {
    const w = await world({ pages: [{ title: 'Index', id: P.index, body: 'first body\n' }] })
    await applyImport(w.repo, planImport(bundleOf(w), {}, w.repo, w.store), STEWARD_A, w.store)
    const before = head(w.repo)
    rmSync(w.dir, { recursive: true, force: true })
    makeNotionExport(w.dir, { pages: [{ title: 'Index', id: P.index, body: 'second body, now meant for ops only\n' }] })
    expect(() => planImport(readNotionExport(w.dir, { exported: '2026-11-02' }), { pages: { level: AT_OPS } }, w.repo, w.store))
      .toThrow(PAGE_LEVEL_MOVED('The page "Index"', 'members', AT_OPS))
    expect(PAGE_LEVEL_MOVED('The page "Index"', 'members', AT_OPS)).toBe(`The page "Index" was imported at members, and this run would put it at ${AT_OPS}: change a page's level with its visibility control, not the map. Nothing was written.`)
    expect(head(w.repo)).toBe(before)
    expect(w.store.records('pages')).toEqual([])
  })

  it('minor: a page whose level and its container\'s are not within one another takes the container\'s, and the report says so', async () => {
    const w = await world(payroll())
    const plan = planImport(bundleOf(w), { ...atOps, pages: { level: `hat:${COUNCIL}` } }, w.repo, w.store)
    expect(plan.report.notCarried).toContainEqual({ what: 'Salary bands (2026)', why: PARENT_LEVEL_TAKEN })
    const receipt = plan.receipt.not_carried.map(n => n.what).join('\n')
    expect(receipt).not.toContain('Salary bands')
    await applyImport(w.repo, plan, STEWARD_A, w.store)
    expect(w.store.records('pages').map(r => [r.body.title, r.visibility])).toContainEqual(['Salary bands (2026)', AT_OPS])
  })

  it('minor: two databases into one registry take one set of ids, so no row overwrites another', async () => {
    const spec: ExportSpec = { databases: [
      { name: 'Tasks A', id: nid('d', 0x61), columns: ['Name', 'Status'], rows: [{ title: 'Plan', id: nid('b', 0x61), cells: { Status: 'Todo' } }] },
      { name: 'Tasks B', id: nid('d', 0x62), columns: ['Name', 'Status'], rows: [{ title: 'Plan', id: nid('b', 0x62), cells: { Status: 'Doing' } }] },
    ] }
    const w = await world(spec)
    writeFileSync(join(w.repo, 'data', 'tasks.yaml'), 'tasks:\n  - { id: t-1, title: Write the brief, status: todo }\n')
    git(w.repo, 'add -A'); git(w.repo, 'commit -qm "fixture: a task"')
    await applyImport(w.repo, planImport(bundleOf(w), { databases: { 'Tasks A': { into: 'tasks' }, 'Tasks B': { into: 'tasks' } } }, w.repo, w.store), STEWARD_A, w.store)
    const tasks = yamlAt(w.repo, 'data/tasks.yaml').tasks as Record<string, any>[] // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(tasks.map(t => [t.id, t.status]).sort()).toEqual([['plan', 'Todo'], ['plan-2', 'Doing'], ['t-1', 'todo']])
  })

  it('minor: a row\'s notes page the guard refuses is not named by its record', async () => {
    const projects = {
      name: 'Projects', id: P.projects, columns: ['Name', 'Note'],
      rows: [
        { title: 'Garden', id: P.garden, cells: { Note: 'a' }, body: 'See [the row](hub:record/notion-payroll/plain-row).\n' },
        { title: 'Shed', id: P.shed, cells: { Note: 'b' }, body: 'Shed notes.\n' },
      ],
    }
    const w = await world(payroll({ databases: [projects] }))
    const plan = planImport(bundleOf(w), atOps, w.repo, w.store)
    expect(plan.report.notCarried).toContainEqual(expect.objectContaining({ what: 'Garden' }))
    await applyImport(w.repo, plan, STEWARD_A, w.store)
    const rows = yamlAt(w.repo, 'data/collections/notion-projects.yaml')['notion-projects'] as Record<string, unknown>[]
    const ids = new Set(pagesAt(w.repo).map(f => f.replace(/^pages\/|\.md$/g, '')))
    expect(rows.find(r => r.title === 'Garden')).not.toHaveProperty('notes')
    expect(ids.has(String(rows.find(r => r.title === 'Shed')!.notes))).toBe(true)
    expect(scan(w.repo, ['notion-payroll', ...PRIVATE_WORDS])).toEqual([])
  })
})

describe('npm run import (L6 §9.2)', () => {
  const io = () => {
    const said = { out: [] as string[], err: [] as string[] }
    return { said, io: (repo: string) => ({ repo, out: (t: string) => said.out.push(t), err: (t: string) => said.err.push(t) }) }
  }

  it('without --apply nothing in the instance changes, and the map file is written beside the export', async () => {
    const w = await world()
    const before = head(w.repo)
    const { said, io: of } = io()
    expect(await main(['notion', w.dir], of(w.repo))).toBe(0)
    expect(head(w.repo)).toBe(before)
    expect(status(w.repo)).toBe('')
    expect(w.store.collections()).toEqual([])
    const map = parse(readFileSync(join(w.dir, 'hub-import-map.yaml'), 'utf8'))
    expect(Object.keys(map.databases).sort()).toEqual(['Circles', 'Docs', 'Meetings', 'Projects', 'Proposals', 'Tasks'])
    expect(map.databases.Tasks).toMatchObject({ into: 'notion-tasks', level: 'members' })
    expect(map.people).toHaveProperty(['Steward A'])
    expect(said.out.join('\n')).toContain('Nothing was written in the instance.')
  })

  it('refuses while a server for the instance runs', async () => {
    const w = await world()
    const before = head(w.repo)
    const pid = serverPidFile(w.repo)
    mkdirSync(join(pid, '..'), { recursive: true })
    writeFileSync(pid, String(process.ppid))
    try {
      const { said, io: of } = io()
      expect(await main(['notion', w.dir, '--apply'], of(w.repo))).toBe(1)
      expect(said.err.join('\n')).toContain('Stop the server for this repository first.')
    } finally { rmSync(pid, { force: true }) }
    expect(head(w.repo)).toBe(before)
  })
})
