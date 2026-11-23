// lib/federation/join-rule.mjs: what a commit under `Org-Rule: federation/join` may be (network N2 Task 9, fix rounds 1
// and 2). Each hole the re-review found has its own case; the clean cases stay clean. Pure: documents in, sentence out.
import { describe, it, expect } from 'vitest'
import { joinCommitProblem } from '../../lib/federation/join-rule.mjs'

const ID = '3f8a2c1e-5b7d-4e9a-8c10-2d6f4a9b7e31'
const URL_ = 'https://mesa-node.example.org'
const DATE = '2026-11-22T12:00:00Z'
const from = { name: 'Mesa Node', type: 'LocalNode', url: URL_ }
const record = (o: Record<string, unknown> = {}) => ({ id: ID, received: DATE, transport: 'file', ref: `file:${ID}`, from, network: 'Mesh', answers: {}, invite: null, outcome: 'accepted', ...o })
const peer = (o: Record<string, unknown> = {}) => ({ name: 'Mesa Node', url: URL_, type: 'LocalNode', trust: 'read', relationship: 'node', since: '2026-11-22', ...o })
const fed = (join: Record<string, unknown>, peers: unknown[] = []) => ({ identity: { name: 'Hub' }, networks: [{ name: 'Mesh', role: 'hub' }], join, peers })
const OPEN = { policy: 'open', decision: 'LD-2026-040' }
const INVITE = { id: 'i-0a1b2c3d', name: 'Mesa Node', type: 'LocalNode', network: 'Mesh', expires: '2099-12-31', token_sha256: 'a'.repeat(64), used_by: null }

type Docs = { fed?: unknown; requests?: unknown; invites?: unknown; proposals?: unknown }
const judge = (o: { files?: string[]; decision?: string; before: Docs; after: Docs; date?: string }) => joinCommitProblem({
  files: o.files ?? ['federation.yaml', 'data/federation-requests.yaml'], decision: o.decision, date: o.date ?? DATE,
  before: { fed: {}, requests: {}, invites: {}, proposals: {}, ...o.before }, after: { fed: {}, requests: {}, invites: {}, proposals: {}, ...o.after },
})
const accept = (newPeer: Record<string, unknown>, o: { join?: Record<string, unknown>; decision?: string; rec?: Record<string, unknown>; peersBefore?: unknown[] } = {}) => {
  const join = o.join ?? OPEN
  const decision = o.decision ?? 'LD-2026-040'
  const others = o.peersBefore ?? []
  return judge({
    decision,
    before: { fed: fed(join, others) },
    after: { fed: fed(join, [...others.filter(p => (p as { url: string }).url !== URL_), newPeer]), requests: { requests: [record({ decision, ...o.rec })] } },
  })
}

describe('clean cases stay clean', () => {
  it('a standing-decision acceptance of hubPeerOf\'s shape, with and without did', () => {
    expect(accept(peer({ decision: 'LD-2026-040' }))).toBeNull()
    expect(accept(peer({ decision: 'LD-2026-040', did: 'did:plc:abcdefghijklmnopqrstuvwx' }))).toBeNull()
  })
  it('an existing node peer given the decision it lacked', () => {
    expect(accept(peer({ decision: 'LD-2026-040' }), { peersBefore: [peer()] })).toBeNull()
    expect(accept(peer({ decision: 'LD-2026-040', did: 'did:plc:abcdefghijklmnopqrstuvwx' }), { peersBefore: [peer()] })).toBeNull()
  })
  it('an existing member that keeps its earlier decision', () => {
    expect(judge({
      files: ['data/federation-requests.yaml'], decision: 'LD-2026-040',
      before: { fed: fed(OPEN, [peer({ decision: 'LD-2026-001' })]) },
      after: { fed: fed(OPEN, [peer({ decision: 'LD-2026-001' })]), requests: { requests: [record({ decision: 'LD-2026-040' })] } },
    })).toBeNull()
  })
  it('a refusal, and a proposed record naming its proposal', () => {
    expect(judge({ files: ['data/federation-requests.yaml'], before: {}, after: { requests: { requests: [record({ outcome: 'refused', reason: 'no' })] } } })).toBeNull()
    expect(judge({
      files: ['data/federation-requests.yaml'], before: { fed: fed(OPEN) },
      after: { requests: { requests: [record({ outcome: 'proposed', proposal: 'p-2026-11-22-001-abcd' })] }, proposals: { proposals: [{ id: 'p-2026-11-22-001-abcd', origin: { kind: 'federation-request', request: ID, from: 'Mesa Node' } }] } },
    })).toBeNull()
  })
  it('an invite acceptance that uses an unexpired invite of the right type', () => {
    const join = { policy: 'invite' }
    expect(judge({
      files: ['federation.yaml', 'data/federation-requests.yaml', 'data/invites.yaml'], decision: `invite ${INVITE.id}`,
      before: { fed: fed(join), invites: { invites: [INVITE] } },
      after: { fed: fed(join, [peer({ decision: `invite ${INVITE.id}` })]), requests: { requests: [record({ decision: `invite ${INVITE.id}`, invite: INVITE.id })] }, invites: { invites: [{ ...INVITE, used_by: ID }] } },
    })).toBeNull()
  })
})

