// A node adds or withdraws its own network account (refi-dao-os network app spec §5.4, §5.7; plan task B5).
//
// "Add your node" is its own OAuth round-trip (B2, purpose `add-node`) whose only use is proving control of the node's
// account: it never creates or changes a session (a signed-in person stays who they were; a signed-out lead is not
// signed in by it, and no Guest is recorded). Then, in order:
//   - only a node already on the network (a local node in data/kb/organization.yaml) takes an account;
//   - an account linked to a person (B4) is never a node's;
//   - an account live for another node is refused: one account holds one node;
//   - the two-way check (check.ts, the port of check-network.mjs) must pass;
//   - the match rule (A2, match.ts) decides: a match goes live with its `why`; anything else is pending for a steward,
//     never shown, and does not block the node. A node that already has a live account takes no other until that one
//     is removed: a new attempt is held as pending with that note, even when it matches.
// Going live closes the node's other pending accounts and this account's pending claims on other nodes.
// "Remove our account" (purpose `withdraw-node`) is the same round-trip as the node's own account: it drops at once.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Context } from 'hono'
import { parse as parseYaml } from 'yaml'
import type { NetworkEntry, PrivateStore } from '../private/store.ts'
import { HANDLE_INVALID, type IdentityHandler } from '../session/atproto.ts'
import { matchesNode, type Known, type OrgLinks } from './match.ts'
import { checkAccount, resolveHandle as resolveByProtocol, type CheckResult } from './check.ts'

export const ADDED = (handle: string, node: string) => `Added. ${handle} is ${node}'s account on the ReFi DAO Network now.`
export const ALREADY = (handle: string, node: string) => `${handle} is already ${node}'s account on the ReFi DAO Network. Nothing changed.`
export const PENDING = 'Thanks. A steward will confirm this with your node through a channel already on its page, usually within a few days.'
export const PENDING_HELD = (node: string) => `Thanks. ${node} already has an account on the ReFi DAO Network, and a node holds one. This one waits: `
  + 'a steward will confirm with your node through a channel already on its page once the current account is removed.'
/** Kept privately with a pending entry held because its node already has a live account (stewards see it, B6). */
export const HELD_NOTE = 'the node already has a live account'
export const NODE_UNKNOWN = 'That node is not on the ReFi DAO Network yet. A new node joins through the Local Node form first. Nothing was added.'
export const NODE_PERSON = 'This account is linked to a person in this Hub, and a person\'s account is never a node\'s. Sign in with the node\'s own account. Nothing was added.'
export const NODE_TAKEN = 'This account is already another node\'s account on the ReFi DAO Network, and an account holds one node. Nothing was added.'
export const CHECK_FAILED = (reason: string) => `This account's handle does not check out both ways (${reason}). Nothing was added.`
export const WITHDRAWN = (handle: string, node: string) => `Removed. ${handle} is no longer ${node}'s account on the ReFi DAO Network.`
export const NOT_ON = (node: string) => `This account is not ${node}'s account on the ReFi DAO Network. Nothing was removed.`
const NO_NODE = 'This sign-in did not say which node it was for. Start again from the node\'s page.'

export interface NodeRecord extends OrgLinks { title: string }

function readYamlMap(file: string): Record<string, unknown> | null {
  try {
    const doc: unknown = parseYaml(readFileSync(file, 'utf8'))
    return doc && typeof doc === 'object' && !Array.isArray(doc) ? doc as Record<string, unknown> : null
  } catch { return null }
}
const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** A local node of the organization registry (data/kb/organization.yaml, `org_type: local-node`): its title, website
 *  and links; anything else (another kind of organization, no such id, an unreadable file) is null. */
export function readNode(repo: string, id: string): NodeRecord | null {
  const entries = readYamlMap(join(repo, 'data', 'kb', 'organization.yaml'))?.entries
  const e = isMap(entries) && Object.hasOwn(entries, id) ? entries[id] : null
  if (!isMap(e) || e.org_type !== 'local-node') return null
  const links = isMap(e.links) ? Object.fromEntries(Object.entries(e.links).filter(([, v]) => typeof v === 'string')) as Record<string, string> : null
  return { title: typeof e.title === 'string' && e.title.trim() !== '' ? e.title : id, url: typeof e.url === 'string' ? e.url : null, links }
}

/** The node's Dec 9 entry in data/nodes/network.yaml (its DID and check), or null. */
export function readKnown(repo: string, id: string): Known {
  const nodes = readYamlMap(join(repo, 'data', 'nodes', 'network.yaml'))?.nodes
  const e = isMap(nodes) && Object.hasOwn(nodes, id) ? nodes[id] : null
  if (!isMap(e) || typeof e.did !== 'string' || (e.check !== 'pass' && e.check !== 'fail')) return null
  return { did: e.did, check: e.check }
}

