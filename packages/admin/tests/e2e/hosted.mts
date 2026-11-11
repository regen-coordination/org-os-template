// The hosted, read-only walk (platform 0.7, R4a): a Hub as a staging Hub runs one, in the installed Chrome. The server is
// started hosted (`startServer({ hosted: true })` with `readHostedConfig`, as scripts/hub.ts starts it) with
// HOUSE_INSTANCE_WRITES off, a portal origin, the emailed-link sign-in with a recording mailer, and a backup key pair. The
// instance is a synthetic Example DAO: pages in git (one public, one for members), a private page in the store kept at
// role:steward, the tasks collection, the Notion and Fileverse imports (their Circles kept at role:steward), and the Roles
// table loaded with house:roles' own `main`: a steward, a network member, and a visitor with no Role.
//
// The browser reaches the Hub at its https origin: every request to that host is answered by this server, addressed to the
// Hub's host as its TLS proxy would (Host, the page's Origin, the browser's cookies for it, X-Real-IP), and its WebSocket
// is carried the same way; a redirect the server answers is recorded and followed; the portal's host answers a stand-in
// page; every other host is refused. Nothing reaches the network.
//
// The walk:
//   - the public (no session): every Hub route asks them to sign in (L5 §11.1) and draws nothing restricted; the API
//     answers them the public page alone; /portal and /door go to the portal origin, the path and query kept;
//   - the steward signs in by an emailed link (the form on /sign-in, the link taken from the mailer, Continue); the
//     Portal link points at the portal origin; pages, collections, the imports and Sources read; no write control is
//     drawn on any route the walk opens, and nothing says an edit saves; a write sent straight to the API answers 403
//     with the read-only sentence, and nothing is committed;
//   - the network member signs in the same way: they read the members' side but not the steward's page or Circles;
//     presence: each sees the other on the page; comments: the steward comments, the member replies, the steward
//     resolves, each seen by the other;
//   - the visitor with no Role signs in: the "no Role here yet" band, and nothing restricted appears.
// Then the repository's HEAD is the one it started at. Shots at 1440 and 390, light and dark, go to app/e2e/hosted/
// (git-ignored); a failed walk leaves each open page's shot and aria snapshot there too.
//
// Every file is under a fresh directory in the OS temp dir, removed at the end.
import { chromium, type Browser, type BrowserContext, type Page, type Route, type WebSocketRoute } from 'playwright-core'
import { WebSocket } from 'ws'
import { request as httpRequest } from 'node:http'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, stringify } from 'yaml'
import { makeFixtureRepo, removeFixtureRepo } from '../fixtures.ts'
import { makeNotionExport } from '../fixtures/notion-export.ts'
import { startServer } from '../../server/serve.ts'
import { readHostedConfig } from '../../server/hosted/config.ts'
import { READ_ONLY } from '../../server/hosted/instance-writes.ts'
import { recordingMailer } from '../../server/session/mail.ts'
import { openPrivateStore } from '../../server/private/store.ts'
import { createKeyPair } from '../../server/private/crypto.ts'
import { emailKey } from '../../lib/session-token.mjs'
import { main as rolesMain } from '../../scripts/house-roles.ts'
import { newPrivateJwk } from '../../scripts/house-session-key.ts'
import { main as importMain } from '../../scripts/import.ts'
import { settle } from './seed.mts'

const here = dirname(fileURLToPath(import.meta.url))
const SHOTS = join(here, '..', '..', 'app', 'e2e', 'hosted')
const PULL = join(here, '..', 'fixtures', 'fileverse')

const HUB_HOST = 'hub.example.org'
const HUB = `https://${HUB_HOST}`
const PORTAL_HOST = 'portal.example.org'
const PORTAL = `https://${PORTAL_HOST}`
const PEPPER = '0f'.repeat(32)
const COOKIE = 'org_session_e2e'
const ORG = 'Example DAO'

interface Person { id: string; name: string; mail: string; roles: string[]; address: number }
const STEWARD: Person = { id: 'example-dao:person:steward-a', name: 'Steward A', mail: 'steward-a@example.org', roles: ['network-member', 'steward'], address: 11 }
const MEMBER: Person = { id: 'example-dao:person:steward-b', name: 'Steward B', mail: 'steward-b@example.org', roles: ['network-member'], address: 12 }
const VISITOR: Person = { id: 'example-dao:person:visitor-c', name: 'Visitor C', mail: 'visitor-c@example.org', roles: [], address: 13 }
const PUBLIC_ADDRESS = 10

