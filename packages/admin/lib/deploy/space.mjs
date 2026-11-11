// packages/admin/lib/deploy/space.mjs
//
// Step 8 of a composition's deployment (L7 spec §8.2, §8.4, §9; Task 13): the Snapshot space, off chain. Nothing is
// posted and nothing is signed here: the Hub prepares the space's settings and two links (the ENS app for the name, the
// testnet's create page), for the ENS name's owner (the space's controller, L7-D12) to paste. The step is ready once the
// hat whose wearers vote exists, and done when the testnet hub returns the space with the composed name, network and
// strategies (server/deploy/state.ts reads it, a query only). Pure: no network, no clock. Imports only sibling lib modules.
//
// The strategy, confirmed (Task 13 Step 1): `erc1155-balance-of` in snapshot-labs/snapshot-strategies at commit
// 91abd258f10b4e881375890647bc0b5c58bd1cfb (2025-07-28, the default branch's head when read on 2026-11-06),
//   https://github.com/snapshot-labs/snapshot-strategies/blob/91abd258f10b4e881375890647bc0b5c58bd1cfb/src/strategies/erc1155-balance-of/schema.json
//   — params `{ symbol?: string (≤ 16), address: 0x…40, tokenId: string (≤ 100), decimals: number ≥ 0 }`, required
//   `address`, `tokenId`, `decimals`, no other key (additionalProperties false);
//   https://github.com/snapshot-labs/snapshot-strategies/blob/91abd258f10b4e881375890647bc0b5c58bd1cfb/src/strategies/erc1155-balance-of/index.ts
//   — each voter's score is `balanceOf(voter, tokenId)` on `address`, scaled by `decimals`.
// On Hats v1, balanceOf(wearer, hatId) is 1 for a wearer in good standing: one wearer, one vote, with decimals 0.
import { checksumAddress } from '../caip.mjs'
import { DEPLOYMENTS } from '../deployments.mjs'
import { spaceStrategyProblems } from '../compose.mjs'
import { prettyHatId } from '../hats.mjs'
import { WAITS, predictions, topsOf } from './plan.mjs'

/** @typedef {import('../compose.mjs').Composition} Composition */
/** @typedef {Composition['spaces'][number]} ComposedSpace */
/** @typedef {import('./plan.mjs').ChainState} ChainState */
/** @typedef {import('./plan.mjs').PlannedStep} PlannedStep */
/** @typedef {{ name: string, network: string, params: Record<string, unknown> }} SpaceStrategy */
/** @typedef {{ name?: unknown, network?: unknown, strategies?: unknown, filters?: unknown, admins?: unknown, voting?: unknown }} FoundSpace */
/** @typedef {{
 *   network: string, space: string,
 *   settings: Record<string, unknown> & { name: string, network: string, symbol: string, strategies: SpaceStrategy[], filters: Record<string, unknown> },
 *   links: { name: string, create: string, space: string } }} SpaceSettingsDraft */

export const SPACE_STRATEGY = 'erc1155-balance-of'
export const SPACE_TITLE = 'The Snapshot space'
const TESTNET_UI = 'https://testnet.snapshot.box'
const ENS_APP = 'https://sepolia.app.ens.domains'
const SEPOLIA = 'eip155:11155111'
const SEPOLIA_ONLY = 'Deploying is built for Sepolia (eip155:11155111) only.'
/** Said while no hat names who votes. */
export const NO_HAT = 'Waits for the hat whose wearers vote: relate the space to a hat (elects), or name it in its strategy.'

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObj = v => typeof v === 'object' && v !== null && !Array.isArray(v)
const PLACEHOLDER = /\$\{hat\.([^}]+)\}/

/** The first `${hat.<tree>/<key>}` in `v`, as `<tree>/<key>`. @param {unknown} v @returns {string | null} */
function firstHat(v) {
  if (typeof v === 'string') return PLACEHOLDER.exec(v)?.[1] ?? null
  if (Array.isArray(v)) { for (const x of v) { const f = firstHat(x); if (f) return f } return null }
  if (isObj(v)) { for (const x of Object.values(v)) { const f = firstHat(x); if (f) return f } return null }
  return null
}

/** The `<tree>/<key>` of the hat whose wearers vote: the first `${hat.…}` in the space's strategies, else its `elects`.
 * @param {ComposedSpace} space @returns {string | null} */
