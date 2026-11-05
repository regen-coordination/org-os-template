import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { makeFixtureRepo, removeFixtureRepo } from '../fixtures.ts'
import { git } from '../changes/fixtures.ts'
import { startServer, type Running } from '../../server/serve.ts'
import { createSession, endSession } from '../../server/session/sessions.ts'

// L5 spec §9.5: every WebSocket message passes the gate, per connection. A hosted server on a fresh repository under the
// temp directory (makeFixtureRepo), one socket opened with no session (the public) and one with a member's session. The
// files are written again until the server's watcher has seen them (macOS coalesces events; see tests/watcher.test.ts),
// and the test waits for what the member hears before it reads what the public heard.

const PROJECTS = (pub: string, mem: string) => `schema_version: "2.0"
projects:
  - { id: proj-pub, title: "${pub}", status: execute, type: program, lead: steward-a }
  - { id: proj-mem, title: "${mem}", status: develop, type: program, lead: ana, visibility: members }
`
const IDEAS = (title: string) => `schema_version: "2.0"\nideas:\n  - { id: idea-1, title: "${title}", status: open }\n`
const VISIBILITY = 'visibility:\n  collections:\n    projects: { default: public }\n'
const A1 = 'eip155:42220:0x00000000000000000000000000000000000000a1'

type Msg = { type: string; registry?: string; ids?: string[] }
let repo: string
let server: Running
const heard: { public: Msg[]; member: Msg[] } = { public: [], member: [] }
const sockets: WebSocket[] = []