const MEMBERS = `schema_version: "2.0"
members:
  - { id: steward-a, name: Steward A, kind: person, handles: { git: [admin-test@local] } }
  - { id: "${STEWARD.id}", name: "${STEWARD.name}", kind: person }
  - { id: "${MEMBER.id}", name: "${MEMBER.name}", kind: person }
`
/** The stewards' role, named here so a level of role:steward is one the records may name; the Roles table's `steward`
 *  is the same word, so the steward reads at it either way. */
const GOVERNANCE = `schema_version: "2.0"
governance:
  model: "solo-maintainer"
  roles:
    steward: { members: ["${STEWARD.id}"] }
  decisions: []
`
const VISIBILITY = `visibility:
  defaults: { contact: "role:steward" }
  collections:
    pages: { default: members }
    tasks: { default: members }
`
const TASKS = `schema_version: "2.0"
tasks:
  - { id: t-agenda, title: Write the agenda, status: todo }
  - { id: t-room, title: Book the room, status: doing }
`
const page = (id: string, title: string, visibility: string | null, body: string) =>
  `---\nid: ${id}\ntitle: ${title}\nparent: null\norder: 1000\n${visibility ? `visibility: ${visibility}\n` : ''}---\n${body}`
const PUBLIC_PAGE = { id: 'welcome-0001', title: 'Welcome to Example DAO' }
const MEMBERS_PAGE = { id: 'guide-0001', title: 'Field guide' }
const PRIVATE_PAGE = { id: 'p-00000000beef', title: 'Steward room', text: 'Kept for stewards alone.' }
/** What the public, and a person with no Role, must never be shown: the members' and the stewards' titles and text. */
const RESTRICTED = [MEMBERS_PAGE.title, 'Members read this guide.', PRIVATE_PAGE.title, PRIVATE_PAGE.text, 'Write the agenda', 'Water the garden']
/** What a network member (no steward Role) must never be shown: the steward's page and the Circles import. */
const STEWARDS_ONLY = [PRIVATE_PAGE.title, PRIVATE_PAGE.text]

/** The accessible names of a control that writes the instance: none is drawn while the Hub's writes are off. (Comments,
 *  replies, resolve, reopen and the author's delete are what a read-only Hub still writes, plan D-6.) */
const WRITE_CONTROL = /^(New\b|New page|Add\b|Record a meeting|Move to|Move into|Propose|Stage|Suggest|Turn into a task|Import\b|Rename|Archive|Save\b|Publish|Edit\b|Apply|Approve|Ratify|Sync\b|Commit)/i

const fail = (why: string): never => { throw new Error(why) }
const said: string[] = []
const log = (line: string) => { said.push(line) }

// ── the instance, before the server ──

const temp = mkdtempSync(join(tmpdir(), 'admin-e2e-hosted-'))
const home = join(temp, 'home')
mkdirSync(home)
// The state home and the private store, outside the repository, set before the imports (a private import goes to the store).
const privateDir = join(home, 'private')
process.env.ORG_OS_ADMIN_HOME = home
process.env.ORG_OS_PRIVATE_DIR = privateDir
const repo = makeFixtureRepo()
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString().trim()
writeFileSync(join(repo, 'federation.yaml'), `identity:\n  name: "${ORG}"\n  type: "Organization"\n`)
writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
writeFileSync(join(repo, 'data', 'governance.yaml'), GOVERNANCE)
writeFileSync(join(repo, 'data', 'visibility.yaml'), VISIBILITY)
writeFileSync(join(repo, 'data', 'tasks.yaml'), TASKS)
mkdirSync(join(repo, 'pages'))
writeFileSync(join(repo, 'pages', `${PUBLIC_PAGE.id}.md`), page(PUBLIC_PAGE.id, PUBLIC_PAGE.title, 'public', 'How Example DAO works, in the open.\n'))
writeFileSync(join(repo, 'pages', `${MEMBERS_PAGE.id}.md`), page(MEMBERS_PAGE.id, MEMBERS_PAGE.title, null, 'Members read this guide.\n'))
git('add', '-A'); git('commit', '-qm', 'e2e: Example DAO, its pages, tasks and policy')

