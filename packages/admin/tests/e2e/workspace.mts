// The workspace's acceptance walk (DAO-OS L6 Task 21, spec §17), in the installed Chrome, on the e2e fixture instance
// with the plan's placeholders: a Hats tree (Council, Ops under it), Ops wearing `steward-a` (the git identity, so the
// local actor) and Council a second member who signs in with a wallet in a second browser; NocoDB and Fileverse as `link`
// Systems; a handbook tree whose saves need Council's approval; publication decided by Council.
//
// Before the server starts (the import refuses while one runs): the synthetic Notion export (tests/fixtures/notion-export.ts)
// is imported with `npm run import`'s own `main` (a dry run writes the map beside the export, outside the repository; the
// walk edits it, keeping Circles at Ops; then --apply), and the Fileverse fixture (tests/fixtures/fileverse/) likewise; a
// private task and a private page at Ops are put in the store. Then, in the browser:
//   - the imports are absent previewing as Public and there previewing as Members; an imported contact field (kept at
//     Council, above steward-a's Ops) reads "council only" for steward-a and in the preview: the server's marker, since a
//     preview re-gates rows, not fields (the L6 carry from Task 17);
//   - Sources lists the instance, NocoDB and Fileverse (link Systems) and both imports; every row of the editor table is
//     opened;
//   - steward-a writes a page with a mention and an embedded view (one commit), adds a task on the board (one batched
//     commit), records a meeting and lands on its notes page;
//   - the second member's presence on that page shows for steward-a;
//   - the handbook's save is staged ("Staged · needs approval"), proposed, approved and ratified by the second member;
//   - the private task's "Move into the repository…" stages the move (a change with a private part only, which the tray
//     holds since this task's fix), which is proposed and ratified, and the task is in data/tasks.yaml;
//   - Task 20's dialogs: narrowing a page with git subpages asks with their count ("Narrow to Hat: ops?"), widening one to
//     Public asks with its count ("Widen to Public?"), and a private page offers "Move into the repository…".
// Then no object git holds carries the private text, and validate:governance --strict passes over the history the walk
// made. Shots at 1440 and 390, light and dark, of the workspace routes go to app/e2e/workspace/ (git-ignored, Q39); a
// failed walk leaves each open page's shot and aria snapshot there too.
//
// Every file is under fresh directories in the OS temp dir, removed at the end: the repository, the state home, the
// private store, the export and the pull. Nothing reaches the network: the chain is faked in-process and the link
// Systems are never fetched (their driver reads nothing).
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, stringify } from 'yaml'
import { makeFixtureRepo, removeFixtureRepo } from '../fixtures.ts'
import { addressOfKey, key } from '../session/keys.ts'
import { makeNotionExport } from '../fixtures/notion-export.ts'
import { startServer } from '../../server/serve.ts'
import { openPrivateStore } from '../../server/private/store.ts'
import { hatRef } from '../../lib/hats.mjs'
import { parseTrailers } from '../../lib/trailers.mjs'
import { main as importMain } from '../../scripts/import.ts'
import { PAGE_LEAVES_GIT } from '../../lib/narrow.mjs'
import { RESTRICTED_TITLE } from '../../lib/standards/project.mjs'
import type { EditorRow } from '../../lib/workspace/editors.mjs'
import { editorHref } from '../../app/src/workspace/files.ts'
import { CELO, COUNCIL_ID, OPS_ID, fakeChain, withWallet } from './wallet.mts'
import { settle } from './seed.mts'

const here = dirname(fileURLToPath(import.meta.url))
const SHOTS = join(here, '..', '..', 'app', 'e2e', 'workspace')
const FRAMEWORK = join(here, '..', '..', '..', '..')
const PULL = join(here, '..', 'fixtures', 'fileverse')
const COUNCIL = hatRef(CELO, COUNCIL_ID)
const OPS = hatRef(CELO, OPS_ID)
const A1 = `${CELO}:0x00000000000000000000000000000000000000a1`
const HANDBOOK = 'handbook-3f2a'

const MEMBERS = `schema_version: "2.0"
members:
  - { id: steward-a, name: Steward A, kind: person, handles: { git: [admin-test@local], wallet: "${A1}" } }
  - { id: steward-b, name: Steward B, kind: person }
  - { id: ops-lead, name: Ops Lead, kind: person }
`
/** Workspace writes are direct (the implied workspace/direct) but in the handbook's tree, whose saves Council approves; a
 *  publication (a move into the repository among them) is proposed by any member and approved by Council. */
