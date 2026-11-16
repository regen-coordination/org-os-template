import type { DeployPlan, DeployStep } from '../../../api.ts'
import { SEPOLIA } from './composed.ts'

/** A deployment as GET /api/deploy answers it (DAO-OS L7 spec §8.3), for the Test DAO composition of composed.ts, part
 *  way through: the Safe created and the top hat minted (done), the child hats and their wearers ready as two Safe
 *  transactions on consecutive nonces, the gate waiting, the Snapshot space ready as settings to paste, and the daoURI
 *  registration ready as an account step that replaces another text. Placeholder addresses and synthetic call data
 *  only: nothing here was read from a chain. /deploy's tests and the /parts specimen read it. */
const hex = (n: number, fill: string) => `0x${fill.repeat(n)}`
const at = (tail: string) => `0x${'0'.repeat(40 - tail.length)}${tail}`
export const DEPLOY_SAFE = at('5afe')
export const DEPLOY_RESOLVER = at('e5')
export const DEPLOY_FACTORY = at('f1')
export const HATS = at('4a75')
export const TOP_HAT = `0x${'0'.repeat(7)}1${'0'.repeat(56)}`

/** The call data of an account step: four bytes of selector and synthetic words, never a real call. */
const DATA = `0x2f2ff15d${hex(64, '0').slice(2)}${hex(64, '1').slice(2)}`
const SAFE_LINK = `https://app.safe.global/transactions/queue?safe=sep:${DEPLOY_SAFE}`
const safeStep = (summary: string, nonce: number, id: string): DeployStep['step'] => ({
  call: { chain: SEPOLIA, to: `${SEPOLIA}:${HATS}`, value: '0', data: DATA, operation: 0, summary },
  signer: { kind: 'safe', account: `${SEPOLIA}:${DEPLOY_SAFE}` },
  safe: {
    payload: { to: HATS, value: '0', data: DATA, operation: 0, safeTxGas: '0', baseGas: '0', gasPrice: '0', gasToken: at('0'), refundReceiver: at('0'), nonce },
    ref: { system: 'test-dao-safe', id, chain: SEPOLIA, payload: { to: HATS, value: '0', data_hash: hex(64, 'd'), operation: 0, nonce } },
    link: SAFE_LINK,
  },
})

/** Step 7's window, as the planner says it on "Wire the gate to the Safe" (lib/deploy/plan.mjs). */
export const WIRE_WINDOW = 'Between this step and "Register the signers", every founding owner is unregistered: anyone may remove any of them (HatsSignerGate.removeSigner) until the claim adds them back, and the Safe cannot sign in that window.'
export const REPLACES = 'test-dao.eth\'s daouri reads https://old.example.org/dao.json now; this step replaces it.'
export const DAO_URI = 'https://dao.example.org/.well-known/dao.json'

export const SPACE_DRAFT: NonNullable<DeployStep['draft']> = {
  network: SEPOLIA, space: 'test-dao.eth',
  settings: { name: 'Test DAO', network: '11155111', symbol: 'VOTE',
    strategies: [{ name: 'erc1155-balance-of', network: '11155111', params: { symbol: 'VOTE', address: HATS, tokenId: '26959946667150639794667015087019630673637144422540572481103610249216', decimals: 0 } }],
    filters: { onlyMembers: true, minScore: 0 } },
  links: { name: 'https://sepolia.app.ens.domains/test-dao.eth', create: 'https://testnet.snapshot.box/#/create', space: 'https://testnet.snapshot.box/#/s:test-dao.eth' },
}

export const STEP_SAFE: DeployStep = { id: 'safe:create', system: 'test-dao-safe', title: 'Create the Safe', status: 'done', signer: { kind: 'account' },
  predicts: [{ kind: 'address', value: `${SEPOLIA}:${DEPLOY_SAFE}` }] }
export const STEP_TOP: DeployStep = { id: 'tree:top', system: 'test-dao-roles', title: 'Mint the top hat to the Safe', status: 'done', signer: { kind: 'account' },
  predicts: [{ kind: 'hat', value: `${SEPOLIA}:${TOP_HAT}` }] }
