import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { openPrivateStore, type PrivateStore } from '../../server/private/store.ts'
import type { KnownActor } from '../../server/actor.ts'
import { applyImport, planImport, PRIVATE_IN_TEXT, STRICT_ITEM } from '../../server/workspace/imports.ts'
import { BIG_PAGE, DOC_KEY, DOC_NO_LEVEL, LINK_NOT_CARRIED, PRIVATE_NAME_IN_TEXT } from '../../lib/imports/plan.mjs'
import { A_LINK, NOT_A_SNAPSHOT, readFileverse } from '../../lib/imports/fileverse.mjs'
import { readNotionExport } from '../../lib/imports/notion.mjs'
import { PAGE_MAX_BYTES } from '../../lib/workspace/pages.mjs'
import { main, SNAPSHOT_IN_GIT } from '../../scripts/import.ts'

// DAO-OS L6 §9.5, the review of Tasks 13 and 14 (platform full): what a Fileverse pull's names and paths may carry into
// git, the archive root's place, the snapshot of a private dDoc in git, and the reader's input. Every pull here is written
// by the test into a temporary folder outside the repository (as the review's probes did), in the pull's own front matter
// shape; every repository is a fresh temporary one (makeChangeRepo, git identity steward-a). Synthetic only; no network.

const CELO = 'eip155:42220'
const STEWARD = `${CELO}:0x0000000d0001${'0'.repeat(52)}`
const OPS = `${CELO}:0x0000000d0002${'0'.repeat(52)}`
const AT_STEWARD = `hat:${STEWARD}`
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
`
const POLICY = `visibility:
  defaults: { contact: "hat:${OPS}" }
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

interface World { repo: string; store: PrivateStore; pull: string }

/** A fresh instance (the tree, one member, the policy) and an empty pull folder outside it. */
async function world(): Promise<World> {
  const repo = makeChangeRepo(SOLO)
  cleanup.push(repo)
  writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  writeFileSync(join(repo, 'data', 'visibility.yaml'), POLICY)
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: the tree, one member, the policy"')
  const store = await openPrivateStore(repo, { dir: temp('fv-review-store-') }); stores.push(store)
  return { repo, store, pull: temp('fv-review-pull-') }
}

/** A tab as the pull writes it: `<dir>/<doc>/<file>`, its front matter, its text's digest. */
function tab(dir: string, doc: string, file: string, title: string, body: string, front: Record<string, string> = {}): void {
  mkdirSync(join(dir, doc), { recursive: true })
  const sha = createHash('sha256').update(body, 'utf8').digest('hex')
  const keys = { title: `"${title}"`, fileverse_doc: doc, fileverse_tab: `"${file.replace(/\.md$/, '')}"`, fileverse_tab_id: '"default"', pulled_at: '2026-11-02', content_sha256: sha, ...front }
  writeFileSync(join(dir, doc, file), `---\n${Object.entries(keys).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n\n${body}`)
}

const fileAt = (repo: string, rel: string) => git(repo, `show HEAD:${rel}`)
const pagesAt = (repo: string) => git(repo, 'ls-tree --name-only HEAD pages/').split('\n').filter(n => n.endsWith('.md'))
const front = (text: string) => parse(/^---\n([\s\S]*?)\n---/.exec(text)![1]!) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const bodyOf = (text: string) => text.replace(/^---\n[\s\S]*?\n---\n\n?/, '')
const byTitle = (repo: string, title: string) => pagesAt(repo).map(f => fileAt(repo, f)).find(t => front(t).title === title)
/** Which of `needles` any object of the repository's object store holds, reachable or not. */
function scan(repo: string, needles: string[]): string[] {
  const all = execFileSync('git', ['cat-file', '--batch-all-objects', '--batch'], { cwd: repo, maxBuffer: 1 << 28 }).toString('utf8')
  return needles.filter(n => all.toLowerCase().includes(n.toLowerCase()))
}