export function spaceHat(space) {
  return firstHat(space.settings.strategies) ?? space.elects ?? null
}

/** The strategies as the draft lists them: the composed ones that are objects, else one erc1155-balance-of.
 * @param {unknown} strategies @returns {Record<string, unknown>[]} */
const listedOf = strategies => {
  const listed = Array.isArray(strategies) ? strategies.filter(isObj) : []
  return listed.length > 0 ? listed : [{ name: SPACE_STRATEGY, params: {} }]
}

/** The `<tree>/<key>` each erc1155-balance-of strategy counts, in order: the first `${hat.…}` in its own params, else
 *  the space's `elects` (fix I-2: never another strategy's hat); null where neither names one.
 * @param {ComposedSpace} space @returns {(string | null)[]} */
export function strategyHats(space) {
  return listedOf(space.settings.strategies).filter(st => st.name === SPACE_STRATEGY).map(st => firstHat(st.params) ?? space.elects ?? null)
}

/** The full hex id of the hat `<tree>/<key>`, once its tree's top hat is known (a deployed tree's, or the one the Safe
 *  wears as read); null before (a predicted top hat could still be taken, L7-D4).
 * @param {string} ref @param {Composition} c @param {ChainState} s @returns {string | null} */
function hatIdOf(ref, c, s) {
  const i = ref.indexOf('/')
  const tree = i > 0 ? c.trees.find(t => t.id === ref.slice(0, i)) : undefined
  if (!tree) return null
  if (!tree.deployed && !s.trees[tree.id]?.topHat) return null
  const p = predictions(c, { proxyCreationCode: s.proxyCreationCode, tops: topsOf(c, s.trees) })
  return p.hats[tree.id]?.[ref.slice(i + 1)] ?? null
}

/** `${hat.<tree>/<key>}` in every string of `value`, as the hat's id in decimal text; null when one is not known.
 * @param {unknown} value @param {(ref: string) => string | null} idOf @returns {unknown} */
function resolved(value, idOf) {
  let missing = false
  /** @param {unknown} v @returns {unknown} */
  const walk = v => {
    if (typeof v === 'string') {
      return v.replace(new RegExp(PLACEHOLDER.source, 'g'), (_, ref) => {
        const id = idOf(ref)
        if (!id) { missing = true; return '' }
        return BigInt(id).toString()
      })
    }
    if (Array.isArray(v)) return v.map(walk)
    if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
    return v
  }
  const out = walk(value)
  return missing ? null : out
}

/**
 * The settings and links for `space` (spec §8.4): the composed settings with the network as Snapshot writes it
 * ('11155111'), each `erc1155-balance-of` strategy on Hats v1 with the voting hat's id as decimal text and decimals 0
 * (the pinned schema's keys only), proposals by the space's members only (`filters.onlyMembers`), and the links. null
 * while the voting hat's id is not known, or the space is not on Sepolia.
 * @param {ComposedSpace} space @param {Composition} c @param {ChainState} s @returns {SpaceSettingsDraft | null}
 */
export function spaceSettingsDraft(space, c, s) {
  if (space.network !== SEPOLIA || !Object.hasOwn(DEPLOYMENTS, SEPOLIA)) return null
  if (spaceStrategyProblems(space).length > 0) return null // refused in words (compositionProblems), never rewritten
  const ref = spaceHat(space)
  const hatId = ref ? hatIdOf(ref, c, s) : null
  if (!hatId) return null
  const composed = /** @type {Record<string, unknown> | null} */ (resolved(space.settings, r => hatIdOf(r, c, s)))
  if (!composed) return null
  const network = SEPOLIA.slice('eip155:'.length)
  const symbol = typeof composed.symbol === 'string' && composed.symbol !== '' ? composed.symbol : 'VOTE'
  // the raw strategies, index for index with the resolved ones (resolving keeps the shape): each names its own hat
  const raw = listedOf(space.settings.strategies)
  /** @type {(SpaceStrategy | null)[]} */
  const strategies = listedOf(composed.strategies).map((st, i) => {
    const params = isObj(st.params) ? st.params : {}
    if (st.name !== SPACE_STRATEGY) return { name: String(st.name), network, params }
    const own = firstHat(raw[i]?.params) ?? space.elects ?? null
    const id = own ? hatIdOf(own, c, s) : null
    if (!id) return null
    return {
      name: SPACE_STRATEGY, network,
      params: {
        symbol: typeof params.symbol === 'string' && params.symbol !== '' ? params.symbol : symbol,
        address: checksumAddress(DEPLOYMENTS[SEPOLIA].hats.address),
        tokenId: BigInt(id).toString(),
        decimals: 0,
      },
    }
  })
  if (strategies.some(x => x === null)) return null
  const filters = { ...(isObj(composed.filters) ? composed.filters : {}), onlyMembers: true }
  if (typeof filters.minScore !== 'number') filters.minScore = 0
  return {
    network: SEPOLIA,
    space: space.space,
    settings: { ...composed, name: typeof composed.name === 'string' ? composed.name : '', network, symbol, strategies: /** @type {SpaceStrategy[]} */ (strategies), filters },
    links: { name: `${ENS_APP}/${space.space}`, create: `${TESTNET_UI}/#/create`, space: `${TESTNET_UI}/#/s:${space.space}` },
  }
}

