// The screen harness (ruling L4-R8): shoots pages of a running fixture in the installed Chrome at 1440 and
// 390 wide, light and dark, with the clock fixed and motion reduced, and compares each shot with the one
// stored locally. Baselines are git-ignored and regenerated (ruling R-3). A shot fails when more than 0.1%
// of its pixels differ or its size changes; what it saw is then written beside the stored image as
// *.actual.png. Any request from the page to an origin other than the fixture's fails the run.
import { chromium, type Browser, type Page } from 'playwright-core'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { FIXED_NOW } from '../../app/src/test/fixtures/parts.ts'

export const WIDTHS = [1440, 390] as const
export const THEMES = ['light', 'dark'] as const
export type Theme = (typeof THEMES)[number]
const HEIGHT: Record<number, number> = { 1440: 900, 390: 844 }
/** One locale and one time zone for every shot, whatever the host's (ruling R-10, L4-R8): amounts group as en-US
 *  ("1,271.00") and dates fall on the UTC day of the fixtures' clock. */
export const PINNED = { locale: 'en-US', timezoneId: 'UTC' } as const
/** Share of pixels that may differ before a shot fails. */
export const LIMIT = 0.001

/** The committed visual record (ruling R-3): light only, WebP, `docs/design/house-record/<name>-light.webp`.
 *  The one list of what L4 records (L4a's six, then L4b's, G-4); a task that draws one of these groups refreshes its files. */
export const RECORD = ['tokens-1440', 'controls-1440', 'atoms-1440', 'frame-1440', 'frame-390', 'tray-1440', 'rows-1440', 'needs-1440', 'views-1440', 'gov-1440', 'gov-roles-1440', 'map-1440', 'map-390', 'map-compose-1440', 'work-1440', 'lib-1440', 'door-1440'] as const

/** The record names of one group (or all of them for `null`). */
export function recordsFor(group: string | null): string[] {
  return RECORD.filter(r => group === null || r.slice(0, r.lastIndexOf('-')) === group)
}

export const shotName = (job: string, width: number, theme: Theme) => `${job}-${width}-${theme}`

/** The origin a request reaches when it is not the fixture's, else null. `data:`, `blob:` and `about:`
 *  stay in the page; http(s) and ws(s) must be the fixture's own host and port. */
export function foreignOrigin(url: string, base: string): string | null {
  let u: URL
  try { u = new URL(url) } catch { return url }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol)) return null
  const b = new URL(base)
  const same = u.host === b.host && (u.protocol === b.protocol || u.protocol === b.protocol.replace(/^http/, 'ws'))
  return same ? null : `${u.protocol}//${u.host}`
}

/** The share of pixels that differ, decoded and compared in Chrome itself (no PNG library). */
export async function differ(browser: Browser, a: Buffer, b: Buffer): Promise<{ ratio: number; sizes: string | null }> {
  const page = await browser.newPage()
  try {
    // tsx wraps named functions in __name(); the page has no such helper, so give it one.
    await page.evaluate('globalThis.__name = (f) => f')
    return await page.evaluate(async ([x, y]) => {
      const load = async (b64: string) => { const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode(); return img }
      const [i, j] = await Promise.all([load(x), load(y)])
      if (i.width !== j.width || i.height !== j.height) return { ratio: 1, sizes: `${i.width}×${i.height} stored, ${j.width}×${j.height} now` }
      const px = (img: HTMLImageElement) => {
        const c = new OffscreenCanvas(img.width, img.height)
        const g = c.getContext('2d')!
        g.drawImage(img, 0, 0)
        return g.getImageData(0, 0, img.width, img.height).data
      }
      const p = px(i), q = px(j)
      let n = 0
      for (let k = 0; k < p.length; k += 4) if (p[k] !== q[k] || p[k + 1] !== q[k + 1] || p[k + 2] !== q[k + 2] || p[k + 3] !== q[k + 3]) n++
      return { ratio: n / (i.width * i.height), sizes: null }
    }, [a.toString('base64'), b.toString('base64')] as const)
  } finally { await page.close() }
}

/** A committed record weighs at most this (ruling B4-a, Q39): the record set stays small as groups grow. */
export const RECORD_MAX_BYTES = 150 * 1024
/** The qualities a record is tried at, best first. Chrome's quality 1 is lossless, but 1.2 to 6.5 times the 0.9 size
 *  (gov-1440 362 KiB, frame-1440 810 KiB), and lossless is not reachable within the budget without another encoder. */
export const RECORD_QUALITIES = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4] as const

/** A record encoded at the highest of RECORD_QUALITIES that fits RECORD_MAX_BYTES; refused, with its smallest size,
 *  when none does (split the group's record rather than blur it further). */
