// packages/admin/lib/deploy/encode.mjs
//
// Pure calldata encoders for the Sepolia deployment (spec §8.2): the Safe, the Hats tree and the Hats Signer Gate.
// Nothing here sends, signs or reads the chain. Every contract address comes from DEPLOYMENTS (lib/deployments.mjs); a chain
// other than Sepolia throws deploymentsOn's sentence. Each call is { to: CAIP-10, value: '0', data, operation }.
// Pure: imports only sibling lib modules.
import { encodeArgs, encodeCall } from '../abi.mjs'
import { addressOf, caip10 } from '../caip.mjs'
import { deploymentsOn } from '../deployments.mjs'
import { encodeMultiSend } from '../multisend.mjs'
import { hatsCall, normalHatId, parseHatRef } from '../hats.mjs'

/** @typedef {{ to: string, value: '0', data: string, operation: 0 | 1 }} DeployCall */

const ZERO = '0x0000000000000000000000000000000000000000'

// Safe 1.4.1 setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver):
// `to`/`data` are the optional setup delegatecall (unused); the fallback handler is the FIFTH argument.
const SAFE_SETUP = 'setup(address[],uint256,address,bytes,address,address,uint256,address)'
const CREATE_PROXY = 'createProxyWithNonce(address,bytes,uint256)'
const DEPLOY_MODULE = 'deployModule(address,bytes,uint256)'
const HSG_SETUP = 'setUp(bytes)'
const CLAIM_SIGNERS = 'claimSignersFor(uint256[],address[])'
const ENABLE_MODULE = 'enableModule(address)'
const SET_GUARD = 'setGuard(address)'

// HatsSignerGate v2.0.0 SetupParams, in this exact order (abi.decode(initializeParams, (SetupParams)) in HatsSignerGate.setUp):
// https://github.com/Hats-Protocol/hats-zodiac/blob/v2.0.0/src/interfaces/IHatsSignerGate.sol
// (the brief named src/lib/HSGLib.sol; that file does not exist at the tag - the struct is in the interface)
//   struct SetupParams {
//     uint256 ownerHat; uint256[] signerHats; address safe; ThresholdConfig thresholdConfig;
//     bool locked; bool claimableFor; address implementation; address hsgGuard; address[] hsgModules; }
//   struct ThresholdConfig { TargetThresholdType thresholdType; uint120 min; uint120 target; }   // ABSOLUTE = 0, PROPORTIONAL = 1
const SETUP_PARAMS = '(uint256,uint256[],address,(uint8,uint120,uint120),bool,bool,address,address,address[])'

/** @param {string} chain @param {string} address @returns {string} */
const account = (chain, address) => caip10(chain, address)

/** @param {string} chain @param {string} to bare address @param {string} data @param {0 | 1} [operation] @returns {DeployCall} */
function callTo(chain, to, data, operation = 0) {
  return { to: account(chain, to), value: '0', data, operation }
}

/** A hat id in any form the Hats module reads, or a hat ref, as a decimal-safe bigint.
 * @param {unknown} hat @returns {bigint} */
function hatNumber(hat) {
  if (typeof hat === 'string') {
    const ref = parseHatRef(hat)
    if (ref) return BigInt(ref.hatId)
    const id = normalHatId(hat)
    if (id !== null) return BigInt(id)
  }
  throw new Error(`${String(hat)} is not a hat id`)
}

/** @param {string[]} owners @param {number} threshold @param {string} fallbackHandler @returns {string} setup(...) calldata */
export function safeInitializer(owners, threshold, fallbackHandler) {
  if (!Array.isArray(owners) || owners.length === 0) throw new Error('a Safe needs at least one owner')
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > owners.length) {
    throw new Error(`the threshold ${String(threshold)} must be a whole number from 1 to the ${owners.length} owners`)
  }
  return encodeCall(SAFE_SETUP, [owners.map(addressOf), threshold, ZERO, '0x', addressOf(fallbackHandler), ZERO, 0, ZERO])
}

/** @param {string} chain @param {string[]} owners @param {number} threshold @param {string} saltNonce decimal @returns {DeployCall} */
export function createSafeCall(chain, owners, threshold, saltNonce) {
  const { safe } = deploymentsOn(chain)
  const init = safeInitializer(owners, threshold, safe.fallbackHandler)
  return callTo(chain, safe.proxyFactory, encodeCall(CREATE_PROXY, [safe.singletonL2, init, BigInt(saltNonce)]))
}

/** @param {string} chain @param {import('../hats.mjs').HatsCall} c @returns {DeployCall} */
function hatsStep(chain, c) {
  const { hats } = deploymentsOn(chain)
  return callTo(chain, hats.address, c.data)
}