const GOVERNANCE = `schema_version: "2.0"
governance:
  model: "consensus"
  membership: { tree: hats-main }
  roles:
    council: { hat: "${COUNCIL}" }
    ops: { hat: "${OPS}" }
    member: { all: true }
  rules:
    - { id: handbook, applies_to: ["workspace:tree-${HANDBOOK}"], propose: member, decide: { by: council, method: approve, count: 1 } }
    - { id: publish, applies_to: [publication], propose: member, decide: { by: council, method: approve, count: 1 } }
  decisions: []
`
const SYSTEMS = `schema_version: "2.0"
systems:
  - { id: hats-main, kind: hats-tree, name: Hats, chain: "${CELO}", address: "13", driver: hats-tree }
  - { id: nocodb, kind: link, name: NocoDB, url: "https://nocodb.example.test" }
  - { id: fileverse, kind: link, name: Fileverse, url: "https://fileverse.example.test" }
`
/** Contact data is kept at Council, above Ops: steward-a (Ops) is not admitted to it, so the server gates it for them. (A
 *  preview of a narrower viewer re-gates rows, not fields, in the client: the L6 carry from Task 17, rulings log.) */
const VISIBILITY = `visibility:
  defaults: { contact: "hat:${COUNCIL}" }
  collections:
    pages: { default: members }
    tasks: { default: members }
`
const TASKS = `schema_version: "2.0"
tasks:
  - { id: t-agenda, title: Write the agenda, status: todo }
  - { id: t-room, title: Book the room, status: doing }
`
const page = (id: string, title: string, parent: string | null, order: number, body: string) =>
  `---\nid: ${id}\ntitle: ${title}\nparent: ${parent === null ? 'null' : parent}\norder: ${order}\n---\n${body}`
/** The pages the walk starts from: the handbook (raised) with a chapter; a guide with two git subpages (narrowed in Task
 *  20's dialog) and an atlas with one (widened). */
const PAGES: Record<string, string> = {
  [HANDBOOK]: page(HANDBOOK, 'Handbook', null, 1000, 'How the org works.\n'),
  'chapter-0001': page('chapter-0001', 'Chapter one', HANDBOOK, 1000, 'The first chapter.\n'),
  'guide-0001': page('guide-0001', 'Field guide', null, 2000, 'A guide to the field.\n'),
  'guide-a-0001': page('guide-a-0001', 'Guide part A', 'guide-0001', 1000, 'Part A.\n'),
  'guide-b-0001': page('guide-b-0001', 'Guide part B', 'guide-0001', 2000, 'Part B.\n'),
  'atlas-0001': page('atlas-0001', 'Atlas', null, 3000, 'Maps of the region.\n'),
  'atlas-a-0001': page('atlas-a-0001', 'Atlas sheet A', 'atlas-0001', 1000, 'Sheet A.\n'),
}

const fail = (why: string): never => { throw new Error(why) }
const said: string[] = []
const log = (line: string) => { said.push(line) }

// ── the instance, before any server ──

