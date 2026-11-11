// packages/admin/server/proposals/watches.ts
//
// What prepare made of an add-role signed by the via Safe (PF-R205; L7 Task 18 review M-1): the Safe transaction's
// data_hash and the hats-role ref read beside it (`watch`). An attach of that transaction must carry exactly that watch,
// and a watch is never taken from the client for a transaction prepare did not make as an add-role, so a forged watch
// can neither hide the tree's reading nor hold another proposal's hat (ATTACHED_ELSEWHERE). Kept in memory, per
// repository, the latest few hundred: prepare writes nothing. After a restart the server knows none, so an attach with a
// watch is refused until the author prepares again (refuse rather than guess).

import type { ForeignRef } from '../systems/driver.ts'
import { readRegistryOrEmpty } from '../registry.ts'
import { decodeResult, selector } from '../../lib/abi.mjs'
import { caip10, sameAccount } from '../../lib/caip.mjs'
import { multiSendCallOnlyOn } from '../../lib/deployments.mjs'
import { HATS_SIGNATURES, HATS_V1, adminOf, hatRef, normalHatId, prettyHatId, treeIdOf } from '../../lib/hats.mjs'
import { decodeMultiSend } from '../../lib/multisend.mjs'

const KEPT = 512
const kept = new Map<string, Map<string, ForeignRef>>()

/** Remember that the Safe transaction whose data hashes to `dataHash` is an add-role whose new hat is `watch`. */
export function keepWatch(repo: string, dataHash: string, watch: ForeignRef): void {
  const mine = kept.get(repo) ?? new Map<string, ForeignRef>()
  kept.set(repo, mine)
  const key = dataHash.toLowerCase()
  mine.delete(key)
  mine.set(key, watch)
  while (mine.size > KEPT) mine.delete(mine.keys().next().value!)
}

/** The watch prepare made for the Safe transaction whose data hashes to `dataHash`, or undefined. */
export function watchOf(repo: string, dataHash: string): ForeignRef | undefined {
  return kept.get(repo)?.get(dataHash.toLowerCase())
}

/** Whether two hats-role refs name the same new hat with the same details and first wearers (ids and accounts without
 *  case, wearers in any order). */
export function sameWatch(a: ForeignRef, b: ForeignRef): boolean {
  const pa = a.payload as { kind: string; details?: unknown; wearers?: unknown }
  const pb = b.payload as { kind: string; details?: unknown; wearers?: unknown }
  const wearers = (p: { wearers?: unknown }) => (Array.isArray(p.wearers) ? p.wearers.map(w => String(w).toLowerCase()).sort() : [])
  return a.system === b.system && String(a.id).toLowerCase() === String(b.id).toLowerCase() && pa.kind === pb.kind &&
    pa.details === pb.details && JSON.stringify(wearers(pa)) === JSON.stringify(wearers(pb))
}

/** What a check says of a Safe transaction that calls Hats, or delegates its call out of sight, and that it cannot read
 *  as one new role (L7 gap B2; the gaps review's M-1). */
export const NOT_ONE_ROLE = (why: string): string =>
  `The Safe transaction may change hats, and the Hub cannot read it as one new role: ${why.replace(/[.\s]+$/, '')}. Prepare it again and attach what it gives.`

const CREATE_HAT = selector(HATS_SIGNATURES.createHat)
const BATCH_MINT = selector(HATS_SIGNATURES.batchMintHats)
const CREATE_TYPES = ['uint256', 'string', 'uint32', 'address', 'address', 'bool', 'string']
const MINT_TYPES = ['uint256[]', 'address[]']

/**
 * L7 gap B2 (closes PF-R225): the add-role a Safe transaction carries, rebuilt from the transaction itself when its
 * attach holds no watch (prepare's memory lost it: evicted, or a restart). `tx` is the transaction as the Safe
 * Transaction Service describes it, its hash already checked against the attach; `chain` is the Safe's. An add-role is
 * what prepare makes (server/systems/hats.ts, add-role through a Safe): a delegatecall to MultiSendCallOnly 1.4.1 whose
 * inner calls are Hats v1 `createHat(admin, details, …)` and then `batchMintHats(ids, wearers)` of the new id to every
 * first wearer. The watch is `{ system: <the tree in data/systems.yaml>, id: <the minted id>, payload: { kind:
 * hats-role, details, wearers } }`, read as a watch is.
 *
 * null: the transaction calls no Hats contract and delegates to nothing but MultiSendCallOnly 1.4.1: a plain Safe
 * transaction, read as the Safe reads it. `{ refused }` (the check reads it as a mismatch in that sentence, never
 * executed): it calls Hats v1 at all, directly or in any inner call, whatever the selector (createHat, batchCreateHats,
 * mintHat…), and is not exactly the add-role bundle; or it delegatecalls anything but MultiSendCallOnly 1.4.1, which could
 * do the same out of sight (the gaps review's M-1); or its bundle cannot be read at all. The bundle's createHat carries
 * what prepare writes (a non-zero eligibility and toggle, room for every first wearer: M-2); that its minted hat is the
 * one createHat makes is checked beside the tree's reading (`besideWatch`, the admin's newest child).
 */