/** @param {string} chain @param {string} safe @param {string} details @param {string} image @returns {DeployCall} */
export function mintTopHatCall(chain, safe, details, image) {
  deploymentsOn(chain)
  return hatsStep(chain, hatsCall(chain, 'mintTopHat', [addressOf(safe), details, image], 'mint the top hat'))
}

/** @param {string} chain
 * @param {{ admin: string, details: string, maxSupply: number, eligibility: string, toggle: string, mutable: boolean, image: string }[]} hats
 * @returns {DeployCall} */
export function createHatsCall(chain, hats) {
  deploymentsOn(chain)
  const args = [
    hats.map((h) => hatNumber(h.admin)),
    hats.map((h) => h.details),
    hats.map((h) => h.maxSupply),
    hats.map((h) => addressOf(h.eligibility)),
    hats.map((h) => addressOf(h.toggle)),
    hats.map((h) => h.mutable),
    hats.map((h) => h.image),
  ]
  return hatsStep(chain, hatsCall(chain, 'batchCreateHats', args, 'create the hats'))
}

/** @param {string} chain @param {{ hat: string, wearer: string }[]} mints @returns {DeployCall} */
export function mintHatsCall(chain, mints) {
  deploymentsOn(chain)
  const args = [mints.map((m) => hatNumber(m.hat)), mints.map((m) => addressOf(m.wearer))]
  return hatsStep(chain, hatsCall(chain, 'batchMintHats', args, 'give the hats to their first wearers'))
}

/** setUp(bytes) calldata for a HatsSignerGate v2.0.0 proxy; implementation is the deployment's, guard zero, no modules.
 * @param {{ ownerHat: string, signerHats: string[], safe: string, threshold: { type: 'absolute' | 'proportional', min: number, target: number }, locked: false, claimableFor: boolean }} p
 * @param {string} [chain] defaults to Sepolia @returns {string} */
export function gateInitializer(p, chain = 'eip155:11155111') {
  const { hsg } = deploymentsOn(chain)
  if (p.locked !== false) throw new Error('the gate is deployed unlocked')
  if (p.threshold.type !== 'absolute' && p.threshold.type !== 'proportional') throw new Error(`threshold type ${String(p.threshold.type)} is neither absolute nor proportional`)
  const params = [
    hatNumber(p.ownerHat),
    p.signerHats.map(hatNumber),
    addressOf(p.safe),
    [p.threshold.type === 'absolute' ? 0 : 1, p.threshold.min, p.threshold.target],
    false,
    !!p.claimableFor,
    hsg.implementation,
    ZERO,
    [],
  ]
  return encodeCall(HSG_SETUP, [encodeArgs([SETUP_PARAMS], [params])])
}

/** @param {string} chain @param {string} initializer @param {string} saltNonce decimal @returns {DeployCall} */
export function deployGateCall(chain, initializer, saltNonce) {
  const { hsg } = deploymentsOn(chain)
  return callTo(chain, hsg.moduleProxyFactory, encodeCall(DEPLOY_MODULE, [hsg.implementation, initializer, BigInt(saltNonce)]))
}

/** MultiSendCallOnly 1.4.1 reverts on an inner delegatecall; refuse to build one.
 * @param {{ operation: 0 | 1, to: string, value: string, data: string }[]} txs */
export function assertCallOnlyInner(txs) {
  txs.forEach((t, i) => {
    if (t.operation !== 0) throw new Error(`MultiSendCallOnly reverts on an inner delegatecall (transaction ${i} has operation ${String(t.operation)})`)
  })
}

/** The Safe delegatecalls MultiSendCallOnly (outer operation 1); the inner calls (operation 0) go to the Safe itself.
 * @param {string} chain @param {string} safe @param {string} gate @returns {DeployCall} */
export function wireGateCall(chain, safe, gate) {
  const { safe: s } = deploymentsOn(chain)
  const self = addressOf(safe)
  const inner = [
    { operation: /** @type {const} */ (0), to: self, value: '0', data: encodeCall(ENABLE_MODULE, [addressOf(gate)]) },
    { operation: /** @type {const} */ (0), to: self, value: '0', data: encodeCall(SET_GUARD, [addressOf(gate)]) },
  ]
  assertCallOnlyInner(inner)
  return callTo(chain, s.multiSendCallOnly, encodeMultiSend(inner), 1)
}

/** @param {string} chain @param {string} gate @param {string[]} hats @param {string[]} signers @returns {DeployCall} */
export function claimSignersCall(chain, gate, hats, signers) {
  deploymentsOn(chain)
  if (hats.length !== signers.length) throw new Error('claim: hats and signers must be the same length')
  return callTo(chain, addressOf(gate), encodeCall(CLAIM_SIGNERS, [hats.map(hatNumber), signers.map(addressOf)]))
}