describe('the holes of round 1, each refused', () => {
  it('a new peer with another trust, relationship, decision or an extra key', () => {
    expect(accept(peer({ decision: 'LD-2026-040', trust: 'full' }))).toMatch(/trust/)
    expect(accept(peer({ decision: 'LD-2026-040', relationship: 'upstream' }))).toMatch(/relationship/)
    expect(accept(peer({ decision: 'anything' }))).toMatch(/decision/)
    expect(accept(peer({ decision: 'LD-2026-040', write: true }))).toMatch(/write/)
    expect(accept({ trust: 'full', relationship: 'upstream', decision: 'anything', write: true, name: 'Mesa Node', url: URL_ })).not.toBeNull()
  })
  it('a new peer whose name, type or url is not the record\'s', () => {
    expect(accept(peer({ decision: 'LD-2026-040', name: 'Someone Else' }))).toMatch(/name/)
    expect(accept(peer({ decision: 'LD-2026-040', type: 'Network' }))).toMatch(/type/)
  })
  it('an existing peer in another role given a decision', () => {
    expect(accept(peer({ decision: 'LD-2026-040', relationship: 'upstream', trust: 'full' }), { peersBefore: [peer({ relationship: 'upstream', trust: 'full' })] })).toMatch(/relationship/)
  })
  it('an existing node peer whose trust changes', () => {
    expect(accept(peer({ decision: 'LD-2026-040', trust: 'full' }), { peersBefore: [peer()] })).toMatch(/trust/)
  })
  it('a record naming a network the hub does not list', () => {
    expect(accept(peer({ decision: 'LD-2026-040' }), { rec: { network: 'Elsewhere' } })).toMatch(/network/)
  })
  it('an expired invite, or one for another type', () => {
    const join = { policy: 'invite' }
    const withInvite = (inv: Record<string, unknown>) => judge({
      files: ['federation.yaml', 'data/federation-requests.yaml', 'data/invites.yaml'], decision: `invite ${INVITE.id}`,
      before: { fed: fed(join), invites: { invites: [inv] } },
      after: { fed: fed(join, [peer({ decision: `invite ${INVITE.id}` })]), requests: { requests: [record({ decision: `invite ${INVITE.id}`, invite: INVITE.id })] }, invites: { invites: [{ ...inv, used_by: ID }] } },
    })
    expect(withInvite({ ...INVITE, expires: '2026-11-21' })).toMatch(/expired/)
    expect(withInvite({ ...INVITE, expires: '2026-11-22' })).toBeNull() // a bare date is good through its day
    expect(withInvite({ ...INVITE, type: 'Network' })).toMatch(/type/)
  })
  it('held → refused is the operator\'s act, not federation/join', () => {
    expect(judge({
      files: ['data/federation-requests.yaml'],
      before: { requests: { requests: [record({ outcome: 'held' })] } },
      after: { requests: { requests: [record({ outcome: 'refused', reason: 'no' })] } },
    })).not.toBeNull()
  })
  it('a proposed record that names no proposal of this request', () => {
    expect(judge({ files: ['data/federation-requests.yaml'], before: { fed: fed(OPEN) }, after: { requests: { requests: [record({ outcome: 'proposed', proposal: 'p-2026-11-22-001-abcd' })] } } })).toMatch(/proposal/)
    // a refusal may name any network (the hub refuses one it doesn't list); held and proposed may not
    expect(judge({ files: ['data/federation-requests.yaml'], before: { fed: fed(OPEN) }, after: { requests: { requests: [record({ outcome: 'held', network: 'Elsewhere' })] } } })).toMatch(/network/)
    expect(judge({
      files: ['data/federation-requests.yaml'], before: { fed: fed(OPEN) },
      after: { requests: { requests: [record({ outcome: 'proposed', proposal: 'p-2026-11-22-001-abcd' })] }, proposals: { proposals: [{ id: 'p-2026-11-22-001-abcd', origin: { kind: 'federation-request', request: 'another', from: 'x' } }] } },
    })).toMatch(/proposal/)
  })
})

