import { addressOf, caip10, isAddress, parseCaip10 } from '../../lib/caip.mjs'
import { decodeResult } from '../../lib/abi.mjs'
import { HATS_V1, VIEW_HAT_TYPES, adminOf, childHatId, hatLevel, hatRef, hatsCall, inTree, normalHatId, parseHatRef, prettyHatId, topHatId, treeIdOf, treeRef } from '../../lib/hats.mjs'
import { TEXT_MAX } from './actions.ts'
import { CHAINS, chainIdNumber, chainInfo } from './chains.ts'
import { isForeignRef, type ActionInput, ActionSpec, Driver, DriverContext, DriverRead, DriverSection, ForeignRef, OutcomeReading, OutcomeRef, PreparedAction, PreparedStep } from './driver.ts'
import { ethCalls, type CallResult, type EthCall } from './wire.ts'
import { shortAddress, signerName } from './safe.ts'

/** A tree with more hats than this is a failed read: a bigger one is a different tool's job. */
export const HATS_MAX = 256
/** Pages of holders followed per hat (the explorer's pages are 50 long). */
export const HOLDER_PAGES = 4
/** Once this long has passed since a read began, no more holder lists are fetched (the Hats read has 20 s; the explorer is paced). */
export const HOLDERS_BUDGET_MS = 12_000

const ZERO = '0x0000000000000000000000000000000000000000'
const DETAILS_SHOWN = 60
const SHOWN_HOLDERS = 3

export interface HatFact {
  /** The hat ref (`eip155:<n>:0x<64 hex>`). */
  id: string; pretty: string; admin: string | null; level: number; details: string; imageURI: string
  maxSupply: number; supply: number
  /** CAIP-10, null for the zero address. */
  eligibility: string | null; toggle: string | null
  mutable: boolean; active: boolean; lastHatId: number
  /** CAIP-10; null: the chain has no explorer to ask. */
  holders: string[] | null
  /** false: the list was cut (pages remained after HOLDER_PAGES) or is not known (null). */
  holdersComplete: boolean
}
export interface WearerReading { ok: true; system: string; chain: string; account: string; hats: string[]; block: number; readAt: string }
export interface WearersReading { ok: true; system: string; hat: string; wearers: string[]; holders: string[]; complete: boolean; block: number; readAt: string }

const hostsOf = (): string[] => [...new Set(Object.values(CHAINS).flatMap(c => [c.rpc, c.explorer]).filter((h): h is string => !!h))]

/** The tree a system record names, or the sentence that says what is wrong. Nothing is requested. */
function treeOf(system: Record<string, unknown>): { chain: string; treeId: number; name: string; explorer: string | null; id: string } {
  const chain = String(system.chain)
  const info = chainInfo(chain)
  if (!info) throw new Error(`a Hats tree is read on chains this Hub knows (${Object.keys(CHAINS).join(', ')}); ${chain} is not one of them`)
  if (!info.rpc) throw new Error(`no RPC host is known for ${info.name}, so its Hats tree cannot be read`)
  const treeId = treeIdOf(system.address)
  if (treeId === null) throw new Error(`${JSON.stringify(system.address)} is not a Hats tree id (a number from 1 to 4294967295, "13" or "0x0000000d")`)
  return { chain, treeId, name: info.name, explorer: info.explorer, id: String(system.id) }
}

const holderCaip = (chain: string, hash: string): string => caip10(chain, hash.toLowerCase())

