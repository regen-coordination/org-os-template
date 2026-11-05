// Reflow (WCAG 1.4.10, 1.4.4; spec §13), in the installed Chrome, on the seeded fixture of the acceptance walks
// (seed.mts), in the house skin only (L4-R6: bare is a test skin, not a look anyone reflows). Every route of §14.1 and
// every drawn /parts group, at 390 and at 320: the page never scrolls sideways, and nothing inside it does except the
// tab bars, the palette's scope chips and the canvases reached by their own keys (the maps, the board canvas, the job
// log), or a block that is a focusable, labelled region a keyboard reader can scroll. Then, at those widths: the More
// sheet open, a record in edit, the Changes tray's card above the bottom bar (its tap opens /changes), and the Propose
// panel open over /changes. At 700, every collection and board (`/all/*`, `/b/*`). At 390 with `dir="rtl"`: `/`,
// `/systems`, `/b/treasury`, the proposal and `/door` (the map reads the direction when it mounts; dir is set before
// the page loads). At 1440 with the root's text at 200 %: `/`, `/systems` and a record, with no sideways scroll and no
// text clipped by its box. In forced colours, on the same three, the focus ring is drawn in `Highlight`; those shots
// and the 200 % ones are stored in app/e2e/reflow/ (git-ignored) for the operator. Fails naming the page, the width and
// what it measured.
//
// Usage, from packages/admin:  npm run e2e:reflow
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SKIN_KEY } from '../../app/src/skin.ts'
import { GROUPS } from '../../app/src/parts/groups/list.ts'
import { startFixture } from './setup.mts'
import { acceptanceRoutes, GOVERNANCE, SYSTEMS, seed, settle, viewAsPublic, type AcceptanceRoute } from './seed.mts'
import { PINNED } from './shoot.mts'

const here = dirname(fileURLToPath(import.meta.url))
const SHOTS = join(here, '..', '..', 'app', 'e2e', 'reflow')
const PHONES = [390, 320] as const
/** The phone's tray card: the count, "N staged" and one button, on one line (a 44px target and its padding). */
const TRAY_CARD = 64
/** What may scroll sideways inside its own box (§13): the tab bars and the palette's scope chips, and the canvases
 *  reached by their own keys — the maps, the board canvas and its cells, the machine diagrams, the compose canvas, a
 *  job's log. */
const OWN = '.tabs, .pal-scope, .react-flow, .board.canvas, .hdiag, .cmp-canvas, .joblog-out'

const fx = await startFixture({ offline: true, governance: GOVERNANCE, systems: SYSTEMS })
const problems: string[] = []
let browser: Browser | undefined
let seen = 0