async function runImport(args: string[]): Promise<string[]> {
  const out: string[] = []
  const code = await importMain(args, { repo, out: t => out.push(t), err: t => out.push(`err: ${t}`), env: { ...process.env, INIT_CWD: temp } })
  if (code !== 0) fail(`npm run import -- ${args.join(' ')} answered ${code}:\n${out.join('\n')}`)
  return out
}
// The imports, as an operator runs them before the Hub starts: the Notion export with Circles kept at role:steward, and
// the Fileverse pull.
const notion = makeNotionExport(join(temp, 'notion-export'))
await runImport(['notion', notion])
const mapFile = join(notion, 'hub-import-map.yaml')
if (!existsSync(mapFile)) fail('the dry run wrote no map beside the export')
const map = parse(readFileSync(mapFile, 'utf8')) as { databases: Record<string, { level: string }> }
map.databases.Circles!.level = 'role:steward'
writeFileSync(mapFile, stringify(map))
await runImport(['notion', notion, '--apply'])
const pull = join(temp, 'fileverse-pull')
cpSync(PULL, pull, { recursive: true })
await runImport(['fileverse', pull])
await runImport(['fileverse', pull, '--apply'])

// The hosted settings, as the deploy's env sets them (every folder outside the repository).
const keys = join(temp, 'keys')
mkdirSync(keys)
createKeyPair(join(keys, 'backup.key'), join(keys, 'backup.pub'))
const ENV: Record<string, string> = {
  ORG_OS_HOSTED: '1', ORG_OS_PUBLIC_ORIGIN: HUB, ORG_OS_PORTAL_ORIGIN: PORTAL, ORG_OS_BIND: '127.0.0.1', PORT: '0',
  ORG_OS_TRUST_PROXY: 'on', ORG_OS_PUSH: 'off', ORG_OS_REFRESH_EVERY: 'off', ORG_OS_PORTAL_EVERY: 'off',
  ORG_OS_PORTAL_DIR: join(temp, 'portal'), ORG_OS_PRIVATE_DIR: privateDir, ORG_OS_BACKUP_DIR: join(temp, 'backups'),
  ORG_OS_BACKUP_PUBLIC_KEY_FILE: join(keys, 'backup.pub'), ORG_OS_ADMIN_HOME: home,
  HOUSE_INSTANCE_WRITES: 'off',
  HOUSE_EMAIL_PEPPER: PEPPER, HOUSE_SESSION_PRIVATE_JWK: JSON.stringify(newPrivateJwk()),
  SESSION_COOKIE_NAME: COOKIE, SESSION_COOKIE_DOMAIN: 'example.org', RESEND_API_KEY: 're_test_synthetic', MAIL_FROM: 'hub@example.org',
}
Object.assign(process.env, ENV)

// The Roles, through house:roles (stdin only), into the store the server opens; the private page beside them.
{
  const doc = {
    roles_version: '2026-11-11',
    people: [STEWARD, MEMBER, VISITOR].map(p => ({ id: p.id, name: p.name, email_keys: [emailKey(p.mail, PEPPER)], roles: p.roles, nodes: [] })),
  }
  const out: string[] = []
  const code = await rolesMain(['load'], { repo, stdin: async () => JSON.stringify(doc), out: t => out.push(t), err: t => out.push(t), env: process.env })
  if (code !== 0) fail(`house:roles load answered ${code}: ${out.join(' / ')}`)
  log(`house:roles: ${out.join(' / ')}`)
  const store = await openPrivateStore(repo, { dir: privateDir })
  await store.putRecord({ collection: 'pages', id: PRIVATE_PAGE.id, visibility: 'role:steward', body: { title: PRIVATE_PAGE.title, parent: null, order: 9000, markdown: `${PRIVATE_PAGE.text}\n` }, rev: '' }, 'steward-a', null)
  store.close()
}

const read = readHostedConfig(process.env, repo)
if (!('config' in read)) throw new Error(read.refuse)
const mailer = recordingMailer()
const server = await startServer({
  repo, port: 0, appDist: join(here, '..', '..', 'app', 'dist'), hosted: true, hostedConfig: read.config, mailer,
  fetch: async () => { throw new Error('no network in this walk') },
})
const startHead = git('rev-parse', 'HEAD')
mkdirSync(SHOTS, { recursive: true })

// ── the proxy: the Hub's https origin answered by this server ──