describe('I1: a members tab\'s links into a stricter dDoc (Tasks 13–14 review)', () => {
  it('each link into the Steward dDoc is ↗, said, and no name or path of it reaches git; a link between members tabs resolves in the Hub', async () => {
    const w = await world()
    tab(w.pull, 'steward-pay-review', '1-salaries-2027.md', 'Salaries 2027', 'Private numbers.\n')
    tab(w.pull, 'season-calendar', '1-themes.md', 'Themes', [
      'See [the review](../steward-pay-review/1-salaries-2027.md), [Salaries 2027](../steward-pay-review/1-salaries-2027.md),',
      '[the dDoc](../steward-pay-review/), [a tab not pulled](../steward-pay-review/9-gone.md),',
      '[outside](https://fileverse.example.test/steward-pay-review/1-salaries-2027),',
      '[an unknown dDoc](../elsewhere-doc/1-x.md), [the schedule](./2-schedule.md) and [again](2-schedule.md).',
      '',
    ].join('\n'))
    tab(w.pull, 'season-calendar', '2-schedule.md', 'Schedule', 'Dates.\n')
    const plan = planImport(readFileverse(w.pull), { docs: { 'steward-pay-review': { level: AT_STEWARD } } }, w.repo, w.store)
    expect(plan.report.notCarried).toContainEqual({ what: 'Themes', why: STRICT_ITEM })
    expect(plan.report.notCarried).toContainEqual({ what: 'Themes', why: LINK_NOT_CARRIED })
    await applyImport(w.repo, plan, STEWARD_A, w.store)

    const schedule = front(byTitle(w.repo, 'Schedule')!)
    const themes = bodyOf(byTitle(w.repo, 'Themes')!)
    const [review, ddoc] = ['Salaries 2027', 'steward-pay-review'].map(t => w.store.records('pages').find(r => r.body.title === t)!.id)
    expect(themes).toBe([
      `See [↗](./${review}.md), [↗](./${review}.md),`,
      `[↗](./${ddoc}.md), ↗,`,
      '↗,',
      `↗, [the schedule](./${schedule.id}.md) and [again](./${schedule.id}.md).`,
      '',
    ].join('\n'))
    expect(scan(w.repo, ['steward-pay-review', 'salaries-2027', 'Salaries 2027', 'Private numbers', '9-gone', 'elsewhere-doc'])).toEqual([])
  })

  it('a git text naming a private dDoc\'s folder or tab path outside a link is refused, naming the git page', async () => {
    const w = await world()
    tab(w.pull, 'steward-pay-review', '1-salaries-2027.md', 'Salaries 2027', 'Private numbers.\n')
    tab(w.pull, 'season-calendar', '1-themes.md', 'Themes', 'Ask about the steward-pay-review dDoc.\n')
    const map = { docs: { 'steward-pay-review': { level: AT_STEWARD } } }
    expect(() => planImport(readFileverse(w.pull), map, w.repo, w.store)).toThrow(PRIVATE_NAME_IN_TEXT('The page "Themes"'))
    tab(w.pull, 'season-calendar', '1-themes.md', 'Themes', '`steward-pay-review/1-salaries-2027.md` is the file.\n')
    expect(() => planImport(readFileverse(w.pull), map, w.repo, w.store)).toThrow(PRIVATE_NAME_IN_TEXT('The page "Themes"'))
    // A name that only holds the private one (a longer slug) is not it.
    tab(w.pull, 'season-calendar', '1-themes.md', 'Themes', 'The steward-pay-review-2025 dDoc is members.\n')
    expect(() => planImport(readFileverse(w.pull), map, w.repo, w.store)).not.toThrow()
    expect(PRIVATE_NAME_IN_TEXT('The page "Themes"')).toContain('Nothing was written.')
    expect(PRIVATE_NAME_IN_TEXT('x')).not.toBe(PRIVATE_IN_TEXT('x'))
  })
})

