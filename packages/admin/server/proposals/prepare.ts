// packages/admin/server/proposals/prepare.ts
//
// *Prepare transaction* on a proposal decided by an outside system (0.6 P2 spec §3.11 "Prepare, then attach"): the
// payload a signer puts in the Safe app, the Safe transaction hash it commits the proposal to, and the link to the app.
// Read only: the Safe's nonce and version are read through the server's SystemReader (the driver's declared host,
// paced, timed out); nothing is posted and nothing is written. Attaching what it gives is a separate act, an `attach`
// event (events.ts), which checks the hash again.
//
// DAO-OS L2: the same route prepares a typed action of any system's driver (`prepareAction`): a hat minted, an owner
// added, a vote drafted. The reader checks the proposal's class and the parameters, runs the driver, and wraps the steps
// a chosen Safe (`via`) signs in Safe transactions. Nothing is signed, sent or written; no lock is taken.

import { HttpError } from '../errors.ts'
import { Refusal } from '../changes/apply.ts'
import { readRegistryOrEmpty } from '../registry.ts'
import type { SystemReader } from '../systems/reader.ts'
import type { PreparedAction, SafePayload, SystemRef, TxInput } from '../systems/driver.ts'
import { readLedger } from './ledger.ts'
import { methodOf } from '../../lib/proposals.mjs'

/** What prepare reads with: the server's SystemReader, or a test's stand-in. */
export type PrepareSource = Pick<SystemReader, 'prepare'>

/** What POST …/prepare answers. `ref` is what an `attach` records. */
export interface PrepareResult { payload: SafePayload; safeTxHash: string; appLink: string; ref: SystemRef }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const SHAPE = 'The body must be {"to": "0x…", "value": "<base units, decimal>", "data"?: "0x…", "operation": 0 | 1, "chain"?: "<CAIP-2>"}'
const ACTION_SHAPE = 'An action body is {"system": "<id in data/systems.yaml>", "action": "<the action\'s id>", "params": {…}, "via"?: "<id of a Safe in data/systems.yaml>"}'

/** The body of POST …/prepare, or a 400 that says what it must be. The hash function checks the values themselves. */
export function readTxInput(body: unknown): TxInput {
  if (!isObject(body) || typeof body.to !== 'string') throw new HttpError(400, `${SHAPE}; "to" is missing.`)
  if (typeof body.value !== 'string') throw new HttpError(400, `${SHAPE}; "value" is not text.`)
  if (body.data !== undefined && typeof body.data !== 'string') throw new HttpError(400, `${SHAPE}; "data" is not text.`)
  if (body.operation !== 0 && body.operation !== 1) throw new HttpError(400, `${SHAPE}; "operation" is not 0 or 1.`)
  return { to: body.to, value: body.value, data: body.data ?? '0x', operation: body.operation }
}

/** A typed action, as POST …/prepare takes it. */
export interface ActionBody { system: string; action: string; params: Record<string, unknown>; via?: string }

/** What POST …/prepare was sent: 0.6's transaction (with the chain it is for, absent: the record's), or an action. A body
 *  with "system" or "action" is an action; one that is both, or neither in its shape, is a 400 that says what it must be. */
export type PrepareBody = { kind: 'tx'; tx: TxInput; chain?: string } | { kind: 'action'; action: ActionBody }

export function readPrepareBody(body: unknown): PrepareBody {
  if (isObject(body) && (body.system !== undefined || body.action !== undefined)) {
    if (body.to !== undefined) throw new HttpError(400, `${ACTION_SHAPE}, or a transaction; not both: "to" is a transaction's.`)
    if (typeof body.system !== 'string' || body.system === '') throw new HttpError(400, `${ACTION_SHAPE}; "system" is missing.`)
    if (typeof body.action !== 'string' || body.action === '') throw new HttpError(400, `${ACTION_SHAPE}; "action" is missing.`)
    if (body.params !== undefined && !isObject(body.params)) throw new HttpError(400, `${ACTION_SHAPE}; "params" is not an object.`)
    if (body.via !== undefined && (typeof body.via !== 'string' || body.via === '')) throw new HttpError(400, `${ACTION_SHAPE}; "via" is not a system id.`)
    return { kind: 'action', action: {
      system: body.system, action: body.action, params: (body.params as Record<string, unknown> | undefined) ?? {},
      ...(body.via !== undefined ? { via: body.via as string } : {}),
    } }
  }
  const tx = readTxInput(body)
  const chain = (body as Record<string, unknown>).chain
  if (chain !== undefined && typeof chain !== 'string') throw new HttpError(400, `${SHAPE}; "chain" is not text.`)
  return { kind: 'tx', tx, ...(chain !== undefined ? { chain } : {}) }
}

