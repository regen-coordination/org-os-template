// DAO-OS L7 Tasks 19 and 17 in the installed Chrome: a shelf wizard composes a DAO and /compose draws it. On the e2e
// fixture with the framework's test shelf registered (federation.yaml → library.shelves, committed in the fixture's own
// temporary repository), the test shelf's wizard asks a name and the signers; a threshold above the signers is refused
// by the add and the wizard goes back to Signers with the sentence; with two of two it stages the test council's add
// and opens /compose, where the Safe, the Hats tree and its council hat are drawn from the change, with no count of
// prepared transactions: the composition is only staged, and GET /api/deploy answers STAGED_ONLY (Task 11) before it
// reads anything. A rename on the canvas is staged into the same change. Nothing is written
// to git. Previewing as Public, /compose draws no canvas and no control that writes. Placeholder addresses only.
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startFixture } from './setup.mts'
import { SYSTEMS, viewAsPublic } from './seed.mts'

const here = dirname(fileURLToPath(import.meta.url))
const SHELF = join(here, '..', 'library', 'fixtures', 'test-shelf')
const A1 = `0x${'0'.repeat(38)}a1`, A2 = `0x${'0'.repeat(38)}a2`
const WIZARD = '/wizards/test-shelf%2Ftest-compose'

const fx = await startFixture({ offline: true, systems: SYSTEMS })
const git = (...args: string[]) => execFileSync('git', args, { cwd: fx.repo }).toString().trim()
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
try {
  writeFileSync(join(fx.repo, 'federation.yaml'), `identity:\n  name: "Fixture Org"\n  type: "Organization"\nlibrary:\n  shelves:\n    - { path: ${JSON.stringify(SHELF)} }\n`)
  git('add', 'federation.yaml')
  git('commit', '-qm', 'e2e: register the test shelf')
  const head = git('rev-parse', 'HEAD')

  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  const field = (label: string) => page.locator('.wiz-field').filter({ has: page.getByText(label, { exact: true }) }).locator('input, textarea')
  const next = () => page.getByRole('button', { name: 'Continue' }).click()

  await page.goto(`${fx.base}${WIZARD}`)
  await page.getByRole('heading', { level: 1, name: 'Compose a test council' }).waitFor()
  await page.getByRole('button', { name: 'Start' }).click()
  await page.getByRole('heading', { level: 2, name: 'Name' }).waitFor()
  await field('Name').fill('Test DAO')
  // walk I12: the id the records are named from follows the name
  const id = await field('Id').inputValue()
  if (id !== 'test-dao') throw new Error(`the Id reads "${id}"`)
  await next()
  await page.getByRole('heading', { level: 2, name: 'Signers' }).waitFor()
  // walk M14: the eyebrow counts the rail, the review last, on every screen
  const eyebrow = await page.locator('.wiz-k').textContent()
  if (eyebrow !== 'Compose a test council · 2 of 3') throw new Error(`the eyebrow reads "${eyebrow}"`)
  await field('Signers').fill(`${A1}\n${A2}`)
  await field('Signatures needed').fill('3')
  await next()
  await page.getByRole('heading', { level: 2, name: 'Review' }).waitFor()
  await page.getByRole('list', { name: 'What it stages' }).getByText('systems:test-dao-safe').waitFor()
  await page.getByRole('button', { name: 'Stage in your changes' }).click()
  // the add refuses a threshold above the signers: back to Signers, the sentence said, nothing staged
  await page.getByRole('heading', { level: 2, name: 'Signers' }).waitFor()
  await page.locator('.wiz-body .note-error').getByText(/threshold is 3, and the Safe has 2 owners/).waitFor()
  const refused = await (await fetch(`${fx.base}/api/changes`)).json() as { ops: { record: string }[] }
  if (refused.ops.some(o => o.record.startsWith('systems:test-dao'))) throw new Error('a refused add staged something')
  await field('Signatures needed').fill('2')
  await next()
  await page.getByRole('heading', { level: 2, name: 'Review' }).waitFor()
  await page.getByRole('button', { name: 'Stage in your changes' }).click()
  await page.waitForURL(/\/compose$/)

  // /compose: the composition, drawn from the change
  await page.getByRole('heading', { level: 1, name: 'Compose' }).waitFor()
  const canvas = page.locator('.cmp-canvas')
  for (const id of ['test-dao-safe', 'test-dao-roles', 'test-dao-roles/council']) await canvas.locator(`[data-node-id="${id}"]`).waitFor()
  const foot = await page.locator('.cmp-foot').innerText()
  if (!foot.includes('Staged · not yet deployed')) throw new Error(`the foot reads "${foot}"`)
  if (/prepared transaction/.test(foot)) throw new Error(`the foot counts prepared transactions with no plan read: "${foot}"`)
  const plan = await fetch(`${fx.base}/api/deploy`)
  const said = await plan.json() as { code?: string }
  if (plan.status !== 409 || said.code !== 'STAGED_ONLY') throw new Error(`GET /api/deploy on a staged composition answered ${plan.status} ${JSON.stringify(said)}`)
  const staged = await (await fetch(`${fx.base}/api/changes`)).json() as { ops: { record: string }[] }
  const records = staged.ops.map(o => o.record)
  for (const r of ['systems:test-dao-safe', 'systems:test-dao-roles', 'boards:test-dao-council']) if (!records.includes(r)) throw new Error(`the change does not stage ${r}: ${records.join(', ')}`)

  // a rename on the canvas stages into the same change
  await canvas.locator('[data-node-id="test-dao-safe"]').click()
  const name = page.getByRole('region', { name: 'Test DAO Safe' }).getByLabel('Name')
  await name.fill('Council Safe')
  await name.blur()
  await canvas.locator('[data-node-id="test-dao-safe"]').getByText('Council Safe').waitFor()
  // the change holds the Safe's create, so the engine folds the rename into it (or keeps it as an update)
  type Staged = { ops: { op: string; record: string; set?: { name?: string }; value?: { name?: string } }[] }
  const named = (v: Staged) => v.ops.some(o => o.record === 'systems:test-dao-safe' && (o.set?.name ?? o.value?.name) === 'Council Safe')
  let renamed = false
  for (let i = 0; i < 40 && !renamed; i++) {
    renamed = named(await (await fetch(`${fx.base}/api/changes`)).json() as Staged)
    if (!renamed) await page.waitForTimeout(250)
  }
  if (!renamed) throw new Error('the rename was not staged')

  // Review order opens the Changes tray over the page
  await page.getByRole('button', { name: 'Review order' }).click()
  await page.getByRole('group', { name: 'Your change' }).waitFor()
  await page.keyboard.press('Escape')

  // nothing is written to git
  if (git('rev-parse', 'HEAD') !== head || git('status', '--porcelain') !== '') throw new Error('composing wrote to the repository')

  // previewing as Public: nothing composed is shown, and nothing that writes
  await viewAsPublic(page)
  await page.getByText('Nothing composed is shown.').waitFor()
  if (await page.locator('.cmp-canvas, .cmp-shelf').count() !== 0) throw new Error('previewing as Public draws the canvas')
  if (await page.getByRole('button', { name: /^(Propose|Review order|Stage)/ }).count() !== 0) throw new Error('previewing as Public draws a control that writes')

  console.log('compose wizard and /compose: ok')
} finally {
  await browser?.close()
  await fx.stop()
}
