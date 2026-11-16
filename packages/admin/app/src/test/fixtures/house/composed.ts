import type { Resource } from '../../../api.ts'
/** A composition as data/systems.yaml holds it (DAO-OS L7 spec §4.1): the Test DAO's Safe, its Hats tree with the
 *  council hat that signs for the Safe, a Snapshot space that elects the council and a daoURI registration, all
 *  composed and not deployed; beside them a deployed Safe and a link the composition does not name. Placeholder
 *  addresses only. /compose's tests and the adapter's read it. */
export const SEPOLIA = 'eip155:11155111'
export const OWNERS = [1, 2, 3].map(i => `${SEPOLIA}:0x${'0'.repeat(38)}a${i}`)

export const COMPOSED_SAFE = {
  id: 'test-dao-safe', kind: 'safe', driver: 'safe', name: 'Test DAO Safe', chain: SEPOLIA, section: 'organization/treasury',
  position: { x: 360, y: 220 }, order: 1,
  deployment: {
    status: 'composed', owners: OWNERS, threshold: 2, salt: '1',
    on_deploy: { roles: { council: { hat: '${hat.test-dao-roles/council}' } }, rules: [{ id: 'treasury', applies_to: ['treasury'], propose: 'council', decide: { by: 'system', system: 'test-dao-safe' } }] },
  },
  signer_gate: { hats: ['test-dao-roles/council'], threshold: { type: 'absolute', min: 2, target: 2 }, claimable_for: true, address: null },
}
export const COUNCIL_HAT = { key: 'council', details: 'Council', admin: 'top', max_supply: 5, mutable: true, wearers: OWNERS, role: 'decides', hat: null, image: 'ipfs://council' }
export const COMPOSED_TREE = {
  id: 'test-dao-roles', kind: 'hats-tree', driver: 'hats-tree', name: 'Test DAO roles', chain: SEPOLIA, position: { x: 360, y: 60 }, order: 2,
  deployment: { status: 'composed', top: { details: 'Test DAO', image: '', worn_by: 'test-dao-safe' } },
  hats: [COUNCIL_HAT],
}
export const COMPOSED_VOTES = {
  id: 'test-dao-votes', kind: 'snapshot-space', driver: 'snapshot-space', name: 'Test DAO votes', url: 'https://testnet.snapshot.box/#/s:test-dao.eth',
  space: 'test-dao.eth', order: 5, relates: [{ to: 'test-dao-roles/council', label: 'elects' }],
  deployment: { status: 'composed', network: SEPOLIA, settings: { name: 'Test DAO', symbol: 'VOTE' } },
}
export const COMPOSED_REGISTRATION = {
  id: 'test-dao-registration', kind: 'daouri-registration', driver: 'daouri-registration', name: 'Test DAO registration', chain: SEPOLIA,
  ens: 'test-dao.eth', position: { x: 640, y: 220 }, order: 6, deployment: { status: 'composed' },
}
/** Deployed, and named by no composed System: not on the canvas. */
export const DEPLOYED_SAFE = { id: 'treasury-safe', kind: 'safe', driver: 'safe', name: 'Treasury', chain: 'eip155:42220', address: `0x${'0'.repeat(36)}5afe` }
export const FORUM = { id: 'forum', kind: 'link', name: 'Forum', url: 'https://forum.example.org' }

export const COMPOSED_SYSTEMS: Record<string, unknown>[] = [COMPOSED_SAFE, COMPOSED_TREE, COMPOSED_VOTES, COMPOSED_REGISTRATION, DEPLOYED_SAFE, FORUM]

/** The read the systems reader answers for a composed System (server/systems/reader.ts): no driver is asked, the read is
 *  good, says `composed` in its facts and has no time. The adapter adds the reading state, which never moved. */
export const COMPOSED_READ = { ok: true, readAt: null, facts: { composed: true }, sections: [], open: null, note: 'Composed, not deployed', state: 'unknown' }
/** A composed System as the systems adapter makes it a Resource (server/resources/adapters/systems.ts). */
function composedResource(e: Record<string, unknown>): Resource {
  const id = String(e.id)
  const section = typeof e.section === 'string' ? e.section : null
  return {
    id: `system:${id}`, kind: 'system', board: section?.startsWith('organization') ? 'organization' : 'systems', name: String(e.name),
    status: String(e.kind), attention: null, changed: null,
    facts: { kind: e.kind, chain: e.chain ?? null, address: null, section, embeddable: false, notes: null, driver: COMPOSED_READ },
    source: { path: 'data/systems.yaml', editable: true, registry: 'systems', entityId: id },
  }
}
/** The walk's composed Test DAO (whole-platform walk I1, I2): its Safe, in the treasury's section, and its Hats tree, as
 *  /api/resources answers them beside the org's own deployed Safe and tree. */
export const COMPOSED_SAFE_RESOURCE = composedResource(COMPOSED_SAFE)
export const COMPOSED_TREE_RESOURCE = composedResource(COMPOSED_TREE)