/** One request to the server as the TLS proxy sends it: the Hub's host, the client's address in X-Real-IP. */
function forward(method: string, path: string, headers: Record<string, string>, body: Buffer | null): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: server.port, method, path, headers }, res => {
      const chunks: Buffer[] = []
      res.on('data', (d: Buffer) => chunks.push(d))
      res.on('end', () => {
        const out: Record<string, string> = {}
        for (const [k, v] of Object.entries(res.headers)) {
          if (v === undefined || k === 'connection' || k === 'transfer-encoding' || k === 'keep-alive') continue
          out[k] = Array.isArray(v) ? v.join('\n') : String(v)
        }
        resolve({ status: res.statusCode ?? 0, headers: out, body: Buffer.concat(chunks) })
      })
    })
    req.on('error', reject)
    req.end(body ?? undefined)
  })
}

/** Every redirect the server answered, by path and query: its status and Location. */
const redirects = new Map<string, { status: number; location: string }>()
const cookieHeader = async (ctx: BrowserContext) => (await ctx.cookies(HUB)).map(c => `${c.name}=${c.value}`).join('; ')

/** Page loads so far, per person: the next load's address (below). */
const loads = new Map<number, number>()
/** A browser context whose every request goes to this server, from the person `who`'s addresses. The Hub limits reads
 *  per client address (L9 §5.9: 300 a minute, 100 at once), and every page load here is a cold one (the HTML, the
 *  scripts, the fonts and the page's reads, ~25 requests), as a person's first visit is, many times a minute: so each
 *  page load comes from the next address of the person's own block (198.18.<who>.<n>), and the limits are not what this
 *  walk measures. */
async function hubContext(who: number, opts: { width?: number; scheme?: 'light' | 'dark'; storageState?: Awaited<ReturnType<BrowserContext['storageState']>> } = {}): Promise<BrowserContext> {
  const ctx = await browser!.newContext({
    viewport: { width: opts.width ?? 1440, height: 900 }, colorScheme: opts.scheme ?? 'light', locale: 'en-US', timezoneId: 'UTC',
    serviceWorkers: 'block', ...(opts.storageState ? { storageState: opts.storageState } : {}),
  })
  let address = `198.18.${who}.${((loads.get(who) ?? 0) % 250) + 1}`
  await ctx.route(() => true, async (route: Route) => {
    const req = route.request()
    if (req.isNavigationRequest() && req.frame() === req.frame().page().mainFrame()) { const n = loads.get(who) ?? 0; loads.set(who, n + 1); address = `198.18.${who}.${(n % 250) + 1}` }
    const url = new URL(req.url())
    if (url.host === PORTAL_HOST) {
      return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><title>${ORG} portal</title><h1>${ORG} portal</h1>` })
    }
    if (url.host !== HUB_HOST) return route.abort('blockedbyclient')
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(req.headers())) if (!k.startsWith(':') && k !== 'host' && k !== 'cookie') headers[k] = v
    headers.host = HUB_HOST
    headers['x-real-ip'] = address
    const cookie = await cookieHeader(ctx)
    if (cookie) headers.cookie = cookie
    const res = await forward(req.method(), `${url.pathname}${url.search}`, headers, req.postDataBuffer())
    // A redirect is kept as the server answered it, and the browser is taken on by a page that goes there (the browser
    // does not follow a 3xx it is handed by interception).
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      redirects.set(`${url.pathname}${url.search}`, { status: res.status, location: res.headers.location })
      return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><meta http-equiv="refresh" content="0;url=${res.headers.location.replace(/"/g, '&quot;')}">` })
    }
    return route.fulfill({ status: res.status, headers: res.headers, body: res.body })
  })
  await ctx.routeWebSocket(u => new URL(u).host === HUB_HOST, async (ws: WebSocketRoute) => {
    const url = new URL(ws.url())
    const up = new WebSocket(`ws://127.0.0.1:${server.port}${url.pathname}${url.search}`, {
      headers: { host: HUB_HOST, origin: HUB, cookie: await cookieHeader(ctx), 'x-real-ip': address },
    })
    const queued: (string | Buffer)[] = []
    up.on('open', () => { for (const m of queued.splice(0)) up.send(m) })
    up.on('message', (data, binary) => ws.send(binary ? data as Buffer : String(data)))
    up.on('close', () => { void ws.close().catch(() => {}) })
    up.on('error', () => { void ws.close().catch(() => {}) })
    ws.onMessage(m => { if (up.readyState === WebSocket.OPEN) up.send(m); else queued.push(m) })
    ws.onClose(() => up.close())
  })
  return ctx
}

