// Every route of the Hub (spec §14.1), shot in the installed Chrome at 1440 and 390, light and dark, on a seeded
// fixture (seed.mts: an approve rule, the recorded Safe, one open proposal by `contributor`, one change staged by
// `steward-a`), and compared with the shots stored locally in app/e2e/routes/ (git-ignored, ruling Q39: none of them
// joins the record). The server reads outside systems offline, and the page may reach nothing but the fixture. What
// moves between two runs is masked: times, `[data-volatile]`, and the seeded proposal's id (its last four characters
// are drawn at random).
//
// Usage, from packages/admin:
//   npm run e2e:routes                 every route, compared
//   npm run e2e:routes -- --update     store what it sees (the first run on a machine, or after a redraw)
//   npm run e2e:routes -- --only <slug>[,<slug>…]
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startFixture } from './setup.mts'
import { acceptanceRoutes, GOVERNANCE, SYSTEMS, seed, settle, viewAsPublic } from './seed.mts'
import { shootAll, type Job } from './shoot.mts'

const here = dirname(fileURLToPath(import.meta.url))
const DIR = join(here, '..', '..', 'app', 'e2e', 'routes')
const args = process.argv.slice(2)
const update = args.includes('--update')
const at = args.indexOf('--only')
const only = at >= 0 ? new Set((args[at + 1] ?? '').split(',').filter(Boolean)) : null

const fx = await startFixture({ offline: true, governance: GOVERNANCE, systems: SYSTEMS })
let problems: string[]
try {
  const seeded = await seed(fx)
  const routes = (await acceptanceRoutes(fx.base, seeded)).filter(r => !only || only.has(r.slug))
  if (only && routes.length !== only.size) throw new Error(`--only names a slug that is no route: ${[...only].join(', ')}`)
  // the door and the previews are shot whole: the door is a page outside the frame, and the band sits above main
  const jobs: Job[] = routes.map(r => ({
    name: r.slug, path: r.path, full: r.path === '/door' || !!r.preview,
    ready: async p => { await settle(p); if (r.preview === 'public') await viewAsPublic(p) },
  }))
  problems = await shootAll({ base: fx.base, jobs, dir: DIR, update, mask: ['time', '[data-volatile]', `text=${seeded.proposal}`] })
  console.log(`${routes.length} routes, ${routes.length * 4} shots`)
} finally {
  await fx.stop()
}
if (problems.length > 0) {
  for (const p of problems) console.error(p)
  process.exit(1)
}
console.log(update ? 'route screenshots: stored' : 'route screenshots: ok')
