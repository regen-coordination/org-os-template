// Join requests as resources (network N2 Task 10): the `federation` adapter maps every outcome to a column and asks
// for attention while a request waits on the operator; the built-in board groups them; a members-only read never
// reaches the public; untrusted answers are capped and stripped wherever they are shown. Fresh temp repos only.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stringify } from 'yaml'
import { makeChangeRepo } from '../changes/fixtures.ts'
import { removeFixtureRepo } from '../fixtures.ts'
import { createApp } from '../../server/app.ts'
import { withRequest } from '../../server/request.ts'
import { ResourceStore } from '../../server/resources/index.ts'
import { mountResources } from '../../server/resources/routes.ts'
import { federation, shownAnswers, statusOf } from '../../server/resources/adapters/federation.ts'
import { runCommand } from '../../server/resources/run.ts'
import { builtinBoards } from '../../server/boards/read.ts'
import { writeReplied } from '../../server/federation/hub.ts'
import { validateBoard } from '../../lib/board-query.mjs'
import { boardFieldsOf } from '../../lib/data-validate.mjs'
import { stateDir } from '../../server/state.ts'
import type { AdapterContext, Graph } from '../../server/resources/types.ts'

const ID = (n: number) => `3f8a2c1e-5b7d-4e9a-8c10-2d6f4a9b7e${String(n).padStart(2, '0')}`
const NOW = new Date('2026-11-22T12:00:00Z')

let repo: string
beforeEach(() => { repo = makeChangeRepo() })
afterEach(() => removeFixtureRepo(repo))

const ctx = (): AdapterContext => ({ repo, now: () => NOW, run: runCommand, lastOk: () => null })
const rec = (n: number, over: Record<string, unknown> = {}) => ({
  id: ID(n), received: '2026-11-22T10:00:00.000Z', transport: 'file', ref: null,
  from: { name: `Node ${n}`, type: 'LocalNode', url: `https://node-${n}.example.org` }, network: 'Mesh', answers: { purpose: 'soil' }, invite: null,
  outcome: 'held', ...over,
})
const putRecords = (...rows: Record<string, unknown>[]) => {
  mkdirSync(join(repo, 'data'), { recursive: true })
  writeFileSync(join(repo, 'data', 'federation-requests.yaml'), stringify({ requests: rows }))
}
const putProposals = (...rows: Record<string, unknown>[]) =>
  writeFileSync(join(repo, 'data', 'proposals.yaml'), stringify({ proposals: rows }))
const read = async (): Promise<Graph> => (await federation.read(ctx())) as Graph
const by = async (n: number) => (await read()).nodes.find(x => x.id === `federation-request:${ID(n)}`)!