/** The text of the page as drawn, for the "nothing restricted" checks. */
const shown = async (p: Page) => (await p.locator('body').innerText()).replace(/\s+/g, ' ')
async function noneOf(p: Page, words: string[], who: string, where: string): Promise<void> {
  const text = await shown(p)
  const seen = words.filter(w => text.includes(w))
  if (seen.length > 0) fail(`${who} is shown ${seen.join(', ')} at ${where}`)
}

/** The accessible names of every button and link drawn in `main`, outside the Comments thread. */
async function writeControls(p: Page): Promise<string[]> {
  const names = await p.locator('main button, main a[href], main [role="button"], main [role="menuitem"]').evaluateAll(els => els
    .filter(e => !e.closest('[aria-label="Comments"]'))
    .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 })
    .map(e => (e.getAttribute('aria-label') ?? (e as HTMLElement).innerText ?? '').trim()))
  return names.filter(n => WRITE_CONTROL.test(n))
}

/** Opens `path`, waits for it, and fails on any write control drawn there or any editable surface outside a composer. */
async function readOnly(p: Page, path: string, who: string): Promise<void> {
  await p.goto(`${HUB}${path}`)
  await settle(p)
  const writes = await writeControls(p)
  if (writes.length > 0) fail(`${who} is offered ${writes.join(', ')} at ${path} while the Hub's writes are off`)
  const editable = await p.locator('main [contenteditable="true"]').count()
  if (editable > 0) fail(`${who} has ${editable} editable surface(s) at ${path} while the Hub's writes are off`)
  // nothing says an edit saves (PR7-R67)
  const says = ['Saved · direct', 'saves directly', 'Staged · needs approval']
  const text = await shown(p)
  const saving = says.filter(w => text.includes(w))
  if (saving.length > 0) fail(`${who} reads "${saving.join('", "')}" at ${path} while the Hub's writes are off`)
}

/** The emailed-link sign-in, as a person does it: the form on /sign-in, the link from the mail, Continue. */
async function signIn(ctx: BrowserContext, who: Person): Promise<Page> {
  const p = await ctx.newPage()
  const before = mailer.sent.length
  await p.goto(`${HUB}/sign-in`)
  await p.getByRole('group', { name: 'Sign in' }).waitFor()
  await p.getByLabel('Email').fill(who.mail)
  await p.getByRole('button', { name: 'Email me a link' }).click()
  await p.getByRole('group', { name: 'Sign in' }).getByText(`If this address is on ${ORG}'s records, a link is on its way.`).waitFor()
  const until = Date.now() + 10_000
  while (mailer.sent.length === before && Date.now() < until) await new Promise(r => setTimeout(r, 50))
  const mail = mailer.sent.at(-1)
  if (mailer.sent.length === before || !mail) fail(`no link was mailed for ${who.name}`)
  if (mail!.to.toLowerCase() !== who.mail) fail(`the link for ${who.name} went to another address`)
  const link = new URL(mail!.link)
  if (`${link.origin}${link.pathname}` !== `${HUB}/sign-in/link`) fail(`the link is ${link.origin}${link.pathname}, not the Hub's /sign-in/link`)
  await p.goto(link.href)
  await p.getByRole('heading', { level: 1, name: `Continue to ${ORG}` }).waitFor()
  if (p.url().includes('token=')) fail('the link page leaves the token in the address bar')
  await p.getByRole('button', { name: 'Continue' }).click()
  await p.waitForURL(u => new URL(u).pathname === '/')
  const session = await p.evaluate(async () => (await fetch('/api/session')).json()) as { signedIn?: boolean; via?: string; person?: { name: string } }
  if (!session.signedIn || session.via !== 'email' || session.person?.name !== who.name) fail(`${who.name}'s session reads ${JSON.stringify(session)}`)
  return p
}

/** A write sent straight to the API from the page (its origin, its cookie): refused read-only. */
async function refusedWrite(p: Page, method: string, path: string, body: unknown): Promise<void> {
  const r = await p.evaluate(async ({ method, path, body }) => {
    const res = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) as unknown }
  }, { method, path, body })
  const json = r.json as { error?: string; code?: string } | null
  if (r.status !== 403 || json?.error !== READ_ONLY || json?.code !== 'INSTANCE_READ_ONLY') fail(`${method} ${path} answered ${r.status} ${JSON.stringify(json)}, not 403 with the read-only sentence`)
}