/** The network a strategy counts on: its own, else the space's (Snapshot's default).
 * @param {Record<string, unknown>} st @param {unknown} spaceNetwork @returns {string} */
const networkOf = (st, spaceNetwork) => String(st.network ?? spaceNetwork ?? '')

/** A strategy in words: `erc1155-balance-of of hat <pretty> on Hats v1`, or its name; then ` on network <n>` when it
 *  counts on another network than `want`, and ` with decimals <d>` for an erc1155-balance-of not scaled by 0.
 * @param {unknown} st @param {unknown} spaceNetwork @param {string} want */
function strategyWords(st, spaceNetwork, want) {
  if (!isObj(st)) return 'an unreadable strategy'
  const params = isObj(st.params) ? st.params : {}
  const hats = DEPLOYMENTS[SEPOLIA].hats.address.toLowerCase()
  let words = String(st.name)
  if (st.name === SPACE_STRATEGY && typeof params.address === 'string' && params.address.toLowerCase() === hats && tokenOf(params.tokenId) !== null) {
    words = `${SPACE_STRATEGY} of hat ${prettyHatId('0x' + /** @type {bigint} */ (tokenOf(params.tokenId)).toString(16).padStart(64, '0'))} on Hats v1`
  }
  const network = networkOf(st, spaceNetwork)
  if (network !== want) words += ` on network ${network || 'none'}`
  if (st.name === SPACE_STRATEGY && params.decimals !== 0) words += ` with decimals ${String(params.decimals ?? 'none')}`
  return words
}
/** @param {unknown} v @returns {bigint | null} */
const tokenOf = v => { try { return typeof v === 'string' && v !== '' ? BigInt(v) : typeof v === 'number' ? BigInt(v) : null } catch { return null } }

/** The same strategy: its name and the network it counts on (its own, else the found space's; fix I-1), and for
 *  erc1155-balance-of its contract, token id and decimals.
 * @param {unknown} found @param {unknown} foundNetwork @param {SpaceStrategy} want */
function sameStrategy(found, foundNetwork, want) {
  if (!isObj(found) || found.name !== want.name || networkOf(found, foundNetwork) !== want.network) return false
  if (want.name !== SPACE_STRATEGY) return true
  const params = isObj(found.params) ? found.params : {}
  return typeof params.address === 'string' && params.address.toLowerCase() === String(want.params.address).toLowerCase()
    && tokenOf(params.tokenId) === tokenOf(want.params.tokenId)
    && params.decimals === want.params.decimals
}

/** The voting keys the hub is asked for (server/deploy/state.ts SPACE_QUERY) and compared where the draft sets them; a
 *  number the hub leaves unset reads as 0 (Snapshot's default). */
export const SPACE_VOTING = /** @type {const} */ (['delay', 'period', 'type', 'quorum'])
/** @param {unknown} v */
const shown = v => (v === null || v === undefined || v === '' ? 'none' : String(v))

/** What the hub's space holds against the draft (spec §9: the composed name, network and strategies; final L7 review
 * M-1: who may propose, `filters.onlyMembers` and `filters.minScore`, which the draft always sets, and the `admins` and
 * the `voting` keys of SPACE_VOTING where the draft sets them). [] when it matches.
 * @param {SpaceSettingsDraft} draft @param {FoundSpace} found @returns {string[]} */