export interface EntryDeps {
  store: PrivateStore
  /** The instance repository: its organization registry and its Dec 9 network entries. */
  repo: string
  /** The two-way check; default check.ts `checkAccount` over the network. */
  check?: (rec: { handle: string; did: string }) => Promise<CheckResult>
  /** Resolves a handle on the node's own profile link (the match rule's `record`); default the protocol's resolution. */
  resolveHandle?: (handle: string) => Promise<string | null>
  now?: () => Date
  newId?: () => string
}

/** The `add-node` purpose's handler. Answers in a sentence; sets no cookie. */
export function addNodeAccount(d: EntryDeps): IdentityHandler {
  const now = d.now ?? (() => new Date())
  const newId = d.newId ?? (() => `ne-${randomUUID()}`)
  const check = d.check ?? (rec => checkAccount(rec))
  const resolveHandle = d.resolveHandle ?? (h => resolveByProtocol(h))
  return async (c: Context, who) => {
    if (!who.node) return c.text(NO_NODE, 400)
    const node = readNode(d.repo, who.node)
    if (!node) return c.text(NODE_UNKNOWN, 404)
    if (d.store.accountLink(who.did)) return c.text(NODE_PERSON, 409)
    const liveElsewhere = () => d.store.networkEntries('live').find(e => e.did === who.did && e.node !== who.node)
    if (liveElsewhere()) return c.text(NODE_TAKEN, 409)
    if (who.handle === HANDLE_INVALID) return c.text(CHECK_FAILED('the account has no checked handle'), 422)

    const checked = await check({ handle: who.handle, did: who.did })
    if (checked.check !== 'pass') return c.text(CHECK_FAILED(checked.reason ?? 'the check did not pass'), 422)
    const handle = checked.handle
    const match = await matchesNode({ did: who.did, handle }, node, readKnown(d.repo, who.node), { resolveHandle })

    // The store as it is now, after the network calls: the decision and the write follow without another wait.
    if (liveElsewhere()) return c.text(NODE_TAKEN, 409)
    const entries = d.store.networkEntries()
    const nodeLive = entries.find(e => e.state === 'live' && e.node === who.node)
    if (nodeLive?.did === who.did) return c.text(ALREADY(nodeLive.handle, node.title), 200)
    const at = now()
    const entry = (state: NetworkEntry['state'], why: NetworkEntry['why'], reason: string | null): NetworkEntry => ({
      id: newId(), did: who.did, node: who.node!, handle, on: checked.on, state, why, added: at.toISOString(), addedBy: who.by ?? who.did,
      check: 'pass', checkedOn: at.toISOString().slice(0, 10), reason, channel: null,
    })
    const pendingHere = entries.some(e => e.state === 'pending' && e.node === who.node && e.did === who.did)
    if (nodeLive) {
      if (!pendingHere) await d.store.putNetworkEntry(entry('pending', null, HELD_NOTE))
      return c.text(PENDING_HELD(node.title), 202)
    }
    if (!match.match) {
      if (!pendingHere) await d.store.putNetworkEntry(entry('pending', null, null))
      return c.text(PENDING, 202)
    }
    await d.store.putNetworkEntry(entry('live', match.why, null))
    for (const e of entries) {
      if (e.state !== 'pending') continue
      if (e.node === who.node) await d.store.setNetworkEntryState(e.id, 'removed', { reason: e.did === who.did ? 'closed: this account went live for this node' : 'closed: another account went live for this node' })
      else if (e.did === who.did) await d.store.setNetworkEntryState(e.id, 'removed', { reason: 'closed: this account went live for another node' })
    }
    return c.text(ADDED(handle, node.title), 200)
  }
}

/** The `withdraw-node` purpose's handler: the node's own account (live or pending on that node) is removed at once. */
export function withdrawNodeAccount(d: EntryDeps): IdentityHandler {
  return async (c: Context, who) => {
    if (!who.node) return c.text(NO_NODE, 400)
    const title = readNode(d.repo, who.node)?.title ?? who.node
    const mine = d.store.networkEntries().filter(e => e.node === who.node && e.did === who.did && e.state !== 'removed')
    if (mine.length === 0) return c.text(NOT_ON(title), 404)
    for (const e of mine) await d.store.setNetworkEntryState(e.id, 'removed', { reason: 'withdrawn by the node' })
    const shown = mine.find(e => e.state === 'live') ?? mine[0]!
    return c.text(WITHDRAWN(shown.handle, title), 200)
  }
}