describe('I2: the archive root\'s place is no dDoc\'s (Tasks 13–14 review)', () => {
  it('a dDoc folder named archive is a dDoc: the root is written, every parent exists, a second run changes nothing', async () => {
    const w = await world()
    tab(w.pull, 'archive', '1-old.md', 'Old', 'Old things.\n')
    tab(w.pull, 'season-calendar', '1-themes.md', 'Themes', 'Themes.\n')
    await applyImport(w.repo, planImport(readFileverse(w.pull), {}, w.repo, w.store), STEWARD_A, w.store)
    const pages = pagesAt(w.repo).map(f => front(fileAt(w.repo, f)))
    const root = pages.find(p => p.title === 'Fileverse archive · 2026-11-02')
    expect(root).toMatchObject({ parent: null, visibility: 'members' })
    expect(pages.map(p => p.title).sort()).toEqual(['Fileverse archive · 2026-11-02', 'Old', 'Themes', 'archive', 'season-calendar'])
    const ids = new Set(pages.map(p => p.id))
    expect(pages.filter(p => p.parent !== null && !ids.has(p.parent))).toEqual([])
    expect(pages.find(p => p.title === 'archive')).toMatchObject({ parent: root!.id, from: { source: 'fileverse', id: 'archive', doc: 'archive' } })
    const again = planImport(readFileverse(w.pull), {}, w.repo, w.store)
    expect(again.writes).toEqual({ git: [], private: [], assets: [] })
  })

  it('a dDoc folder named archive at hat:Steward stays private, under the root, run after run', async () => {
    const w = await world()
    tab(w.pull, 'archive', '1-old.md', 'Old', 'Old things.\n')
    const map = { docs: { archive: { level: AT_STEWARD } } }
    await applyImport(w.repo, planImport(readFileverse(w.pull), map, w.repo, w.store), STEWARD_A, w.store)
    const [root] = pagesAt(w.repo).map(f => front(fileAt(w.repo, f)))
    expect(pagesAt(w.repo)).toHaveLength(1)
    expect(root).toMatchObject({ title: 'Fileverse archive · 2026-11-02', parent: null })
    const kept = () => w.store.records('pages').map(r => ({ title: r.body.title, parent: r.body.parent, visibility: r.visibility }))
    const ddoc = w.store.records('pages').find(r => r.body.title === 'archive')!
    expect(kept()).toEqual(expect.arrayContaining([
      { title: 'archive', parent: root!.id, visibility: AT_STEWARD },
      { title: 'Old', parent: ddoc.id, visibility: AT_STEWARD },
    ]))
    const before = kept()
    const again = planImport(readFileverse(w.pull), map, w.repo, w.store)
    expect(again.writes).toEqual({ git: [], private: [], assets: [] })
    await applyImport(w.repo, again, STEWARD_A, w.store)
    expect(kept()).toEqual(before)
    expect(scan(w.repo, ['Old things', '1-old'])).toEqual([])
  })
})

