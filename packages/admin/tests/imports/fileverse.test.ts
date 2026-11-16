import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { openPrivateStore, type PrivateStore } from '../../server/private/store.ts'
import type { KnownActor } from '../../server/actor.ts'
import { applyImport, planImport, NOT_PUBLIC, PAGE_LEVEL_MOVED } from '../../server/workspace/imports.ts'
import { NOT_A_DOC, ROOT_ID } from '../../lib/imports/plan.mjs'
import { readFileverse, DOC_ELSEWHERE, NOT_A_SNAPSHOT, NO_COMMENTS, SHA_MISMATCH } from '../../lib/imports/fileverse.mjs'
import { main } from '../../scripts/import.ts'

// DAO-OS L6 §9.5 (Task 13): the Fileverse reader. It reads the pull's output (`docs/governance/fileverse/<doc>/<tab>.md`,
// front matter `title`, `fileverse_doc`, `fileverse_tab`, `fileverse_tab_id`, `pulled_at`, `content_sha256`) into the
// import's one bundle: each dDoc a page, each tab its subpage, under one root "Fileverse archive · <date>". The map sets
// each dDoc's level (§20 Q7); the rest is Task 12's pipeline, its rulings with it. The snapshot files are left where they
// are, byte for byte.
//
// The pull is the synthetic one in tests/fixtures/fileverse/ (two invented dDocs, two tabs each). Every test copies it into
// a fresh temporary repository (makeChangeRepo, whose git identity is steward-a) and keeps the private store in a temp
// folder of its own. No network.

const CELO = 'eip155:42220'
const STEWARD = `${CELO}:0x0000000d0001${'0'.repeat(52)}`
const OPS = `${CELO}:0x0000000d0002${'0'.repeat(52)}`
const AT_STEWARD = `hat:${STEWARD}`
const PULL = fileURLToPath(new URL('../fixtures/fileverse/', import.meta.url))
const AT = 'docs/governance/fileverse'

const SOLO = `schema_version: "2.0"
governance:
  model: "solo-maintainer"
  membership: { tree: hats-main }
  roles:
    steward: { hat: "${STEWARD}" }
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
  defaults: { contact: "hat:${OPS}" }
  collections:
    pages: { default: members }
`
const STEWARD_A: KnownActor = { id: 'steward-a', name: 'Steward A', kind: 'person', via: 'git' }
const STEWARD_MAP = { docs: { 'council-notes': { level: AT_STEWARD } } }

const cleanup: string[] = []
const stores: PrivateStore[] = []
afterEach(() => {
  for (const s of stores.splice(0)) { try { s.close() } catch { /* closed by the test */ } }
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
})
const temp = (tag: string): string => { const d = mkdtempSync(join(tmpdir(), tag)); cleanup.push(d); return d }
/** The command's environment with a private store of its own (tests/setup.ts gives the whole file one folder). */
const own = (): NodeJS.ProcessEnv => ({ ...process.env, ORG_OS_PRIVATE_DIR: temp('fileverse-cmd-store-') })

interface World { repo: string; store: PrivateStore; dir: string }

/** A fresh instance holding the pull at docs/governance/fileverse/, committed as the pull commits it. */
async function world(): Promise<World> {
  const repo = makeChangeRepo(SOLO)
  cleanup.push(repo)
  writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  writeFileSync(join(repo, 'data', 'visibility.yaml'), POLICY)
  cpSync(PULL, join(repo, AT), { recursive: true })
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: the tree, three members, the policy, a Fileverse pull"')
  const store = await openPrivateStore(repo, { dir: temp('fileverse-store-') }); stores.push(store)
  return { repo, store, dir: join(repo, AT) }
}