/**
 * Prepare the transaction `tx` for proposal `id`. 404 for a proposal not in the ledger; 409, in words, for one that
 * waits on no outside system, or whose system is not a Safe in data/systems.yaml, or that the driver refuses (a
 * proposal that is not of class treasury, a Safe older than 1.3.0 or of a version it does not say); 502 when the Safe
 * could not be read.
 */
export async function prepare(repo: string, id: string, tx: TxInput, systems: PrepareSource | undefined, chain?: string): Promise<PrepareResult> {
  const entry = readLedger(repo).entries.find(e => String(e.id) === id)
  if (!entry) throw new HttpError(404, `The ledger has no proposal ${id}.`)
  const refuse = (error: string) => new Refusal(409, { code: 'NOT_PREPARED', error: `Not prepared: ${error}` })
  const waits = [...new Set(entry.rules.filter(r => methodOf(r) === 'system').map(r => String(r.decide?.system)))]
  if (waits.length === 0) throw refuse(`proposal ${id} waits on no outside system; its rules are decided by people.`)
  const systemId = waits[0]!
  const system = (readRegistryOrEmpty(repo, 'systems').entries ?? []).find(s => isObject(s) && String(s.id) === systemId)
  if (!system) throw refuse(`data/systems.yaml has no system "${systemId}".`)
  if (system.driver !== 'safe') throw refuse(`"${systemId}" is not a Safe (data/systems.yaml gives it no safe driver), so the platform prepares no transaction for it.`)
  if (!systems) throw new HttpError(502, 'Not prepared: this server was given no network access, so the Safe\'s nonce cannot be read.')
  const prepared = await systems.prepare(system, { proposal: { classes: entry.classes ?? [] }, tx, ...(chain !== undefined ? { chain } : {}) })
  if (!prepared.ok) {
    if ('failed' in prepared) throw new HttpError(502, `Not prepared: the Safe could not be read (${prepared.error}). Nothing was sent; try again.`)
    throw refuse(prepared.error.replace(/^Not prepared: /, ''))
  }
  return { payload: prepared.payload, safeTxHash: prepared.ref.id, appLink: prepared.link, ref: prepared.ref }
}

/** What an action is prepared with: the server's SystemReader, or a test's stand-in. */
export type ActionSource = Pick<SystemReader, 'prepareAction'>

/** A sentence ends once. */
const sentence = (text: string) => text.replace(/[.\s]+$/, '') + '.'

/**
 * Prepare the typed action `body` for proposal `id` (DAO-OS L2): `system` and `via` are ids in data/systems.yaml. 404 for
 * a proposal not in the ledger; 409 `NOT_PREPARED`, in words, for an id data/systems.yaml does not hold and for whatever
 * the reader or the driver refuses (an action of another class than the proposal's, a parameter that is wrong, a hat the
 * Safe is no admin of); 502 when a system could not be read. Answers the PreparedAction's ok form. Reads only: nothing is
 * signed, sent or written, and no lock is taken.
 */
export async function prepareAction(repo: string, id: string, body: ActionBody, systems: ActionSource | undefined): Promise<Extract<PreparedAction, { ok: true }>> {
  const entry = readLedger(repo).entries.find(e => String(e.id) === id)
  if (!entry) throw new HttpError(404, `The ledger has no proposal ${id}.`)
  const refuse = (error: string) => new Refusal(409, { code: 'NOT_PREPARED', error: `Not prepared: ${sentence(error)}` })
  const records = (readRegistryOrEmpty(repo, 'systems').entries ?? []).filter(isObject)
  const system = records.find(s => String(s.id) === body.system)
  if (!system) throw refuse(`data/systems.yaml has no system "${body.system}"`)
  const via = body.via === undefined ? null : records.find(s => String(s.id) === body.via)
  if (via === undefined) throw refuse(`data/systems.yaml has no system "${body.via}" to sign with (via)`)
  const failed = (why: string) => new HttpError(502, `Not prepared: ${body.system} could not be read (${why}). Nothing was sent; try again.`)
  if (!systems) throw failed('this server was given no network access')
  const prepared = await systems.prepareAction(system, { proposal: { classes: entry.classes ?? [] }, action: body.action, params: body.params }, via)
  if (!prepared.ok) {
    // A Safe transaction the via Safe could not hash (safe.ts prepareSafeTx) already says "Not prepared:"; say it once.
    const error = prepared.error.replace(/^Not prepared: /, '')
    if (prepared.failed) throw failed(error)
    throw refuse(error)
  }
  return prepared
}
