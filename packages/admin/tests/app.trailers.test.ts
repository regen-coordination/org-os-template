import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureRepo, removeFixtureRepo, SYSTEMS_YAML } from './fixtures.ts'
import { createApp } from '../server/app.ts'
import { parseTrailers } from '../lib/trailers.mjs'

// Every admin write carries Org-Actor, Org-Change and Org-Rule (F1 §3.6, P1 spec §7.1).
let repo: string
let app: ReturnType<typeof createApp>
beforeEach(() => { repo = makeFixtureRepo(); app = createApp(repo) })
afterEach(() => removeFixtureRepo(repo))

const json = (method: string, body: unknown) => ({
  method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
})
const trailers = () => parseTrailers(execSync('git log -1 --pretty=%B', { cwd: repo }).toString())
/** Commit a fixture change first: a save refuses a file that has uncommitted edits. */
const commitFixture = (file: string, text: string) => {
  writeFileSync(join(repo, 'data', file), text)
  execSync(`git add data/${file}`, { cwd: repo })
  execSync(`git commit -qm "fixture: ${file}"`, { cwd: repo })
}
const PROJECT = { id: 'proj-001', title: 'Renamed', status: 'develop', type: 'program', lead: 'ana' }

describe('admin commits carry Org-Actor and Org-Rule', () => {
  it('a save by someone who is not a member is refused', async () => {
    execSync('git config user.email stranger@local', { cwd: repo })
    const before = execSync('git rev-parse HEAD', { cwd: repo }).toString()
    const res = await app.request('/api/registries/projects/proj-001', json('PUT', PROJECT))
    const sentence = 'Read-only: your git email `stranger@local` matches no member in `data/members.yaml`.'
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ reason: sentence, error: sentence })
    expect(execSync('git rev-parse HEAD', { cwd: repo }).toString()).toBe(before)
  })
  it('a save by a member names them by id', async () => {
    expect((await app.request('/api/registries/projects/proj-001', json('PUT', PROJECT))).status).toBe(200)
    expect(trailers()).toEqual({ actor: 'steward-a', change: expect.stringMatching(/^chg_/), rule: 'solo/direct' })
  })
  it('the solo default names itself, whatever the registry: members', async () => {
    const res = await app.request('/api/registries/members/ana',
      json('PUT', { id: 'ana', name: 'Ana Silva', role: 'Contributor', layer: 'contributor', status: 'inactive', joined: '2025-02-01' }))
    expect(res.status).toBe(200)
    expect(trailers().rule).toBe('solo/direct')
  })
  it('the solo default names itself, whatever the registry: systems', async () => {
    commitFixture('systems.yaml', SYSTEMS_YAML)
    const res = await app.request('/api/registries/systems/treasury-safe', json('PUT', {
      id: 'treasury-safe', kind: 'safe', name: 'Main treasury', chain: 'eip155:42220',
      address: '0x1111111111111111111111111111111111111111', driver: 'safe', section: 'organization/treasury',
    }))
    expect(res.status).toBe(200)
    expect(trailers()).toEqual({ actor: 'steward-a', change: expect.stringMatching(/^chg_/), rule: 'solo/direct' })
  })
  it('a create and a delete carry them too', async () => {
    expect((await app.request('/api/registries/ideas', json('POST', { id: 'idea-1', title: 'An idea' }))).status).toBe(201)
    expect(trailers()).toEqual({ actor: 'steward-a', change: expect.stringMatching(/^chg_/), rule: 'solo/direct' })
    expect((await app.request('/api/registries/ideas/idea-1', { method: 'DELETE' })).status).toBe(200)
    expect(trailers()).toEqual({ actor: 'steward-a', change: expect.stringMatching(/^chg_/), rule: 'solo/direct' })
  })
  it('the actor is who they were before the save, when the save changes their own handles', async () => {
    const res = await app.request('/api/registries/members/steward-a',
      json('PUT', { id: 'steward-a', name: 'Steward A', role: 'Core Steward', layer: 'core', status: 'active', joined: '2023-01-15' }))
    expect(res.status).toBe(200)
    expect(trailers()).toEqual({ actor: 'steward-a', change: expect.stringMatching(/^chg_/), rule: 'solo/direct' })
  })

  // P2-R14: Org-Rule is <rule id>/<method>. The class is no longer in it.
  it('written rules: the trailer names the rule that governed, not the class', async () => {
    commitFixture('governance.yaml', [
      'schema_version: "2.0"', 'governance:', '  model: consensus', '  decisions: []', '  rules:',
      '    - id: project-rule', '      applies_to: [records]', '      propose: maintainer', '      decide: { by: maintainer, method: direct }',
      '    - id: people-rule', '      applies_to: [members]', '      propose: maintainer', '      decide: { by: maintainer, method: direct }', '',
    ].join('\n'))
    expect((await app.request('/api/registries/projects/proj-001', json('PUT', PROJECT))).status).toBe(200)
    expect(trailers().rule).toBe('project-rule/direct')
    const res = await app.request('/api/registries/members/ana',
      json('PUT', { id: 'ana', name: 'Ana Silva', role: 'Contributor', layer: 'contributor', status: 'inactive', joined: '2025-02-01' }))
    expect(res.status).toBe(200)
    expect(trailers().rule).toBe('people-rule/direct')
  })
})