const head = (repo: string) => git(repo, 'rev-parse HEAD').trim()
const fileAt = (repo: string, rel: string, rev = 'HEAD') => git(repo, `show ${rev}:${rel}`)
const status = (repo: string) => git(repo, 'status --porcelain').trim()
const pagesAt = (repo: string) => git(repo, 'ls-tree --name-only HEAD pages/').split('\n').filter(n => n.endsWith('.md'))
const pageTexts = (repo: string) => pagesAt(repo).map(f => ({ file: f, text: fileAt(repo, f) }))
const front = (text: string) => parse(/^---\n([\s\S]*?)\n---/.exec(text)![1]!) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const byTitle = (repo: string, title: string) => pageTexts(repo).find(p => front(p.text).title === title)
function scan(repo: string, needles: string[]): string[] {
  const all = execFileSync('git', ['cat-file', '--batch-all-objects', '--batch'], { cwd: repo, maxBuffer: 1 << 28 }).toString('utf8')
  return needles.filter(n => all.includes(n))
}
/** Every file under `dir`, its bytes' digest and its mtime. */
function snapshotOf(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name)
      if (e.isDirectory()) walk(full)
      else out[relative(dir, full)] = `${createHash('sha256').update(readFileSync(full)).digest('hex')} ${statSync(full).mtimeMs}`
    }
  }
  walk(dir)
  return out
}
/** A tab of the pull rewritten as the pull writes it: a new body, its digest and a later pull date. */
function repull(dir: string, rel: string, body: string, pulledAt = '2026-11-05'): void {
  const file = join(dir, rel)
  const was = readFileSync(file, 'utf8')
  const head = /^---\n[\s\S]*?\n---\n/.exec(was)![0]
    .replace(/^pulled_at: .*$/m, `pulled_at: ${pulledAt}`)
    .replace(/^content_sha256: .*$/m, `content_sha256: ${createHash('sha256').update(body, 'utf8').digest('hex')}`)
  writeFileSync(file, `${head}\n${body}`)
}
const GOVERNANCE = fileURLToPath(new URL('../../../../scripts/validate-governance.mjs', import.meta.url))
const DATA = fileURLToPath(new URL('../../../../scripts/validate-data.mjs', import.meta.url))