export function spaceDiffers(draft, found) {
  const out = []
  const want = draft.settings
  if (found.name !== want.name) out.push(`the space on the Snapshot hub is named "${String(found.name ?? '')}", not "${want.name}"`)
  if (String(found.network ?? '') !== want.network) out.push(`the space on the Snapshot hub votes on network ${String(found.network ?? 'none')}, not ${want.network} (Sepolia)`)
  const strategies = Array.isArray(found.strategies) ? found.strategies : []
  if (strategies.length !== want.strategies.length || !want.strategies.every((w, i) => sameStrategy(strategies[i], found.network, w))) {
    const words = (/** @type {unknown[]} */ list, /** @type {unknown} */ net) => list.map(st => strategyWords(st, net, want.network)).join(', ')
    out.push(`the space's strategies are ${strategies.length > 0 ? words(strategies, found.network) : 'none'}, not ${words(want.strategies, want.network)}`)
  }
  const filters = isObj(found.filters) ? found.filters : {}
  if (want.filters.onlyMembers === true && filters.onlyMembers !== true) out.push('the space lets anyone propose, not only its members')
  if (typeof want.filters.minScore === 'number' && Number(filters.minScore ?? 0) !== want.filters.minScore) {
    out.push(`the space asks a proposer for a score of ${shown(filters.minScore)}, not ${want.filters.minScore}`)
  }
  if (Array.isArray(want.admins)) {
    const set = (/** @type {unknown} */ v) => (Array.isArray(v) ? v.map(a => String(a).toLowerCase()).sort() : [])
    if (JSON.stringify(set(found.admins)) !== JSON.stringify(set(want.admins))) {
      const list = (/** @type {unknown} */ v) => (Array.isArray(v) && v.length > 0 ? v.map(String).join(', ') : 'none')
      out.push(`the space's admins are ${list(found.admins)}, not ${list(want.admins)}`)
    }
  }
  if (isObj(want.voting)) {
    const voting = isObj(found.voting) ? found.voting : {}
    for (const key of SPACE_VOTING) {
      if (!Object.hasOwn(want.voting, key)) continue
      const w = want.voting[key]
      const f = voting[key]
      const same = key === 'type' ? shown(f) === shown(w) : Number(f ?? 0) === Number(w ?? 0)
      if (!same) out.push(`the space's voting ${key} is ${shown(f)}, not ${shown(w)}`)
    }
  }
  return out
}

/**
 * The planner's `space` hook (planDeployment's `hooks.space`): step 8, `space:settings`, for each composed space. Its
 * signer is the ENS name's owner, an account, off chain: a ready step carries `draft` and no call.
 * @param {Composition} c @param {ChainState} s @returns {(PlannedStep & { draft?: SpaceSettingsDraft })[]}
 */
export function spaceSteps(c, s) {
  return c.spaces.map(space => {
    /** @type {PlannedStep & { draft?: SpaceSettingsDraft }} */
    const base = { id: 'space:settings', system: space.id, title: SPACE_TITLE, status: 'waits', signer: { kind: 'account' }, predicts: [] }
    const waits = (/** @type {string} */ why) => ({ ...base, waits: why })
    if (space.network !== SEPOLIA) return waits(SEPOLIA_ONLY)
    const refused = spaceStrategyProblems(space)
    if (refused.length > 0) return waits(/** @type {string} */ (refused[0]))
    const counted = strategyHats(space)
    const refs = counted.length > 0 ? counted : [spaceHat(space)]
    if (refs.some(r => !r)) return waits(NO_HAT)
    const read = s.spaces?.[space.id]
    if (!read) return waits('Waits for the Snapshot space to be read.')
    if (read.error !== undefined) return waits(`Waits for the Snapshot hub to answer: ${read.error}`)
    const draft = spaceSettingsDraft(space, c, s)
    const predicts = [{ kind: 'space', value: space.space }]
    if (!draft) return waits(WAITS.top)
    if (read.found) {
      const differs = spaceDiffers(draft, read.found)
      return differs.length > 0 ? { ...base, status: 'mismatch', predicts, differs, draft } : { ...base, status: 'done', predicts }
    }
    // every hat a strategy counts exists (fix I-2)
    for (const ref of /** @type {string[]} */ (refs)) {
      const i = ref.indexOf('/')
      const kid = s.trees[ref.slice(0, i)]?.children[ref.slice(i + 1)]
      if (!kid || kid.details === null) return waits(WAITS.hats)
    }
    return { ...base, status: 'ready', predicts, draft }
  })
}