/** What the page says about its width, and every block that scrolls sideways without being reachable. */
async function measure(page: Page) {
  return page.evaluate(own => {
    const doc = document.documentElement
    const scrollers = [...document.querySelectorAll<HTMLElement>('body *')].filter(el => {
      const o = getComputedStyle(el).overflowX
      return (o === 'auto' || o === 'scroll') && el.scrollWidth > el.clientWidth + 1
    })
    return {
      wide: doc.scrollWidth - window.innerWidth,
      scrollers: scrollers.filter(el => !el.closest(own)).map(el => ({
        what: `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(' ').join('.')}` : ''}`,
        focusable: el.tabIndex >= 0,
        name: el.getAttribute('aria-label') ?? el.getAttribute('aria-labelledby') ?? '',
        role: el.getAttribute('role') ?? '',
        // the outermost block past its edge, to name what is too wide
        cause: (() => {
          const edge = el.getBoundingClientRect().right, start = el.getBoundingClientRect().left
          const past = (x: Element) => { const r = x.getBoundingClientRect(); return x.getClientRects().length > 0 && (r.right > edge + 1 || r.left < start - 1) }
          // a block inside one that clips its overflow does not widen the scroller
          const clippedIn = (x: Element) => { for (let a = x.parentElement; a && a !== el; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return true; return false }
          const hit = [...el.querySelectorAll('*')].find(x => past(x) && !past(x.parentElement!) && !clippedIn(x))
          return hit ? `${hit.tagName.toLowerCase()}.${String(hit.className).split(' ').join('.')} (${Math.round(hit.getBoundingClientRect().width)}px)` : ''
        })(),
      })),
    }
  }, OWN)
}

/** Records what `measure` found wrong on the page as it stands. */
async function check(page: Page, at: string) {
  seen++
  const m = await measure(page)
  const width = page.viewportSize()!.width
  if (m.wide > 0) problems.push(`${at}: the page is ${width + m.wide}px wide at ${width}px; the block that is too wide must scroll inside itself`)
  for (const sc of m.scrollers) {
    if (!sc.focusable || !sc.name || sc.role !== 'region') problems.push(`${at}: ${sc.what} scrolls sideways but is not a focusable, labelled region (tabindex ${sc.focusable ? 'ok' : 'missing'}, label ${sc.name || 'missing'}, role ${sc.role || 'missing'})${sc.cause ? `; too wide: ${sc.cause}` : ''}`)
  }
}

/** Text a box cuts off: an element holding text whose overflow is hidden or clipped and whose content is taller than it,
 *  or wider without an ellipsis that says so. Screen-reader-only text and the maps' own labels are left out. */
async function clipped(page: Page): Promise<string[]> {
  return page.evaluate(() => [...document.querySelectorAll<HTMLElement>('body *')].filter(el => {
    if (el.closest('.sr-only, .react-flow, [aria-hidden="true"]') || el.getClientRects().length === 0) return false
    if (![...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent!.trim() !== '')) return false
    const cs = getComputedStyle(el)
    const hides = (o: string) => o === 'hidden' || o === 'clip'
    const y = hides(cs.overflowY) && el.scrollHeight > el.clientHeight + 1
    const x = hides(cs.overflowX) && el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== 'ellipsis'
    return y || x
  }).map(el => `${el.tagName.toLowerCase()}.${String(el.className).split(' ').join('.')} "${el.textContent!.trim().slice(0, 40)}"`))
}

async function context(width: number, extra: Parameters<Browser['newContext']>[0] = {}): Promise<BrowserContext> {
  const ctx = await browser!.newContext({ viewport: { width, height: width >= 1200 ? 900 : 800 }, colorScheme: 'light', reducedMotion: 'reduce', ...PINNED, ...extra })
  await ctx.addInitScript('globalThis.__name = (f) => f') // tsx wraps named functions in __name(); the page has none
  await ctx.addInitScript(([key]) => { try { localStorage.setItem(key!, 'house') } catch { /* no storage: the build's default */ } }, [SKIN_KEY])
  return ctx
}

async function visit(page: Page, r: AcceptanceRoute | string) {
  const route = typeof r === 'string' ? { path: r } as AcceptanceRoute : r
  await page.goto(`${fx.base}${route.path}`)
  await settle(page)
  if (route.preview === 'public') await viewAsPublic(page)
  await page.waitForTimeout(150)
}

const label = (r: AcceptanceRoute | string) => typeof r === 'string' ? r : `${r.path}${r.preview ? ` (as ${r.preview})` : ''}`
const stem = (path: string) => path === '/' ? 'home' : path.slice(1).replace(/[^a-z0-9]+/gi, '-')

try {
  const seeded = await seed(fx)
  const routes = await acceptanceRoutes(fx.base, seeded)
  const parts = ['/parts', ...GROUPS.filter(g => g.drawn).map(g => `/parts/${g.id}`)]
  const project = routes.find(r => r.slug === 'record-project')!.path
  const proposal = routes.find(r => r.slug === 'proposal')!.path
  browser = await chromium.launch({ channel: 'chrome', headless: true })

  for (const width of PHONES) {
    const ctx = await context(width)
    const page = await ctx.newPage()
    await visit(page, '/')
    // The phone's frame: the sidebar is not drawn, the bottom bar is, and there is no Menu button to open.
    const frame = await page.evaluate(() => ({
      side: getComputedStyle(document.querySelector('.frame-side')!).display,
      bbar: !!document.querySelector('.bbar') && getComputedStyle(document.querySelector('.frame-bbar')!).display !== 'none',
      menu: [...document.querySelectorAll('button')].some(b => b.textContent?.trim() === 'Menu' || b.getAttribute('aria-label') === 'Menu'),
    }))
    if (frame.side !== 'none' || !frame.bbar || frame.menu) problems.push(`/ at ${width}px: the frame is not the phone's (sidebar ${frame.side}, bottom bar ${frame.bbar ? 'drawn' : 'missing'}, Menu button ${frame.menu ? 'present' : 'absent'})`)

    for (const r of [...routes, ...parts]) {
      try { await visit(page, r) } catch (err) { problems.push(`${label(r)} at ${width}px: did not draw: ${(err as Error).message.split('\n')[0]}`); continue }
      await check(page, `${label(r)} at ${width}px`)
    }
    // the More sheet, opened, fits too
    await visit(page, '/')
    await page.locator('.bbar').getByRole('button', { name: 'More' }).click()
    await page.getByRole('dialog', { name: 'More' }).waitFor()
    await check(page, `/ (More open) at ${width}px`)
    await page.keyboard.press('Escape')
    // a record in edit
    await visit(page, project)
    await page.getByRole('button', { name: 'Edit' }).click()
    await check(page, `${project} (edit) at ${width}px`)
    // The Changes tray on a phone (§5.6): a card above the bottom bar (count, "N staged", the primary); a tap on the card
    // opens /changes, the change drawn whole as a page. The seeded change gains an edit whose lines wrap.
    for (const field of ['Title', 'Summary']) await page.getByLabel(field, { exact: true }).fill(`${field} changed in the reflow walk, to make a line that wraps at a phone's width`)
    await page.getByRole('button', { name: 'Save to changes' }).click()
    const tray = page.getByRole('region', { name: 'Changes' })
    const card = tray.getByRole('link', { name: /^Review \d+ staged change/ })
    await card.waitFor()
    const box = await tray.boundingBox(), bar = await page.locator('.bbar').boundingBox()
    if (!box || !bar || box.y + box.height > bar.y + 1) problems.push(`at ${width}px the tray's card is not above the bottom bar (card ${JSON.stringify(box)}, bar ${JSON.stringify(bar)})`)
    if (box && box.height > TRAY_CARD) problems.push(`at ${width}px the tray's card is ${Math.round(box.height)}px tall; a card is at most ${TRAY_CARD}px`)
    await check(page, `${project} (tray card) at ${width}px`)
    await card.click()
    await page.waitForURL(/\/changes$/)
    await page.getByRole('heading', { level: 1, name: 'Changes' }).waitFor()
    await page.getByRole('group', { name: 'Your change' }).waitFor()
    await check(page, `/changes (a staged change) at ${width}px`)
    if (await page.getByRole('region', { name: 'Changes' }).count() !== 1) problems.push(`/changes at ${width}px draws the change twice: the page and the dock`)
    // the Propose panel, opened from /changes (C7's .panel-form)
    await page.getByRole('region', { name: 'Changes' }).getByRole('button', { name: 'Propose', exact: true }).click()
    const panel = page.getByRole('complementary', { name: 'Propose' })
    await panel.getByLabel('Title').fill('A title long enough to wrap at the narrowest phone this walk measures')
    if (!(await panel.isVisible())) problems.push(`/changes at ${width}px: the Propose panel opened but is not visible`)
    await check(page, `/changes (Propose open) at ${width}px`)
    await ctx.close()
  }

  // at 700: every collection and board
  {
    const ctx = await context(700)
    const page = await ctx.newPage()
    for (const r of routes.filter(r => !r.preview && /^\/(all|b)(\/|$)/.test(r.path))) {
      await visit(page, r)
      await check(page, `${label(r)} at 700px`)
    }
    await ctx.close()
  }

  // at 390, right to left: the logical properties hold and nothing scrolls sideways
  {
    const ctx = await context(390)
    // set once the document is parsed and before the app's module runs, so the map reads it when it mounts
    await ctx.addInitScript(() => { document.addEventListener('readystatechange', () => { if (document.readyState === 'interactive') document.documentElement.setAttribute('dir', 'rtl') }) })
    const page = await ctx.newPage()
    for (const path of ['/', '/systems', '/b/treasury', proposal, '/door']) {
      await visit(page, path)
      const dir = await page.evaluate(() => getComputedStyle(document.body).direction)
      if (dir !== 'rtl') problems.push(`${path} (rtl) at 390px: the body's direction is ${dir}`)
      await check(page, `${path} (rtl) at 390px`)
    }
    await ctx.close()
  }

  // at 1440, the root's text at 200 %; then forced colours: the focus ring is Highlight
  mkdirSync(SHOTS, { recursive: true })
  const big = ['/', '/systems', project]
  {
    const ctx = await context(1440)
    await ctx.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = '200%' }) })
    const page = await ctx.newPage()
    for (const path of big) {
      await visit(page, path)
      const root = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)
      if (root !== '32px') problems.push(`${path} (text 200 %): the root's font size is ${root}, not 32px`)
      await check(page, `${path} (text 200 %) at 1440px`)
      for (const c of await clipped(page)) problems.push(`${path} (text 200 %) at 1440px: text is clipped by its box: ${c}`)
      await page.screenshot({ path: join(SHOTS, `text200-${stem(path)}-1440.png`), fullPage: true })
    }
    await ctx.close()
  }
  {
    const ctx = await context(1440, { forcedColors: 'active' })
    const page = await ctx.newPage()
    for (const path of big) {
      await visit(page, path)
      // the first stops of the Tab order, each drawn with an outline in the system's Highlight
      const highlight = await page.evaluate(() => {
        const probe = document.createElement('span'); probe.style.color = 'Highlight'; document.body.append(probe)
        const c = getComputedStyle(probe).color; probe.remove(); return c
      })
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press('Tab')
        const ring = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null
          if (!el || el === document.body) return null
          const cs = getComputedStyle(el)
          return { what: `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}"`, style: cs.outlineStyle, width: parseFloat(cs.outlineWidth), color: cs.outlineColor }
        })
        seen++
        if (!ring) { problems.push(`${path} (forced colours): Tab ${i + 1} left focus on the body`); break }
        if (ring.style === 'none' || ring.width < 1 || ring.color !== highlight) problems.push(`${path} (forced colours): the focus ring on ${ring.what} is ${ring.style} ${ring.width}px ${ring.color}, not a solid ring in Highlight (${highlight})`)
        if (i === 0) await page.screenshot({ path: join(SHOTS, `forced-${stem(path)}-1440.png`) })
      }
    }
    await ctx.close()
  }
} finally {
  await browser?.close()
  await fx.stop()
}
if (problems.length) {
  console.error(`reflow: ${problems.length} problem(s) in ${seen} page views\n${problems.map(p => `  - ${p}`).join('\n')}`)
  process.exit(1)
}
console.log(`reflow at 390 and 320 (and 700, rtl, text 200 %, forced colours): ok, ${seen} page views in the house skin`)