describe('the Fileverse reader (L6 §9.5)', () => {
  it('each dDoc is a page and each tab its subpage', async () => {
    const w = await world()
    const bundle = readFileverse(w.dir)
    expect(bundle.source).toBe('fileverse')
    expect(bundle.exported).toBe('2026-11-03') // the newest pull's day
    expect(bundle.collections).toEqual([])
    expect(bundle.pages.map(p => [p.sid, p.title, p.parent])).toEqual([
      ['council-notes', 'council-notes', null],
      ['council-notes/agenda', 'Agenda', 'council-notes'],
      ['council-notes/decisions', 'Decisions', 'council-notes'],
      ['season-calendar', 'season-calendar', null],
      ['season-calendar/themes', 'Themes', 'season-calendar'],
      ['season-calendar/schedule', 'Schedule', 'season-calendar'],
    ])
    expect(bundle.pages.find(p => p.sid === 'season-calendar/schedule')!.body).toBe('| Month | Theme |\n| --- | --- |\n| November | Soil |\n| December | Water |\n')
    expect(bundle.notRead).toContainEqual({ what: 'comments', why: NO_COMMENTS })

    await applyImport(w.repo, planImport(bundle, {}, w.repo, w.store), STEWARD_A, w.store)
    const root = byTitle(w.repo, 'Fileverse archive · 2026-11-03')!
    const rootId = front(root.text).id
    expect(front(root.text)).toMatchObject({ parent: null, visibility: 'members', from: { source: 'fileverse', id: ROOT_ID } })
    const doc = byTitle(w.repo, 'season-calendar')!
    expect(front(doc.text).parent).toBe(rootId)
    const themes = front(byTitle(w.repo, 'Themes')!.text)
    const schedule = front(byTitle(w.repo, 'Schedule')!.text)
    expect([themes.parent, schedule.parent]).toEqual([front(doc.text).id, front(doc.text).id])
    expect(themes.order).toBeLessThan(schedule.order) // the tabs in their order in the dDoc
    expect(byTitle(w.repo, 'Schedule')!.text).toContain('| November | Soil |')
    expect(pagesAt(w.repo)).toHaveLength(7) // the root, two dDocs, four tabs
    expect(git(w.repo, 'log -1 --format=%B').split('\n')[0]).toBe('import: fileverse 2026-11-03')
    expect(status(w.repo)).toBe('')
  })

  it('from carries doc, tab, tab id, pulled_at and the sha', async () => {
    const w = await world()
    await applyImport(w.repo, planImport(readFileverse(w.dir), {}, w.repo, w.store), STEWARD_A, w.store)
    const sha = /^content_sha256: (.+)$/m.exec(readFileSync(join(w.dir, 'season-calendar/schedule.md'), 'utf8'))![1]
    expect(front(byTitle(w.repo, 'Schedule')!.text).from).toEqual({
      source: 'fileverse', id: 'season-calendar/schedule', exported: '2026-11-03',
      doc: 'season-calendar', tab: '2-schedule', tab_id: 's2e9', pulled_at: '2026-11-03', content_sha256: sha,
    })
    expect(front(byTitle(w.repo, 'season-calendar')!.text).from).toEqual({ source: 'fileverse', id: 'season-calendar', exported: '2026-11-03', doc: 'season-calendar' })
    // Two dDocs whose first tabs share the id Fileverse gives a first tab: each is its own page.
    expect(front(byTitle(w.repo, 'Themes')!.text).from).toMatchObject({ id: 'season-calendar/themes', tab_id: 'default' })
    expect(front(byTitle(w.repo, 'Agenda')!.text).from).toMatchObject({ id: 'council-notes/agenda', tab_id: 'default' })
  })

  it('a dDoc mapped to hat:Steward lands as private pages, its tabs too', async () => {
    const w = await world()
    const plan = planImport(readFileverse(w.dir), STEWARD_MAP, w.repo, w.store)
    await applyImport(w.repo, plan, STEWARD_A, w.store)
    const priv = w.store.records('pages')
    expect(priv.map(r => r.body.title).sort()).toEqual(['Agenda', 'Decisions', 'council-notes'])
    expect(priv.every(r => r.visibility === AT_STEWARD)).toBe(true)
    const doc = priv.find(r => r.body.title === 'council-notes')!
    expect(priv.filter(r => r.body.parent === doc.id).map(r => r.body.title).sort()).toEqual(['Agenda', 'Decisions'])
    expect(doc.body.parent).toBe(front(byTitle(w.repo, 'Fileverse archive · 2026-11-03')!.text).id)
    expect(priv.find(r => r.body.title === 'Agenda')!.body).toMatchObject({
      markdown: 'The council meets each fortnight.\n\n- Review the season plan\n- Hear the circles\n',
      from: { source: 'fileverse', id: 'council-notes/agenda', doc: 'council-notes', tab: '1-agenda', tab_id: 'default', pulled_at: '2026-11-02' },
    })
    // The other dDoc is members, in git; nothing of the Steward one is in any page or the receipt git holds.
    expect(pagesAt(w.repo)).toHaveLength(4)
    for (const p of pageTexts(w.repo)) expect(p.text).not.toMatch(/council|fortnight|Agenda|Decisions/)
    expect(fileAt(w.repo, 'data/imports.yaml')).not.toMatch(/council|Agenda|Decisions/)
    expect(plan.receipt.created.pages).toBe(7)
    // The snapshot is in git where the pull left it; the import added no other object holding its words.
    const objects = scan(w.repo, ['Hear the circles'])
    expect(objects).toEqual(['Hear the circles'])
    expect(git(w.repo, 'log --format=%H -S "Hear the circles"').trim().split('\n')).toHaveLength(1) // the fixture's commit only
  })

  it('the snapshot files are left untouched', async () => {
    const w = await world()
    const before = snapshotOf(w.dir)
    const said: string[] = []
    const io = { repo: w.repo, out: (t: string) => said.push(t), err: (t: string) => said.push(t), env: own() }
    // A dry run: nothing in the instance, the pull's folder with it (the map is printed, not written among the snapshots).
    expect(await main(['fileverse', w.dir], io)).toBe(0)
    expect(snapshotOf(w.dir)).toEqual(before)
    expect(status(w.repo)).toBe('')
    expect(said.join('\n')).toContain('docs:')
    // The import, then a second run. A dDoc kept at hat:Steward is imported only from a folder git ignores (Tasks 13–14
    // review I4): the fixture's pull stops tracking it first.
    writeFileSync(join(w.repo, '.gitignore'), `${AT}/council-notes/\n`)
    git(w.repo, `rm -r -q --cached ${AT}/council-notes`); git(w.repo, 'add .gitignore'); git(w.repo, 'commit -qm "fixture: council-notes ignored"')
    const map = join(temp('fileverse-map-'), 'map.yaml')
    writeFileSync(map, `docs:\n  council-notes: { level: "${AT_STEWARD}" }\n`)
    expect(await main(['fileverse', w.dir, '--map', map, '--apply'], io)).toBe(0)
    expect(await main(['fileverse', w.dir, '--map', map, '--apply'], io)).toBe(0)
    expect(snapshotOf(w.dir)).toEqual(before)
    expect(git(w.repo, `log --format=%s -- ${AT}`).trim().split('\n')).toEqual(['fixture: council-notes ignored', 'fixture: the tree, three members, the policy, a Fileverse pull'])
    expect(status(w.repo)).toBe('')
  })

  it('a re-pull with a changed tab updates the page when the Hub copy is unchanged since import, and keeps it otherwise', async () => {
    const w = await world()
    await applyImport(w.repo, planImport(readFileverse(w.dir), STEWARD_MAP, w.repo, w.store), STEWARD_A, w.store)
    // Pulled again with nothing changed but the pull's date: nothing to write.
    repull(w.dir, 'season-calendar/themes.md', 'Each month of the season has one theme.\n')
    const same = planImport(readFileverse(w.dir), STEWARD_MAP, w.repo, w.store)
    expect(same.writes.git).toEqual([])
    expect(same.writes.private).toEqual([])
    // The Hub edits Themes (git) and Agenda (private); then a pull changes all four tabs.
    const themes = byTitle(w.repo, 'Themes')!
    writeFileSync(join(w.repo, themes.file), `${themes.text}\nAn edit made in the Hub.\n`)
    git(w.repo, `add ${themes.file}`); git(w.repo, 'commit -qm "page: Themes"')
    const agenda = w.store.records('pages').find(r => r.body.title === 'Agenda')!
    await w.store.putRecord({ collection: 'pages', id: agenda.id, visibility: agenda.visibility, body: { ...agenda.body, markdown: 'Edited in the Hub.\n' }, rev: 'edited-in-the-hub' }, 'steward-a', null)
    repull(w.dir, 'season-calendar/themes.md', 'Each month has a theme.\n')
    repull(w.dir, 'season-calendar/schedule.md', '| Month | Theme |\n| --- | --- |\n| November | Seeds |\n')
    repull(w.dir, 'council-notes/agenda.md', 'The council meets weekly.\n')
    repull(w.dir, 'council-notes/decisions.md', 'Decisions, with their dates.\n')
    const next = planImport(readFileverse(w.dir), STEWARD_MAP, w.repo, w.store)
    expect(next.report.updated).toBe(2)
    expect(next.report.kept.map(k => k.what).sort()).toEqual(['Agenda', 'Themes'])
    expect(next.report.kept.every(k => k.why === 'edited in the Hub since it was imported — kept')).toBe(true)
    await applyImport(w.repo, next, STEWARD_A, w.store)
    expect(fileAt(w.repo, themes.file)).toContain('An edit made in the Hub.')
    expect(fileAt(w.repo, themes.file)).not.toContain('Each month has a theme.')
    const schedule = byTitle(w.repo, 'Schedule')!
    expect(schedule.text).toContain('| November | Seeds |')
    expect(front(schedule.text).from).toMatchObject({ pulled_at: '2026-11-05', exported: '2026-11-05' })
    const priv = w.store.records('pages')
    expect(priv.find(r => r.body.title === 'Agenda')!.body.markdown).toBe('Edited in the Hub.\n')
    expect(priv.find(r => r.body.title === 'Decisions')!.body).toMatchObject({ markdown: 'Decisions, with their dates.\n', from: { pulled_at: '2026-11-05' } })
    // The receipt names neither private page.
    const receipts = parse(fileAt(w.repo, 'data/imports.yaml')).imports as Record<string, unknown>[]
    expect(receipts).toHaveLength(2)
    expect(JSON.stringify(receipts)).not.toMatch(/Agenda|Decisions|council/)
  })
})

