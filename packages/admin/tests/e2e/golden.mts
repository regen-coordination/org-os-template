// The golden path of the P1 spec §9, in the installed Chrome: Home → Projects → a record → Edit →
// stage → the tray shows one op → Apply → one commit with the three trailers → the record shows the
// new value. Also: ⌘K finds the record; List · Map switches and the inspector opens; Governance shows
// the solo rule; an operation runs from a record page.
import { chromium } from 'playwright-core'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseTrailers } from '../../lib/trailers.mjs'
import { startFixture } from './setup.mts'

const fx = await startFixture()
const git = (args: string) => execSync(`git ${args}`, { cwd: fx.repo }).toString().trim()
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  await page.goto(`${fx.base}/`)
  // Home's head is its line now (C6, §14.1): how many things wait on you, the page's h1
  await page.getByRole('heading', { level: 1, name: /(waits|wait) on you\.$/ }).waitFor()
  await page.getByRole('region', { name: /^Needs you/ }).waitFor()
  await page.getByRole('region', { name: /^Systems/ }).waitFor()
  await page.getByRole('region', { name: 'Recently' }).waitFor()

  // ⌘K finds the record
  await page.keyboard.press('ControlOrMeta+k')
  await page.getByRole('combobox', { name: /Search records/ }).fill('onboarding')
  await page.getByRole('option', { name: /Node Onboarding Program/ }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: 'Command palette' }).waitFor({ state: 'detached' })

  // ? shows the key map, Esc closes it; g p goes to Proposals and focus lands on its h1 (§5.8, §5.11)
  await page.keyboard.press('?')
  await page.getByRole('dialog', { name: 'Keys' }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: 'Keys' }).waitFor({ state: 'detached' })
  await page.keyboard.press('g')
  await page.keyboard.press('p')
  await page.waitForURL(/\/governance\/proposals$/)
  await page.waitForFunction(() => document.activeElement?.tagName === 'H1')

  // Home → Projects; List · Map, and the inspector
  // the house sidebar (A10): Workspace lists its collections while it or one of them is current
  const house = page.getByRole('navigation', { name: 'Hub' })
  await house.getByRole('link', { name: 'Workspace' }).click()
  await house.getByRole('link', { name: 'Projects' }).click()
  await page.waitForURL(/\/b\/projects$/)
  await page.getByRole('tab', { name: 'Map' }).click()
  await page.locator('[data-node-id="project:proj-001"]').click() // the house's map node (C6, E-42)
  await page.getByRole('complementary', { name: 'Node Onboarding Program inspector' }).waitFor()
  await page.getByRole('tab', { name: 'List' }).click()

  // → the record → Edit → stage
  await page.getByRole('grid', { name: 'Projects' }).getByRole('link', { name: 'Node Onboarding Program' }).click()
  await page.waitForURL(/\/r\/project\/proj-001$/)
  await page.getByRole('button', { name: 'Edit' }).click()
  await page.getByLabel('Status', { exact: true }).fill('archive')
  await page.getByRole('button', { name: 'Save to changes' }).click()

  // the docked tray shows one staged op → Review opens it over the page → Apply
  const tray = page.getByRole('region', { name: 'Changes' })
  await tray.getByText('1 staged change', { exact: true }).waitFor()
  await tray.getByRole('button', { name: 'Review' }).click()
  const change = tray.getByRole('group', { name: 'Your change' })
  const rows = await change.getByRole('list', { name: 'Staged ops' }).getByRole('listitem').count()
  if (rows !== 1) throw new Error(`the tray shows ${rows} ops, not 1`)
  const before = git('rev-parse HEAD')
  await change.getByRole('button', { name: 'Apply', exact: true }).click()

  // one commit, with Org-Actor, Org-Change and Org-Rule
  const until = Date.now() + 15_000
  while (Date.now() < until && git('rev-parse HEAD') === before) await new Promise(r => setTimeout(r, 200))
  if (git('rev-parse HEAD') === before) throw new Error('Apply made no commit')
  if (git(`rev-list --count ${before}..HEAD`) !== '1') throw new Error('Apply made more than one commit')
  const t = parseTrailers(git('log -1 --pretty=%B'))
  if (t.actor !== 'steward-a' || !t.change || t.rule !== 'solo/direct') throw new Error(`the commit's trailers are wrong: ${JSON.stringify(t)}`)
  if (!/status:\s*"?archive"?/.test(readFileSync(join(fx.repo, 'data', 'projects.yaml'), 'utf8'))) throw new Error('data/projects.yaml does not hold the new status')

  // the record shows the new value, no longer staged
  await page.getByRole('group', { name: 'Fields' }).getByText('archive', { exact: true }).waitFor({ timeout: 15_000 })
  await tray.waitFor({ state: 'detached', timeout: 15_000 })

  // Governance shows the solo rule
  await page.goto(`${fx.base}/governance/rules`)
  await page.getByRole('region', { name: 'Rules' }).getByText(/decides alone/).waitFor()

  // an operation runs from a record page
  await page.goto(`${fx.base}/r/module/org-os-demo`)
  await page.getByText('check fails: docs/missing.md missing').first().waitFor()
  await page.getByRole('button', { name: 'Re-run checks' }).click()
  await page.getByText(/Re-run checks · ok/).waitFor({ timeout: 15_000 })

  // The library: browse, search, open an entry's preview. Reading it changes nothing: same commit, same tree.
  const headBefore = git('rev-parse HEAD')
  const treeBefore = git('status --porcelain')
  await page.goto(`${fx.base}/library`)
  await page.getByRole('heading', { level: 1, name: 'Library' }).waitFor()
  await page.getByRole('searchbox', { name: 'Search the library' }).fill('onboarding')
  await page.getByRole('link', { name: 'Onboarding' }).click()
  await page.waitForURL(/\/library\/board%3Aonboarding$/)
  const said = 'Previewing Onboarding. Nothing changes until it is added.'
  await page.getByRole('region', { name: 'Onboarding preview' }).getByText(said).waitFor()
  await page.waitForFunction(t => document.querySelector('[data-testid=live]')?.textContent === t, said) // a screen reader hears it
  await page.waitForFunction(() => document.activeElement?.tagName === 'H2' && document.activeElement.closest('.lib-prev') !== null) // and the keyboard is on it
  if (!(await page.getByRole('button', { name: 'Add — stage a change' }).isDisabled())) throw new Error('Add — stage a change can be pressed for a raw entry, which the library does not add')
  await page.getByRole('link', { name: 'Close preview' }).click()
  await page.waitForFunction(() => document.activeElement instanceof HTMLAnchorElement && document.activeElement.dataset.entry === 'board:onboarding') // Close returns to the card
  if (git('rev-parse HEAD') !== headBefore || git('status --porcelain') !== treeBefore) throw new Error('reading the library changed the repository')

  // P4c: a new board, arranged by keyboard, applied as one commit with its trailers.
  // New board is a sheet (design pass 2026-11-04): open it, name the board, Create board
  await page.goto(`${fx.base}/boards`)
  await page.getByRole('button', { name: 'New board' }).click()
  const sheet = page.getByRole('dialog', { name: 'New board' })
  await sheet.getByLabel('Name').fill('Team board')
  await sheet.getByRole('button', { name: 'Create board' }).click()
  // the board opens in Arrange: ?arrange=1 is dropped from the address as soon as Arrange starts (final review M-4),
  // so it can pass too quickly to be seen; the board's address and Arrange's own control are what is waited for
  await page.waitForURL(/\/b\/team-board(\?|$)/)
  await page.getByLabel('Add block').waitFor()
  await page.getByLabel('Add block').selectOption('note')
  const cell = page.getByRole('group', { name: /^Note, block 1 of 1$/ })
  await cell.focus()
  await page.keyboard.press('Space')
  for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowLeft')   // span 12 → 6
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight')        // col 1 → 7
  await page.keyboard.press('Space')
  await page.getByText('Dropped Note at column 7, 6 wide, row 1.').first().waitFor()
  await page.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: 'Stage' }).click()
  const tray2 = page.getByRole('region', { name: 'Changes' })
  await tray2.getByText('1 staged change', { exact: true }).waitFor()
  const before2 = git('rev-parse HEAD')
  await tray2.getByRole('button', { name: 'Review' }).click()
  await tray2.getByRole('group', { name: 'Your change' }).getByRole('button', { name: 'Apply', exact: true }).click()
  const until2 = Date.now() + 15_000
  while (Date.now() < until2 && git('rev-parse HEAD') === before2) await new Promise(r => setTimeout(r, 200))
  if (git(`rev-list --count ${before2}..HEAD`) !== '1') throw new Error('the board did not apply as one commit')
  const t2 = parseTrailers(git('log -1 --pretty=%B'))
  if (t2.actor !== 'steward-a' || !t2.change || t2.rule !== 'solo/direct') throw new Error(`the board commit's trailers are wrong: ${JSON.stringify(t2)}`)
  const boardsFile = readFileSync(join(fx.repo, 'data', 'boards.yaml'), 'utf8')
  if (!/id: team-board/.test(boardsFile) || !/col: 7/.test(boardsFile) || !/span: 6/.test(boardsFile)) throw new Error(`data/boards.yaml does not hold the arranged board:\n${boardsFile}`)
  await page.getByRole('heading', { level: 1, name: 'Team board' }).waitFor()
  console.log('golden path: ok')
} finally {
  await browser?.close()
  await fx.stop()
}
