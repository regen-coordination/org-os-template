// Sign-in from the Hub, in the installed Chrome (DAO-OS L5 spec §4, §11, §15): the server started as golden.mts starts
// it (the admin fixture, setup.mts's way), here with a Hats tree and a fake fetch for the wearer reads; a fake EIP-1193
// provider injected with `addInitScript`, signing with a key made by this harness (nothing is sent on chain; the server
// only recovers the address). The walk: open /, sign in, see the hats in the identity, View as Public and exit, sign
// out; a second address that wears nothing is told it is no member. Screenshots at 1440 and 390, light and dark, go to
// app/e2e/signin/ (git-ignored, Q39).
//
// Every file is under a fresh directory in the OS temp dir, removed at the end. The provider answers only the four
// methods the Hub may ask (WALLET_METHODS); anything else asked of it fails the walk.
import { chromium, type Browser, type Page } from 'playwright-core'
import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeFixtureRepo, removeFixtureRepo } from '../fixtures.ts'
import { addressOfKey, key } from '../session/keys.ts'
import { startServer } from '../../server/serve.ts'
import { hatRef } from '../../lib/hats.mjs'
import { WALLET_METHODS } from '../../app/src/session/wallet.ts'
import { CELO, COUNCIL_ID, OPS_ID, fakeChain, withWallet } from './wallet.mts'

const here = dirname(fileURLToPath(import.meta.url))
const SHOTS = join(here, '..', '..', 'app', 'e2e', 'signin')

const MEMBERS = `schema_version: "2.0"
members:
  - { id: steward-a, name: Steward A, kind: person, handles: { git: [admin-test@local] } }
`
const GOVERNANCE = `schema_version: "2.0"
governance:
  model: "solo-maintainer"
  membership: { tree: hats-main }
  roles:
    council: { hat: "${hatRef(CELO, COUNCIL_ID)}" }
    ops: { hat: "${hatRef(CELO, OPS_ID)}" }
  decisions: []
`
const SYSTEMS = `schema_version: "2.0"
systems:
  - { id: hats-main, kind: hats-tree, name: Hats, chain: "${CELO}", address: "13", driver: hats-tree }
`

const fail = (why: string): never => { throw new Error(why) }
const shot = (page: Page, name: string) => page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false })

// ── the instance ──

const wearer = key()
const stranger = key()
const home = mkdtempSync(join(tmpdir(), 'admin-e2e-signin-'))
process.env.ORG_OS_ADMIN_HOME = home
process.env.ORG_OS_PRIVATE_DIR = join(home, 'private')
const repo = makeFixtureRepo()
writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
writeFileSync(join(repo, 'data', 'governance.yaml'), GOVERNANCE)
writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
execSync('git add -A && git commit -qm "e2e: a Hats tree, its roles, one member"', { cwd: repo })
const fetch = fakeChain({ [COUNCIL_ID]: [addressOfKey(wearer).toLowerCase()], [OPS_ID]: [addressOfKey(wearer).toLowerCase()] })
const server = await startServer({ repo, port: 0, appDist: join(here, '..', '..', 'app', 'dist'), fetch })
const base = `http://localhost:${server.port}`
mkdirSync(SHOTS, { recursive: true })