/** The explorer's holders of one hat, following `next_page_params` up to HOLDER_PAGES pages. `more`: pages remained. */
async function holdersOf(ctx: DriverContext, chain: string, explorer: string, hatId: string): Promise<{ holders: string[]; more: boolean }> {
  const base = `https://${explorer}/api/v2/tokens/${HATS_V1}/instances/${BigInt(hatId).toString()}/holders`
  const holders: string[] = []
  let query = ''
  for (let page = 0; page < HOLDER_PAGES; page++) {
    const answer = (await ctx.fetchJson(base + query)) as { items?: { address?: { hash?: unknown } }[]; next_page_params?: Record<string, unknown> | null } | null
    if (!answer || !Array.isArray(answer.items)) throw new Error(`${explorer} answered no list of holders for the hat ${prettyHatId(hatId)}`)
    for (const item of answer.items) {
      const hash = item?.address?.hash
      if (typeof hash !== 'string' || !isAddress(hash.toLowerCase())) throw new Error(`${explorer} listed a holder of ${prettyHatId(hatId)} that is not an address`)
      const account = holderCaip(chain, hash)
      if (!holders.includes(account)) holders.push(account)
    }
    const next = answer.next_page_params
    if (!next || typeof next !== 'object' || Object.keys(next).length === 0) return { holders, more: false }
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(next)) if (v !== null && v !== undefined) params.set(k, String(v))
    query = `?${params.toString()}`
  }
  return { holders, more: true }
}

function decodeView(chain: string, hatId: string, r: CallResult): Omit<HatFact, 'holders' | 'holdersComplete'> {
  const pretty = prettyHatId(hatId)
  if (!r.ok) throw new Error(`the hat ${pretty} could not be read (${r.error})`)
  let v: unknown[]
  try { v = decodeResult(VIEW_HAT_TYPES, r.data) } catch (err) { throw new Error(`the hat ${pretty} was answered in a shape this Hub does not read (${err instanceof Error ? err.message : String(err)})`) }
  const module = (a: unknown) => (typeof a === 'string' && a.toLowerCase() !== ZERO ? caip10(chain, a) : null)
  const admin = adminOf(hatId)
  return {
    id: hatRef(chain, hatId), pretty, admin: admin === null ? null : hatRef(chain, admin), level: hatLevel(hatId),
    details: String(v[0]), imageURI: String(v[5]), maxSupply: Number(v[1]), supply: Number(v[2]),
    eligibility: module(v[3]), toggle: module(v[4]), mutable: v[7] === true, active: v[8] === true, lastHatId: Number(v[6]),
  }
}

const summary = (holders: string[] | null, complete: boolean, chain: string, members: Record<string, unknown>[]): string => {
  if (!holders || holders.length === 0) return '—'
  const names = holders.slice(0, SHOWN_HOLDERS).map(h => { const a = addressOf(h); return signerName(a, chain, members) ?? shortAddress(a) })
  const more = complete ? '' : ' or more'
  return holders.length > SHOWN_HOLDERS ? `${names.join(', ')} +${holders.length - SHOWN_HOLDERS}${more}` : `${names.join(', ')}${more}`
}
const cut = (text: string): string => (text.length > DETAILS_SHOWN ? `${text.slice(0, DETAILS_SHOWN - 1)}…` : text)

const ADMIN_PARAM = { name: 'admin', label: 'Parent hat', type: 'hat' } as const
const HAT_PARAM = { name: 'hat', label: 'Hat', type: 'hat' } as const
const DETAILS_PARAM = { name: 'details', label: 'Details', type: 'text' } as const

/** What the wearers of a hat's admin can do to the tree, each one call to Hats v1 (spec Q-L2-2 / ruling K1: class governance). */
export const HATS_ACTIONS: ActionSpec[] = [
  { id: 'mint-hat', label: 'Give a hat to someone', class: 'governance', params: [HAT_PARAM, { name: 'wearer', label: 'Wearer', type: 'address' }] },
  { id: 'transfer-hat', label: 'Move a hat from one wearer to another', class: 'governance',
    params: [HAT_PARAM, { name: 'from', label: 'From', type: 'address' }, { name: 'to', label: 'To', type: 'address' }] },
  { id: 'create-child', label: 'Create a hat under another', class: 'governance', params: [
    ADMIN_PARAM, DETAILS_PARAM, { name: 'maxSupply', label: 'Most wearers', type: 'uint' },
    { name: 'eligibility', label: 'Eligibility module', type: 'address' }, { name: 'toggle', label: 'Toggle module', type: 'address' },
    { name: 'mutable', label: 'Can change later ("true" or "false")', type: 'string', optional: true }, { name: 'imageURI', label: 'Image', type: 'string', optional: true }] },
  { id: 'change-details', label: 'Change a hat\'s details', class: 'governance', params: [HAT_PARAM, DETAILS_PARAM] },
]

