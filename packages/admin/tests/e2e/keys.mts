// The golden paths by keyboard alone (spec §13, WCAG 2.1.1, 2.4.3), in the installed Chrome, on the seeded fixture of the
// acceptance walks (seed.mts): no mouse and no click, only keys. Each step says where focus is and what the page shows.
//
// At 1440: Home → `g n` → Enter on the seeded proposal → Tab to Approve → Enter → `g h`; ⌘K → a project → Enter → Edit
// → a field → Enter stages → `g c` → Propose → the title → ⌘↵; `g s` → `v` (Map) → Tab into the map → arrows to the Safe
// → Space (the inspector opens) → Esc (focus back on the node); ⌘K → Organization → a node → Space → "Move on the map"
// → the arrows move the node, focus on it → Esc puts it back; ⌘K → "View as Public" → Enter (the band, no write control) → Tab to Exit
// preview → Enter. At 1000: Space on a /systems row opens the inspector sheet, Esc closes it and focus is on the row
// again (E-93); the rail's overlay opened, `g n` closes it and focus is on /needs's h1 (E-94).
//
// Usage, from packages/admin:  npm run e2e:keys
import { chromium, type Browser, type Page } from 'playwright-core'
import { startFixture } from './setup.mts'
import { GOVERNANCE, PROPOSAL_TITLE, SAFE_ID, SYSTEMS, seed, settle } from './seed.mts'
import { PINNED } from './shoot.mts'

const fx = await startFixture({ offline: true, governance: GOVERNANCE, systems: SYSTEMS })
let browser: Browser | undefined
let steps = 0

interface Focus { tag: string; role: string; name: string; text: string; node: string; row: boolean; inDialog: string }

/** Where focus is: the element's tag, role, name (aria-label or text), its map node id, and the dialog it is in. */
const focusOf = (page: Page): Promise<Focus> => page.evaluate(() => {
  const el = (document.activeElement ?? document.body) as HTMLElement
  const dialog = el.closest('dialog')
  return {
    tag: el.tagName.toLowerCase(), role: el.getAttribute('role') ?? '', name: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 120),
    text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 200), node: el.dataset.nodeId ?? el.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId ?? '',
    row: el.hasAttribute('data-row'), inDialog: dialog ? (dialog.getAttribute('aria-label') ?? dialog.getAttribute('aria-labelledby') ?? 'a dialog') : '',
  }
})

/** One step of the walk: what it did, then a check that throws with where focus is when it does not hold. */
async function step(page: Page, what: string, check: (f: Focus) => boolean | Promise<boolean>, timeout = 10_000) {
  steps++
  const until = Date.now() + timeout
  let f = await focusOf(page)
  while (!(await check(f))) {
    if (Date.now() > until) throw new Error(`step ${steps} (${what}): focus is on ${JSON.stringify(f)} at ${page.url()}`)
    await page.waitForTimeout(100)
    f = await focusOf(page)
  }
  console.log(`  ${steps}. ${what}`)
}

/** Presses Tab (Shift+Tab with `back`) until focus satisfies `want`, at most `max` times. */
async function tabTo(page: Page, want: (f: Focus) => boolean, what: string, max = 80, back = false) {
  for (let i = 0; i < max; i++) {
    if (want(await focusOf(page))) return
    await page.keyboard.press(back ? 'Shift+Tab' : 'Tab')
  }
  if (!want(await focusOf(page))) throw new Error(`Tab never reached ${what}; focus is on ${JSON.stringify(await focusOf(page))} at ${page.url()}`)
}

const h1 = (name: RegExp | string) => (f: Focus) => f.tag === 'h1' && (typeof name === 'string' ? f.text === name : name.test(f.text))
const keys = async (page: Page, ...ks: string[]) => { for (const k of ks) await page.keyboard.press(k) }
const path = (page: Page) => new URL(page.url()).pathname