export const STEP_HATS: DeployStep = { id: 'tree:hats', system: 'test-dao-roles', title: 'Create the child hats', status: 'ready',
  signer: { kind: 'safe', system: 'test-dao-safe' }, step: safeStep('Create the child hats: Council', 0, hex(64, 'a')), link: SAFE_LINK, threshold: 2,
  predicts: [{ kind: 'hat', value: `${SEPOLIA}:0x${'0'.repeat(7)}1${'0'.repeat(3)}1${'0'.repeat(52)}` }] }
export const STEP_WEARERS: DeployStep = { id: 'tree:wearers', system: 'test-dao-roles', title: 'Give the hats to their first wearers', status: 'ready',
  signer: { kind: 'safe', system: 'test-dao-safe' }, step: safeStep('Give Council to 0x…00a1, 0x…00a2, 0x…00a3', 1, hex(64, 'b')), link: SAFE_LINK, threshold: 2,
  predicts: [{ kind: 'wearer', value: `${SEPOLIA}:${at('a1')}` }] }
export const STEP_GATE: DeployStep = { id: 'gate:deploy', system: 'test-dao-safe', title: 'Deploy the Hats Signer Gate', status: 'waits',
  waits: 'Waits for the child hats to be read back.', signer: { kind: 'account' }, predicts: [] }
export const STEP_WIRE: DeployStep = { id: 'gate:wire', system: 'test-dao-safe', title: 'Wire the gate to the Safe', status: 'waits',
  waits: 'Waits for the gate to be read back.', signer: { kind: 'safe', system: 'test-dao-safe' }, predicts: [] }
export const STEP_SPACE: DeployStep = { id: 'space:settings', system: 'test-dao-votes', title: 'The Snapshot space', status: 'ready', signer: { kind: 'account' },
  draft: SPACE_DRAFT, link: SPACE_DRAFT.links.create, predicts: [{ kind: 'space', value: 'test-dao.eth' }] }
export const STEP_REGISTER: DeployStep = { id: 'registration:daouri', system: 'test-dao-registration', title: 'Register the daoURI', status: 'ready',
  signer: { kind: 'account' }, link: `https://eth-sepolia.blockscout.com/address/${DEPLOY_RESOLVER}`, differs: [REPLACES],
  step: {
    call: { chain: SEPOLIA, to: `${SEPOLIA}:${DEPLOY_RESOLVER}`, value: '0', data: DATA, operation: 0,
      summary: `Set the text record daouri of test-dao.eth to ${DAO_URI}, on its resolver ${DEPLOY_RESOLVER}. Your account must own test-dao.eth (or hold ROLE_SET_TEXT on that resolver) and sign it from your own wallet; from any other account the resolver refuses it.` },
    signer: { kind: 'account', account: '' }, safe: null,
  },
  predicts: [{ kind: 'text', value: DAO_URI, on: 'test-dao.eth' }] }
/** An account step ready to run: the gate deployed by any account, from their own wallet (the /parts specimen). */
export const STEP_GATE_READY: DeployStep = { id: 'gate:deploy', system: 'test-dao-safe', title: 'Deploy the Hats Signer Gate', status: 'ready',
  signer: { kind: 'account' }, link: `https://eth-sepolia.blockscout.com/address/${DEPLOY_FACTORY}`,
  step: {
    call: { chain: SEPOLIA, to: `${SEPOLIA}:${DEPLOY_FACTORY}`, value: '0', data: DATA, operation: 0, summary: 'Deploy the Hats Signer Gate for Test DAO Safe through the module factory' },
    signer: { kind: 'account', account: '' }, safe: null,
  },
  predicts: [{ kind: 'module', value: `${SEPOLIA}:${at('9a7e')}` }] }

export const DEPLOY_PLAN: DeployPlan = {
  chain: SEPOLIA, composed: ['test-dao-safe', 'test-dao-roles', 'test-dao-votes', 'test-dao-registration'], readAt: '2026-11-06T12:00:00.000Z', problems: [],
  steps: [STEP_SAFE, STEP_TOP, STEP_HATS, STEP_WEARERS, STEP_GATE, STEP_WIRE, STEP_SPACE, STEP_REGISTER],
}
