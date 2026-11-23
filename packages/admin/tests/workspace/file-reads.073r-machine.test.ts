import { describe, it, expect, vi, afterEach } from 'vitest'
import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { WebSocket } from 'ws'
import { startServer, type Running } from '../../server/serve.ts'
import { fileLevel, readFilesPolicy } from '../../lib/visibility.mjs'
import { repoWith } from './file-reads.fixtures.ts'

// org-os 0.7.3: the fresh review of 0.7.2's round 3, its probes kept as tests (synthetic values only): the person at the
// machine over the WebSocket (I3, R3), and a key inside the canon at run time (M-b, R13).

const GOVERNANCE = `schema_version: "2.0"
governance:
  model: "steward-council"
  roles:
    maintainer: { members: ["example-dao:person:steward"] }
`
const POLICY = (files: string) => `visibility:
  collections:
    projects: { default: public }
    members:
      default: public
      fields: { name: members }
${files}`
const FILES = `  files:
    default: role:steward
    paths:
      data/projects.yaml: members
`

function repoOf(files: string): string {
  const repo = repoWith(GOVERNANCE)
  const data: Record<string, string> = {
    'data/tasks.yaml': `schema_version: "2.0"\ntasks:\n  - { id: t-1, title: "A task", status: open }\n`,
    'data/visibility.yaml': POLICY(files),
    'pages/hello-0001.md': `---\ntitle: Hello\n---\n\nA members page.\n`,
  }
  for (const [p, t] of Object.entries(data)) { mkdirSync(dirname(join(repo, p)), { recursive: true }); writeFileSync(join(repo, p), t) }
  execSync('git add -A && git commit -qm "fixture"', { cwd: repo, stdio: 'pipe' })
  return repo
}

let server: Running | null = null
const sockets: WebSocket[] = []
afterEach(async () => { for (const ws of sockets.splice(0)) ws.terminate(); await server?.close(); server = null })

async function heardAtTheMachine(files: string) {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const repo = repoOf(files)
  server = await startServer({ repo, port: 0, fetch: async () => { throw new Error('no network in this test') } })
  const s = server
  const heard: { type: string; target?: string; people?: { handle: string; role: string }[] }[] = []
  const ws = new WebSocket(`ws://127.0.0.1:${s.port}/api/events`, { headers: { host: `localhost:${s.port}` } })
  sockets.push(ws)
  ws.on('message', d => heard.push(JSON.parse(String(d))))
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject) })
  const post = (target: string) => fetch(`http://localhost:${s.port}/api/presence`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target }) })
  const onRecord = await post('record:tasks:t-1')
  const onPage = await post('page:hello-0001')
  for (let i = 0; i < 100 && !heard.some(m => m.type === 'presence' && m.target === 'page:hello-0001'); i++) await new Promise(r => setTimeout(r, 20))
  return { statuses: [onRecord.status, onPage.status], record: heard.filter(m => m.target === 'record:tasks:t-1'), page: heard.find(m => m.type === 'presence' && m.target === 'page:hello-0001') }
}

describe('0.7.3, review of round 3: the person at the machine over the WebSocket (R3)', () => {
  it('control, no files section: hears presence on the record, and by name', async () => {
    const r = await heardAtTheMachine('')
    expect(r.statuses).toEqual([200, 200])
    expect(r.record.length).toBeGreaterThan(0)
    expect(r.page?.people?.[0]?.role).toBe('At The Machine')
  }, 60_000)

  it('with a files section: still hears it, and by name (R3: never gated by files)', async () => {
    const r = await heardAtTheMachine(FILES)
    expect(r.statuses).toEqual([200, 200]) // the HTTP routes let them on the record (fileReader `all`)
    expect(r.record.length).toBeGreaterThan(0)
    expect(r.page?.people?.[0]?.role).toBe('At The Machine')
  }, 60_000)
})

describe('0.7.3, review of round 3: a key inside the canon (R13)', () => {
  it('a narrowing key inside data/kb/ narrows the canon at run time, never passed over', () => {
    const files = readFilesPolicy({ visibility: { files: { default: 'members', paths: { 'data/kb/claim.yaml': 'role:steward' } } } })
    expect(fileLevel(files, 'data/kb/claim.yaml')).toEqual({ level: 'role', role: 'steward' })
  })
})