describe('the federation adapter', () => {
  it('draws nothing when no request was received', async () => {
    expect(await read()).toEqual({ nodes: [], edges: [] })
  })

  it('maps each outcome and proposal state to its column', async () => {
    putRecords(
      rec(1, { outcome: 'held' }),
      rec(2, { outcome: 'accepted', decision: 'open policy' }),
      rec(3, { outcome: 'refused', reason: 'Not now.' }),
      rec(4, { outcome: 'proposed', proposal: 'p-2026-11-22-001-a1b2' }),
      rec(5, { outcome: 'proposed', proposal: 'p-2026-11-22-002-a1b2' }),
      rec(6, { outcome: 'proposed', proposal: 'p-2026-11-22-003-a1b2' }),
      rec(7, { outcome: 'proposed', proposal: 'p-2026-11-22-009-a1b2' }),
    )
    putProposals({ id: 'p-2026-11-22-001-a1b2', state: 'open' }, { id: 'p-2026-11-22-002-a1b2', state: 'ratified' }, { id: 'p-2026-11-22-003-a1b2', state: 'rejected' })
    const g = await read()
    expect(g.nodes.map(n => [n.id.slice(-2), n.status])).toEqual([
      ['01', 'under-decision'], ['02', 'mutual'], ['03', 'refused'], ['04', 'under-decision'], ['05', 'mutual'], ['06', 'refused'], ['07', 'requested'],
    ])
    expect(g.nodes.every(n => n.kind === 'federation-request' && n.board === 'organization')).toBe(true)
    // a proposed record whose proposal the ledger does not hold (record 7) has nothing yet: requested
    expect(statusOf({ outcome: 'proposed' }, false)).toBe('requested')
    expect(await by(2)).toMatchObject({ facts: { from: 'Node 2', network: 'Mesh', transport: 'file', ref: null, replied: null, outcome: 'accepted' } })
    expect((await by(4)).facts.proposal).toBe('p-2026-11-22-001-a1b2')
  })

  it('asks to be decided while held, and to be told once the outcome is final on a transport that can reply', async () => {
    putRecords(
      rec(1, { outcome: 'held' }),
      rec(2, { outcome: 'accepted', transport: 'github', ref: 'https://github.com/mesh/hub/issues/2' }),
      rec(3, { outcome: 'refused', transport: 'github', ref: 'https://github.com/mesh/hub/issues/3', reason: 'No.' }),
      rec(4, { outcome: 'accepted', transport: 'file' }),
      rec(5, { outcome: 'proposed', proposal: 'p-2026-11-22-001-a1b2', transport: 'github', ref: 'https://github.com/mesh/hub/issues/5' }),
    )
    putProposals({ id: 'p-2026-11-22-001-a1b2', state: 'open' })
    expect((await by(1)).attention).toEqual({ level: 'warn', text: 'Decide it.' })
    expect((await by(2)).attention).toEqual({ level: 'warn', text: 'Tell them the outcome.' })
    expect((await by(3)).attention).toEqual({ level: 'warn', text: 'Tell them the outcome.' })
    // a file request has no reply; an open proposal's outcome is not final
    expect((await by(4)).attention).toBeNull()
    expect((await by(5)).attention).toBeNull()
    // once told, the receipt (kept under stateDir, outside git) clears it and is shown as a fact
    writeReplied(repo, ID(2), { at: '2026-11-22T11:00:00.000Z', ref: 'https://github.com/mesh/hub/issues/2#c1' })
    const told = await by(2)
    expect(told.attention).toBeNull()
    expect(told.facts.replied).toEqual({ at: '2026-11-22T11:00:00.000Z', ref: 'https://github.com/mesh/hub/issues/2#c1' })
  })

  it('caps and strips what a forged request says, wherever the adapter shows it', async () => {
    const long = 'x'.repeat(5000)
    putRecords(rec(1, {
      from: { name: `Mesa\u001b[31m Node‮${long}`, type: 'LocalNode', url: 'https://n.example.org' }, network: `Me\nsh${long}`,
      answers: { purpose: `soil\u0000‮\n${long}`, [`k\u001b${long}`]: 'v', nested: { a: 1 }, n: 4 },
    }))
    const n = await by(1)
    const shown = JSON.stringify(n)
    // no control or format character anywhere, and nothing near the 5000 characters that were sent
    expect(shown).not.toMatch(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/u.source ? /\\u00(0|1)[0-9a-f]|\\u202e/ : /x/)
    expect(Array.from(n.name).length).toBeLessThanOrEqual(100)
    expect(Array.from(String(n.facts.network)).length).toBeLessThanOrEqual(100)
    const answers = n.facts.answers as Record<string, string>
    expect(Object.keys(answers).every(k => Array.from(k).length <= 60)).toBe(true)
    expect(Object.values(answers).every(v => Array.from(v).length <= 200 && !/[\p{Cc}\p{Cf}]/u.test(v))).toBe(true)
    expect(Object.keys(answers).some(k => /[\p{Cc}\p{Cf}]/u.test(k))).toBe(false)
    // a value that is not text is dropped
    expect(answers.nested).toBeUndefined()
    expect(answers.n).toBeUndefined()
    expect(shown.length).toBeLessThan(2500)
  })

  it('shownAnswers keeps at most twenty answers, as one line each', () => {
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`q${i}`, `a\n${i}`]))
    const out = shownAnswers(many)
    expect(Object.keys(out)).toHaveLength(20)
    expect(out.q3).toBe('a 3')
    expect(shownAnswers(null)).toEqual({})
    expect(shownAnswers(['a'])).toEqual({})
  })

  it('is re-read after a reply (the receipt is outside any watched path)', () => {
    // the store re-reads an adapter on `invalidateAdapter`, which a finished job calls for what the operation `refreshes`
    const store = new ResourceStore(ctx(), [federation])
    expect(() => store.invalidateAdapter('federation')).not.toThrow()
    rmSync(stateDir(repo), { recursive: true, force: true })
  })
})