/** A refusal: the contract would revert (or the platform would not prepare it), said in a sentence. */
class Refusal extends Error {}
const UINT32_MAX = 0xffffffffn
const MAX_CHILD_INDEX = 0xffff
const MAX_HAT_LEVEL = 14

type View = Omit<HatFact, 'holders' | 'holdersComplete'>
const flag = (r: CallResult, what: string): boolean => {
  if (!r.ok) throw new Error(`${what} was refused by the node (${r.error})`)
  return decodeResult(['bool'], r.data)[0] === true
}

/** The hat `value` names, as a ref on this system's chain inside its tree; a refusal if it does not. */
function hatIn(chain: string, treeId: number, value: unknown): { ref: string; id: string; pretty: string } {
  let ref: string
  try { ref = hatOf(chain, treeId, value) } catch (err) { throw new Refusal(err instanceof Error ? err.message : String(err)) }
  const id = parseHatRef(ref)!.hatId
  return { ref, id, pretty: prettyHatId(id) }
}

/** A hat that exists: its view, or a refusal. */
function existing(chain: string, id: string, r: CallResult): View {
  const fact = decodeView(chain, id, r)
  if (fact.maxSupply === 0) throw new Refusal(`${fact.pretty} does not exist (it has not been created)`)
  return fact
}

const app = (chain: string, treeId: number) => `https://app.hatsprotocol.xyz/trees/${chainIdNumber(chain)}/${treeId}`