describe('I4: a private dDoc\'s snapshot is never in git (Tasks 13–14 review)', () => {
  const AT = 'docs/governance/fileverse'
  /** The pull inside the instance at docs/governance/fileverse/: a members dDoc and a Steward one, and the map outside. */
  async function inside(how: 'tracked' | 'untracked' | 'ignored') {
    const w = await world()
    const dir = join(w.repo, AT)
    tab(dir, 'season-calendar', '1-themes.md', 'Themes', 'Themes.\n')
    tab(dir, 'steward-pay-review', '1-salaries-2027.md', 'Salaries 2027', 'Private numbers.\n')
    if (how === 'ignored') writeFileSync(join(w.repo, '.gitignore'), `${AT}/steward-pay-review/\n`)
    if (how !== 'untracked') { git(w.repo, 'add -A'); git(w.repo, 'commit -qm "fixture: the pull"') }
    const mapFile = join(temp('fv-review-map-'), 'map.yaml')
    writeFileSync(mapFile, `docs:\n  steward-pay-review: { level: "${AT_STEWARD}" }\n  season-calendar: { level: members }\n`)
    return { ...w, dir, mapFile }
  }
  const run = async (w: World & { mapFile: string }, dir: string, apply: boolean) => {
    const said: string[] = []
    const code = await main(['fileverse', dir, '--map', w.mapFile, ...(apply ? ['--apply'] : [])],
      { repo: w.repo, out: t => said.push(t), err: t => said.push(t), env: { ...process.env, ORG_OS_PRIVATE_DIR: temp('fv-review-cmd-store-') } })
    return { code, said: said.join('\n') }
  }

  it('a pull in the repository whose private dDoc git tracks, or would take, is refused, dry run included, nothing written', async () => {
    for (const how of ['tracked', 'untracked'] as const) {
      const w = await inside(how)
      const head = git(w.repo, 'rev-parse HEAD').trim()
      const status = git(w.repo, 'status --porcelain')
      for (const apply of [false, true]) {
        const out = await run(w, w.dir, apply)
        expect([how, apply, out.code]).toEqual([how, apply, 1])
        expect(out.said).toContain(SNAPSHOT_IN_GIT(['steward-pay-review']))
        expect(out.said).not.toContain('Fileverse pull of')
      }
      expect(git(w.repo, 'rev-parse HEAD').trim()).toBe(head)
      expect(git(w.repo, 'status --porcelain')).toBe(status)
    }
    expect(SNAPSHOT_IN_GIT(['steward-pay-review'])).toContain('pull it into a folder git ignores and import it from there')
  })

  it('a private dDoc git ignores, or a pull outside the repository, imports private', async () => {
    const w = await inside('ignored')
    const out = await run(w, w.dir, true)
    expect([out.code, out.said]).toEqual([0, expect.stringContaining('Imported in commit')])
    expect(scan(w.repo, ['Salaries 2027', 'Private numbers'])).toEqual([])
    const outside = await world()
    tab(outside.pull, 'steward-pay-review', '1-salaries-2027.md', 'Salaries 2027', 'Private numbers.\n')
    tab(outside.pull, 'season-calendar', '1-themes.md', 'Themes', 'Themes.\n')
    const mapFile = join(temp('fv-review-map-'), 'map.yaml')
    writeFileSync(mapFile, `docs:\n  steward-pay-review: { level: "${AT_STEWARD}" }\n  season-calendar: { level: members }\n`)
    const done = await run({ ...outside, mapFile }, outside.pull, true)
    expect([done.code, done.said]).toEqual([0, expect.stringContaining('Imported in commit')])
    expect(scan(outside.repo, ['Salaries 2027', 'Private numbers', 'steward-pay-review'])).toEqual([])
  })
})