describe('the requests board', () => {
  it('ships built in, validates, and groups by status in four columns', () => {
    const board = builtinBoards().find(b => b.id === 'federation-requests')!
    expect(board).toMatchObject({ audience: 'members' })
    expect(board.blocks).toHaveLength(1)
    expect(board.blocks[0]).toMatchObject({ type: 'kanban', source: { kind: 'federation-request' }, view: { group: 'status', columns: ['requested', 'under-decision', 'mutual', 'refused'] } })
    expect(validateBoard(board, { fieldsOf: boardFieldsOf })).toEqual([])
  })
})

describe('members only', () => {
  const asPublic = () => {
    const store = new ResourceStore(ctx())
    return createApp(repo, a => mountResources(a, store, repo), { request: withRequest({ repo, hosted: true, membership: null }) })
  }
  const asMember = () => {
    const store = new ResourceStore(ctx())
    return createApp(repo, a => mountResources(a, store, repo))
  }

  it('a member reads the requests on the resources and the board; the public reads none of it', async () => {
    putRecords(rec(1, { from: { name: 'Mesa Secret Node', type: 'LocalNode', url: 'https://mesa-secret.example.org' }, answers: { purpose: 'UNMISTAKABLE-answer' } }))
    const member = asMember()
    const seen = await (await member.request('/api/resources?kind=federation-request')).json() as { id: string; facts: { answers: Record<string, string> } }[]
    expect(seen.map(n => n.id)).toEqual([`federation-request:${ID(1)}`])
    expect(seen[0]!.facts.answers.purpose).toBe('UNMISTAKABLE-answer')
    expect((await member.request('/api/boards/federation-requests')).status).toBe(200)
    // Task 9's own read route is gone: the board is the read model
    expect((await member.request('/api/federation/requests')).status).toBe(404)

    const pub = asPublic()
    for (const path of ['/api/resources', '/api/resources?kind=federation-request', `/api/resources/${encodeURIComponent(`federation-request:${ID(1)}`)}`,
      '/api/graph/organization', '/api/boards', '/api/boards/federation-requests', '/api/boards/federation-requests/builtin', '/api/registries/federation-requests',
      '/api/federation/requests']) {
      const res = await pub.request(path)
      const text = await res.text()
      // (a 404 names the id the caller asked for: that is theirs, not a leak)
      for (const word of ['Mesa Secret Node', 'mesa-secret', 'UNMISTAKABLE-answer', ...(path.includes('/api/resources/') ? [] : [ID(1)])]) expect(text, `${path} ${word}`).not.toContain(word)
    }
    // the board is not in the public's list at all
    const list = await (await pub.request('/api/boards')).text()
    expect(list).not.toContain('federation-requests')
    // even when data/visibility.yaml calls the registry public: the resource has no registry, so it is members' only
    writeFileSync(join(repo, 'data', 'visibility.yaml'), 'schema_version: "2.0"\ndefault: public\nregistries:\n  federation-requests: public\n')
    const again = await (await asPublic().request('/api/resources')).text()
    expect(again).not.toContain('Mesa Secret Node')
    expect(again).not.toContain(ID(1))
  })
})