async function prepareHatsAction(system: Record<string, unknown>, input: ActionInput, ctx: DriverContext): Promise<PreparedAction> {
  const { chain, treeId, id: systemId } = treeOf(system)
  const p = input.params
  const via = input.via ? caip10(chain, addressOf(input.via.account)) : null
  const who = (a: unknown) => addressOf(String(a))
  const short = (a: string) => shortAddress(addressOf(a))
  const notAdmin = (pretty: string) => new Refusal(`${addressOf(via!)} is not an admin of ${pretty}`)
  const signer = (adminRef: string): PreparedStep['signer'] => (via ? { kind: 'safe', account: via } : { kind: 'wearer', hat: adminRef })
  const done = (action: string, call: PreparedStep['call'], adminRef: string, attach: ForeignRef): PreparedAction => ({
    ok: true, action, steps: [{ call, signer: signer(adminRef), safe: null }], draft: null, link: app(chain, treeId), attach,
  })
  const wearerRef = (hatRef_: string, account: string): ForeignRef =>
    ({ system: systemId, id: hatRef_, payload: { kind: 'hats-wearer', wearer: caip10(chain, account) } })
  const adminRefOf = (id: string): string => hatRef(chain, adminOf(id) ?? id)

  try {
    switch (input.action) {
      case 'mint-hat': {
        const hat = hatIn(chain, treeId, p.hat), wearer = who(p.wearer)
        const calls: EthCall[] = [
          hatsCall(chain, 'viewHat', [hat.id], `read ${hat.pretty}`), hatsCall(chain, 'isEligible', [wearer, hat.id], `is the account eligible for ${hat.pretty}`),
          hatsCall(chain, 'isWearerOfHat', [wearer, hat.id], `does the account wear ${hat.pretty}`),
          ...(via ? [hatsCall(chain, 'isAdminOfHat', [addressOf(via), hat.id], `is the signer an admin of ${hat.pretty}`)] : []),
        ]
        const { results } = await ethCalls(ctx, chain, calls)
        const fact = existing(chain, hat.id, results[0]!)
        if (!fact.active) throw new Refusal(`${hat.pretty} is not active`)
        if (fact.supply >= fact.maxSupply) throw new Refusal(`${hat.pretty} has all of its ${fact.maxSupply} hats worn`)
        if (!flag(results[1]!, `isEligible for ${hat.pretty}`)) throw new Refusal(`${short(wearer)} is not eligible for ${hat.pretty}`)
        // eligible and active are checked above, so isWearerOfHat equals the stored balance mintHat checks (Hats.sol @ cccb71a, line 258).
        if (flag(results[2]!, `isWearerOfHat for ${hat.pretty}`)) throw new Refusal(`${short(wearer)} already wears ${hat.pretty}`)
        if (via && !flag(results[3]!, `isAdminOfHat for ${hat.pretty}`)) throw notAdmin(hat.pretty)
        return done('mint-hat', hatsCall(chain, 'mintHat', [hat.id, wearer], `mint ${hat.pretty} to ${short(wearer)}`), adminRefOf(hat.id), wearerRef(hat.ref, wearer))
      }
      case 'transfer-hat': {
        const hat = hatIn(chain, treeId, p.hat), from = who(p.from), to = who(p.to)
        const calls: EthCall[] = [
          hatsCall(chain, 'viewHat', [hat.id], `read ${hat.pretty}`), hatsCall(chain, 'isWearerOfHat', [from, hat.id], `does the sender wear ${hat.pretty}`),
          hatsCall(chain, 'isEligible', [from, hat.id], `is the sender eligible for ${hat.pretty}`),
          hatsCall(chain, 'isWearerOfHat', [to, hat.id], `does the receiver wear ${hat.pretty}`), hatsCall(chain, 'isEligible', [to, hat.id], `is the receiver eligible for ${hat.pretty}`),
          ...(via ? [hatsCall(chain, 'isAdminOfHat', [addressOf(via), hat.id], `is the signer an admin of ${hat.pretty}`)] : []),
        ]
        const { results } = await ethCalls(ctx, chain, calls)
        const fact = existing(chain, hat.id, results[0]!)
        if (!fact.active) throw new Refusal(`${hat.pretty} is not active`)
        if (fact.level > 0 && !fact.mutable) throw new Refusal(`${hat.pretty} is immutable, so it cannot be transferred`)
        // transferHat checks the stored balance of `from` (Hats.sol @ cccb71a, line 561: admins may move a revoked hat), and no public
        // function reads it: ERC1155._balanceOf is internal and Hats.balanceOf is gated by active and eligible. For an active hat and an
        // eligible `from`, isWearerOfHat equals the stored balance, so only then is "does not wear" certain; an ineligible `from` is let through.
        const fromWears = flag(results[1]!, `isWearerOfHat for ${hat.pretty}`), fromEligible = flag(results[2]!, `isEligible for ${hat.pretty}`)
        if (!fromWears && fromEligible) throw new Refusal(`${short(from)} does not wear ${hat.pretty}`)
        // `to`: the hat is active and `to` must be eligible, so isWearerOfHat is the stored balance here as well.
        if (flag(results[3]!, `isWearerOfHat for ${hat.pretty}`)) throw new Refusal(`${short(to)} already wears ${hat.pretty}`)
        if (!flag(results[4]!, `isEligible for ${hat.pretty}`)) throw new Refusal(`${short(to)} is not eligible for ${hat.pretty}`)
        if (via && !flag(results[5]!, `isAdminOfHat for ${hat.pretty}`)) throw notAdmin(hat.pretty)
        const summary = `transfer ${hat.pretty} from ${short(from)} to ${short(to)}` + (fromWears ? '' : `; the contract checks ${short(from)}'s stored balance`)
        return done('transfer-hat', hatsCall(chain, 'transferHat', [hat.id, from, to], summary), adminRefOf(hat.id), wearerRef(hat.ref, to))
      }
      case 'create-child': {
        const admin = hatIn(chain, treeId, p.admin)
        const eligibility = who(p.eligibility), toggle = who(p.toggle)
        if (eligibility.toLowerCase() === ZERO) throw new Refusal('"eligibility" is the zero address; the contract refuses a hat with no eligibility module')
        if (toggle.toLowerCase() === ZERO) throw new Refusal('"toggle" is the zero address; the contract refuses a hat with no toggle module')
        const details = String(p.details)
        if (Buffer.byteLength(details, 'utf8') > TEXT_MAX) throw new Refusal(`"details" is ${Buffer.byteLength(details, 'utf8')} bytes; at most ${TEXT_MAX}`)
        const supply = BigInt(String(p.maxSupply))
        if (supply < 1n) throw new Refusal('"maxSupply" must be at least 1: a hat with no room for a wearer reads as not created')
        if (supply > UINT32_MAX) throw new Refusal(`"maxSupply" is ${supply}; a hat holds at most ${UINT32_MAX}`)
        const mutable = p.mutable === undefined ? 'true' : String(p.mutable)
        if (mutable !== 'true' && mutable !== 'false') throw new Refusal(`"mutable" is ${JSON.stringify(mutable)}; it is "true" or "false"`)
        if (hatLevel(admin.id) >= MAX_HAT_LEVEL) throw new Refusal(`${admin.pretty} is at level ${MAX_HAT_LEVEL} and cannot have children`)
        const { results } = await ethCalls(ctx, chain, [hatsCall(chain, 'viewHat', [admin.id], `read ${admin.pretty}`)])
        const fact = existing(chain, admin.id, results[0]!)
        if (fact.lastHatId >= MAX_CHILD_INDEX) throw new Refusal(`${admin.pretty} has no room for another child (65535 are made)`)
        const child = childHatId(admin.id, fact.lastHatId + 1)
        const pretty = prettyHatId(child)
        if (via) {
          const second = await ethCalls(ctx, chain, [hatsCall(chain, 'isAdminOfHat', [addressOf(via), child], `is the signer an admin of ${pretty}`)])
          if (!flag(second.results[0]!, `isAdminOfHat for ${pretty}`)) throw notAdmin(pretty)
        }
        const call = hatsCall(chain, 'createHat', [admin.id, details, Number(supply), eligibility, toggle, mutable === 'true', p.imageURI === undefined ? '' : String(p.imageURI)], `create hat ${pretty} under ${admin.pretty}`)
        return done('create-child', call, admin.ref, { system: systemId, id: hatRef(chain, child), payload: { kind: 'hats-hat', details } })
      }
      case 'change-details': {
        const hat = hatIn(chain, treeId, p.hat), details = String(p.details)
        const calls: EthCall[] = [
          hatsCall(chain, 'viewHat', [hat.id], `read ${hat.pretty}`),
          ...(via ? [hatsCall(chain, 'isAdminOfHat', [addressOf(via), hat.id], `is the signer an admin of ${hat.pretty}`)] : []),
        ]
        const { results } = await ethCalls(ctx, chain, calls)
        const fact = existing(chain, hat.id, results[0]!)
        if (fact.level > 0 && !fact.mutable) throw new Refusal(`${hat.pretty} is immutable, so its details cannot change`)
        if (fact.details === details) throw new Refusal(`${hat.pretty} already reads these details`)
        if (via && !flag(results[1]!, `isAdminOfHat for ${hat.pretty}`)) throw notAdmin(hat.pretty)
        return done('change-details', hatsCall(chain, 'changeHatDetails', [hat.id, details], `change the details of ${hat.pretty}`), adminRefOf(hat.id),
          { system: systemId, id: hat.ref, payload: { kind: 'hats-hat', details, existing: true } })
      }
      default:
        return { ok: false, error: `the hats-tree driver has no action "${input.action}" (its actions: ${HATS_ACTIONS.map(a => a.id).join(', ')})` }
    }
  } catch (err) {
    if (err instanceof Refusal) return { ok: false, error: err.message }
    throw err
  }
}