try {
  const seeded = await seed(fx)
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const open = async (width: number) => {
    const ctx = await browser!.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', ...PINNED })
    await ctx.addInitScript('globalThis.__name = (f) => f') // tsx wraps named functions in __name(); the page has none
    const page = await ctx.newPage()
    page.on('dialog', d => void d.accept())
    return page
  }

  console.log('at 1440:')
  const page = await open(1440)
  await page.goto(`${fx.base}/`)
  await settle(page)

  // Home → g n → Enter on the seeded proposal → Tab to Approve → Enter → g h
  await keys(page, 'g', 'n')
  await step(page, '`g n` goes to Needs you, focus on its h1', f => path(page) === '/needs' && h1('Needs you')(f))
  await tabTo(page, f => f.text.includes(PROPOSAL_TITLE), 'the seeded proposal on Needs you')
  await page.keyboard.press('Enter')
  await step(page, 'Enter opens the proposal, focus on its h1', f => path(page) === `/governance/proposals/${seeded.proposal}` && h1(PROPOSAL_TITLE)(f))
  await tabTo(page, f => f.tag === 'button' && f.name === 'Approve', 'Approve')
  await page.keyboard.press('Enter')
  await step(page, 'Tab to Approve, Enter: approved, and the rule is met', async () =>
    (await page.getByRole('region', { name: 'Actions' }).getByText('Approved.', { exact: true }).count()) > 0, 15_000)
  await keys(page, 'g', 'h')
  await step(page, '`g h` goes Home (its board), focus on its h1', f => ['/', '/b/home'].includes(path(page)) && f.tag === 'h1')

  // ⌘K → a project → Enter → Edit → a field → Enter stages → g c → Propose → the title → ⌘↵
  await page.keyboard.press('ControlOrMeta+k')
  await step(page, '⌘K opens the palette, focus in its search', f => f.role === 'combobox')
  await page.keyboard.type('Node Onboarding')
  await page.getByRole('option', { name: /Node Onboarding Program/ }).first().waitFor()
  await page.keyboard.press('Enter')
  await step(page, 'Enter opens the project, focus on its h1', f => path(page) === '/r/project/proj-001' && h1('Node Onboarding Program')(f))
  await tabTo(page, f => f.tag === 'button' && f.name === 'Edit', 'Edit')
  await page.keyboard.press('Enter')
  // the form opens in place: focus stays where Edit was, on its Save to changes
  await step(page, 'Enter on Edit opens the form, focus on Save to changes', f => f.tag === 'button' && f.name === 'Save to changes')
  const status = page.getByLabel('Status', { exact: true })
  const onStatus = () => status.evaluate(el => el === document.activeElement)
  for (let i = 0; i < 40 && !(await onStatus()); i++) await page.keyboard.press('Tab')
  for (let i = 0; i < 80 && !(await onStatus()); i++) await page.keyboard.press('Shift+Tab')
  await step(page, 'Tab to the status field', async () => status.evaluate(el => el === document.activeElement))
  await keys(page, 'ControlOrMeta+a')
  await page.keyboard.type('archive')
  // the record page's fields are no form that Enter submits: Enter on its Save to changes stages
  await tabTo(page, f => f.tag === 'button' && f.name === 'Save to changes', 'Save to changes', 80, true)
  await page.keyboard.press('Enter')
  const tray = page.getByRole('region', { name: 'Changes' })
  await step(page, 'Enter on Save to changes stages the edit, and focus is on Edit again', async f =>
    f.tag === 'button' && f.name === 'Edit' && (await page.getByRole('group', { name: 'Fields' }).getByText('archive', { exact: true }).count()) > 0
      && (await tray.getByText(/^\d+ staged changes?$/).count()) > 0)
  await keys(page, 'g', 'c')
  await step(page, '`g c` opens the change, focus inside it', f => f.inDialog !== '')
  await tabTo(page, f => f.tag === 'button' && f.name === 'Propose', 'Propose')
  await page.keyboard.press('Enter')
  const panel = page.getByRole('complementary', { name: 'Propose' })
  await panel.waitFor()
  const title = panel.getByLabel('Title')
  for (let i = 0; i < 20 && !(await title.evaluate(el => el === document.activeElement)); i++) await page.keyboard.press('Tab')
  await step(page, 'Propose opens its panel; Tab to the title', async () => title.evaluate(el => el === document.activeElement))
  await page.keyboard.type('Archive the onboarding program')
  await page.keyboard.press('ControlOrMeta+Enter')
  await step(page, '⌘↵ proposes: "Opened p-…"', async () => (await panel.getByRole('status').filter({ hasText: /^Opened / }).count()) > 0, 15_000)

  // g s → v (Map) → Tab into the map → arrows to the Safe → Space → Esc; Move on the map
  await keys(page, 'g', 's') // from the panel's news, where focus is
  await step(page, '`g s` is Systems, focus on its h1', f => path(page) === '/systems' && f.tag === 'h1')
  await tabTo(page, f => f.row, 'a Systems row')
  await page.keyboard.press('v')
  await step(page, '`v` turns the list to its map', async () => (await page.locator('.react-flow__node').count()) > 0)
  await tabTo(page, f => f.node !== '', 'a node of the map')
  for (let i = 0; i < 12 && (await focusOf(page)).node !== `system:${SAFE_ID}`; i++) {
    const at = (await focusOf(page)).node
    for (const k of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
      await page.keyboard.press(k)
      if ((await focusOf(page)).node !== at) break
    }
  }
  await step(page, 'the arrows walk the map to the Safe', f => f.node === `system:${SAFE_ID}`)
  await page.keyboard.press('Space')
  const inspector = page.getByRole('complementary', { name: /inspector$/ })
  await step(page, 'Space opens the inspector', async () => (await inspector.count()) > 0)
  await page.keyboard.press('Escape')
  await step(page, 'Esc closes it, focus back on the node', async f => f.node === `system:${SAFE_ID}` && (await inspector.count()) === 0)
  // the Organization map keeps its own layout, so a node there can be moved: Space → "Move on the map" → the arrows
  await page.keyboard.press('ControlOrMeta+k')
  await page.keyboard.type('Organization')
  await page.getByRole('option', { name: /^Organization/ }).first().waitFor()
  await page.keyboard.press('Enter')
  await step(page, '⌘K → Organization opens its map, focus on its h1', f => path(page) === '/b/organization' && f.tag === 'h1')
  await page.locator('.react-flow__node').first().waitFor()
  await tabTo(page, f => f.node !== '', 'a node of the Organization map')
  const moved = (await focusOf(page)).node
  await page.keyboard.press('Space')
  await inspector.waitFor()
  await tabTo(page, f => f.tag === 'button' && f.name === 'Move on the map', 'Move on the map')
  await page.keyboard.press('Enter')
  await step(page, '"Move on the map" puts focus on the node, in move mode', f => f.node === moved)
  const box = async () => page.locator(`.react-flow__node[data-id="${moved}"]`).evaluate(el => (el as HTMLElement).style.transform)
  const before = await box()
  await page.keyboard.press('ArrowRight')
  await step(page, 'an arrow moves the node one step, focus stays on it', async f => f.node === moved && (await box()) !== before)
  await page.keyboard.press('Escape')
  await step(page, 'Esc puts it back', async f => f.node === moved && (await box()) === before)

  // ⌘K → View as Public → Enter → the band, no write control → Tab to Exit preview → Enter
  await page.keyboard.press('ControlOrMeta+k')
  await page.keyboard.type('View as Public')
  await page.getByRole('option', { name: /View as Public/ }).first().waitFor()
  await page.keyboard.press('Enter')
  await step(page, '"View as Public": the band says so', async () => (await page.locator('.band').count()) > 0)
  const writes = await page.getByRole('button', { name: /^(Edit|Apply|Propose|Save to changes|Auto-layout|Reset layout)$/ }).count()
  if (writes > 0) throw new Error(`previewing as Public, ${writes} write control(s) are drawn`)
  await tabTo(page, f => f.tag === 'button' && f.name === 'Exit preview', 'Exit preview')
  await page.keyboard.press('Enter')
  await step(page, 'Exit preview ends it, and focus is on the View as control', async f => (await page.locator('.band').count()) === 0 && /View as/.test(f.name + f.text))
  await page.context().close()

  console.log('at 1000:')
  const narrow = await open(1000)
  await narrow.goto(`${fx.base}/systems`)
  await settle(narrow)
  await tabTo(narrow, f => f.row, 'a Systems row')
  const row = (await focusOf(narrow)).text
  await narrow.keyboard.press('Space')
  const sheet = narrow.locator('dialog.insp-sheet')
  await step(narrow, 'Space on a row opens the inspector as a sheet (E-93)', async () => (await sheet.evaluate(d => (d as HTMLDialogElement).open).catch(() => false)) === true)
  await narrow.keyboard.press('Escape')
  await step(narrow, 'Esc closes the sheet first, and focus is on the row again', async f => f.row && f.text === row && (await narrow.locator('dialog.insp-sheet[open]').count()) === 0)
  await tabTo(narrow, f => f.tag === 'button' && /^Expand sidebar$/.test(f.name), 'Expand sidebar', 80, true)
  await narrow.keyboard.press('Enter')
  await step(narrow, 'the rail opens its overlay', async () => (await narrow.locator('[data-overlay]').count()) > 0)
  await keys(narrow, 'g', 'n')
  await step(narrow, '`g n` closes the overlay and focus is on /needs\'s h1 (E-94)', async f => path(narrow) === '/needs' && h1('Needs you')(f) && (await narrow.locator('[data-overlay]').count()) === 0)
  console.log(`keyboard walk: ok, ${steps} steps`)
} finally {
  await browser?.close()
  await fx.stop()
}
