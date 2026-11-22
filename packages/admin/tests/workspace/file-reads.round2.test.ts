import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { createApp } from '../../server/app.ts'
import { mountProposals } from '../../server/proposals/routes.ts'
import { gateGraph, Levels } from '../../server/visibility/gate.ts'
import type { Graph, Resource } from '../../server/resources/types.ts'
import { readFileView } from '../../server/workspace/files.ts'
import { viewerReader } from '../../server/workspace/reads.ts'
import { hatRef } from '../../lib/hats.mjs'
import {
  AGENT_LAYER, DAY, HOST, ID, MAIL, MEMBER_AT_MACHINE, T0,
  cookieFor, house, repoWith,
} from './file-reads.fixtures.ts'

// 0.7.1 (D6), fix round 2: replay asks what load asks (1), the map's stale count when only some of a card's agent-layer
// ops are unread (2), the tray's write answers keep M2 (3), and a decider by a hat they wear (4). Synthetic values only.

/** No workspace rule (WORKSPACE_DIRECT): the maintainer alone reads the agent layer; every member proposes. */
const DIRECT = `schema_version: "2.0"
governance:
  model: "steward-council"
  roles:
    maintainer: { members: ["${ID.steward}"] }
    everyone: { all: true }
  rules:
    - { id: everything, applies_to: [all], propose: everyone, decide: { by: maintainer, method: approve, count: 1 } }
`
const NOT_GOVERNED = (path: string) => `${path} is not a governed file, so it has no editor here. Nothing was staged.`

function atMachine(repo: string, email: string): (path: string, body: unknown) => Promise<Response> {
  execSync(`git config user.email ${email}`, { cwd: repo, stdio: 'pipe' })
  const app = createApp(repo, (a, ctx) => mountProposals(a, { repo, withLock: ctx.withLock, startBranch: 'main', now: () => T0 }))
  return async (path, body) => app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}
const post = (h: { app: Hono }, path: string, cookie: string, body: unknown) => h.app.request(`http://${HOST}${path}`, {
  method: 'POST', headers: { host: HOST, cookie, 'content-type': 'application/json' }, body: JSON.stringify(body),
})

describe('1: replay asks what load asks', () => {
  it('a non-decider author\'s replay of a proposal holding an agent-layer op is refused before anything runs', async () => {
    const repo = repoWith(DIRECT)
    // A proposal made before 0.7.1 could hold it: here, made at the network member's own machine.
    const local = atMachine(repo, MEMBER_AT_MACHINE)
    // With the identity file beside it, which needs an approval, so it is proposed and not applied.
    expect((await local('/api/changes/ops', { ops: [
      { op: 'file', path: DAY, text: `${AGENT_LAYER[DAY]}\nmine\n` },
      { op: 'file', path: 'IDENTITY.md', text: '# Example DAO, said again\n' },
    ] })).status).toBe(200)
    const proposed = await local('/api/proposals', { title: 'A memory line' })
    expect([proposed.status, proposed.status === 201 ? null : await proposed.clone().json()]).toEqual([201, null])
    const id = String((await proposed.json()).id)
    // The file moves on the trunk, so the proposal is stale: its STALE refusal would name the path.
    appendFileSync(join(repo, DAY), 'A later synthetic line.\n')
    execSync('git commit -qam "memory moves"', { cwd: repo, stdio: 'pipe' })
    const h = await house(repo, { proposals: true, writes: true })
    const member = await cookieFor(h, MAIL.member)
    for (const body of [{}, { choose: 'mine' }, { choose: 'theirs' }]) {
      const res = await post(h, `/api/proposals/${id}/replay`, member, body)
      expect([res.status, await res.json()]).toEqual([422, { errors: [{ record: DAY, field: 'path', message: NOT_GOVERNED(DAY) }] }])
    }
  })
})