/** The ref an author attaches, checked with no network: this system, a hat of its tree on its chain, a payload this driver reads. */
function checkHatsRef(system: Record<string, unknown>, raw: unknown): { ok: true; ref: ForeignRef } | { ok: false; error: string } {
  const bad = (error: string) => ({ ok: false as const, error })
  try {
    const { chain, treeId, id: systemId } = treeOf(system)
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return bad('a Hats ref is {"system", "id", "payload"}')
    const r = raw as Record<string, unknown>
    if (r.system !== systemId) return bad(`"system" is ${JSON.stringify(r.system)}; this tree is ${JSON.stringify(systemId)}`)
    const parsed = typeof r.id === 'string' ? parseHatRef(r.id) : null
    if (!parsed) return bad(`"id" is not a hat ref (${chain}:0x and 64 hex digits): ${JSON.stringify(r.id)}`)
    const id = hatOf(chain, treeId, r.id)
    const payload = typeof r.payload === 'object' && r.payload !== null && !Array.isArray(r.payload) ? (r.payload as Record<string, unknown>) : null
    if (payload === null) return bad('a Hats ref has a "payload": {"kind": "hats-wearer", "wearer": <CAIP-10>} or {"kind": "hats-hat", "details": <text>}')
    if (payload.kind === 'hats-wearer') {
      const w = typeof payload.wearer === 'string' ? parseCaip10(payload.wearer) : null
      if (!w) return bad(`the wearer must be a CAIP-10 account (${chain}:0x…): ${JSON.stringify(payload.wearer)}`)
      if (w.chain !== chain) return bad(`the wearer is on ${w.chain}; this tree is on ${chain}`)
      return { ok: true, ref: { system: systemId, id, payload: { kind: 'hats-wearer', wearer: caip10(chain, w.address) } } }
    }
    if (payload.kind === 'hats-hat') {
      if (typeof payload.details !== 'string') return bad('the details of a hats-hat payload are text')
      if (payload.existing !== undefined && payload.existing !== true) return bad('"existing" is true or absent')
      return { ok: true, ref: { system: systemId, id, payload: { kind: 'hats-hat', details: payload.details, ...(payload.existing === true ? { existing: true as const } : {}) } } }
    }
    return bad(`a Hats tree attaches a hats-wearer or hats-hat payload, not ${JSON.stringify(payload.kind)}`)
  } catch (err) {
    return bad(err instanceof Error ? err.message : String(err))
  }
}

