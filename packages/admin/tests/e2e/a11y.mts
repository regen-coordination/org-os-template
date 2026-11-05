// Axe (L4-R3; WCAG 2.2 AA, spec §13), in the installed Chrome, on the seeded fixture of the acceptance walks (seed.mts):
// every route of §14.1 and every drawn /parts group, at 1440 and 390, light and dark. axe-core is injected from
// node_modules (no network) and run with the tags wcag2a, wcag2aa, wcag21a, wcag21aa and wcag22aa; any violation fails,
// naming its rule, the route, the width, the theme and each target.
//
// Then the live region with a modal open (E-92): `showModal()` makes everything outside the dialog inert, so a sentence
// said through the page's one polite region must still reach the accessibility tree. With each modal open — the
// inspector sheet at 1000, the Changes tray's panel, a confirm dialog, the palette — a sentence is said, and Chrome's
// own accessibility tree (CDP Accessibility.getFullAXTree) must hold it in a live region that is not ignored. The
// wizard's own status line (WizardFrame, role=status) is read the same way. Whether a screen reader speaks it is the
// operator's check (VoiceOver/NVDA, §8 of the execution brief).
//
// Usage, from packages/admin:  npm run e2e:a11y           (every route and group)
//                              npm run e2e:a11y -- --only /systems,/parts/rows
import { chromium, type Browser, type Page } from 'playwright-core'
import { createRequire } from 'node:module'
import { GROUPS } from '../../app/src/parts/groups/list.ts'
import { startFixture } from './setup.mts'
import { acceptanceRoutes, GOVERNANCE, SYSTEMS, seed, settle, viewAsPublic, type AcceptanceRoute } from './seed.mts'
import { PINNED, THEMES, WIDTHS } from './shoot.mts'

const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js')
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const args = process.argv.slice(2)
const at = args.indexOf('--only')
const only = at >= 0 ? new Set((args[at + 1] ?? '').split(',').filter(Boolean)) : null

interface Violation { id: string; impact: string | null; help: string; nodes: { target: string[] }[] }

const fx = await startFixture({ offline: true, governance: GOVERNANCE, systems: SYSTEMS })
const problems: string[] = []
let browser: Browser | undefined
let runs = 0

async function axe(page: Page): Promise<Violation[]> {
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ path: AXE })
  return page.evaluate(async tags => {
    const r = await (window as unknown as { axe: { run(c: unknown, o: unknown): Promise<{ violations: Violation[] }> } }).axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] })
    return r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map(n => ({ target: n.target })) }))
  }, TAGS)
}

/** The texts Chrome's accessibility tree holds in live regions that are not ignored (inert content is ignored). */
async function liveTexts(page: Page): Promise<string[]> {
  const cdp = await page.context().newCDPSession(page)
  try {
    const { nodes } = await cdp.send('Accessibility.getFullAXTree') as { nodes: { nodeId: string; ignored: boolean; parentId?: string; name?: { value?: string }; properties?: { name: string; value: { value?: unknown } }[]; childIds?: string[]; role?: { value?: string } }[] }
    const byId = new Map(nodes.map(n => [n.nodeId, n]))
    const live = (n: typeof nodes[number]) => n.properties?.some(p => p.name === 'live' && p.value.value !== 'off')
    const out: string[] = []
    for (const n of nodes) {
      if (n.ignored || !(n.role?.value === 'StaticText' || n.role?.value === 'text')) continue
      // a text counts when an ancestor that is not ignored is a live region
      for (let p = n.parentId ? byId.get(n.parentId) : undefined; p; p = p.parentId ? byId.get(p.parentId) : undefined) {
        if (p.ignored) break
        if (live(p)) { out.push(String(n.name?.value ?? '')); break }
      }
    }
    return out
  } finally { await cdp.detach() }
}

/** Says `text` through the page's one live region, as `announce()` does, and finds it in the accessibility tree. */
async function heard(page: Page, text: string): Promise<boolean> {
  await page.evaluate(t => window.dispatchEvent(new CustomEvent('org-os-announce', { detail: t })), text)
  await page.waitForTimeout(200)
  return (await liveTexts(page)).some(t => t.includes(text))
}

const label = (r: AcceptanceRoute | string) => typeof r === 'string' ? r : `${r.path}${r.preview ? ` (as ${r.preview})` : ''}`