export async function fitRecord(encode: (quality: number) => Promise<Buffer>): Promise<{ quality: number; webp: Buffer }> {
  let last: { quality: number; webp: Buffer } | null = null
  for (const quality of RECORD_QUALITIES) {
    last = { quality, webp: await encode(quality) }
    if (last.webp.length <= RECORD_MAX_BYTES) return last
  }
  throw new Error(`the record is ${(last!.webp.length / 1024).toFixed(1)} KiB at quality ${last!.quality}, over the ${RECORD_MAX_BYTES / 1024} KiB a record may weigh`)
}

/** A PNG re-encoded as WebP by Chrome's own encoder (canvas.toDataURL), so no image dependency is needed. */
export async function toWebp(browser: Browser, png: Buffer, quality = 0.9): Promise<Buffer> {
  const page = await browser.newPage()
  try {
    await page.evaluate('globalThis.__name = (f) => f')
    const url = await page.evaluate(async ([b64, q]) => {
      const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode()
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
      c.getContext('2d')!.drawImage(img, 0, 0)
      return c.toDataURL('image/webp', q)
    }, [png.toString('base64'), quality] as const)
    if (!url.startsWith('data:image/webp;base64,')) throw new Error(`this Chrome did not encode WebP (it gave ${url.slice(0, 24)}…)`)
    return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')
  } finally { await page.close() }
}

/** Unrolls the app's frame for a shot: the document grows to the page instead of the page scrolling inside it. */
export const UNROLL = '.frame:not([data-specimen]) { block-size: auto !important; } .frame:not([data-specimen]) > .frame-main > .frame-scroll { overflow: visible !important; }'

export interface Job {
  /** The file stem: shots are `<name>-<width>-<theme>.png`. */
  name: string
  path: string
  /** Waits for what the page draws after its h1 (a map's edges…). */
  ready?: (p: Page) => Promise<void>
  /** Shoot the whole page (the frame, the door) instead of `main`. */
  full?: boolean
}

/** Shoots every job at each width and theme; stores (`update`) or compares. Returns the problems found,
 *  empty when every shot matched (or was stored) and the page reached nothing but the fixture. */
export async function shootAll(opts: { base: string; jobs: Job[]; dir: string; update: boolean; mask?: string[]; say?: (line: string) => void }): Promise<string[]> {
  const say = opts.say ?? console.log
  const problems: string[] = []
  const foreign = new Set<string>()
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    for (const width of WIDTHS) {
      const context = await browser.newContext({ viewport: { width, height: HEIGHT[width]! }, deviceScaleFactor: 1, reducedMotion: 'reduce', ...PINNED })
      const page = await context.newPage()
      const watch = (url: string) => { const f = foreignOrigin(url, opts.base); if (f && !foreign.has(url)) { foreign.add(url); problems.push(`the page reached ${f} (${url}); only the fixture may be reached`) } }
      page.on('request', r => watch(r.url()))
      page.on('websocket', ws => watch(ws.url()))
      await page.clock.setFixedTime(FIXED_NOW)
      for (const job of opts.jobs) {
        for (const theme of THEMES) {
          const name = shotName(job.name, width, theme)
          await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
          await page.goto(`${opts.base}${job.path}`)
          await page.locator('h1').first().waitFor()
          if (job.ready) await job.ready(page)
          await page.evaluate(() => document.fonts.ready)
          await page.waitForTimeout(300)
          // The app's frame scrolls the page in its own area (§5.1); the shot unrolls it, so it holds the whole page
          // and not one screen of it. A /parts frame specimen keeps its own height.
          await page.addStyleTag({ content: UNROLL })
          // The root keeps the browser's 16px (A7b): a root font rule would draw every rem token smaller.
          const root = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)
          if (root !== '16px') problems.push(`${name}: the root's font size is ${root}, not the browser's 16px`)
          const mask = (opts.mask ?? []).map(s => page.locator(s))
          const shot = job.full
            ? await page.screenshot({ fullPage: true, animations: 'disabled', mask })
            : await page.locator('main').screenshot({ animations: 'disabled', mask })
          const file = join(opts.dir, `${name}.png`), actual = join(opts.dir, `${name}.actual.png`)
          if (opts.update) {
            mkdirSync(opts.dir, { recursive: true })
            writeFileSync(file, shot)
            rmSync(actual, { force: true })
            say(`stored ${name}.png`)
            continue
          }
          if (!existsSync(file)) { problems.push(`no stored image for ${name}.png; run with --update`); continue }
          const d = await differ(browser, readFileSync(file), shot)
          if (d.sizes || d.ratio > LIMIT) {
            writeFileSync(actual, shot)
            problems.push(`${name}: ${d.sizes ?? `${(d.ratio * 100).toFixed(3)}% of pixels differ (limit ${LIMIT * 100}%)`}; see ${name}.actual.png`)
          } else {
            rmSync(actual, { force: true })
            say(`${name}: ${(d.ratio * 100).toFixed(3)}% of pixels differ`)
          }
        }
      }
      await context.close()
    }
  } finally { await browser.close() }
  return problems
}
