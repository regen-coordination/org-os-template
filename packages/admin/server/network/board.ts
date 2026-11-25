// What stewards see (refi-dao-os network app spec §5.4, §5.6; plan task B6). Two lists:
//   - New: the node accounts that are live (node, handle, when, check, why), each with Remove, which asks a short
//     reason kept privately; a removed account is off at once;
//   - Waiting: the pending accounts, with Confirm, which asks which channel on the node's record the steward used
//     (never the account being claimed), and Decline, which asks a short reason kept privately.
// A pending account not confirmed in 30 days drops, whenever the board, an action or the export reads the store.
// `GET /api/network` is C1's public read (B7); `GET /api/network/export` is contract C1 for the weekly copy (refi-dao-os scripts/nodes/pull-network.mjs). Stewards
// only: the person's Roles, as the records hold them now, include `steward`.
import type { Context, Hono } from 'hono'
import type { NetworkEntry, PrivateStore } from '../private/store.ts'
import { personOf } from '../request.ts'
import { MEMBERS_ONLY } from '../visibility/gate.ts'
import { readNode, closeOthers, STEWARD_REASON } from './entries.ts'
import { profileTarget } from './match.ts'

export const STEWARD_ROLE = 'steward'
export const STEWARDS_ONLY = 'Only stewards see and decide the network\'s node accounts.'
export const PENDING_DAYS = 30
/** How long the public read names a node whose account came down: two weekly copies (final review, B8). */
export const REMOVED_PUBLIC_DAYS = 14
const DAY_MS = 86_400_000
const REASON_MAX = 500
const ASK_REASON = 'Send { reason }: a few words on why, kept privately.'
const NOT_FOUND = 'There is no such account waiting or live; nothing was changed.'
const NODE_HAS_ONE = 'This node already has a live account. Remove that one first; nothing was changed.'
const ACCOUNT_LIVE = 'This account is already another node\'s live account, and an account holds one node. Nothing was changed.'
const ACCOUNT_PERSON = 'This account has since been linked to a person in this Hub, and a person\'s account is never a node\'s. Nothing was changed.'

export interface BoardDeps { store: PrivateStore; repo: string; now?: () => Date }
export interface Channel { key: string; url: string }

/** The channels on the node's record a steward may have confirmed through: its website and its links, never a profile
 *  link naming the account being claimed. */
export function channelsOf(repo: string, entry: Pick<NetworkEntry, 'node' | 'did' | 'handle'>): Channel[] {
  const node = readNode(repo, entry.node)
  if (!node) return []
  const out: Channel[] = []
  const add = (key: string, url: unknown) => {
    if (typeof url !== 'string' || url.trim() === '' || out.some(c => c.url === url)) return
    const target = profileTarget(url)
    if (target !== null && (target === entry.did || target === entry.handle.toLowerCase())) return
    out.push({ key, url })
  }
  add('website', node.url)
  for (const [key, url] of Object.entries(node.links ?? {})) add(key, url)
  return out
}

/** Pending accounts older than PENDING_DAYS drop (removed, with why). */
async function dropStale(store: PrivateStore, now: Date): Promise<void> {
  const before = now.getTime() - PENDING_DAYS * DAY_MS
  for (const e of store.networkEntries('pending')) {
    const t = Date.parse(e.added)
    if (Number.isFinite(t) && t < before) {
      await store.setNetworkEntryState(e.id, 'removed', { reason: `dropped: not confirmed in ${PENDING_DAYS} days`, at: now.toISOString() })
    }
  }
}

async function textField(c: Context, name: string): Promise<string | null> {
  let body: unknown
  try { body = await c.req.json() } catch { return null }
  const v = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>)[name] : undefined
  return typeof v === 'string' && v.trim() !== '' && v.length <= REASON_MAX ? v.trim() : null
}

