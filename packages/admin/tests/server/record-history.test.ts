// Walk fix wave 5 (G12: M5): a record no adapter makes a Resource of (a task, a meeting) had no history: its page said
// "No commit names this record yet" though a commit had just written it (a ratified move into the repository among
// them). GET /api/registries/:name/:id/changed answers the record's last commit, named as history names it (its
// Org-Actor's display name), for a record the viewer's gated registry holds, and nothing for one it does not. Fresh
// repositories under the temp directory (makeChangeRepo, git's identity admin-test@local); no network.
import { describe, it, expect, afterEach } from 'vitest'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { withRequest } from '../../server/request.ts'

const MEMBERS = `schema_version: "2.0"
members:
  - id: "steward-a"
    name: "Steward A"
    kind: "person"
    handles:
      git: ["admin-test@local"]
`
const cleanup: string[] = []
afterEach(() => { for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true }) })

function house(hosted = false) {
  const repo = makeChangeRepo()
  cleanup.push(repo)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: a member"')
  const app = createApp(repo, undefined, hosted ? { request: withRequest({ repo, hosted: true, membership: null }) } : {})
  return { app, repo }
}
const call = (app: ReturnType<typeof createApp>, method: string, path: string, body?: unknown) =>
  app.request(`http://localhost:4680${path}`, { method, headers: { host: 'localhost:4680', ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) })

describe('a record\'s history, for a record that is no Resource (walk M5)', () => {
  it('a task the house committed: its last change, by the Org-Actor\'s name', async () => {
    const { app } = house()
    expect((await call(app, 'POST', '/api/changes/ops', { ops: [{ op: 'create', record: 'tasks:t-1', value: { id: 't-1', title: 'Water the beds', status: 'todo' } }] })).status).toBe(200)
    expect((await call(app, 'POST', '/api/changes/apply', {})).status).toBe(200)
    const res = await call(app, 'GET', '/api/registries/tasks/t-1/changed')
    expect(res.status).toBe(200)
    const body = await res.json() as { changed: { by: string; at: string } | null }
    expect(body.changed).toMatchObject({ by: 'Steward A' })
    expect(Number.isNaN(Date.parse(body.changed!.at))).toBe(false)
  })

  it('a record the registry does not hold is absent: 404, never a history', async () => {
    const { app } = house()
    expect((await call(app, 'GET', '/api/registries/tasks/no-such/changed')).status).toBe(404)
  })

  it('the public is not given it (members\' side)', async () => {
    const { app } = house(true)
    expect((await call(app, 'GET', '/api/registries/tasks/t-1/changed')).status).toBe(401)
  })
})
