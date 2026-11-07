// The 0.6 P2 loop across two members, in the installed Chrome (P2 spec §4 "E2E", §3.12): one organisation whose
// records need a maintainer's approval, a bare remote, and two clones of it, ana's and bruno's, each served by its own
// admin server. ana Syncs, stages an edit of a project, proposes it and Shares; bruno Syncs, opens the proposal,
// approves it and, the rule met at once (approve, count 1, the author's own approval not counting), ratifies it and
// Shares; ana Syncs. The ratify is one merge commit with two parents and exactly the four trailers of §3.13; both
// clones then pass `validate:governance --strict` and show the new value.
//
// Everything lives under one fresh directory in the OS temp dir (the seed, the remote, both clones, both servers'
// state homes) and is removed at the end. Git reads no global or system configuration; each server is its own process,
// so each has its own ORG_OS_ADMIN_HOME. Nothing reaches a real instance or the network beyond localhost and the
// remote, which is a directory.
import { chromium, type Browser, type Page } from 'playwright-core'
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { approveRule } from './seed.mts'

const here = dirname(fileURLToPath(import.meta.url))
const ADMIN = join(here, '..', '..')
const FRAMEWORK = join(ADMIN, '..', '..')

const GIT_ENV = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' }
/** The environment every git call here and every server gets: the parent's with every `GIT_*` key removed (a
 *  `GIT_DIR`, `GIT_WORK_TREE` or `GIT_INDEX_FILE` inherited from a hook would point git at another repository), then
 *  no global or system configuration. */
const ENV: NodeJS.ProcessEnv = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
  ...GIT_ENV,
}
/** The seed's one commit is made by this identity, explicitly; every later commit is a server's, as its clone's member. */
const SEED_ENV = { ...ENV, GIT_AUTHOR_NAME: 'ana', GIT_AUTHOR_EMAIL: 'ana@example.test', GIT_COMMITTER_NAME: 'ana', GIT_COMMITTER_EMAIL: 'ana@example.test' }
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: ENV, stdio: 'pipe' }).toString().trim()

const MEMBERS = `schema_version: "2.0"
members:
  - id: "ana"
    name: "Steward A"
    kind: person
    status: "active"
    handles:
      git: ["ana@example.test"]
  - id: "bruno"
    name: "Steward B"
    kind: person
    status: "active"
    handles:
      git: ["bruno@example.test"]
`
const PROJECTS = `schema_version: "2.0"
projects:
  - id: "proj-001"
    title: "Seed Library"
    status: "execute"
    type: "program"
    lead: "bruno"
    contributors: ["ana"]
`
// Both decide; one approval is enough, and it cannot be the author's own (self_approve is false by default).
const GOVERNANCE = approveRule(['ana', 'bruno'])
// No fleet: no peers, no data/instances.yaml. Sync and Share are operations on this instance's own card, which is
// there without one.
const FEDERATION = `identity:
  name: "Two Clone Org"
  type: "Organization"
`

/** The real state home's listing, to show the run left it as it was (an absent folder stays absent). */
const REAL_HOME = join(homedir(), '.org-os', 'admin')
const listing = () => (existsSync(REAL_HOME) ? readdirSync(REAL_HOME).sort().join('\n') : null)

/** One admin server for one clone, in its own process: its own state home, git with no global configuration. Its stop
 *  goes on `stops` the moment it is spawned, so a server that never says its address is still ended by the caller. */
async function serve(repo: string, home: string, stops: (() => Promise<void>)[]): Promise<string> {
  const child: ChildProcess = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts', '--repo', repo, '--port', '0'],
    { cwd: ADMIN, env: { ...ENV, ORG_OS_ADMIN_HOME: home, ORG_OS_PRIVATE_DIR: join(home, 'private') }, stdio: ['ignore', 'pipe', 'pipe'] })
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
  const gone = () => child.exitCode !== null || child.signalCode !== null
  stops.push(async () => {
    if (gone()) return
    child.kill('SIGTERM')
    const killed = setTimeout(() => child.kill('SIGKILL'), 10_000)
    await exited
    clearTimeout(killed)
  })
  let said = ''
  child.stderr!.on('data', chunk => { said += String(chunk) })
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!gone()) child.kill('SIGKILL')
      reject(new Error(`the server for ${repo} did not start within 30 s:\n${said}`))
    }, 30_000)
    child.stdout!.on('data', chunk => {
      said += String(chunk)
      const m = /http:\/\/localhost:(\d+)/.exec(said)
      if (m) { clearTimeout(timer); resolve(`http://localhost:${m[1]}`) }
    })
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`the server for ${repo} exited (${code}):\n${said}`)) })
  })
}

