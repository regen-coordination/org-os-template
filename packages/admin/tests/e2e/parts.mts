// /parts by section, in the installed Chrome: every drawn group at 1440 and 390, light and dark, compared
// with the images stored locally in app/e2e/parts/ (git-ignored; ruling R-3). The server reads outside
// systems offline and the page may reach nothing but the fixture (ruling L4-R8).
//
// Usage, from packages/admin:
//   npm run e2e:parts                         every drawn group, compared
//   npm run e2e:parts -- --update             store what it sees (the first run on a machine, or after a redraw)
//   npm run e2e:parts -- --group tokens       one group
//   npm run e2e:parts -- --group tokens --record
//       after a passing compare, writes the group's committed record files (light, WebP) to
//       docs/design/house-record/<group>-<width>-light.webp, for the names in shoot.mts's RECORD only.
import { chromium } from 'playwright-core'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startFixture } from './setup.mts'
import { fitRecord, recordsFor, shootAll, toWebp, type Job } from './shoot.mts'
import { GROUPS } from '../../app/src/parts/groups/list.ts'

const here = dirname(fileURLToPath(import.meta.url))
const DIR = join(here, '..', '..', 'app', 'e2e', 'parts')
const RECORD_DIR = join(here, '..', '..', '..', '..', 'docs', 'design', 'house-record')
const args = process.argv.slice(2)
const update = args.includes('--update')
const record = args.includes('--record')
const at = args.indexOf('--group')
const group = at >= 0 ? args[at + 1] ?? '' : null

const fail = (why: string): never => { console.error(why); process.exit(2) }
if (update && record) fail('--record writes after a passing compare: run --update first, then --record')
if (group !== null) {
  const g = GROUPS.find(x => x.id === group)
  if (!g) fail(`no group "${group}"; the groups are ${GROUPS.map(x => x.id).join(', ')}`)
  else if (!g.drawn) fail(`the group "${group}" is not drawn yet`)
}

/** What a group draws after its h1: the blocks' maps lay out their edges. */
const READY: Record<string, Job['ready']> = {
  // the blocks' maps are the house's map now (C6): attached, as the map group's, for an edge that may run level
  blocks: p => p.locator('.react-flow__edge').first().waitFor({ state: 'attached' }),
  // attached, not visible: the map's first edge may run level, a box of no height, which is never "visible"
  map: p => p.locator('.react-flow__edge').first().waitFor({ state: 'attached' }),
  door: p => p.locator('.door-plate .react-flow__edge').first().waitFor({ state: 'attached' }),
}
const FULL = new Set(['frame', 'door'])
const ids = group !== null ? [group] : GROUPS.filter(g => g.drawn).map(g => g.id)
const jobs: Job[] = ids.map(id => ({ name: id, path: `/parts/${id}`, ready: READY[id], full: FULL.has(id) }))

const fx = await startFixture({ offline: true })
let problems: string[]
try {
  problems = await shootAll({ base: fx.base, jobs, dir: DIR, update })
} finally {
  await fx.stop()
}
if (problems.length > 0) {
  for (const p of problems) console.error(p)
  process.exit(1)
}

if (record) {
  const names = ids.flatMap(id => recordsFor(id))
  if (names.length === 0) console.log(`nothing to record: ${ids.join(', ')} ${ids.length === 1 ? 'is' : 'are'} not in the record list`)
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    mkdirSync(RECORD_DIR, { recursive: true })
    for (const name of names) {
      const png = readFileSync(join(DIR, `${name}-light.png`))
      const { quality, webp } = await fitRecord(q => toWebp(browser, png, q))
      writeFileSync(join(RECORD_DIR, `${name}-light.webp`), webp)
      console.log(`recorded docs/design/house-record/${name}-light.webp (${(webp.length / 1024).toFixed(1)} KiB, quality ${quality})`)
    }
  } finally { await browser.close() }
}
console.log(update ? 'parts screenshots: stored' : 'parts screenshots: ok')