let browser: Browser | undefined
let at = 'the start'
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })

  // ── the public ──
  at = 'the public'
  const pub = await hubContext(PUBLIC_ADDRESS)
  const pp = await pub.newPage()
  // Hosted, the members' side asks the public to sign in (L5 §11.1: a 401 read with no session goes to
  // /sign-in?next=); what the public may read, the server answers as such, and the portal is the public's site.
  for (const path of ['/', '/workspace', `/p/${PUBLIC_PAGE.id}`, `/p/${MEMBERS_PAGE.id}`, `/p/${PRIVATE_PAGE.id}`, '/c/tasks', '/c/notion-tasks', '/c/notion-circles', '/sources']) {
    await pp.goto(`${HUB}${path}`)
    await pp.waitForURL(u => new URL(u).pathname === '/sign-in')
    // / is Home's board (/b/home) before it asks
    if (new URL(pp.url()).searchParams.get('next') !== (path === '/' ? '/b/home' : path)) fail(`${path} sent the public to ${pp.url()}`)
    await pp.getByLabel('Email').waitFor()
    await noneOf(pp, RESTRICTED, 'the public', path)
  }
  // (no named function inside an evaluate: the runner's transform would name it with a helper the page lacks)
  const [pagesRead, pubRead, memRead, privRead, collRead, srcRead] = await pp.evaluate(paths => Promise.all(paths.map(async path => {
    const r = await fetch(path)
    return { status: r.status, text: await r.text() }
  })), ['/api/pages', `/api/pages/${PUBLIC_PAGE.id}`, `/api/pages/${MEMBERS_PAGE.id}`, `/api/pages/${PRIVATE_PAGE.id}`, '/api/collections', '/api/sources'])
  const publicReads = { pages: pagesRead!, pub: pubRead!, mem: memRead!, priv: privRead!, collections: collRead!, sources: srcRead! }
  const titles = (JSON.parse(publicReads.pages.text) as { title: string }[]).map(x => x.title)
  if (titles.join() !== PUBLIC_PAGE.title) fail(`GET /api/pages answers the public ${titles.join(', ')}`)
  if (publicReads.pub.status !== 200 || !publicReads.pub.text.includes('How Example DAO works, in the open.')) fail(`the public page reads ${publicReads.pub.status} to the public`)
  for (const [what, r] of [['the members page', publicReads.mem], ['the private page', publicReads.priv], ['the collections', publicReads.collections], ['Sources', publicReads.sources]] as const) {
    if (r.status === 200 && RESTRICTED.some(w => r.text.includes(w))) fail(`${what} answers the public ${r.text.slice(0, 200)}`)
    if (RESTRICTED.some(w => r.text.includes(w))) fail(`${what}'s refusal names what is restricted: ${r.text.slice(0, 200)}`)
  }
  log(`the public: every Hub route asks them to sign in, nothing restricted drawn; the API answers the public page alone (members page ${publicReads.mem.status}, private ${publicReads.priv.status}, collections ${publicReads.collections.status}, Sources ${publicReads.sources.status})`)
  // /portal and /door go to the portal origin, anything under them and the query kept.
  for (const [path, location, lands] of [['/portal', PORTAL, `${PORTAL}/`], ['/door', PORTAL, `${PORTAL}/`], ['/door/projects?x=1', `${PORTAL}/projects?x=1`, `${PORTAL}/projects?x=1`]] as const) {
    await pp.goto(`${HUB}${path}`)
    await pp.waitForURL(lands)
    const answered = redirects.get(path)
    if (answered?.status !== 302 || answered.location !== location) fail(`${path} was answered ${JSON.stringify(answered)}, not 302 to ${location}`)
    await pp.getByRole('heading', { level: 1, name: `${ORG} portal` }).waitFor()
  }
  log('/portal and /door redirect to the portal origin, the path under them and the query kept')
  await pub.close()

  // ── the steward: signed in by an emailed link; everything read, nothing writable ──
  at = 'the steward'
  const sctx = await hubContext(STEWARD.address)
  const ps = await signIn(sctx, STEWARD)
  log('the steward signed in by an emailed link (the form, the mailed link, Continue)')
  await ps.locator('button.who').first().filter({ hasText: STEWARD.name }).waitFor({ timeout: 15_000 })
  if (await ps.locator('.band').filter({ hasText: 'no Role here yet' }).count() > 0) fail('the steward reads the no-Role band')
  const portalHref = await ps.getByRole('link', { name: /Portal/ }).first().getAttribute('href')
  if (portalHref !== PORTAL) fail(`the Portal link points at ${portalHref}, not ${PORTAL}`)
  log(`the Portal link points at ${PORTAL}`)
  at = 'the steward reads'
  await readOnly(ps, '/workspace', STEWARD.name)
  for (const t of [PUBLIC_PAGE.title, MEMBERS_PAGE.title, PRIVATE_PAGE.title]) await ps.getByText(t).first().waitFor()
  await readOnly(ps, `/p/${MEMBERS_PAGE.id}`, STEWARD.name)
  await ps.getByText('Members read this guide.').first().waitFor()
  await readOnly(ps, `/p/${PRIVATE_PAGE.id}`, STEWARD.name)
  await ps.getByText(PRIVATE_PAGE.text).first().waitFor()
  await readOnly(ps, '/c/tasks', STEWARD.name)
  await ps.getByText('Write the agenda').first().waitFor()
  await ps.getByRole('tab', { name: 'Board' }).click()
  await ps.getByRole('list', { name: 'todo' }).getByText('Write the agenda').waitFor()
  if ((await writeControls(ps)).length > 0) fail(`the board offers ${(await writeControls(ps)).join(', ')}`)
  await readOnly(ps, '/c/meetings', STEWARD.name)
  await readOnly(ps, '/c/notion-tasks', STEWARD.name)
  await ps.getByRole('link', { name: 'Water the garden' }).first().waitFor()
  await readOnly(ps, '/c/notion-circles', STEWARD.name)
  await readOnly(ps, '/sources', STEWARD.name)
  const rows = (await ps.getByRole('list', { name: 'Sources' }).getByRole('listitem').allInnerTexts()).map(r => r.split('\n').join(' '))
  if (rows.filter(r => /Import/.test(r)).length < 2) fail(`Sources lists fewer than two imports: ${rows.join(' | ')}`)
  for (const path of ['/', '/registries', '/registries/projects', '/c/notion-docs', '/library', '/governance']) await readOnly(ps, path, STEWARD.name)
  log('the steward reads pages (public, members, the private page), tasks and its board, meetings, the imports and Sources; no write control on any of them')
  at = 'a write through the API'
  await refusedWrite(ps, 'POST', '/api/registries/projects', { id: 'p-x', title: 'X' })
  await refusedWrite(ps, 'POST', '/api/pages', { title: 'A new page', parent: null })
  if (git('rev-parse', 'HEAD') !== startHead) fail('a refused write moved the trunk')
  log('a write sent to the API answers 403 with the read-only sentence; nothing committed')

  // ── the network member: presence and the conversation ──
  at = 'the network member'
  const mctx = await hubContext(MEMBER.address)
  const pm = await signIn(mctx, MEMBER)
  for (const path of ['/workspace', '/c/notion-circles', `/p/${PRIVATE_PAGE.id}`]) {
    await pm.goto(`${HUB}${path}`)
    await settle(pm).catch(() => {})
    await noneOf(pm, STEWARDS_ONLY, MEMBER.name, path)
  }
  log('the network member reads the members\' side, never the steward\'s page or Circles')
  at = 'presence'
  await ps.goto(`${HUB}/p/${MEMBERS_PAGE.id}`)
  await settle(ps)
  await pm.goto(`${HUB}/p/${MEMBERS_PAGE.id}`)
  await settle(pm)
  await ps.locator('.ed-bar').getByRole('img', { name: new RegExp(`${MEMBER.name} is (reading|editing)`) }).waitFor({ timeout: 30_000 })
  await pm.locator('.ed-bar').getByRole('img', { name: new RegExp(`${STEWARD.name} is (reading|editing)`) }).waitFor({ timeout: 30_000 })
  log('presence: each sees the other on the page')
  at = 'comments'
  await ps.getByRole('button', { name: /^Comments, / }).click()
  const sThread = ps.getByRole('complementary', { name: 'Comments' })
  await sThread.getByRole('textbox', { name: 'Comment' }).fill('Should the guide name the season?')
  await ps.keyboard.press('ControlOrMeta+Enter')
  await sThread.getByText('Should the guide name the season?').waitFor()
  await pm.getByRole('button', { name: /^Comments, / }).click()
  const mThread = pm.getByRole('complementary', { name: 'Comments' })
  await mThread.getByText('Should the guide name the season?').waitFor({ timeout: 15_000 })
  await mThread.getByRole('button', { name: 'Reply' }).first().click()
  await mThread.getByRole('textbox', { name: /^Reply to / }).fill('Yes, at the top.')
  await pm.keyboard.press('ControlOrMeta+Enter')
  await mThread.getByText('Yes, at the top.').waitFor()
  await sThread.getByText('Yes, at the top.').waitFor({ timeout: 15_000 })
  if (await sThread.getByRole('button', { name: 'Turn into a task' }).count() > 0) fail('Turn into a task is offered while the Hub\'s writes are off')
  await sThread.getByRole('button', { name: 'Resolve' }).first().click()
  await sThread.getByText(new RegExp(`^Resolved by ${STEWARD.name}`)).waitFor()
  await mThread.getByText(new RegExp(`^Resolved by ${STEWARD.name}`)).waitFor({ timeout: 15_000 })
  if (git('rev-parse', 'HEAD') !== startHead) fail('the conversation moved the trunk')
  log('comments: the steward comments, the member replies, the steward resolves; each seen by the other; nothing committed')
  await mctx.close()

  // ── the visitor with no Role ──
  at = 'the visitor'
  const vctx = await hubContext(VISITOR.address)
  const pv = await signIn(vctx, VISITOR)
  await pv.locator('.band').filter({ hasText: 'You are signed in, but you have no Role here yet.' }).first().waitFor({ timeout: 15_000 })
  for (const path of ['/', '/workspace', `/p/${MEMBERS_PAGE.id}`, `/p/${PRIVATE_PAGE.id}`, '/c/tasks', '/c/notion-tasks', '/c/notion-circles', '/sources']) {
    await pv.goto(`${HUB}${path}`)
    await settle(pv).catch(() => {})
    await noneOf(pv, RESTRICTED, VISITOR.name, path)
  }
  const visitorPages = await pv.evaluate(async () => { const r = await fetch('/api/pages'); return r.ok ? (await r.json() as { title: string }[]).map(x => x.title) : [] })
  if (visitorPages.join() !== PUBLIC_PAGE.title) fail(`GET /api/pages answers the visitor ${visitorPages.join(', ')}`)
  log('the visitor with no Role reads "no Role here yet", and only what is public')

  // ── the shots: 1440 and 390, light and dark ──
  at = 'the shots'
  const steward = await sctx.storageState()
  const visitor = await vctx.storageState()
  await sctx.close()
  await vctx.close()
  const routes: [string, string, typeof steward | undefined][] = [
    ['sign-in', '/sign-in', undefined],
    ['workspace', '/workspace', steward], ['page', `/p/${MEMBERS_PAGE.id}`, steward], ['private-page', `/p/${PRIVATE_PAGE.id}`, steward],
    ['tasks', '/c/tasks', steward], ['imported-tasks', '/c/notion-tasks', steward], ['sources', '/sources', steward],
    ['no-role', '/', visitor],
  ]
  let shots = 0
  for (const width of [1440, 390]) {
    for (const scheme of ['light', 'dark'] as const) {
      for (const [slug, path, state] of routes) {
        const c = await hubContext(state === steward ? STEWARD.address : state === visitor ? VISITOR.address : PUBLIC_ADDRESS, { width, scheme, ...(state ? { storageState: state } : {}) })
        const p = await c.newPage()
        await p.goto(`${HUB}${path}`)
        await settle(p)
        await p.screenshot({ path: join(SHOTS, `${slug}-${width}-${scheme}.png`), fullPage: false })
        shots++
        await c.close()
      }
    }
  }
  log(`${shots} shots in ${SHOTS}`)
  if (git('rev-parse', 'HEAD') !== startHead) fail('the walk moved the trunk')

  console.log(`e2e hosted: ok (${said.length} steps)\n${said.map(l => `  ${l}`).join('\n')}`)
} catch (err) {
  let n = 0
  for (const p of browser?.contexts().flatMap(c => c.pages()) ?? []) {
    n++
    await p.screenshot({ path: join(SHOTS, `failed-${n}.png`), fullPage: true }).catch(() => {})
    writeFileSync(join(SHOTS, `failed-${n}.aria.txt`), `${p.url()}\n${await p.locator('body').ariaSnapshot().catch(() => '')}`)
  }
  console.error(`e2e hosted: failed at ${at}`)
  throw err
} finally {
  await browser?.close()
  await server.close()
  removeFixtureRepo(repo)
  rmSync(temp, { recursive: true, force: true })
}