/** The stewards' board routes and the export. */
export function mountNetworkBoard(app: Hono, d: BoardDeps): void {
  const now = d.now ?? (() => new Date())
  /** The refusal for anyone who is not a steward, or null. Stale pending accounts drop on every steward's read. */
  const gate = async (c: Context): Promise<Response | null> => {
    const p = personOf(c)
    if (!p || p.kind === 'ended' || p.kind === 'removed') return c.json({ error: MEMBERS_ONLY, code: 'SIGN_IN' }, 401)
    if (p.kind !== 'person' || !p.person.roles.includes(STEWARD_ROLE)) return c.json({ error: STEWARDS_ONLY, code: 'STEWARDS_ONLY' }, 403)
    await dropStale(d.store, now())
    return null
  }
  const title = (node: string) => readNode(d.repo, node)?.title ?? node
  const byId = (id: string, state: NetworkEntry['state']) => d.store.networkEntries(state).find(e => e.id === id) ?? null
  const newestFirst = (a: NetworkEntry, b: NetworkEntry) => b.added.localeCompare(a.added) || a.id.localeCompare(b.id)

  app.get('/api/network/entries', async c => {
    const refused = await gate(c); if (refused) return refused
    return c.json({
      new: d.store.networkEntries('live').sort(newestFirst).map(e => ({ id: e.id, node: e.node, title: title(e.node), handle: e.handle, added: e.added, check: e.check, why: e.why })),
      waiting: d.store.networkEntries('pending').sort(newestFirst).map(e => ({ id: e.id, node: e.node, title: title(e.node), handle: e.handle, added: e.added,
        note: e.reason, channels: channelsOf(d.repo, e) })),
    }, 200, { 'cache-control': 'no-store' })
  })

  app.post('/api/network/entries/:id/remove', async c => {
    const refused = await gate(c); if (refused) return refused
    const reason = await textField(c, 'reason')
    if (!reason) return c.json({ error: ASK_REASON }, 400)
    const e = byId(c.req.param('id'), 'live')
    if (!e) return c.json({ error: NOT_FOUND }, 404)
    await d.store.setNetworkEntryState(e.id, 'removed', { reason: `${STEWARD_REASON}${reason}`, at: now().toISOString() })
    return c.body(null, 204)
  })

  app.post('/api/network/entries/:id/decline', async c => {
    const refused = await gate(c); if (refused) return refused
    const reason = await textField(c, 'reason')
    if (!reason) return c.json({ error: ASK_REASON }, 400)
    const e = byId(c.req.param('id'), 'pending')
    if (!e) return c.json({ error: NOT_FOUND }, 404)
    await d.store.setNetworkEntryState(e.id, 'removed', { reason: `${STEWARD_REASON}${reason}`, at: now().toISOString() })
    return c.body(null, 204)
  })

  app.post('/api/network/entries/:id/confirm', async c => {
    const refused = await gate(c); if (refused) return refused
    const channel = await textField(c, 'channel')
    const e = byId(c.req.param('id'), 'pending')
    if (!e) return c.json({ error: NOT_FOUND }, 404)
    const channels = channelsOf(d.repo, e)
    if (!channel || !channels.some(ch => ch.key === channel)) {
      return c.json({ error: `Send { channel }: which channel on the node's record you confirmed through (${channels.map(ch => ch.key).join(', ') || 'the record names none'}).` }, 400)
    }
    const live = d.store.networkEntries('live')
    if (live.some(x => x.node === e.node)) return c.json({ error: NODE_HAS_ONE }, 409)
    if (live.some(x => x.did === e.did)) return c.json({ error: ACCOUNT_LIVE }, 409)
    if (d.store.accountLink(e.did)) return c.json({ error: ACCOUNT_PERSON }, 409)
    const at = now().toISOString()
    await d.store.setNetworkEntryState(e.id, 'live', { why: 'steward', channel, at })
    await closeOthers(d.store, e, at)
    return c.body(null, 204)
  })

  app.get('/api/network/export', async c => {
    const refused = await gate(c); if (refused) return refused
    const { live, removed } = shown(d.store)
    return c.json({
      as_of: now().toISOString(),
      entries: live.map(e => ({ node: e.node, did: e.did, handle: e.handle, on: e.on, added: e.added.slice(0, 10), check: e.check, checked_on: e.checkedOn, why: e.why })),
      removed: [...removed].map(([node, on]) => ({ node, on })),
    }, 200, { 'cache-control': 'no-store' })
  })

  // B7: the public read (C1's public fields only), for the network site. Anyone, signed out included.
  app.get('/api/network', c => {
    const { live, removed } = shown(d.store)
    // Only recent removals: the weekly copy carries the rest, and a node that came back by the form route must show.
    const since = new Date(now().getTime() - REMOVED_PUBLIC_DAYS * DAY_MS).toISOString().slice(0, 10)
    return c.json({
      as_of: now().toISOString(),
      entries: live.map(e => ({ node: e.node, did: e.did, handle: e.handle, on: e.on })),
      removed: [...removed].filter(([, on]) => on >= since).map(([node]) => ({ node })),
    }, 200, { 'cache-control': 'public, max-age=60' })
  })

  // The Hub's own add/remove page (final review, B8) names the node and says whether it has an account: public words.
  app.get('/api/network/nodes/:id', c => {
    const id = c.req.param('id')
    const node = readNode(d.repo, id)
    if (!node) return c.json({ error: 'That node is not on the ReFi DAO Network yet.' }, 404)
    const live = d.store.networkEntries('live').find(e => e.node === id)
    return c.json({ id, title: node.title, account: live ? { handle: live.handle } : null }, 200, { 'cache-control': 'public, max-age=60' })
  })
}

/** The live entries, and the nodes whose live account came down (latest removal day per node), never a node that is
 *  live again. A removed entry that was once live has a `why` (only going live sets one); a declined or closed pending
 *  account has none, was never shown, and is never listed. */
function shown(store: PrivateStore): { live: NetworkEntry[]; removed: Map<string, string> } {
  const all = store.networkEntries()
  const live = all.filter(e => e.state === 'live')
  const liveNodes = new Set(live.map(e => e.node))
  const removed = new Map<string, string>()
  for (const e of all) {
    if (e.state !== 'removed' || e.why === null || liveNodes.has(e.node) || !e.decided) continue
    const on = e.decided.slice(0, 10)
    if ((removed.get(e.node) ?? '') < on) removed.set(e.node, on)
  }
  return { live, removed }
}