let browser: Browser | undefined
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })

  // ── the walk, at 1440, light ──
  const { ctx, page, asked } = await withWallet(browser, wearer, { width: 1440, scheme: 'light' })
  await page.goto(`${base}/`)
  // Home's head is its line (L4c C6, §14.1): how many things wait on you, the page's h1 (as golden.mts reads it)
  await page.getByRole('heading', { level: 1, name: /(waits|wait) on you\.$/ }).waitFor()
  await page.goto(`${base}/sign-in`)
  await page.getByRole('heading', { level: 1, name: 'Sign in with your wallet' }).waitFor()
  await page.getByRole('button', { name: 'Sign in with Ethereum' }).click()
  // Signed in, the page goes on to /, and the identity is the session's: the lowest hat worn (Ops, under Council).
  await page.waitForURL(`${base}/`)
  const who = page.locator('button.who').first()
  await who.filter({ hasText: 'ops' }).waitFor({ timeout: 15_000 })
  await who.click()
  const menu = page.getByRole('menu', { name: 'Signed in' })
  for (const hat of ['council', 'ops']) await menu.getByRole('menuitem', { name: hat, exact: true }).waitFor()
  await menu.getByRole('menuitem', { name: 'Sign out' }).waitFor()
  await page.keyboard.press('Escape')

  // View as Public, then exit.
  await page.locator('button.viewas').first().click()
  await page.getByRole('menu', { name: 'View as' }).getByRole('menuitemradio', { name: 'Public' }).click()
  await page.getByText('Previewing as Public.').first().waitFor()
  await page.getByRole('button', { name: 'Exit preview' }).click()
  await page.getByText('Previewing as Public.').first().waitFor({ state: 'detached' })

  // Sign out: the session ends and the page is the sign-in card again.
  await who.click()
  await page.getByRole('menu', { name: 'Signed in' }).getByRole('menuitem', { name: 'Sign out' }).click()
  await page.waitForURL(/\/sign-in$/)
  await page.getByRole('button', { name: 'Sign in with Ethereum' }).waitFor()
  const session = await (await page.request.get(`${base}/api/session`)).json() as { signedIn?: boolean }
  if (session.signedIn) fail('the session is still open after Sign out')
  const outside = asked.filter(m => !(WALLET_METHODS as readonly string[]).includes(m))
  if (outside.length > 0) fail(`the Hub asked the wallet for ${outside.join(', ')}`)
  if (!asked.includes('personal_sign')) fail('the wallet was never asked to sign')
  await ctx.close()

  // ── a second address that wears nothing ──
  const other = await withWallet(browser, stranger, { width: 1440, scheme: 'light' })
  await other.page.goto(`${base}/sign-in`)
  await other.page.getByRole('button', { name: 'Sign in with Ethereum' }).click()
  await other.page.locator('main.signin-page .note').getByText('This address wears no hat in').waitFor({ timeout: 15_000 })
  // D-5: this Hub has no portal origin, so the card offers no portal link
  if (await other.page.getByRole('link', { name: 'Read the portal' }).count() > 0) fail('the card offers a portal link with no portal origin')
  await other.ctx.close()

  // ── the shots: 1440 and 390, light and dark ──
  for (const width of [1440, 390]) {
    for (const scheme of ['light', 'dark'] as const) {
      const tag = `${width}-${scheme}`
      const a = await withWallet(browser, wearer, { width, scheme })
      await a.page.goto(`${base}/sign-in`)
      await a.page.getByRole('button', { name: 'Sign in with Ethereum' }).waitFor()
      await shot(a.page, `signin-idle-${tag}`)
      await a.page.getByRole('button', { name: 'Sign in with Ethereum' }).click()
      await a.page.waitForURL(`${base}/`)
      await a.page.getByRole('heading', { level: 1, name: /(waits|wait) on you\.$/ }).waitFor()
      await shot(a.page, `signed-in-${tag}`)
      await a.ctx.close()
      const b = await withWallet(browser, stranger, { width, scheme })
      await b.page.goto(`${base}/sign-in`)
      await b.page.getByRole('button', { name: 'Sign in with Ethereum' }).click()
      await b.page.locator('main.signin-page .note').getByText('This address wears no hat in').waitFor({ timeout: 15_000 })
      await shot(b.page, `not-member-${tag}`)
      await b.ctx.close()
    }
  }
  console.log(`e2e sign-in: ok (walk, not-member, 12 shots in ${SHOTS})`)
} finally {
  await browser?.close()
  await server.close()
  removeFixtureRepo(repo)
  rmSync(home, { recursive: true, force: true })
}
