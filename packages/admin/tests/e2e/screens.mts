// Screenshots for a look by hand (the P1 client plan's acceptance task), at 1400px in light mode:
// Home (also dark, and at phone width); a record in edit mode with the Changes tray open; Governance;
// both full maps, the Organization one with the inspector open; Projects in Map view; the record with
// the most neighbours (its MiniMap); and a Treasury system page when the instance has one.
//
// Usage, from packages/admin. Not part of npm test.
//   npx tsx tests/e2e/screens.mts <output dir>
//       against the e2e fixture (tests/e2e/setup.mts), which it starts and removes;
//   npx tsx tests/e2e/screens.mts <output dir> --base http://localhost:4791 [--treasury http://localhost:4792]
//       against admin servers already running (on scratch clones: the record shot stages a change in
//       the server's ORG_OS_ADMIN_HOME, and nothing here applies it). --treasury names the server whose
//       Treasury system page to take, when it is not --base's.
import { chromium, type Browser, type Page } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { startFixture } from './setup.mts'

interface Res { id: string; kind: string; name: string; source: { editable?: boolean } }
interface Graph { nodes: Res[]; edges: { from: string; to: string }[] }

const arg = (flag: string) => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : undefined }
const out = process.argv[2]
if (!out || out.startsWith('--')) { console.error('usage: tsx tests/e2e/screens.mts <output dir> [--base <url>] [--treasury <url>]'); process.exit(2) }
const dir = resolve(out)
mkdirSync(dir, { recursive: true })

const fx = arg('--base') ? undefined : await startFixture()
const base = (arg('--base') ?? fx!.base).replace(/\/$/, '')
const treasuryBase = (arg('--treasury') ?? base).replace(/\/$/, '')
const get = async <T,>(url: string): Promise<T> => {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url}: ${r.status}`)
  return r.json() as Promise<T>
}
const href = (id: string) => { const i = id.indexOf(':'); return `/r/${encodeURIComponent(id.slice(0, i))}/${encodeURIComponent(id.slice(i + 1))}` }

/** The record that touches the most others, counted over both maps' edges. */
async function mostNeighbours(at: string): Promise<{ id: string; n: number } | undefined> {
  const seen = new Map<string, Set<string>>()
  for (const board of ['organization', 'systems']) {
    const g = await get<Graph>(`${at}/api/graph/${board}`)
    for (const e of g.edges) for (const [a, b] of [[e.from, e.to], [e.to, e.from]]) {
      if (!seen.has(a!)) seen.set(a!, new Set())
      seen.get(a!)!.add(b!)
    }
  }
  const [id, set] = [...seen.entries()].sort((x, y) => y[1].size - x[1].size)[0] ?? []
  return id ? { id, n: set!.size } : undefined
}

const mapReady = async (page: Page) => {
  await page.locator('[data-node-id]').first().waitFor({ timeout: 15_000 }) // the house's map node (C6, E-42)
  await page.waitForTimeout(600) // the fit-view on first load
}

let browser: Browser | undefined
const taken: string[] = []
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  // A page taller than the window is taken in a window as tall as the page, not as a full-page
  // capture: the nav (sticky, 100vh) and the tray (sticky at the foot) then sit where a reader sees
  // them, instead of where a capture of the first 900px left them. A map keeps the 900px window.
  const shot = async (name: string, url: string, o: { width?: number; dark?: boolean; map?: boolean; act?: (p: Page) => Promise<void> } = {}) => {
    const width = o.width ?? 1400
    const ctx = await browser!.newContext({ viewport: { width, height: 900 }, colorScheme: o.dark ? 'dark' : 'light', locale: 'en-US', timezoneId: 'UTC' })
    const page = await ctx.newPage()
    await page.goto(url)
    await page.waitForFunction(() => { const h = document.querySelector('h1')?.textContent; return !!h && h !== '…' })
    await page.getByText('Loading…').first().waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {})
    // a first frame's skeletons (§6.2) go when the page has drawn; /parts draws them as specimens, for good. One that
    // never clears is a page that never drew: the run fails (review minor 8)
    if (!new URL(page.url()).pathname.startsWith('/parts')) {
      await page.locator('.skel[aria-busy="true"]').first().waitFor({ state: 'detached', timeout: 15_000 })
        .catch(() => { throw new Error(`${page.url()}: a skeleton was still loading after 15 s`) })
    }
    if (o.act) await o.act(page)
    const tall = o.map ? 900 : await page.evaluate(() => document.documentElement.scrollHeight)
    if (tall > 900) { await page.setViewportSize({ width, height: tall }); await page.waitForTimeout(300) }
    const path = join(dir, `${name}.png`)
    await page.screenshot({ path })
    taken.push(path)
    await ctx.close()
  }

  const resources = await get<Res[]>(`${base}/api/resources`)
  const project = resources.find(r => r.kind === 'project' && r.source.editable)
  if (!project) throw new Error('no editable project to take the record and map shots with')

  await shot('home', `${base}/`)
  await shot('home-dark', `${base}/`, { dark: true })
  await shot('home-phone', `${base}/`, { width: 390 })

  await shot('record-edit-tray', `${base}${href(project.id)}`, { act: async page => {
    const field = async (...names: string[]) => {
      for (const n of names) { const f = page.getByLabel(n, { exact: true }); if (await f.count()) return f }
      throw new Error(`no field named ${names.join(' or ')}`)
    }
    await page.getByRole('button', { name: 'Edit' }).click()
    const status = await field('Status')
    await status.fill(`${await status.inputValue()} (review)`)
    await page.getByRole('button', { name: 'Save to changes' }).click()
    await page.getByRole('button', { name: 'Edit' }).click()
    const title = await field('title', 'name')
    await title.fill(`${await title.inputValue()} — draft`)
    await (await field('started', 'startDate')).fill('2026-13-01')
    // last: the tray's panel is modal over the page, so nothing under it can be pressed after it opens
    await page.getByRole('region', { name: 'Changes' }).getByRole('button', { name: 'Review' }).click()
  } })

  await shot('governance', `${base}/governance/rules`)
  await shot('map-organization', `${base}/b/organization?select=${encodeURIComponent(project.id)}`, { map: true, act: async page => {
    await mapReady(page)
    await page.getByRole('complementary', { name: /inspector$/ }).waitFor()
  } })
  await shot('map-systems', `${base}/b/systems`, { map: true, act: mapReady })
  await shot('section-map-projects', `${base}/b/projects`, { map: true, act: async page => {
    await page.getByRole('tab', { name: 'Map' }).click()
    await mapReady(page)
  } })

  const busiest = await mostNeighbours(base)
  if (busiest) {
    console.log(`record-neighbours: ${busiest.id}, ${busiest.n} neighbours`)
    await shot('record-neighbours', `${base}${href(busiest.id)}`, { act: async page => { await page.getByTestId('minimap').waitFor() } })
  }

  const entries = await fetch(`${treasuryBase}/api/registries/systems`).then(r => (r.ok ? r.json() : { entries: [] })) as { entries?: { id?: string; section?: string }[] }
  const treasury = entries.entries?.find(e => e.section === 'organization/treasury' && e.id)
  if (treasury) {
    await shot('treasury', `${treasuryBase}${href(`system:${treasury.id}`)}`, { act: async page => {
      await page.getByText(/read .* ago|read just now|Waiting on signers/).first().waitFor({ timeout: 20_000 }).catch(() => {})
    } })
  } else console.log(`treasury: no system in organization/treasury at ${treasuryBase}`)

  console.log(`screens: ${dir}\n${taken.join('\n')}`)
} finally {
  await browser?.close()
  await fx?.stop()
}