export function addRoleOf(repo: string, chain: string, tx: { to: string; operation: number; data: string | null }): { watch: ForeignRef } | { refused: string } | null {
  const callOnly = multiSendCallOnlyOn(chain)
  if (sameAccount(tx.to, HATS_V1)) return { refused: NOT_ONE_ROLE('it calls Hats v1 directly, and an add-role is one MultiSendCallOnly bundle') }
  if (tx.operation !== 0 && (!callOnly || !sameAccount(tx.to, callOnly))) {
    return { refused: NOT_ONE_ROLE('it delegates its call to a contract other than MultiSendCallOnly 1.4.1, which the Hub does not read') }
  }
  if (tx.operation !== 1 || !tx.data) return null
  let inner: ReturnType<typeof decodeMultiSend>
  try { inner = decodeMultiSend(tx.data) } catch (err) {
    return { refused: NOT_ONE_ROLE(`its MultiSendCallOnly bundle does not read (${err instanceof Error ? err.message : String(err)})`) }
  }
  const onHats = (c: (typeof inner)[number]) => sameAccount(c.to, HATS_V1)
  if (!inner.some(onHats)) return null
  const [make, mint] = inner
  if (inner.length !== 2 || !make || !mint || ![make, mint].every(c => onHats(c) && c.operation === 0 && c.value === '0') ||
    make.data.slice(0, 10).toLowerCase() !== CREATE_HAT || mint.data.slice(0, 10).toLowerCase() !== BATCH_MINT) {
    return { refused: NOT_ONE_ROLE('an add-role is two plain calls to Hats v1, createHat then batchMintHats, and this bundle is not') }
  }
  let admin: string, details: string, supply: number, eligibility: string, toggle: string, ids: string[], wearers: string[]
  try {
    const made = decodeResult(CREATE_TYPES, '0x' + make.data.slice(10)) as unknown[]
    const minted = decodeResult(MINT_TYPES, '0x' + mint.data.slice(10)) as [string[], string[]]
    admin = normalHatId(String(made[0]))!
    details = String(made[1])
    supply = Number(made[2])
    eligibility = String(made[3])
    toggle = String(made[4])
    ;[ids, wearers] = minted
    if (admin === null) throw new Error('its admin is no hat id')
  } catch (err) {
    return { refused: NOT_ONE_ROLE(`its calls do not decode (${err instanceof Error ? err.message : String(err)})`) }
  }
  const id = normalHatId(String(ids[0]))
  if (id === null || ids.length === 0 || wearers.length !== ids.length || ids.some(x => normalHatId(String(x)) !== id)) {
    return { refused: NOT_ONE_ROLE('batchMintHats does not mint one hat to each of its wearers') }
  }
  // M-2: what prepare writes for add-role (server/systems/hats.ts newHat): modules that are not the zero address, room
  // for every first wearer. `mutable` decodes as a bool either way; the image is prepare's input.
  if (/^0x0{40}$/i.test(eligibility) || /^0x0{40}$/i.test(toggle)) return { refused: NOT_ONE_ROLE('its createHat names the zero address as a module, which prepare never writes') }
  if (!(supply >= wearers.length)) return { refused: NOT_ONE_ROLE(`its createHat makes room for ${supply}, and it mints to ${wearers.length}`) }
  if (adminOf(id) !== admin) return { refused: NOT_ONE_ROLE(`it mints ${prettyHatId(id)}, which is no child of ${prettyHatId(admin)}, the admin createHat makes a hat under`) }
  const treeId = Number(BigInt(id) >> 224n)
  const tree = (readRegistryOrEmpty(repo, 'systems').entries ?? []).find(s => typeof s === 'object' && s !== null &&
    (s as Record<string, unknown>).kind === 'hats-tree' && (s as Record<string, unknown>).chain === chain && treeIdOf((s as Record<string, unknown>).address as string) === treeId) as Record<string, unknown> | undefined
  if (!tree) return { refused: NOT_ONE_ROLE(`its new hat ${prettyHatId(id)} is in a tree data/systems.yaml does not hold on ${chain}`) }
  return { watch: { system: String(tree.id), id: hatRef(chain, id), payload: { kind: 'hats-role', details, wearers: wearers.map(w => caip10(chain, w)) } } }
}