try {
  const seeded = await seed(fx)
  const all: (AcceptanceRoute | string)[] = [...await acceptanceRoutes(fx.base, seeded), '/parts', ...GROUPS.filter(g => g.drawn).map(g => `/parts/${g.id}`)]
  const visits = all.filter(r => !only || only.has(typeof r === 'string' ? r : r.path) || (typeof r !== 'string' && only.has(r.slug)))
  browser = await chromium.launch({ channel: 'chrome', headless: true })

  for (const width of WIDTHS) {
    for (const theme of THEMES) {
      const ctx = await browser.newContext({ viewport: { width, height: width >= 1200 ? 900 : 844 }, colorScheme: theme, reducedMotion: 'reduce', ...PINNED })
      await ctx.addInitScript('globalThis.__name = (f) => f') // tsx wraps named functions in __name(); the page has none
      const page = await ctx.newPage()
      for (const r of visits) {
        const path = typeof r === 'string' ? r : r.path
        try {
          await page.goto(`${fx.base}${path}`)
          await settle(page)
          if (typeof r !== 'string' && r.preview === 'public') await viewAsPublic(page)
          await page.waitForTimeout(150)
        } catch (err) { problems.push(`${label(r)} ${width} ${theme}: did not draw: ${(err as Error).message.split('\n')[0]}`); continue }
        runs++
        for (const v of await axe(page)) problems.push(`${v.id} (${v.impact}) on ${label(r)} at ${width} ${theme}: ${v.help} — ${v.nodes.map(n => n.target.join(' ')).join(' | ')}`)
      }
      await ctx.close()
    }
  }

  if (!only) {
    // the live region with each modal open (E-92)
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 }, colorScheme: 'light', reducedMotion: 'reduce', ...PINNED })
    const page = await ctx.newPage()
    const modal = async (what: string, open: () => Promise<void>) => {
      await open()
      const n = await page.evaluate(() => [...document.querySelectorAll('dialog')].filter(d => d.matches(':modal')).length)
      if (n === 0) { problems.push(`live region: ${what} did not open as a modal dialog`); return }
      runs++
      if (!(await heard(page, `Said while ${what} is open.`))) problems.push(`live region: with ${what} open, a sentence said through the live region is not in the accessibility tree (the page outside the dialog is inert)`)
      await page.keyboard.press('Escape')
    }
    await page.goto(`${fx.base}/systems`); await settle(page)
    if (!(await heard(page, 'Said with no dialog open.'))) problems.push('live region: with no dialog open, a sentence said is not in the accessibility tree')
    await modal('the inspector sheet', async () => {
      await page.locator('[data-row]').first().focus()
      await page.keyboard.press('Space')
      await page.getByRole('dialog').first().waitFor()
    })
    await modal('the palette', async () => {
      await page.keyboard.press('ControlOrMeta+k')
      await page.getByRole('dialog', { name: 'Command palette' }).waitFor()
    })
    // axe with ⌘K open (walk 2026-11-04, L4c-fix 6: its scrolling list was not a focusable region)
    await page.keyboard.press('ControlOrMeta+k')
    await page.getByRole('dialog', { name: 'Command palette' }).waitFor()
    runs++
    for (const v of await axe(page)) problems.push(`${v.id} (${v.impact}) with the palette open: ${v.help} — ${v.nodes.map(n => n.target.join(' ')).join(' | ')}`)
    await page.keyboard.press('Escape')
    await modal('the key map', async () => {
      await page.keyboard.press('?')
      await page.getByRole('dialog', { name: 'Keys' }).waitFor()
    })
    await page.goto(`${fx.base}/r/project/${encodeURIComponent(seeded.project)}`); await settle(page)
    await modal("the Changes tray's panel", async () => {
      await page.getByRole('region', { name: 'Changes' }).getByRole('button', { name: 'Review' }).click()
      await page.getByRole('group', { name: 'Your change' }).waitFor()
    })
    await page.goto(`${fx.base}/governance/proposals`); await settle(page)
    // The Sync button is disabled by design here (the fixture has no remote: syncShare says so), so the step opens
    // the confirm this page does offer — the tray's Discard all — waiting for it to be enabled, not assuming it is.
    await modal('a confirm dialog (Discard all)', async () => {
      await page.getByRole('region', { name: 'Changes' }).getByRole('button', { name: 'Review' }).click()
      await page.getByRole('dialog', { name: 'Your change' }).waitFor()
      const discard = page.getByRole('button', { name: 'Discard all' })
      await discard.waitFor()
      await page.waitForFunction(() => [...document.querySelectorAll('button')]
        .some(b => b.textContent?.trim() === 'Discard all' && !(b as HTMLButtonElement).disabled))
      await discard.click()
      await page.getByRole('dialog', { name: /^Discard \d+ staged op/ }).waitFor()
    })
    // the wizard's own status line (WizardFrame) is in the tree beside the page's one region
    await page.goto(`${fx.base}/wizards/open-instance`); await settle(page)
    const status = await page.locator('.wiz-body [role="status"]').textContent()
    runs++
    if (!status) problems.push('live region: the wizard\'s status line is empty')
    else if (!(await liveTexts(page)).some(t => t.includes(status))) problems.push(`live region: the wizard's status line "${status}" is not in the accessibility tree`)
    await ctx.close()
  }
} finally {
  await browser?.close()
  await fx.stop()
}
if (problems.length) {
  console.error(`a11y: ${problems.length} problem(s) in ${runs} runs\n${problems.map(p => `  - ${p}`).join('\n')}`)
  process.exit(1)
}
console.log(`a11y: 0 violations in ${runs} runs (axe ${TAGS.join(' ')}; the live region with each modal open)`)
