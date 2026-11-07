// From the review of the write path (2026-10-11), with the reviewer's input:
// a delete must not leave another entry referring to something that is gone.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureRepo, removeFixtureRepo } from './fixtures.ts'
import { createApp } from '../server/app.ts'
import { readRegistry } from '../server/registry.ts'

let repo: string
let app: ReturnType<typeof createApp>
beforeEach(() => { repo = makeFixtureRepo(); app = createApp(repo) })
afterEach(() => removeFixtureRepo(repo))

const json = (method: string, body: unknown) => ({
  method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
})
const git = (cmd: string) => execSync(`git ${cmd}`, { cwd: repo, stdio: 'pipe' }).toString()
const commits = () => Number(git('rev-list --count HEAD').trim())
const file = (name: string) => join(repo, 'data', `${name}.yaml`)
const read = (name: string) => readFileSync(file(name), 'utf8')
const put = (name: string, id: string, body: unknown) => app.request(`/api/registries/${name}/${id}`, json('PUT', body))
const del = (name: string, id: string) => app.request(`/api/registries/${name}/${id}`, { method: 'DELETE' })

// The delete route validated nothing: a member a project names as lead could
// be removed, leaving the reference pointing at nobody in a committed state.
describe('a delete that would leave a dangling reference is refused', () => {
  it('names the entry and the field that refer to it', async () => {
    const held = read('members')
    const res = await del('members', 'steward-a')
    expect(res.status).toBe(409)
    const { error } = await res.json()
    expect(error).toMatch(/not deleted/i)
    expect(error).toMatch(/projects.*"proj-001".*lead/s)
    expect(read('members')).toBe(held)
    expect(commits()).toBe(1)
  })

  it('sees a reference held in a list', async () => {
    const res = await del('members', 'ana')
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/projects.*"proj-001".*contributors/s)
  })

  it('goes through once nothing refers to the entry', async () => {
    const project = { id: 'proj-001', title: 'Node Onboarding Program', status: 'execute', type: 'program', lead: 'steward-a', tags: ['nodes', 'onboarding'] }
    expect((await put('projects', 'proj-001', project)).status).toBe(200) // contributors removed
    expect((await del('members', 'ana')).status).toBe(200)
    expect(readRegistry(repo, 'members').entries!.map(e => e.id)).toEqual(['steward-a'])
  })

  it('an entry nothing refers to is deleted as before; a missing one is still 404', async () => {
    expect((await del('projects', 'proj-001')).status).toBe(200)
    expect((await del('members', 'ghost')).status).toBe(404)
  })
})