/** Proposals' Sync (the foot line under the head): the fetch's confirm dialog, then Fetch and sync; the page says what
 *  Sync did, or a refusal as an error note (E-58). */
async function syncIn(page: Page, base: string, expect: RegExp) {
  await page.goto(`${base}/governance/rules`)
  await page.getByRole('heading', { level: 1, name: 'Proposals' }).waitFor()
  await page.getByRole('button', { name: 'Sync', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Sync' })
  await dialog.getByText(/fetch origin: it downloads, it changes no file/).waitFor()
  await dialog.getByRole('button', { name: 'Fetch and sync' }).click()
  const said = page.getByRole('status').filter({ hasText: expect })
  const refused = page.locator('.note-error')
  await said.or(refused).first().waitFor({ timeout: 30_000 })
  if (await refused.count() > 0) throw new Error(`Sync refused: ${await refused.first().innerText()}`)
}

/** Proposals' Share: the exact push is shown, then Run; the page follows the job and says how it ended, which must
 *  be "Shared", and the remote must hold the trunk. */
async function shareFrom(page: Page, base: string, repo: string, remote: string) {
  await page.goto(`${base}/governance/rules`)
  await page.getByRole('heading', { level: 1, name: 'Proposals' }).waitFor()
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Share' })
  await dialog.getByText('git push -- origin refs/heads/main:refs/heads/main', { exact: true }).waitFor()
  await dialog.getByRole('button', { name: 'Run' }).click()
  await page.getByRole('status').filter({ hasText: /^Sharing main with origin…$/ }).or(page.getByRole('status').filter({ hasText: /^Shared: / })).first().waitFor()
  const shared = page.getByRole('status').filter({ hasText: /^Shared: origin now holds main\.$/ })
  const refused = page.locator('.note-error').or(page.getByRole('alert'))
  await shared.or(refused).first().waitFor({ timeout: 60_000 })
  if (await refused.count() > 0) throw new Error(`Share did not succeed: ${await refused.first().innerText()}`)
  if (git(remote, 'rev-parse', 'refs/heads/main') !== git(repo, 'rev-parse', 'HEAD')) throw new Error('after Share, the remote does not hold the trunk')
}

/** `node scripts/validate-governance.mjs <clone> --strict`, from the framework root: its exit code and what it said. */
const validate = (repo: string) => spawnSync(process.execPath, ['scripts/validate-governance.mjs', repo, '--strict'], { cwd: FRAMEWORK, env: ENV, encoding: 'utf8' })

const realBefore = listing()
const root = mkdtempSync(join(tmpdir(), 'admin-e2e-proposals-'))
let browser: Browser | undefined
const stops: (() => Promise<void>)[] = []
try {
  // ── the world: a seed of one commit, a bare remote made from it, two clones ──
  const seed = join(root, 'seed')
  mkdirSync(join(seed, 'data'), { recursive: true })
  writeFileSync(join(seed, 'data', 'members.yaml'), MEMBERS)
  writeFileSync(join(seed, 'data', 'projects.yaml'), PROJECTS)
  writeFileSync(join(seed, 'data', 'governance.yaml'), GOVERNANCE)
  writeFileSync(join(seed, 'federation.yaml'), FEDERATION)
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: seed, env: SEED_ENV })
  execFileSync('git', ['add', '-A'], { cwd: seed, env: SEED_ENV })
  execFileSync('git', ['commit', '-qm', 'seed: two maintainers, a project, a rule over records'], { cwd: seed, env: SEED_ENV })
  const remote = join(root, 'remote.git')
  git(root, 'clone', '-q', '--bare', seed, remote)
  const clone = (who: string) => {
    const dir = join(root, who)
    git(root, 'clone', '-q', remote, dir)
    git(dir, 'config', 'user.name', who)
    git(dir, 'config', 'user.email', `${who}@example.test`)
    return dir
  }
  const a = clone('ana'), b = clone('bruno')
  const homes = { a: join(root, 'home-ana'), b: join(root, 'home-bruno') }
  const A = { base: await serve(a, homes.a, stops) }
  const B = { base: await serve(b, homes.b, stops) }

  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const open = async () => {
    const page = await (await browser!.newContext({ viewport: { width: 1400, height: 900 }, locale: 'en-US', timezoneId: 'UTC' })).newPage()
    page.on('dialog', d => void d.accept()) // Ratify asks first; the person says yes
    return page
  }
  const pa = await open(), pb = await open()

  // ── ana: Sync first (a fresh clone has never fetched), then stage an edit and propose it ──
  await syncIn(pa, A.base, /Up to date with origin\/main: nothing to do\./)
  await pa.goto(`${A.base}/r/project/proj-001`)
  await pa.getByRole('button', { name: 'Edit' }).click()
  await pa.getByLabel('Status', { exact: true }).fill('develop')
  await pa.getByRole('button', { name: 'Save to changes' }).click()
  const tray = pa.getByRole('region', { name: 'Changes' })
  await tray.getByText('1 staged change', { exact: true }).waitFor()
  if (await tray.getByRole('button', { name: /^Apply/ }).count() !== 0) throw new Error('the tray offers Apply where the rule asks for an approval')
  const beforePropose = git(a, 'rev-parse', 'HEAD')
  await tray.getByRole('button', { name: 'Propose', exact: true }).click()
  const panel = pa.getByRole('complementary', { name: 'Propose' })
  await panel.getByLabel('Title').fill('Move the seed library to develop')
  await panel.getByLabel('Rationale').fill('The pilot is over; the next season plans the second library.')
  await panel.getByRole('button', { name: 'Propose', exact: true }).click()
  const opened = panel.getByRole('status').filter({ hasText: /^Opened / })
  await opened.waitFor({ timeout: 15_000 })
  const id = (await opened.getByRole('link').innerText()).trim()
  if (!/^p-\d{4}-\d{2}-\d{2}-\d{3}-[0-9a-f]{4}$/.test(id)) throw new Error(`the proposal id reads "${id}"`)
  if (git(a, 'rev-list', '--count', `${beforePropose}..HEAD`) !== '1') throw new Error('Propose did not make exactly one commit')
  if (!/status:\s*"?execute"?/.test(readFileSync(join(a, 'data', 'projects.yaml'), 'utf8'))) throw new Error('Propose changed the record on the trunk')
  await opened.getByRole('link').click()
  await pa.waitForURL(new RegExp(`/governance/proposals/${id}$`))
  await pa.getByRole('heading', { level: 1, name: 'Move the seed library to develop' }).waitFor()
  // what the one rule waits on, on its own line; the overall line does not say it again (walk 2026-11-04, L4c-fix 12)
  await pa.locator('.rst .rst-x').first().waitFor()

  // ── ana Shares, so the remote has the proposal ──
  await shareFrom(pa, A.base, a, remote)

  // ── bruno Syncs (a fast-forward), opens the proposal, approves it: the rule is met, and he ratifies ──
  await syncIn(pb, B.base, /Fast-forwarded main by 1 commit from origin\./)
  await pb.goto(`${B.base}/governance/proposals/${id}`)
  await pb.getByRole('heading', { level: 1, name: 'Move the seed library to develop' }).waitFor()
  // Approve and Ratify are the record header's one primary (§9.1); what they say is said under Actions
  const actions = pb.getByRole('region', { name: 'Actions' })
  const head = pb.locator('header.rh')
  await head.getByRole('button', { name: 'Approve', exact: true }).click()
  await pb.getByText('Ready to ratify.', { exact: true }).waitFor({ timeout: 15_000 })
  // Approve's own answer, said under Actions: until it is back the page holds Ratify (the watcher's refetch can show the
  // rule met first, C8 fix I-2)
  await actions.getByText('Approved.', { exact: true }).waitFor({ timeout: 15_000 })
  const trunkTip = git(b, 'rev-parse', 'HEAD')
  await head.getByRole('button', { name: 'Ratify', exact: true }).click()
  const ratified = actions.getByText(/^Ratified as commit [0-9a-f]{7}\.$/)
  const notRatified = actions.locator('.note-error')
  await ratified.or(notRatified).first().waitFor({ timeout: 30_000 })
  if (await notRatified.count() > 0) throw new Error(`Ratify refused: ${await notRatified.first().innerText()}`)

  // the ratify: one merge, first parent the trunk's old tip, exactly the four trailers
  const parents = git(b, 'log', '-1', '--format=%P').split(' ')
  if (parents.length !== 2 || parents[0] !== trunkTip) throw new Error(`the ratify is not a merge onto the trunk's tip: parents ${parents.join(' ')}`)
  const trailers = git(b, 'log', '-1', '--format=%(trailers:only,unfold)').split('\n').filter(Boolean)
  const keys = trailers.map(t => t.split(':')[0]).sort()
  if (keys.join(',') !== 'Org-Actor,Org-Decision,Org-Proposal,Org-Rule') throw new Error(`the ratify's trailers are not the four:\n${trailers.join('\n')}`)
  const t = Object.fromEntries(trailers.map(l => [l.split(':')[0], l.slice(l.indexOf(':') + 1).trim()]))
  if (t['Org-Actor'] !== 'bruno' || t['Org-Rule'] !== 'records/approve' || t['Org-Proposal'] !== id || !/^gov-/.test(t['Org-Decision'] ?? '')) {
    throw new Error(`the ratify's trailers are wrong:\n${trailers.join('\n')}`)
  }
  const decision = t['Org-Decision']
  // the record, the ledger and the decision row, as files on the ratifier's trunk
  const projects = parse(readFileSync(join(b, 'data', 'projects.yaml'), 'utf8')) as { projects: { id: string; status: string }[] }
  if (projects.projects.find(p => p.id === 'proj-001')?.status !== 'develop') throw new Error('data/projects.yaml does not hold the new status')
  const ledger = parse(readFileSync(join(b, 'data', 'proposals.yaml'), 'utf8')) as { proposals: { id: string; state: string }[] }
  if (ledger.proposals.find(p => p.id === id)?.state !== 'ratified') throw new Error(`data/proposals.yaml does not say ${id} is ratified`)
  const gov = parse(readFileSync(join(b, 'data', 'governance.yaml'), 'utf8')) as { governance: { decisions: { id: string; proposal?: string; outcome?: string }[] } }
  const row = gov.governance.decisions.find(d => d.id === decision)
  if (!row || row.proposal !== id || row.outcome !== 'ratified') throw new Error(`data/governance.yaml has no ratified decision row ${decision} for ${id}: ${JSON.stringify(row)}`)

  // ── bruno Shares, then writes before his next Sync: he proposes the next step (final review I2: his own Share left
  // FETCH_HEAD naming the old tip, and Propose read that as "the last fetch was not of the trunk"); then Shares again ──
  await shareFrom(pb, B.base, b, remote)
  await pb.goto(`${B.base}/r/project/proj-001`)
  await pb.getByRole('button', { name: 'Edit' }).click()
  await pb.getByLabel('Status', { exact: true }).fill('execute')
  await pb.getByRole('button', { name: 'Save to changes' }).click()
  const trayB = pb.getByRole('region', { name: 'Changes' })
  await trayB.getByText('1 staged change', { exact: true }).waitFor()
  await trayB.getByRole('button', { name: 'Propose', exact: true }).click()
  const panelB = pb.getByRole('complementary', { name: 'Propose' })
  await panelB.getByLabel('Title').fill('Run the seed library again')
  await panelB.getByRole('button', { name: 'Propose', exact: true }).click()
  const openedB = panelB.getByRole('status').filter({ hasText: /^Opened / })
  const refusedB = panelB.getByRole('alert')
  await openedB.or(refusedB).first().waitFor({ timeout: 15_000 })
  if (await refusedB.count() > 0) throw new Error(`Propose right after a Share was refused: ${await refusedB.first().innerText()}`)
  await shareFrom(pb, B.base, b, remote)

  // ── ana Syncs (a fast-forward by the approval, the ratify and bruno's proposal); bruno's last Sync finds nothing ──
  const coming = Number(git(remote, 'rev-list', '--count', `${git(a, 'rev-parse', 'HEAD')}..main`)) // the approval, the ratify, the branch's content commit, bruno's proposal
  await syncIn(pa, A.base, new RegExp(`Fast-forwarded main by ${coming} commits from origin\\.`))
  await syncIn(pb, B.base, /Up to date with origin\/main: nothing to do\./)
  if (git(a, 'rev-parse', 'HEAD') !== git(b, 'rev-parse', 'HEAD')) throw new Error('after the last Sync the two clones stand on different commits')

  // both see the new value and the ratified proposal
  for (const [page, base] of [[pa, A.base], [pb, B.base]] as const) {
    await page.goto(`${base}/r/project/proj-001`)
    await page.getByRole('group', { name: 'Fields' }).getByText('develop', { exact: true }).waitFor({ timeout: 15_000 })
    await page.goto(`${base}/governance/proposals/${id}`)
    await page.getByText('Nothing more can be done here: the proposal is ratified.', { exact: true }).waitFor()
  }

  // validate:governance --strict, from the framework root, on both clones
  for (const [who, repo] of [['ana', a], ['bruno', b]] as const) {
    const v = validate(repo)
    if (v.status !== 0) throw new Error(`validate:governance --strict on ${who}'s clone exited ${v.status}:\n${v.stdout}${v.stderr}`)
  }

  if (listing() !== realBefore) throw new Error(`the real ${REAL_HOME} listing changed`)
  console.log('proposals two-clone: ok')
} finally {
  // Each step on its own: one that fails must not leave a server running or the folder behind.
  const quietly = async (what: string, fn: () => unknown) => {
    try { await fn() } catch (err) { console.error(`cleanup: ${what} failed: ${err instanceof Error ? err.message : String(err)}`) }
  }
  await quietly('closing the browser', () => browser?.close())
  for (const stop of stops) await quietly('stopping a server', stop)
  await quietly(`removing ${root}`, () => rmSync(root, { recursive: true, force: true }))
}