describe('the reader\'s input (Tasks 13–14 review minors)', () => {
  it('M1: front matter is read as text: folder 007, 1e3, a numeric-looking title and tab name', async () => {
    const w = await world()
    tab(w.pull, '007', '1-a.md', 'A', 'a\n', { title: '1e3', fileverse_tab: '0010' })
    tab(w.pull, '1e3', '1-b.md', 'B', 'b\n', { fileverse_tab_id: '2e1' })
    const b = readFileverse(w.pull)
    expect(b.pages.map(p => p.sid)).toEqual(['007', '007/1-a', '1e3', '1e3/1-b'])
    expect(b.notRead.map(n => n.what)).toEqual(['comments'])
    expect(b.pages.find(p => p.sid === '007/1-a')).toMatchObject({ title: '1e3', mark: { doc: '007', tab: '0010', pulled_at: '2026-11-02' } })
    expect(b.pages.find(p => p.sid === '1e3/1-b')!.mark).toMatchObject({ doc: '1e3', tab_id: '2e1' })
  })

  it('M2: a linked dDoc folder or tab is said and not read; a tab or a Notion page past a page\'s size is said and not read', async () => {
    const w = await world()
    const elsewhere = temp('fv-review-else-')
    tab(elsewhere, 'linked-doc', '1-a.md', 'A', 'a\n')
    tab(w.pull, 'real-doc', '1-a.md', 'A', 'a\n')
    symlinkSync(join(elsewhere, 'linked-doc'), join(w.pull, 'linked-doc'))
    symlinkSync(join(elsewhere, 'linked-doc', '1-a.md'), join(w.pull, 'real-doc', '2-linked.md'))
    // Past the size, with no front matter: read, it would be NOT_A_SNAPSHOT; it is said too big before any read.
    const big = 'x'.repeat(PAGE_MAX_BYTES + 10)
    writeFileSync(join(w.pull, 'real-doc', '3-big.md'), big)
    const b = readFileverse(w.pull)
    expect(b.pages.map(p => p.sid)).toEqual(['real-doc', 'real-doc/1-a'])
    expect(b.notRead).toEqual(expect.arrayContaining([
      expect.objectContaining({ what: 'linked-doc', why: A_LINK }),
      expect.objectContaining({ what: 'real-doc/2-linked.md', why: A_LINK, at: 'real-doc' }),
      expect.objectContaining({ what: 'real-doc/3-big.md', why: BIG_PAGE(PAGE_MAX_BYTES + 10), at: 'real-doc' }),
    ]))
    expect(b.notRead.map(n => n.why)).not.toContain(NOT_A_SNAPSHOT)
    // The receipt names no link: what it points at is not known.
    const plan = planImport(b, {}, w.repo, w.store)
    expect(JSON.stringify(plan.receipt)).not.toContain('linked-doc')
    expect(JSON.stringify(plan.receipt)).not.toContain('2-linked')
    // A Notion page past the size: said, not read.
    const notion = temp('fv-review-notion-')
    writeFileSync(join(notion, `Big ${'a'.repeat(32)}.md`), big)
    writeFileSync(join(notion, `Small ${'b'.repeat(32)}.md`), '# Small\n\nText.\n')
    const n = readNotionExport(notion)
    expect(n.pages.map(p => p.title)).toEqual(['Small'])
    expect(n.notRead).toContainEqual(expect.objectContaining({ what: `Big ${'a'.repeat(32)}.md`, why: BIG_PAGE(PAGE_MAX_BYTES + 10) }))
  })

  it('M3: a dry run never follows a link where its map would go, and never writes inside the repository', async () => {
    const w = await world()
    tab(w.pull, 'real-doc', '1-a.md', 'A', 'a\n')
    const beside = join(w.pull, 'hub-import-map.yaml')
    symlinkSync(join(w.repo, 'planted-map.yaml'), beside)
    const said: string[] = []
    const code = await main(['fileverse', w.pull], { repo: w.repo, out: t => said.push(t), err: t => said.push(t), env: { ...process.env, ORG_OS_PRIVATE_DIR: temp('fv-review-cmd-store-') } })
    expect(code).toBe(0)
    expect(existsSync(join(w.repo, 'planted-map.yaml'))).toBe(false)
    expect(git(w.repo, 'status --porcelain')).toBe('')
    expect(lstatSync(beside).isSymbolicLink()).toBe(true)
    expect(said.join('\n')).toContain(`${beside} is a link, which the import does not follow`)
    expect(said.join('\n')).toContain('docs:')
  })

  it('M7: a docs entry with no level, or a key docs does not take, is refused; a bare level and a titled one are read', async () => {
    const w = await world()
    tab(w.pull, 'steward-pay-review', '1-salaries-2027.md', 'Salaries 2027', 'Private numbers.\n')
    const plan = (docs: Record<string, unknown>) => () => planImport(readFileverse(w.pull), { docs } as never, w.repo, w.store)
    expect(plan({ 'steward-pay-review': { title: 'Pay review' } })).toThrow(DOC_NO_LEVEL('steward-pay-review'))
    expect(plan({ 'steward-pay-review': null })).toThrow(DOC_NO_LEVEL('steward-pay-review'))
    expect(plan({ 'steward-pay-review': { levle: AT_STEWARD } })).toThrow(DOC_KEY('steward-pay-review', 'levle'))
    expect(plan({ 'steward-pay-review': { level: AT_STEWARD, title: 'Pay review' } })).not.toThrow()
    expect(plan({ 'steward-pay-review': AT_STEWARD })).not.toThrow()
    expect(plan({ 'steward-pay-review': { level: 'members' } })).not.toThrow()
    expect(DOC_NO_LEVEL('x')).toContain('Nothing was written.')
    expect(DOC_KEY('x', 'y')).toContain('Nothing was written.')
  })
})