/** The outcome of a Hats ref: the wearer now wears the hat, or the hat now exists (or reads the new details). */
async function hatsOutcome(system: Record<string, unknown>, ref: OutcomeRef, ctx: DriverContext): Promise<OutcomeReading> {
  if (!isForeignRef(ref) || (ref.payload.kind !== 'hats-wearer' && ref.payload.kind !== 'hats-hat')) {
    throw new Error('a Hats tree reads hats-wearer and hats-hat refs, not a Safe transaction or another system\'s ref')
  }
  const { chain, treeId } = treeOf(system)
  const hat = hatIn(chain, treeId, ref.id)
  const payload = ref.payload
  if (payload.kind === 'hats-wearer') {
    const wearer = addressOf(payload.wearer)
    const { results } = await ethCalls(ctx, chain, [hatsCall(chain, 'isWearerOfHat', [wearer, hat.id], `does the account wear ${hat.pretty}`)])
    return flag(results[0]!, `isWearerOfHat for ${hat.pretty}`)
      ? { ok: true, outcome: 'executed', detail: `${shortAddress(wearer)} wears ${hat.pretty}` }
      : { ok: true, outcome: 'pending', detail: `${shortAddress(wearer)} does not wear ${hat.pretty} yet` }
  }
  const { results } = await ethCalls(ctx, chain, [hatsCall(chain, 'viewHat', [hat.id], `read ${hat.pretty}`)])
  const fact = decodeView(chain, hat.id, results[0]!)
  const same = fact.details === payload.details
  if (payload.existing) {
    return same ? { ok: true, outcome: 'executed', detail: `${hat.pretty} reads the new details` } : { ok: true, outcome: 'pending', detail: `${hat.pretty} still has other details` }
  }
  if (fact.maxSupply === 0) return { ok: true, outcome: 'pending', detail: `${hat.pretty} is not created yet` }
  return same ? { ok: true, outcome: 'executed', detail: `${hat.pretty} exists` } : { ok: true, outcome: 'mismatch', detail: 'another hat took this id; prepare again' }
}