const council = key()
const temp = mkdtempSync(join(tmpdir(), 'admin-e2e-workspace-'))
const home = join(temp, 'home')
mkdirSync(home)
process.env.ORG_OS_ADMIN_HOME = home
process.env.ORG_OS_PRIVATE_DIR = join(home, 'private')
const repo = makeFixtureRepo()
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString().trim()
writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
const projects = join(repo, 'data', 'projects.yaml')
writeFileSync(projects, readFileSync(projects, 'utf8').replace(/^(\s+lead: )"[^"]*"$/gm, '$1"steward-a"').replace(/^(\s+contributors: )\[[^\]]*\]$/gm, '$1["steward-b"]'))
writeFileSync(join(repo, 'data', 'governance.yaml'), GOVERNANCE)
writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
writeFileSync(join(repo, 'data', 'visibility.yaml'), VISIBILITY)
writeFileSync(join(repo, 'data', 'tasks.yaml'), TASKS)
mkdirSync(join(repo, 'pages'))
for (const [id, text] of Object.entries(PAGES)) writeFileSync(join(repo, 'pages', `${id}.md`), text)
git('add', '-A'); git('commit', '-qm', 'e2e: a Hats tree, its roles, three members, the policy, tasks and pages')

/** One run of the import command, as `npm run import` runs it; its words kept for the log. */
async function runImport(args: string[]): Promise<string[]> {
  const out: string[] = []
  const code = await importMain(args, { repo, out: t => out.push(t), err: t => out.push(`err: ${t}`), env: { ...process.env, INIT_CWD: temp } })
  if (code !== 0) fail(`npm run import -- ${args.join(' ')} answered ${code}:\n${out.join('\n')}`)
  return out
}

// The Notion export: a dry run writes the map beside it; the walk keeps Circles at Ops (a private collection), as an
// operator would, and leaves every person unlinked (each lands as text at defaults.contact, Council); then the apply.
const notion = makeNotionExport(join(temp, 'notion-export'))
await runImport(['notion', notion])
const mapFile = join(notion, 'hub-import-map.yaml')
if (!existsSync(mapFile)) fail('the dry run wrote no map beside the export')
const map = parse(readFileSync(mapFile, 'utf8')) as { databases: Record<string, { level: string }> }
map.databases.Circles!.level = `hat:${OPS}`
writeFileSync(mapFile, stringify(map))
const notionSaid = await runImport(['notion', notion, '--apply'])
log(`notion import: ${notionSaid.join(' / ')}`)
// The Fileverse pull, copied outside the repository (the fixture folder stays as it is).
const pull = join(temp, 'fileverse-pull')
cpSync(PULL, pull, { recursive: true })
await runImport(['fileverse', pull])
const fvSaid = await runImport(['fileverse', pull, '--apply'])
log(`fileverse import: ${fvSaid.join(' / ')}`)

// A private task at Ops, in the store (as a task kept stricter than members is): its title is the members', its budget
// at Ops by the policy's contact default is not asked; it is the task moved into git by decision below.
{
  const store = await openPrivateStore(repo, { dir: process.env.ORG_OS_PRIVATE_DIR })
  await store.putRecord({ collection: 'tasks', id: 't-payroll', visibility: `hat:${OPS}`, body: { id: 't-payroll', title: 'Review the payroll', status: 'todo' }, rev: '' }, 'steward-a', null)
  await store.putRecord({ collection: 'pages', id: 'p-00000000c0de', visibility: `hat:${OPS}`, body: { title: 'Ops room', parent: null, order: 9000, markdown: 'Where Ops works.\n' }, rev: '' }, 'steward-a', null)
  store.close()
}

const fetch = fakeChain({ [OPS_ID]: [A1.slice(-42).toLowerCase()], [COUNCIL_ID]: [addressOfKey(council).toLowerCase()] })
const server = await startServer({ repo, port: 0, appDist: join(here, '..', '..', 'app', 'dist'), fetch })
const base = `http://localhost:${server.port}`
mkdirSync(SHOTS, { recursive: true })

const head = () => git('rev-parse', 'HEAD')
async function newCommit(before: string, what: string, ms = 30_000): Promise<string> {
  const until = Date.now() + ms
  while (Date.now() < until && head() === before) await new Promise(r => setTimeout(r, 250))
  if (head() === before) fail(`${what}: no commit after ${ms / 1000} s`)
  return head()
}
const fileAtHead = (rel: string) => git('show', `HEAD:${rel}`)

/** Picks a View as entry from the frame's control and waits for the band (or for it to go, for You). */
async function viewAs(p: Page, name: string): Promise<void> {
  await p.locator('[data-view-as] button[aria-haspopup]').filter({ visible: true }).first().click()
  await p.getByRole('menu', { name: 'View as' }).getByRole('menuitemradio', { name: new RegExp(`^${name}`) }).click()
  if (name === 'You') await p.locator('.band').waitFor({ state: 'detached' })
  else await p.locator('.band').waitFor()
}

/** The final review's M-4: the editor a row of the editor table names opened on what the row says, by that editor's own
 *  marker: the source editor's path (a file's Path row, a folder's path field), a record editor's heading (the
 *  collection's, the Systems', the registry's), the page tree's, the boards', the library's, the commons', and the
 *  governance tab the ledger or ratify row opens. */
async function editorOpened(p: Page, row: EditorRow, h1: string): Promise<void> {
  const h = editorHref(row)
  const heading = (name: string) => { if (h1 !== name) fail(`${row.pattern} (${row.editor}) opened "${h1}" at ${h}, not ${name}`) }
  switch (row.editor) {
    case 'record': {
      const name = /^data\/([^/*]+)\.ya?ml$/.exec(row.pattern)?.[1]
      return heading(name === 'tasks' ? 'Tasks' : name === 'meetings' ? 'Meetings' : name === 'systems' ? 'Systems' : name ?? 'Workspace')
    }
    case 'page': return heading('Workspace')
    case 'board': return heading('Boards')
    case 'library': return heading('Library')
    case 'knowledge': await p.locator('header.rh').getByText(/knowledge commons/i).first().waitFor(); return
    case 'ledger': await p.getByRole('tabpanel', { name: 'Open', exact: true }).waitFor(); return heading('Proposals')
    case 'ratify': await p.getByRole('tabpanel', { name: 'Decided', exact: true }).waitFor(); return heading('Proposals')
    default: {
      // the source editor (a generated file's too, which says why it is never edited)
      const path = h.slice('/files/'.length).split('/').map(decodeURIComponent).join('/')
      if (path.endsWith('/')) {
        const field = await p.locator('#files-path').inputValue()
        if (field !== path) fail(`${row.pattern} opened the path field at "${field}", not ${path}`)
        return
      }
      const shown = p.getByRole('group', { name: 'File', exact: true }).locator('code').first()
      if (await shown.count() === 0) fail(`${row.pattern} opened no source editor at ${h}: "${h1}", ${await p.locator('main').innerText().catch(() => '')}`.slice(0, 400))
      const code = (await shown.innerText()).trim()
      if (code !== path) fail(`${row.pattern} opened the source editor on ${code}, not ${path}`)
    }
  }
}

/** The id of the imported page titled `title`, from the tree steward-a reads. */
async function importedPage(p: Page, title: string): Promise<string> {
  const tree = await (await p.request.get(`${base}/api/pages`)).json() as { id: string; title: string }[]
  return tree.find(n => n.title === title)?.id ?? fail(`no imported page titled ${title}: ${tree.map(n => n.title).join(', ')}`)
}

/** The docked tray's Propose panel, titled; answers the new proposal's id. `{ keep }`: the suggested title is kept, and
 *  must be `keep` (the final review's M-3: a title is git text at Propose, so a private part's is RESTRICTED_TITLE). */
async function proposeStaged(p: Page, title: string | { keep: string }): Promise<string> {
  const tray = p.getByRole('region', { name: 'Changes' })
  await tray.getByRole('button', { name: 'Propose', exact: true }).first().click()
  const panel = p.getByRole('complementary', { name: 'Propose' })
  if (typeof title === 'string') await panel.getByLabel('Title').fill(title)
  else {
    const suggested = await panel.getByLabel('Title').inputValue()
    if (suggested !== title.keep) fail(`the Propose panel suggests "${suggested}" for a private move, not "${title.keep}"`)
  }
  await panel.getByRole('button', { name: 'Propose', exact: true }).click()
  const opened = panel.getByRole('status').filter({ hasText: /^Opened / })
  await opened.waitFor({ timeout: 15_000 })
  return (await opened.getByRole('link').innerText()).trim()
}

/** As the second member: the proposal approved (the rule met at once) and ratified; answers the ratify's short commit. */
async function ratifyAs(p: Page, id: string): Promise<string> {
  await p.goto(`${base}/governance/proposals/${encodeURIComponent(id)}`)
  const headr = p.locator('header.rh')
  await headr.getByRole('button', { name: 'Approve', exact: true }).click()
  await p.getByText('Ready to ratify.', { exact: true }).waitFor({ timeout: 15_000 })
  await headr.getByRole('button', { name: 'Ratify', exact: true }).click()
  const actions = p.getByRole('region', { name: 'Actions' })
  const ratified = actions.getByText(/^Ratified as commit [0-9a-f]{7}\.$/)
  await ratified.or(actions.locator('.note-error')).first().waitFor({ timeout: 30_000 })
  if (await ratified.count() === 0) fail(`${id} was not ratified: ${await actions.locator('.note-error').first().innerText()}`)
  return (/[0-9a-f]{7}/.exec(await ratified.innerText()) ?? [''])[0]
}

let browser: Browser | undefined
let at = 'the start'
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const ctx: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light', locale: 'en-US', timezoneId: 'UTC' })
  const pa = await ctx.newPage()

  // ── the imports, as the public and as members ──
  at = 'the imported collection'
  // A git member's hats are read in the background on the first request (Membership.forRead): wait for Ops to be read,
  // which the private collection notion-circles, kept at Ops by the map, shows.
  let ids: string[] = []
  for (const until = Date.now() + 15_000; Date.now() < until; await new Promise(r => setTimeout(r, 300))) {
    const read = await (await pa.request.get(`${base}/api/collections`)).json() as { collections: { id: string }[] }
    ids = read.collections.map(c => c.id)
    if (ids.includes('notion-circles')) break
  }
  for (const want of ['notion-tasks', 'notion-meetings', 'notion-docs', 'notion-circles']) if (!ids.includes(want)) fail(`GET /api/collections has no ${want}: ${ids.join(', ')}`)
  await pa.goto(`${base}/c/notion-tasks`)
  await settle(pa)
  const grid = pa.getByRole('grid', { name: 'Tasks' })
  await grid.getByRole('link', { name: 'Water the garden' }).waitFor()
  // The unlinked assignee is contact data, kept at Council: steward-a (Ops) reads the marker, never the name.
  const water = grid.getByRole('row').filter({ has: pa.getByRole('link', { name: 'Water the garden' }) })
  await water.getByText(/^council only$/i).waitFor()
  if (await water.getByText('Steward A', { exact: true }).count() !== 0) fail('the assignee kept at Council is drawn for steward-a')
  await viewAs(pa, 'Public')
  await pa.getByRole('link', { name: 'Water the garden' }).waitFor({ state: 'detached' })
  log('previewing as Public: the imported tasks are absent')
  await viewAs(pa, 'Members')
  await water.getByText(/^council only$/i).waitFor()
  log('previewing as Members: the imported tasks are there; the assignee reads "Council only"')
  await pa.goto(`${base}/p/${await importedPage(pa, 'Meeting rhythm')}`)
  await settle(pa)
  await viewAs(pa, 'Public')
  await pa.getByRole('heading', { level: 1, name: /^No page at / }).or(pa.getByText(/No page at /)).first().waitFor()
  log('previewing as Public: an imported page is not found')
  await viewAs(pa, 'You')

  // ── Sources, and every row of the editor table opened ──
  at = 'Sources'
  await pa.goto(`${base}/sources`)
  await pa.getByRole('heading', { level: 1, name: 'Sources' }).waitFor()
  const sources = pa.getByRole('list', { name: 'Sources' })
  for (const name of ['NocoDB', 'Fileverse']) await sources.getByRole('link', { name: new RegExp(name) }).or(sources.getByText(name, { exact: true })).first().waitFor()
  const rows = await sources.getByRole('listitem').allInnerTexts()
  const kinds = rows.map(r => r.split('\n').join(' '))
  if (!kinds.some(r => /Instance/.test(r))) fail(`Sources lists no instance: ${kinds.join(' | ')}`)
  if (kinds.filter(r => /^NocoDB|^Fileverse/.test(r) && /System/.test(r)).length < 2) fail(`Sources lists NocoDB and Fileverse not both as Systems: ${kinds.join(' | ')}`)
  if (kinds.filter(r => /Import/.test(r)).length < 2) fail(`Sources lists fewer than two imports: ${kinds.join(' | ')}`)
  log(`Sources: ${kinds.length} rows (the instance, ${kinds.filter(r => /System/.test(r)).length} Systems, ${kinds.filter(r => /Import/.test(r)).length} imports)`)
  at = 'the editor table'
  const table = pa.getByRole('list', { name: 'Where each governed file is edited' })
  const hrefs = await table.getByRole('link').evaluateAll(as => as.map(a => (a as HTMLAnchorElement).getAttribute('href') ?? ''))
  const editors = await (await pa.request.get(`${base}/api/editors`)).json() as EditorRow[]
  if (hrefs.length !== editors.length) fail(`the editor table draws ${hrefs.length} links for ${editors.length} rows`)
  // M-4: each row links where its editor is, and that editor opened on that file or registry (its own marker).
  editors.forEach((row, i) => { if (hrefs[i] !== editorHref(row)) fail(`the editor table links ${row.pattern} to ${hrefs[i]}, not ${editorHref(row)}`) })
  for (const row of editors) {
    const h = editorHref(row)
    at = `the editor at ${h} (${row.pattern})`
    await pa.goto(`${base}${h}`)
    await settle(pa)
    const h1 = (await pa.locator('h1').first().innerText()).trim()
    if (/^No page at /.test(h1)) fail(`${h} is no page`)
    await editorOpened(pa, row, h1)
  }
  log(`the editor table: ${hrefs.length} rows, each opened on its own marker (${new Set(hrefs).size} editors)`)

  // ── a page with a mention and an embedded view: one commit when its session ends ──
  at = 'a new page'
  await pa.goto(`${base}/workspace`)
  await pa.getByRole('button', { name: 'New page' }).click()
  await pa.waitForURL(/\/p\/[^/]+$/)
  const seasonId = decodeURIComponent(new URL(pa.url()).pathname.split('/').pop()!)
  const title = pa.locator('h1.ed-title')
  await title.waitFor()
  await title.click()
  await pa.keyboard.press('ControlOrMeta+a')
  await pa.keyboard.type('Season plan')
  await pa.keyboard.press('Enter')
  const body = pa.getByRole('textbox', { name: /· page body$/ })
  await body.click()
  await pa.keyboard.press('ControlOrMeta+End')
  await pa.keyboard.type('The season is led by @Steward')
  await pa.getByRole('option', { name: /Steward B/ }).first().click()
  await pa.keyboard.type(' with this list:')
  await pa.keyboard.press('Enter')
  await pa.keyboard.type('/')
  await pa.getByRole('option', { name: 'A view of a collection' }).click()
  await pa.getByRole('option', { name: 'Docs' }).click()
  await body.locator('.hub-embed[data-embed="view"]').waitFor()
  // walk I8: the embed draws the collection's rows and a link to its page, not only its label
  await body.locator('.hub-embed[data-embed="view"]').getByRole('link', { name: 'Open Docs' }).waitFor({ timeout: 15_000 })
  await pa.getByText('Saved · direct').first().waitFor({ timeout: 15_000 })
  const beforePage = head()
  // Leaving inside the Hub ends the session (its last text sent, then closed): its one commit. (A full navigation keeps
  // the session for its idle end, as a closed tab does.)
  await pa.getByRole('navigation', { name: 'Page path' }).getByRole('link', { name: 'Workspace' }).click()
  await pa.waitForURL(/\/workspace$/)
  await newCommit(beforePage, 'the page\'s session')
  const seasonText = fileAtHead(`pages/${seasonId}.md`)
  if (!/title: Season plan/.test(seasonText) || !seasonText.includes('steward-b') || !seasonText.includes('notion-docs')) fail(`the page's file lacks its title, mention or view:\n${seasonText}`)
  if (parseTrailers(git('log', '-1', '--format=%B')).rule !== 'workspace/direct') fail('the page\'s commit is not workspace/direct')
  log(`a page with a mention and an embedded view: one commit (${head().slice(0, 7)}, workspace/direct)`)

  // ── walk I9: Move to… nests the page under another (the tree's menu), then takes it back to the top (the page's own) ──
  at = 'Move to…'
  const writable = await (await pa.request.get(`${base}/api/pages?write`)).json() as { id: string; title: string; parent: string | null; visibility: string; write?: string }[]
  const host = writable.find(p => p.id !== seasonId && p.visibility === 'members' && p.write === 'direct')
  if (!host) fail(`no members page to move the page under: ${JSON.stringify(writable.map(p => [p.id, p.visibility, p.write]))}`)
  if (writable.some(p => p.write === undefined)) fail('GET /api/pages?write left a page without its write mode')
  const beforeMove = head()
  await pa.getByRole('button', { name: 'More for Season plan' }).click()
  await pa.getByRole('menuitem', { name: 'Move to…' }).click()
  const moveDialog = pa.getByRole('dialog', { name: 'Move Season plan' })
  await moveDialog.getByRole('combobox', { name: 'Move under' }).selectOption(host!.id)
  await moveDialog.getByRole('button', { name: 'Move', exact: true }).click()
  await moveDialog.waitFor({ state: 'detached' })
  await newCommit(beforeMove, 'the move under another page')
  if (!new RegExp(`^parent: "?${host!.id}"?$`, 'm').test(fileAtHead(`pages/${seasonId}.md`))) fail(`the moved page's file names no parent ${host!.id}:\n${fileAtHead(`pages/${seasonId}.md`)}`)
  await pa.getByRole('list', { name: 'Pages' }).getByRole('link', { name: /Season plan/ }).filter({ hasText: `In ${host!.title}` }).waitFor()
  const beforeBack = head()
  await pa.goto(`${base}/p/${encodeURIComponent(seasonId)}`)
  await settle(pa)
  await pa.getByRole('button', { name: 'Move to…' }).click()
  const backDialog = pa.getByRole('dialog', { name: 'Move Season plan' })
  await backDialog.getByRole('combobox', { name: 'Move under' }).selectOption({ label: 'The top level' })
  await backDialog.getByRole('button', { name: 'Move', exact: true }).click()
  await backDialog.waitFor({ state: 'detached' })
  await newCommit(beforeBack, 'the move back to the top level')
  if (!/^parent: null$/m.test(fileAtHead(`pages/${seasonId}.md`))) fail(`the page moved back names a parent:\n${fileAtHead(`pages/${seasonId}.md`)}`)
  log(`Move to…: under ${host!.id} and back to the top level, one commit each (${head().slice(0, 7)})`)
  await pa.goto(`${base}/workspace`)
  await settle(pa)

  // ── a task added on the board: the batch's one commit ──
  at = 'the tasks board'
  await pa.goto(`${base}/c/tasks`)
  await settle(pa)
  await pa.getByRole('tab', { name: 'Board' }).click()
  await pa.getByRole('button', { name: 'New in todo' }).click()
  const form = pa.getByRole('form', { name: 'New in todo' })
  await form.getByLabel('Title').fill('Order the seeds')
  const beforeTask = head()
  await form.getByRole('button', { name: 'Add' }).click()
  await pa.getByRole('list', { name: 'todo' }).getByText('Order the seeds').waitFor()
  await newCommit(beforeTask, 'the board\'s batch', 40_000)
  if (!fileAtHead('data/tasks.yaml').includes('Order the seeds')) fail('data/tasks.yaml lacks the task added on the board')
  // The private task (Ops) is on steward-a's board beside the git ones, and on no git file.
  await pa.getByRole('list', { name: 'todo' }).getByRole('link', { name: 'Review the payroll' }).waitFor()
  if (fileAtHead('data/tasks.yaml').includes('Review the payroll')) fail('the private task is in data/tasks.yaml before its move')
  log(`a task added on the board: one commit (${head().slice(0, 7)}); the private task on the board, not in git`)

  // ── Record a meeting: the meeting and its notes page in one commit ──
  at = 'Record a meeting'
  await pa.goto(`${base}/c/meetings`)
  await settle(pa)
  await pa.getByRole('button', { name: 'Record a meeting' }).click()
  const meeting = pa.getByRole('form', { name: 'Record a meeting' })
  await meeting.getByLabel('Title').fill('Season kickoff')
  const beforeMeeting = head()
  await meeting.getByRole('button', { name: 'Record' }).click()
  await pa.waitForURL(/\/p\/[^/]+$/)
  await newCommit(beforeMeeting, 'Record a meeting')
  const notesId = decodeURIComponent(new URL(pa.url()).pathname.split('/').pop()!)
  const shown = git('show', '--name-only', '--format=', 'HEAD').split('\n').sort()
  if (!shown.includes('data/meetings.yaml') || !shown.includes(`pages/${notesId}.md`)) fail(`Record a meeting's commit holds ${shown.join(', ')}`)
  if (!/^meeting: /m.test(fileAtHead(`pages/${notesId}.md`))) fail('the notes page names no meeting')
  log(`Record a meeting: the meeting and its notes page (${notesId}) in one commit`)

  // ── the second member: signed in with a wallet, on the page; steward-a sees them there ──
  at = 'the second member'
  const b = await withWallet(browser, council, { width: 1440, scheme: 'light' })
  const pb = b.page
  pb.on('dialog', d => void d.accept()) // Ratify asks with window.confirm
  await pb.goto(`${base}/sign-in`)
  await pb.getByRole('button', { name: 'Sign in with Ethereum' }).click()
  await pb.waitForURL(`${base}/`)
  await pb.locator('button.who').first().filter({ hasText: 'council' }).waitFor({ timeout: 15_000 })
  await pb.goto(`${base}/p/${encodeURIComponent(seasonId)}`)
  await pb.getByRole('textbox', { name: /· page body$/ }).waitFor()
  await pa.goto(`${base}/p/${encodeURIComponent(seasonId)}`)
  const presence = pa.locator('.ed-bar').getByRole('img', { name: /is (reading|editing)/ })
  await presence.waitFor({ timeout: 30_000 })
  log(`presence: steward-a reads "${await presence.getAttribute('aria-label')}" on the page`)

  // ── the handbook's save: staged, proposed by steward-a, approved and ratified by Council ──
  at = 'the raised tree'
  await pa.goto(`${base}/p/${HANDBOOK}`)
  const hbody = pa.getByRole('textbox', { name: /· page body$/ })
  await hbody.click()
  await pa.keyboard.press('ControlOrMeta+End')
  await pa.keyboard.type(' Decisions are made in the open.')
  await pa.getByText('Staged · needs approval').first().waitFor({ timeout: 15_000 })
  await pa.getByRole('region', { name: 'Changes' }).getByText(`pages/${HANDBOOK}.md`).first().waitFor()
  const hbId = await proposeStaged(pa, 'Open decisions in the handbook')
  const hbCommit = await ratifyAs(pb, hbId)
  if (!fileAtHead(`pages/${HANDBOOK}.md`).includes('Decisions are made in the open.')) fail('the ratified handbook does not hold the edit')
  log(`the handbook's save: staged, proposed (${hbId}), approved and ratified by Council (${hbCommit})`)

  // ── a private task moved into git by decision ──
  at = 'the private task'
  await pa.goto(`${base}/c/tasks`)
  await settle(pa)
  await pa.getByRole('tab', { name: 'Board' }).click()
  await pa.getByRole('list', { name: 'todo' }).getByRole('link', { name: 'Review the payroll' }).click()
  await pa.waitForURL(/\/r\//)
  await settle(pa)
  const taskUrl = pa.url()
  await pa.locator('button.vis-ctl').first().click()
  await pa.getByRole('menuitem', { name: 'Move into the repository…' }).click()
  const move = pa.getByRole('dialog', { name: 'Move into the repository?' })
  await move.getByRole('radio', { name: /Members/ }).check()
  await move.getByRole('button', { name: 'Stage the move' }).click()
  await pa.getByRole('region', { name: 'Changes' }).getByText('1 staged op', { exact: true }).waitFor()
  // M-3: the suggested title is kept; it names no private record (a title is written to git at Propose).
  const mvId = await proposeStaged(pa, { keep: RESTRICTED_TITLE })
  const mvCommit = await ratifyAs(pb, mvId)
  const tasks = parse(fileAtHead('data/tasks.yaml')) as { tasks: { id: string; title: string }[] }
  if (!tasks.tasks.some(t => t.id === 't-payroll' && t.title === 'Review the payroll')) fail('data/tasks.yaml lacks the moved task')
  await pa.goto(taskUrl)
  await settle(pa)
  log(`a private task moved into git: proposed (${mvId}), ratified (${mvCommit}); data/tasks.yaml holds it`)

  // ── Task 20's dialogs: narrowing with the subpages' count, widening with its count, Move into the repository… ──
  at = 'Task 20: narrowing'
  await pa.goto(`${base}/p/guide-0001`)
  await pa.getByRole('textbox', { name: /· page body$/ }).waitFor()
  await pa.locator('.ed-bar button.vis-ctl').click()
  await pa.getByRole('menuitemradio', { name: 'Hat: ops' }).click()
  const narrowing = pa.getByRole('dialog', { name: 'Narrow to Hat: ops?' })
  await narrowing.getByText(PAGE_LEAVES_GIT(2), { exact: true }).waitFor()
  const beforeNarrow = head()
  await narrowing.getByRole('button', { name: 'Narrow to Hat: ops' }).click()
  await newCommit(beforeNarrow, 'the narrowing')
  if (parseTrailers(git('log', '-1', '--format=%B')).rule !== 'visibility/narrow') fail('the narrowing\'s commit is not visibility/narrow')
  const gone = git('show', '--name-status', '--format=', 'HEAD').split('\n').sort()
  if (gone.join(' ') !== 'D\tpages/guide-0001.md D\tpages/guide-a-0001.md D\tpages/guide-b-0001.md') fail(`the narrowing's commit: ${gone.join(', ')}`)
  log('narrowing: "Narrow to Hat: ops?" said its 2 subpages; the page left git with them in one commit (visibility/narrow)')
  at = 'Task 20: widening'
  await pa.goto(`${base}/p/atlas-0001`)
  await pa.getByRole('textbox', { name: /· page body$/ }).waitFor()
  await pa.locator('.ed-bar button.vis-ctl').click()
  await pa.getByRole('menuitemradio', { name: 'Public' }).click()
  const widening = pa.getByRole('dialog', { name: 'Widen to Public?' })
  // pageVisibility.tsx's WIDENS_PAGE, with the server's count (the client module is not loaded into this process)
  await widening.getByText('Atlas and its 1 subpage that takes its level become public, for anyone to read, once decided.', { exact: true }).waitFor()
  await widening.getByRole('button', { name: 'Widen to Public' }).click()
  await pa.locator('.ed-bar').getByText(/Members → Public, proposed/).waitFor({ timeout: 15_000 })
  const staged = await (await pa.request.get(`${base}/api/changes`)).json() as { ops: { op: string; path?: string }[]; classes?: string[] }
  if (!staged.ops.some(o => o.op === 'file' && o.path === 'pages/atlas-0001.md')) fail('the widening staged no file op of the page')
  log('widening: "Widen to Public?" said its 1 subpage; the page reads "Members → Public, proposed"')
  at = 'Task 20: a private page'
  await pa.goto(`${base}/p/p-00000000c0de`)
  await pa.getByRole('textbox', { name: /· page body$/ }).waitFor()
  await pa.locator('.ed-bar button.vis-ctl').click()
  await pa.getByRole('menuitem', { name: 'Move into the repository…' }).click()
  const pmove = pa.getByRole('dialog', { name: 'Move into the repository?' })
  await pmove.getByRole('radio', { name: /Members/ }).waitFor()
  await pmove.getByRole('button', { name: 'Cancel' }).click()
  log('a private page offers "Move into the repository…", whose dialog asks who may read it there')
  await b.ctx.close()
  await ctx.close()

  // ── nothing private in any object git holds; validate:governance --strict over the history the walk made ──
  at = 'the repository'
  const objects = execFileSync('git', ['cat-file', '--batch-all-objects', '--batch'], { cwd: repo, maxBuffer: 1 << 28 }).toString('utf8')
  const kept = ['Where Ops works.', 'The stewards hold the season.', 'notion-circles', 'Ops room', 'Steward A, Steward B'].filter(t => objects.includes(t))
  if (kept.length > 0) fail(`git holds what is kept private: ${kept.join(', ')}`)
  const v = spawnSync(process.execPath, ['scripts/validate-governance.mjs', repo, '--strict'], { cwd: FRAMEWORK, encoding: 'utf8' })
  if (v.status !== 0) fail(`validate:governance --strict exited ${v.status}:\n${v.stdout}${v.stderr}`)
  log(`git: no private text in any object; validate:governance --strict: ok (${git('rev-list', '--count', 'HEAD')} commits)`)

  // ── the shots: 1440 and 390, light and dark ──
  at = 'the shots'
  const routes: [string, string][] = [
    ['workspace', '/workspace'], ['page', `/p/${encodeURIComponent(seasonId)}`], ['notes-page', `/p/${encodeURIComponent(notesId)}`],
    ['private-page', '/p/p-00000000c0de'], ['tasks', '/c/tasks'], ['imported-tasks', '/c/notion-tasks'], ['sources', '/sources'],
    ['file-collections', '/files/data/collections.yaml'], ['moved-task', new URL(taskUrl).pathname], ['handbook', `/p/${HANDBOOK}`],
  ]
  let shots = 0
  for (const width of [1440, 390]) {
    for (const scheme of ['light', 'dark'] as const) {
      const c = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, locale: 'en-US', timezoneId: 'UTC' })
      const p = await c.newPage()
      for (const [slug, path] of routes) {
        await p.goto(`${base}${path}`)
        await settle(p)
        await p.screenshot({ path: join(SHOTS, `${slug}-${width}-${scheme}.png`), fullPage: false })
        shots++
      }
      await c.close()
    }
  }
  log(`${shots} shots in ${SHOTS}`)

  console.log(`e2e workspace: ok (${said.length} steps)\n${said.map(l => `  ${l}`).join('\n')}`)
} catch (err) {
  // What each open page showed when the walk failed, for whoever reads the log (git-ignored with the shots).
  let n = 0
  for (const p of browser?.contexts().flatMap(c => c.pages()) ?? []) {
    n++
    await p.screenshot({ path: join(SHOTS, `failed-${n}.png`), fullPage: true }).catch(() => {})
    writeFileSync(join(SHOTS, `failed-${n}.aria.txt`), `${p.url()}\n${await p.locator('body').ariaSnapshot().catch(() => '')}`)
  }
  console.error(`e2e workspace: failed at ${at}`)
  throw err
} finally {
  await browser?.close()
  await server.close()
  removeFixtureRepo(repo)
  rmSync(temp, { recursive: true, force: true })
}