describe('3: the tray\'s write answers keep the stale filter', () => {
  it('staging an unrelated op does not tell the network member their memory op went stale', async () => {
    const repo = repoWith(DIRECT)
    const local = atMachine(repo, MEMBER_AT_MACHINE)
    expect((await local('/api/changes/ops', { ops: [{ op: 'file', path: 'MEMORY.md', text: '# Memory\n\n- mine\n' }] })).status).toBe(200)
    appendFileSync(join(repo, 'MEMORY.md'), '- a later synthetic line\n')
    execSync('git commit -qam "memory moves"', { cwd: repo, stdio: 'pipe' })
    const h = await house(repo, { writes: true })
    const member = await cookieFor(h, MAIL.member)
    const staged = await post(h, '/api/changes/ops', member, { ops: [{ op: 'file', path: 'IDENTITY.md', text: '# Example DAO, said again\n' }] })
    expect(staged.status).toBe(200)
    const view = await staged.json() as { ops: { path?: string }[]; stale: number[] }
    expect(view.ops.map(o => o.path)).toEqual(['MEMORY.md', 'IDENTITY.md'])
    expect(view.stale).toEqual([])
    // Removing the unrelated op answers the tray too.
    const removed = await h.app.request(`http://${HOST}/api/changes/ops/1`, { method: 'DELETE', headers: { host: HOST, cookie: member } })
    expect(removed.status).toBe(200)
    expect((await removed.json()).stale).toEqual([])
  })
})

describe('2: the map\'s stale count when some of a card\'s agent-layer ops are read and some not', () => {
  it('the attention is rebuilt from what is left', () => {
    const repo = repoWith(DIRECT)
    const proposal: Resource = { id: 'proposal:p-1', kind: 'proposal', board: 'organization', name: 'Two plans', status: 'stale',
      attention: { level: 'alert', text: 'stale: 2 ops were staged against a record that has changed' }, changed: null,
      facts: { stale: [0, 1], agentStale: [{ at: 0, path: DAY }, { at: 1, path: 'docs/plans/plan-b.md' }],
        agentAttention: { level: 'warn', text: 'open: 1 approval' }, ops: 2 },
      source: { path: 'data/proposals.yaml', editable: false, registry: 'proposals', entityId: 'p-1' } }
    const graph = { nodes: [proposal], edges: [] } as unknown as Graph
    const viewer = { kind: 'member' as const, id: ID.steward, hats: [], roles: ['maintainer'] }
    // A reader of memory/ but not of docs/plans/ (a split the rules may one day make): one stale op is left.
    const may = (path: string) => !path.startsWith('docs/plans/')
    const card = gateGraph(viewer, graph, new Levels(repo), undefined, may).nodes[0]!
    expect(card.facts.stale).toEqual([0])
    expect(card.attention).toEqual({ level: 'alert', text: 'stale: 1 op was staged against a record that has changed' })
    // None of them read: the attention it would have with none stale.
    const none = gateGraph(viewer, graph, new Levels(repo), undefined, () => false).nodes[0]!
    expect([none.facts.stale, none.attention]).toEqual([[], { level: 'warn', text: 'open: 1 approval' }])
  })
})

describe('4: a decider by the hat they wear (PR7-R101)', () => {
  const HAT = hatRef('eip155:42220', `0x${'0000000d'}${'00010001'}${'0'.repeat(48)}`)
  const WEARER = 'eip155:42220:0x1111111111111111111111111111111111111111'
  const BY_HAT = `schema_version: "2.0"
governance:
  model: "steward-council"
  roles:
    council: { hat: "${HAT}" }
  rules:
    - { id: agent-layer, applies_to: ["workspace:agent"], propose: council, decide: { by: council, method: direct } }
`
  it('a viewer who wears the deciding role\'s hat reads; one who holds its name and not the hat is answered 404', async () => {
    const repo = repoWith(BY_HAT)
    // As request.ts resolves a SIWE wearer: the hat read, the role sourced from it held.
    const wearer = viewerReader(repo, { kind: 'member', id: WEARER, hats: [HAT], roles: ['council'] })
    expect((await readFileView(repo, DAY, wearer)).text).toBe(AGENT_LAYER[DAY])
    // The role's name and not the hat (a Roles-table Role, a stale reading): not a decider.
    for (const viewer of [{ kind: 'member' as const, id: WEARER, hats: [], roles: ['council'] }, { kind: 'member' as const, id: ID.member, hats: [], roles: ['council', 'network-member'] }]) {
      await expect(readFileView(repo, DAY, viewerReader(repo, viewer))).rejects.toMatchObject({ status: 404, message: `${DAY} is not a governed file, so it has no editor here.` })
    }
  })
})
