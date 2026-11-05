// The instance the e2e and the screenshots run against: the admin fixture, made a solo instance whose
// git user is a member (or every write is refused, P1 spec §6.5), with a module whose check fails and
// a stand-in for crew.
import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeFixtureRepo, removeFixtureRepo } from '../fixtures.ts'
import { startServer } from '../../server/serve.ts'
import { offlineFetch } from './offline-fetch.mts'

const MEMBERS = `schema_version: "2.0"
members:
  - id: "steward-a"
    name: "Steward A"
    kind: person
    role: "Core Steward"
    layer: "core"
    status: "active"
    joined: "2023-01-15"
    handles:
      git: [admin-test@local]
  - id: "contributor"
    name: "Steward B"
    kind: agent
    role: "Contributor"
    layer: "contributor"
    status: "active"
    joined: "2025-02-01"
    handles:
      git: [contributor-test@local]
`

/** The git address that makes `contributor` the actor (seed.mts writes a proposal as them, then hands back). */
export const CONTRIBUTOR_EMAIL = 'contributor-test@local'
/** The fixture's own address: `steward-a`'s. */
export const STEWARD_EMAIL = 'admin-test@local'

/** `members` and `governance` replace the defaults: W2a's walk needs an instance whose git address no
 *  member holds. `offline` reads outside systems from the recorded fixtures and refuses every other host
 *  (offline-fetch.mts; ruling L4-R8): the screens use it. `systems` writes data/systems.yaml (the acceptance
 *  walks' Safe: seed.mts). */
export async function startFixture(opts: { members?: string; governance?: string; offline?: boolean; systems?: string } = {}) {
  const here = dirname(fileURLToPath(import.meta.url))
  const home = mkdtempSync(join(tmpdir(), 'admin-e2e-state-'))
  process.env.ORG_OS_ADMIN_HOME = home
  // The private store sits beside the state home, outside the fixture: Home has no "store unavailable" to show.
  process.env.ORG_OS_PRIVATE_DIR = join(home, 'private')
  const repo = makeFixtureRepo()
  writeFileSync(join(repo, 'data', 'members.yaml'), opts.members ?? MEMBERS)
  if (!opts.members) {
    // The shared fixture's projects name its own members; point them at this file's placeholders, or the
    // record form refuses to save a lead or contributor that is no member.
    const projects = join(repo, 'data', 'projects.yaml')
    writeFileSync(projects, readFileSync(projects, 'utf8').replace(/^(\s+lead: )"[^"]*"$/gm, '$1"steward-a"').replace(/^(\s+contributors: )\[[^\]]*\]$/gm, '$1["contributor"]'))
  }
  writeFileSync(join(repo, 'data', 'governance.yaml'), opts.governance ?? 'governance:\n  model: solo-maintainer\n')
  if (opts.systems) writeFileSync(join(repo, 'data', 'systems.yaml'), opts.systems)
  mkdirSync(join(repo, 'modules', 'org-os-demo'), { recursive: true })
  writeFileSync(join(repo, 'modules', 'org-os-demo', 'module.yaml'), 'id: org-os-demo\nversion: 0.1.0\nchecks:\n  - file-exists: docs/missing.md\n')
  mkdirSync(join(repo, 'scripts'))
  writeFileSync(join(repo, 'scripts', 'crew.mjs'), `console.log(JSON.stringify({ rows: [{ agent: 'platform', role: 'platform',
  state: 'working', status: 'seated', title: 'onboarding', brief: 'Improve the Node Onboarding Program', branch: 'crew/x',
  id: 's1', created: new Date().toISOString(), prompted: true }], handoffs: [], needsRelease: [] }))\n`)
  execSync('git add -A && git commit -qm "e2e: a solo member, a module and a crew stand-in"', { cwd: repo })
  const server = await startServer({ repo, port: 0, appDist: join(here, '..', '..', 'app', 'dist'), ...(opts.offline ? { fetch: offlineFetch } : {}) })
  return {
    repo, base: `http://localhost:${server.port}`,
    async stop() { await server.close(); removeFixtureRepo(repo); rmSync(home, { recursive: true, force: true }) },
  }
}