export const hatsTree: Driver = {
  name: 'hats-tree',
  hosts: hostsOf(),
  minGapMs: 250,
  timeoutMs: () => 20_000,
  actions: HATS_ACTIONS,
  prepareAction: prepareHatsAction,
  outcome: (system, ref, ctx) => hatsOutcome(system, ref, ctx),
  checkRef: checkHatsRef,
  async read(system: Record<string, unknown>, ctx: DriverContext): Promise<DriverRead> {
    const { chain, treeId, name, explorer } = treeOf(system)
    const began = ctx.now().getTime()
    const top = topHatId(treeId)
    const hats = new Map<string, Omit<HatFact, 'holders' | 'holdersComplete'>>()
    const children = new Map<string, string[]>()
    let block = 0

    let level = [top]
    while (level.length > 0) {
      const { block: b, results } = await ethCalls(ctx, chain, level.map(id => hatsCall(chain, 'viewHat', [id], `read the hat ${prettyHatId(id)}`)))
      block = b
      const next: string[] = []
      level.forEach((id, i) => {
        const fact = decodeView(chain, id, results[i])
        if (fact.maxSupply === 0) throw new Error(id === top ? `there is no Hats tree ${treeId} on ${name}` : `the hat ${fact.pretty} is listed as a child but reads as not created (max supply 0)`)
        hats.set(id, fact)
        const kids: string[] = []
        if (fact.lastHatId > 0 && fact.level >= 14) throw new Error(`the hat ${fact.pretty} is at level 14 and cannot have children, yet reports ${fact.lastHatId}`)
        for (let n = 1; n <= fact.lastHatId; n++) kids.push(childHatId(id, n))
        children.set(id, kids)
        next.push(...kids)
      })
      if (hats.size + next.length > HATS_MAX) throw new Error(`the tree has more than ${HATS_MAX} hats; the platform reads trees up to ${HATS_MAX}`)
      level = next
    }

    const walk: string[] = []
    const visit = (id: string) => { walk.push(id); for (const k of children.get(id) ?? []) visit(k) }
    visit(top)

    // Holders come from a keyless explorer: a silence there never fails the tree, which the contract already gave.
    const held = new Map<string, { holders: string[]; more: boolean }>()
    const silent = new Set<string>(), unreached = new Set<string>()
    if (explorer) {
      for (const id of walk) {
        if (hats.get(id)!.supply === 0) continue
        if (ctx.now().getTime() - began >= HOLDERS_BUDGET_MS) { unreached.add(id); continue }
        try { held.set(id, await holdersOf(ctx, chain, explorer, id)) } catch (err) {
          if (ctx.timeLeftMs && ctx.timeLeftMs() <= 0) throw err
          silent.add(id)
        }
      }
    }
    const list: HatFact[] = walk.map(id => {
      if (!explorer || silent.has(id) || unreached.has(id)) return { ...hats.get(id)!, holders: null, holdersComplete: false }
      const got = held.get(id)
      return { ...hats.get(id)!, holders: got ? got.holders : [], holdersComplete: got ? !got.more : true }
    })
    const notListed = [
      ...(silent.size > 0 ? [`holders not listed for ${silent.size} hat(s): ${explorer} did not answer`] : []),
      ...(unreached.size > 0 ? [`holders not listed for ${unreached.size} hat(s): the explorer is read at 4 requests a second`] : []),
    ]

    const roles: DriverSection = { title: 'Roles', rows: list.map(h => ({
      cells: [h.pretty, cut(h.details), `${h.supply} of ${h.maxSupply}`, summary(h.holders, h.holdersComplete, chain, ctx.members)],
      ...(h.active && h.supply === 0 ? { attention: 'warn' as const } : {}), refs: [h.id],
    })) }
    const wearers: DriverSection = explorer
      ? { title: 'Wearers', note: [`static holders from ${explorer}; membership is checked on chain`, ...notListed].join('; '), rows: [
          ...list.flatMap(h => (h.holders ?? []).map(holder => {
            const address = addressOf(holder)
            return { cells: [h.pretty, address, signerName(address, chain, ctx.members) ?? '—'], refs: [holder, h.id] }
          })),
          ...notListed.map(text => ({ cells: ['—', text, '—'], attention: 'warn' as const })),
        ] }
      : { title: 'Wearers', note: `wearers are not listed on ${name}: no keyless source answers there`, rows: [] }
    const modules: DriverSection = { title: 'Modules', rows: list.flatMap(h => [
      ...(h.eligibility ? [{ cells: [h.pretty, 'eligibility', shortAddress(addressOf(h.eligibility))], refs: [h.eligibility, h.id] }] : []),
      ...(h.toggle ? [{ cells: [h.pretty, 'toggle', shortAddress(addressOf(h.toggle))], refs: [h.toggle, h.id] }] : []),
    ]) }

    return {
      ok: true, readAt: ctx.now().toISOString(),
      facts: { chain, tree: treeId, ref: treeRef(chain, treeId), topHat: hatRef(chain, top), block, hats: list },
      sections: [roles, wearers, modules],
      open: { url: `https://app.hatsprotocol.xyz/trees/${chainIdNumber(chain)}/${treeId}`, embeddable: false },
    }
  },
}