async function listen(who: 'public' | 'member', cookie?: string): Promise<void> {
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/api/events`, { headers: { host: `localhost:${server.port}`, ...(cookie ? { cookie } : {}) } })
  sockets.push(ws)
  ws.on('message', data => heard[who].push(JSON.parse(String(data)) as Msg))
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject) })
}

/** Writes `file` again (a new text each time) until the member has heard what `until` waits for. */
async function writeUntil(file: string, text: (n: number) => string, until: (m: Msg[]) => boolean): Promise<void> {
  let n = 0
  for (let i = 0; i < 200 && !until(heard.member); i++) {
    if (i % 4 === 0) writeFileSync(join(repo, 'data', file), text(n++))
    await new Promise(r => setTimeout(r, 50))
  }
  expect(until(heard.member)).toBe(true)
}
const registryChanged = (name: string) => (m: Msg[]) => m.some(x => x.type === 'registry-changed' && x.registry === name)
const resourceChanged = (id: string) => (m: Msg[]) => m.some(x => x.type === 'resources-changed' && x.ids?.includes(id))

beforeAll(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {}) // hosted with no backup key says so (§10.4)
  repo = makeFixtureRepo()
  writeFileSync(join(repo, 'data', 'projects.yaml'), PROJECTS('Public Project', 'Members Project'))
  writeFileSync(join(repo, 'data', 'ideas.yaml'), IDEAS('An idea'))
  writeFileSync(join(repo, 'data', 'visibility.yaml'), VISIBILITY)
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: a public project and a members\' one"')
  server = await startServer({ repo, port: 0, hosted: true, fetch: async () => { throw new Error('no network in this test') } })
  const { token } = await createSession(server.privateStore!, A1, () => new Date())
  await listen('public')
  await listen('member', `house_session=${token}`)
})
afterAll(async () => {
  for (const ws of sockets) ws.terminate()
  await server.close()
  removeFixtureRepo(repo)
  vi.restoreAllMocks()
})

describe('server events, gated per connection (L5 spec §9.5)', () => {
  it('a socket with a session hears its own; one without hears registry-changed only for a public record changed, and public ids only', async () => {
    // A members' collection, then a members' record of a public collection: the member hears both, the public neither.
    await writeUntil('ideas.yaml', n => IDEAS(`An idea, take ${n}`), m => registryChanged('ideas')(m) && resourceChanged('idea:idea-1')(m))
    await writeUntil('projects.yaml', n => PROJECTS('Public Project', `Members Project, take ${n}`),
      m => registryChanged('projects')(m) && resourceChanged('project:proj-mem')(m))
    await new Promise(r => setTimeout(r, 400))
    expect(heard.public.filter(m => m.type === 'registry-changed')).toEqual([])

    // A public record: both hear it, the public with the public ids only.
    const before = heard.member.length
    await writeUntil('projects.yaml', n => PROJECTS(`Public Project, take ${n}`, 'Members Project'),
      m => m.slice(before).some(x => x.type === 'resources-changed' && x.ids?.includes('project:proj-pub')))
    for (let i = 0; i < 100 && !resourceChanged('project:proj-pub')(heard.public); i++) await new Promise(r => setTimeout(r, 50))
    expect(registryChanged('projects')(heard.public)).toBe(true)
    expect(resourceChanged('project:proj-pub')(heard.public)).toBe(true)

    const PUBLIC_IDS = new Set(['project:proj-pub'])
    expect(heard.public.every(m => m.type === 'registry-changed' ? m.registry === 'projects' : m.type === 'resources-changed')).toBe(true)
    expect(heard.public.flatMap(m => m.ids ?? []).filter(id => !PUBLIC_IDS.has(id))).toEqual([])
    // The member heard what the public did not: the members' ids, and the server's attention not at all (maintainers').
    expect(heard.member.flatMap(m => m.ids ?? [])).toEqual(expect.arrayContaining(['idea:idea-1', 'project:proj-mem', 'project:proj-pub']))
    expect(heard.member.flatMap(m => m.ids ?? []).filter(id => id.startsWith('absent:server:'))).toEqual([])
  })
})

describe('a socket whose session ends (R-L5-13.6)', () => {
  // Its own server, whose connections' viewers are asked again after 300 ms: one socket's session ends, another's (the
  // same member's) stays open and tells the test when an event went out.
  const VIEWER_MS = 300
  let repo2: string
  let server2: Running
  const heard2: { ending: Msg[]; staying: Msg[] } = { ending: [], staying: [] }
  const sockets2: WebSocket[] = []
  let ending = ''

  async function listen2(who: 'ending' | 'staying', cookie: string): Promise<void> {
    const ws = new WebSocket(`ws://127.0.0.1:${server2.port}/api/events`, { headers: { host: `localhost:${server2.port}`, cookie } })
    sockets2.push(ws)
    ws.on('message', data => heard2[who].push(JSON.parse(String(data)) as Msg))
    await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject) })
  }
  /** Writes data/ideas.yaml again until `who` has heard a registry-changed for ideas after its `from`th message. */
  async function ideasUntil(who: 'ending' | 'staying', from: number, tag: string): Promise<void> {
    const heardIdeas = () => registryChanged('ideas')(heard2[who].slice(from))
    for (let i = 0; i < 200 && !heardIdeas(); i++) {
      if (i % 4 === 0) writeFileSync(join(repo2, 'data', 'ideas.yaml'), IDEAS(`An idea, ${tag} ${i}`))
      await new Promise(r => setTimeout(r, 50))
    }
    expect(heardIdeas()).toBe(true)
  }

  beforeAll(async () => {
    repo2 = makeFixtureRepo()
    writeFileSync(join(repo2, 'data', 'projects.yaml'), PROJECTS('Public Project', 'Members Project'))
    writeFileSync(join(repo2, 'data', 'ideas.yaml'), IDEAS('An idea'))
    writeFileSync(join(repo2, 'data', 'visibility.yaml'), VISIBILITY)
    git(repo2, 'add -A'); git(repo2, 'commit -qm "fixture: a public project and a members\' one"')
    server2 = await startServer({ repo: repo2, port: 0, hosted: true, connectionViewerMs: VIEWER_MS, fetch: async () => { throw new Error('no network in this test') } })
    ending = (await createSession(server2.privateStore!, A1, () => new Date())).token
    const staying = (await createSession(server2.privateStore!, A1, () => new Date())).token
    await listen2('ending', `house_session=${ending}`)
    await listen2('staying', `house_session=${staying}`)
  })
  afterAll(async () => {
    for (const ws of sockets2) ws.terminate()
    await server2.close()
    removeFixtureRepo(repo2)
  })

  it('hears no members\' event once its viewer is older than the time it is kept: the event is judged on the viewer as it is now', async () => {
    await ideasUntil('ending', 0, 'before') // a member while the session lasts
    await new Promise(r => setTimeout(r, 2 * VIEWER_MS)) // what the writes set off has gone out
    await endSession(server2.privateStore!, ending)
    await new Promise(r => setTimeout(r, 2 * VIEWER_MS)) // the viewer it was last asked as is now older than VIEWER_MS
    const from = heard2.ending.length
    await ideasUntil('staying', heard2.staying.length, 'after') // a members' event went out
    await new Promise(r => setTimeout(r, 2 * VIEWER_MS))
    expect(heard2.ending.slice(from)).toEqual([]) // only ideas changed: nothing the public may hear
  })
})
