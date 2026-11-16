// Spec §4.1's three records, with placeholder addresses only.
const A = (n: number) => `eip155:11155111:0x${'0'.repeat(38)}a${n}`
export const OWNERS = [A(1), A(2)]
export const composedSafe = () => ({
  id: 'test-dao-safe', kind: 'safe', driver: 'safe', name: 'Test DAO Safe', chain: 'eip155:11155111', section: 'organization/treasury',
  position: { x: 360, y: 220 }, order: 1,
  deployment: {
    status: 'composed', owners: [...OWNERS], threshold: 2, salt: '1',
    on_deploy: { roles: { council: { hat: '${hat.test-dao-roles/council}' } }, rules: [{ id: 'treasury', applies_to: ['treasury'], propose: 'council', decide: { by: 'system', system: 'test-dao-safe' } }] },
  },
  signer_gate: { hats: ['test-dao-roles/council'], threshold: { type: 'absolute', min: 2, target: 2 }, claimable_for: true, address: null },
})
export const composedTree = () => ({
  id: 'test-dao-roles', kind: 'hats-tree', driver: 'hats-tree', name: 'Test DAO roles', chain: 'eip155:11155111', position: { x: 360, y: 60 }, order: 2,
  deployment: { status: 'composed', top: { details: 'Test DAO', image: '', worn_by: 'test-dao-safe' } },
  hats: [{ key: 'council', details: 'Council', admin: 'top', max_supply: 5, mutable: true, wearers: [...OWNERS], role: 'decides', hat: null }],
})
export const composedSpace = () => ({
  id: 'test-dao-votes', kind: 'snapshot-space', driver: 'snapshot-space', name: 'Test DAO votes', url: 'https://testnet.snapshot.box/#/s:test-dao.eth', space: 'test-dao.eth', order: 5,
  relates: [{ to: 'test-dao-roles/council', label: 'elects' }],
  deployment: { status: 'composed', network: 'eip155:11155111', settings: { name: 'Test DAO', symbol: 'VOTE' } },
})
