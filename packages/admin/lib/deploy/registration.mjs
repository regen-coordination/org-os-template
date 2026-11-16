// packages/admin/lib/deploy/registration.mjs
//
// Step 9 of a composition's deployment (L7 spec §8.2, §8.5, §9; Task 14, L7-D13): "Register the daoURI", the ENS text
// record `daouri` of the DAO's Sepolia ENS name set to `identity.daoURI`. An account step: `setText(bytes32 node, string
// key, string value)` to the resolver the Universal Resolver names for the name (findResolver), signed by the name's
// owner (or a manager it allows) from their own wallet, never by the Hub. The step is done when the text record reads
// the daoURI; another text there is replaced (a warning, never a mismatch: setting it is the step). Interfaces and
// sources are cited in lib/ens.mjs. Pure: no network, no clock. Imports only sibling lib modules.
import { encodeCall } from '../abi.mjs'
import { caip10, checksumAddress } from '../caip.mjs'
import { DAOURI_KEY, ENS_SIGNATURES, namehash } from '../ens.mjs'

/** @typedef {import('../compose.mjs').Composition} Composition */
/** @typedef {import('./plan.mjs').ChainState} ChainState */
/** @typedef {import('./plan.mjs').PlannedStep} PlannedStep */

export const REGISTRATION_TITLE = 'Register the daoURI'
const ENS_APP = 'https://sepolia.app.ens.domains'
const SEPOLIA = 'eip155:11155111'
/** The plan's sentence (Task 14 Step 1) for a resolver that answers no to ITextResolver. */
export const NO_TEXT = 'This name\'s resolver does not take text records; set daouri in the ENS app.'
export const NO_DAOURI = 'Waits for identity.daoURI in federation.yaml: the address the name registers.'

/**
 * The planner's `registration` hook for `daoURI` (identity.daoURI, or null when federation.yaml has none): step 9,
 * `registration:daouri`, for each composed registration.
 * @param {string | null} daoURI @returns {(c: Composition, s: ChainState) => PlannedStep[]}
 */
export function registrationSteps(daoURI) {
  return (c, s) => c.registrations.map(reg => {
    /** @type {PlannedStep} */
    const base = { id: 'registration:daouri', system: reg.id, title: REGISTRATION_TITLE, status: 'waits', signer: { kind: 'account' }, predicts: [] }
    const waits = (/** @type {string} */ why) => ({ ...base, waits: why })
    const name = reg.ens
    const app = `${ENS_APP}/${name}`
    if (c.chain !== SEPOLIA) return waits('Deploying is built for Sepolia (eip155:11155111) only.')
    let node
    try { node = namehash(name) } catch (err) { return waits(err instanceof Error ? err.message : String(err)) }
    if (!daoURI) return waits(NO_DAOURI)
    const read = s.registrations?.[reg.id]
    if (!read) return waits('Waits for the ENS name to be read.')
    if (read.error !== undefined) return waits(`Waits for the ENS name to be read: ${read.error}`)
    const predicts = [{ kind: 'text', value: daoURI, on: name }]
    if (read.text === daoURI) return { ...base, status: 'done', predicts }
    if (!read.resolver) return waits(`Waits for ${name} to be registered on Sepolia with a resolver: ${app}`)
    if (!read.own) return waits(`${name} has no resolver of its own (a parent name's answers for it): set one in the ENS app, ${app}`)
    if (read.takesText === false) return waits(NO_TEXT)
    if (read.takesText !== true) return waits('Waits for the name\'s resolver to say whether it takes text records.')
    const resolver = checksumAddress(read.resolver)
    const call = {
      to: caip10(c.chain, resolver), value: '0', data: encodeCall(ENS_SIGNATURES.setText, [node, DAOURI_KEY, daoURI]), operation: /** @type {0} */ (0),
      // fix M-2: whose account signs (ENSv2 PermissionedResolver guards setText by ROLE_SET_TEXT, lib/ens.mjs). The read
      // of the name's owner (ENSv2 findOwner) against the composition's accounts is carried, not built (PF-R202).
      summary: `Set the text record ${DAOURI_KEY} of ${name} to ${daoURI}, on its resolver ${resolver}. `
        + `Your account must own ${name} (or hold ROLE_SET_TEXT on that resolver) and sign it from your own wallet; from any other account the resolver refuses it.`,
    }
    return {
      ...base, status: 'ready', call, predicts,
      ...(read.text ? { differs: [`${name}'s daouri reads ${read.text} now; this step replaces it.`] } : {}),
    }
  })
}