describe('fix round 3: what the policy asks, and the rest of the record', () => {
  const invited = (o: { join?: Record<string, unknown>; inv?: Record<string, unknown>; rec?: Record<string, unknown> } = {}) => {
    const join = o.join ?? { policy: 'invite' }
    const inv = { ...INVITE, ...o.inv }
    return judge({
      files: ['federation.yaml', 'data/federation-requests.yaml', 'data/invites.yaml'], decision: `invite ${INVITE.id}`,
      before: { fed: fed(join), invites: { invites: [inv] } },
      after: { fed: fed(join, [peer({ decision: `invite ${INVITE.id}` })]), requests: { requests: [record({ decision: `invite ${INVITE.id}`, invite: INVITE.id, ...o.rec })] }, invites: { invites: [{ ...inv, used_by: ID }] } },
    })
  }
  it('a type the hub does not take, on either path', () => {
    expect(accept(peer({ decision: 'LD-2026-040' }), { join: { ...OPEN, types: ['Network'] } })).toMatch(/takes/)
    expect(accept(peer({ decision: 'LD-2026-040' }), { join: { ...OPEN, types: ['LocalNode'] } })).toBeNull()
    expect(invited({ join: { policy: 'invite', types: ['Network'] } })).toMatch(/takes/)
  })
  it('an ask left unanswered, on either path', () => {
    expect(accept(peer({ decision: 'LD-2026-040' }), { join: { ...OPEN, asks: ['purpose'] } })).toMatch(/purpose/)
    expect(accept(peer({ decision: 'LD-2026-040' }), { join: { ...OPEN, asks: ['purpose'] }, rec: { answers: { purpose: '  ' } } })).toMatch(/purpose/)
    expect(accept(peer({ decision: 'LD-2026-040' }), { join: { ...OPEN, asks: ['purpose'] }, rec: { answers: { purpose: 'soil' } } })).toBeNull()
    expect(invited({ join: { policy: 'invite', asks: ['purpose'] } })).toMatch(/purpose/)
  })
  it('a did that is not one, on a new or an existing entry', () => {
    expect(accept(peer({ decision: 'LD-2026-040', did: 'not-a-did' }))).toMatch(/did/)
    expect(accept(peer({ decision: 'LD-2026-040', did: 'not-a-did' }), { peersBefore: [peer()] })).toMatch(/did/)
  })
  it('since changed on an existing entry', () => {
    expect(accept(peer({ decision: 'LD-2026-040', since: '2026-11-23' }), { peersBefore: [peer()] })).toMatch(/since/)
  })
  it('an existing record dropped or rewritten, duplicates included', () => {
    const r1 = record({ id: '1d2c3b4a-5e6f-4a1b-8c2d-3e4f5a6b7c8d', outcome: 'refused', reason: 'no' })
    const refusal = record({ outcome: 'refused', reason: 'no' })
    const files = ['data/federation-requests.yaml']
    expect(judge({ files, before: { requests: { requests: [r1] } }, after: { requests: { requests: [r1, refusal] } } })).toBeNull()
    expect(judge({ files, before: { requests: { requests: [r1, r1] } }, after: { requests: { requests: [r1, refusal] } } })).not.toBeNull()
    expect(judge({ files, before: { requests: { requests: [r1, r1] } }, after: { requests: { requests: [r1, { ...r1, reason: 'other' }, refusal] } } })).not.toBeNull()
  })
  it('a record whose from has no name, type or url', () => {
    const { name: _n, ...noName } = from
    expect(judge({
      decision: 'LD-2026-040', before: { fed: fed(OPEN) },
      after: { fed: fed(OPEN, [{ url: URL_, type: 'LocalNode', trust: 'read', relationship: 'node', decision: 'LD-2026-040' }]), requests: { requests: [record({ decision: 'LD-2026-040', from: noName })] } },
    })).toMatch(/from/)
  })
  it('an invite for another network', () => {
    expect(invited({ inv: { network: 'Other' } })).toMatch(/network/)
  })
})