/** A hat of this tree, as a ref on the system's chain; or the sentence that refuses it. */
function hatOf(chain: string, treeId: number, value: unknown): string {
  const parsed = typeof value === 'string' ? parseHatRef(value) : null
  if (parsed && parsed.chain !== chain) throw new Error(`the hat ${String(value)} is on ${parsed.chain}, not ${chain}`)
  const id = parsed ? parsed.hatId : normalHatId(value)
  if (id === null) throw new Error(`${String(value)} is not a hat (a ref like ${chain}:0x…, or a hat id)`)
  if (!inTree(id, treeId)) throw new Error(`the hat ${prettyHatId(id)} is not in tree ${treeId}`)
  return hatRef(chain, id)
}

function accountOf(value: unknown): string {
  if (typeof value !== 'string') throw new Error('the account is not an address')
  try { return addressOf(value) } catch { throw new Error(`${value} is not an address (0x and 40 hex digits)`) }
}

/** Which of `hats` (hat refs of this tree) `account` wears now: `isWearerOfHat`, which applies eligibility and toggle. */
export async function readWearer(system: Record<string, unknown>, account: string, hats: string[], ctx: DriverContext): Promise<WearerReading> {
  const { chain, treeId, id } = treeOf(system)
  const who = accountOf(account)
  const refs = hats.map(h => hatOf(chain, treeId, h))
  const { block, results } = await ethCalls(ctx, chain, refs.map(h => hatsCall(chain, 'isWearerOfHat', [who, h], `is the account a wearer of ${prettyHatId(parseHatRef(h)!.hatId)}`)))
  return { ok: true, system: id, chain, account: caip10(chain, who), hats: refs.filter((_, i) => wears(results[i], refs[i])), block, readAt: ctx.now().toISOString() }
}

function wears(r: CallResult, ref: string): boolean {
  if (!r.ok) throw new Error(`isWearerOfHat for ${prettyHatId(parseHatRef(ref)!.hatId)} was refused by the node (${r.error})`)
  return decodeResult(['bool'], r.data)[0] === true
}

/** The explorer's holders of `hat`, and which of them wear it now. `complete`: every holder was listed (the chain has an explorer and no page remained). */
export async function readWearers(system: Record<string, unknown>, hat: string, ctx: DriverContext): Promise<WearersReading> {
  const { chain, treeId, explorer, id } = treeOf(system)
  const ref = hatOf(chain, treeId, hat)
  const hatId = parseHatRef(ref)!.hatId
  const listed = explorer ? await holdersOf(ctx, chain, explorer, hatId) : { holders: [] as string[], more: false }
  const { block, results } = await ethCalls(ctx, chain, listed.holders.map(h => hatsCall(chain, 'isWearerOfHat', [addressOf(h), ref], `is the holder a wearer of ${prettyHatId(hatId)}`)))
  return {
    ok: true, system: id, hat: ref, holders: listed.holders, wearers: listed.holders.filter((h, i) => wears(results[i], ref)),
    complete: explorer !== null && !listed.more, block, readAt: ctx.now().toISOString(),
  }
}