describe('the Fileverse import, its edges (L6 §9.5, Task 13 rulings)', () => {
  it('a map giving a dDoc public is refused; a map naming no dDoc of the pull is refused; a re-run cannot move a dDoc\'s level', async () => {
    const w = await world()
    const before = head(w.repo)
    expect(() => planImport(readFileverse(w.dir), { docs: { 'season-calendar': { level: 'public' } } }, w.repo, w.store)).toThrow(NOT_PUBLIC('season-calendar'))
    expect(() => planImport(readFileverse(w.dir), { docs: { 'council-note': { level: AT_STEWARD } } }, w.repo, w.store)).toThrow(NOT_A_DOC('council-note'))
    expect(NOT_A_DOC('council-note')).toBe('The map names council-note under docs, and the pull holds no dDoc of that name: a misspelt dDoc would land members. Nothing was written.')
    expect(head(w.repo)).toBe(before)
    await applyImport(w.repo, planImport(readFileverse(w.dir), {}, w.repo, w.store), STEWARD_A, w.store)
    expect(() => planImport(readFileverse(w.dir), STEWARD_MAP, w.repo, w.store)).toThrow(PAGE_LEVEL_MOVED('The page "council-notes"', 'members', AT_STEWARD))
  })

  it('the map may title a dDoc; a tab changed since its pull, or moved to another dDoc\'s folder, is not carried, and what is not a tab is not read', async () => {
    const w = await world()
    writeFileSync(join(w.dir, 'README.md'), 'The pull\'s folder.\n')
    const decisions = join(w.dir, 'council-notes/decisions.md')
    writeFileSync(decisions, `${readFileSync(decisions, 'utf8')}A line added by hand.\n`)
    cpSync(join(w.dir, 'season-calendar/themes.md'), join(w.dir, 'council-notes/themes.md'))
    writeFileSync(join(w.dir, 'season-calendar/notes.md'), 'No front matter.\n')
    const bundle = readFileverse(w.dir)
    expect(bundle.pages.map(p => p.sid)).toEqual(['council-notes', 'council-notes/agenda', 'season-calendar', 'season-calendar/themes', 'season-calendar/schedule'])
    expect(bundle.notRead).toEqual(expect.arrayContaining([
      expect.objectContaining({ what: 'README.md', why: NOT_A_SNAPSHOT }),
      expect.objectContaining({ what: 'council-notes/decisions.md', why: SHA_MISMATCH, at: 'council-notes' }),
      expect.objectContaining({ what: 'council-notes/themes.md', why: DOC_ELSEWHERE('season-calendar'), at: 'council-notes' }),
      expect.objectContaining({ what: 'season-calendar/notes.md', why: NOT_A_SNAPSHOT, at: 'season-calendar' }),
    ]))
    const plan = planImport(bundle, { docs: { 'season-calendar': { level: 'members', title: 'Season calendar' }, 'council-notes': { level: AT_STEWARD } } }, w.repo, w.store)
    await applyImport(w.repo, plan, STEWARD_A, w.store)
    expect(byTitle(w.repo, 'Season calendar')).toBeDefined()
    expect(byTitle(w.repo, 'season-calendar')).toBeUndefined()
    // What is about the Steward dDoc is a count in the receipt, never its words.
    const [receipt] = parse(fileAt(w.repo, 'data/imports.yaml')).imports
    expect(JSON.stringify(receipt)).not.toContain('council')
    expect(receipt.not_carried).toContainEqual(expect.objectContaining({ what: '2 items in a restricted collection or page' }))
    expect(plan.report.notCarried).toContainEqual({ what: 'council-notes/decisions.md', why: SHA_MISMATCH })
  })

  it('validate:governance --strict and validate:data accept the import\'s commit', async () => {
    const w = await world()
    await applyImport(w.repo, planImport(readFileverse(w.dir), STEWARD_MAP, w.repo, w.store), STEWARD_A, w.store)
    const at = head(w.repo).slice(0, 7)
    const gov = spawnSync('node', [GOVERNANCE, w.repo, '--strict'], { encoding: 'utf8', env: { ...process.env, CI: '' } })
    expect(gov.stdout.split('\n').filter(l => l.includes(at) && /^\s*[✗⚠]/.test(l))).toEqual([])
    const data = spawnSync('node', [DATA, w.repo], { encoding: 'utf8', env: { ...process.env, CI: '' } })
    expect([data.status, data.stdout.split('\n').filter(l => /✗|error/i.test(l))]).toEqual([0, []])
  })

  it('npm run import -- fileverse: --html is Notion\'s; a dry run of a pull outside the repository writes the map beside it', async () => {
    const w = await world()
    const said: string[] = []
    const io = { repo: w.repo, out: (t: string) => said.push(t), err: (t: string) => said.push(t), env: own() }
    expect(await main(['fileverse', w.dir, '--html', w.dir], io)).toBe(1)
    expect(said.join('\n')).toContain('Use: npm run import -- <notion|fileverse> <folder>')
    const outside = temp('fileverse-pull-')
    cpSync(PULL, outside, { recursive: true })
    expect(await main(['fileverse', outside], io)).toBe(0)
    const map = parse(readFileSync(join(outside, 'hub-import-map.yaml'), 'utf8'))
    expect(map.docs).toEqual({ 'council-notes': { level: 'members', title: 'council-notes' }, 'season-calendar': { level: 'members', title: 'season-calendar' } })
    expect(said.join('\n')).toContain('Fileverse pull of 2026-11-03')
    // The map file beside the pull is not read as a tab.
    expect(readFileverse(outside).notRead.map(n => n.what)).not.toContain('hub-import-map.yaml')
    expect(status(w.repo)).toBe('')
  })
})
