// From the review of the write path (2026-10-11), with the reviewer's inputs:
// what a save does when the registry file already holds edits nobody committed.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureRepo, removeFixtureRepo } from './fixtures.ts'
import { createApp } from '../server/app.ts'

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

// F5. The commit takes the whole registry file. If the file already held
// edits nobody had committed, they went into git under `admin(...)`, never
// validated; and when a hook refused the commit, the put-back staged them.
describe('F5: a save never commits or stages edits it did not make', () => {
  const WIP = '  - id: "WIP-unreviewed"\n    title: "Not ready"\n'
  const edit = { id: 'proj-001', title: 'Renamed', status: 'develop', type: 'program', lead: 'ana' }
  const dirty = () => writeFileSync(file('projects'), read('projects') + WIP)

  it('a save into a file with uncommitted edits is refused, naming the file, and writes nothing', async () => {
    dirty()
    const held = read('projects')
    const res = await put('projects', 'proj-001', edit)
    expect(res.status).toBe(409)
    const { error } = await res.json()
    expect(error).toMatch(/not saved/i)
    expect(error).toContain('data/projects.yaml')
    expect(error).toMatch(/not committed/i)
    expect(error).toMatch(/commit.*or.*discard/is) // says what to do
    expect(read('projects')).toBe(held)
    expect(commits()).toBe(1)
    expect(git('status --porcelain')).toBe(' M data/projects.yaml\n') // still unstaged
  })

  it('a create and a delete are refused the same way', async () => {
    dirty()
    expect((await app.request('/api/registries/projects', json('POST', { id: 'p2' }))).status).toBe(409)
    expect((await del('projects', 'proj-001')).status).toBe(409)
    expect(commits()).toBe(1)
    expect(git('status --porcelain')).toBe(' M data/projects.yaml\n')
  })

  it('with a commit hook that says no, the index is left as it was found', async () => {
    dirty()
    writeFileSync(join(repo, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho "hook says no" >&2\nexit 1\n', { mode: 0o755 })
    const res = await put('projects', 'proj-001', edit)
    expect(res.status).toBe(409)
    expect(git('status --porcelain')).toBe(' M data/projects.yaml\n')
  })

  it('edits that are staged but not committed are refused too, and stay staged', async () => {
    dirty()
    git('add data/projects.yaml')
    expect((await put('projects', 'proj-001', edit)).status).toBe(409)
    expect(git('status --porcelain')).toBe('M  data/projects.yaml\n')
  })

  it('uncommitted edits in another registry do not block the save and are not committed', async () => {
    writeFileSync(file('members'), read('members') + '  - id: "wip"\n')
    expect((await put('projects', 'proj-001', edit)).status).toBe(200)
    expect(git('show --name-only --pretty=format: HEAD').trim()).toBe('data/projects.yaml')
    expect(git('status --porcelain')).toBe(' M data/members.yaml\n')
  })
})
