// packages/admin/lib/federation/request.mjs
//
// The federation request: what a node sends a hub to ask to join its network (N2, spec §6.4, R13).
// Pure: no node:* import. It holds org-level facts only (the node's name, type and public address, the network, the
// answers to the hub's asks, and an invite token), never a person's contact. The hub builds its one `peers` entry
// from these validated fields (`hubPeerOf`) and never applies anything else the file carries.

import { parse, stringify } from 'yaml'
import { isPublicUrl } from './peers.mjs'
import { DID_PATTERN } from './read.mjs'

export const REQUEST_SPEC = 'org-os/federation-request/1'

/** @typedef {{ name: string, type: string, url: string }} RequestFrom
 *  @typedef {{ name: string, url: string }} RequestHub
 *  @typedef {{ spec: string, id: string, created: string, from: RequestFrom, hub: RequestHub, network: string,
 *    answers: Record<string, string>, invite?: string }} FederationRequest */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOP = ['spec', 'id', 'created', 'from', 'hub', 'network', 'answers', 'invite']

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObj = v => typeof v === 'object' && v !== null && !Array.isArray(v)
/** @param {unknown} v @returns {v is string} */
const text = v => typeof v === 'string' && v.trim() !== ''

/** @param {{ id: string, from: RequestFrom, hub: RequestHub, network: string, answers: Record<string, string>,
 *   invite?: string, now: string | Date }} a @returns {FederationRequest} */
export function buildRequest({ id, from, hub, network, answers, invite, now }) {
  /** @type {FederationRequest} */
  const request = {
    spec: REQUEST_SPEC, id, created: new Date(now).toISOString(),
    from: { name: from.name, type: from.type, url: from.url },
    hub: { name: hub.name, url: hub.url },
    network, answers: { ...answers },
  }
  if (invite !== undefined && invite !== '') request.invite = invite
  return request
}

/** Reads a request from YAML or JSON. Only the validated fields come back, and anything unknown is refused.
 *  @param {string} source @returns {{ request: FederationRequest | null, problems: string[] }} */
export function parseRequest(source) {
  /** @type {unknown} */
  let doc
  try { doc = parse(source) } catch (e) {
    return { request: null, problems: [`The request can't be read: ${/** @type {Error} */ (e).message.split('\n')[0]}`] }
  }
  if (!isObj(doc)) return { request: null, problems: ["The request isn't a mapping."] }
  /** @type {string[]} */
  const problems = []
  for (const key of Object.keys(doc)) if (!TOP.includes(key)) problems.push(`Unknown key "${key}".`)
  if (doc.spec !== REQUEST_SPEC) problems.push(`spec must be ${REQUEST_SPEC}.`)
  if (!text(doc.id) || !UUID.test(doc.id)) problems.push('id must be a UUID.')
  if (!text(doc.created) || Number.isNaN(new Date(doc.created).getTime())) problems.push('created must be a date.')
  if (!text(doc.network)) problems.push('network is missing.')

  const from = doc.from
  if (!isObj(from)) problems.push('from is missing.')
  else {
    for (const key of Object.keys(from)) if (!['name', 'type', 'url'].includes(key)) problems.push(`Unknown key "from.${key}".`)
    if (!text(from.name)) problems.push('from.name is missing.')
    if (!text(from.type)) problems.push('from.type is missing.')
    if (!isPublicUrl(from.url)) problems.push('from.url must be a public https address.')
  }
  const hub = doc.hub
  if (!isObj(hub)) problems.push('hub is missing.')
  else {
    for (const key of Object.keys(hub)) if (!['name', 'url'].includes(key)) problems.push(`Unknown key "hub.${key}".`)
    if (!text(hub.name)) problems.push('hub.name is missing.')
    if (!text(hub.url)) problems.push('hub.url is missing.')
  }
  const answers = doc.answers
  if (!isObj(answers) || !Object.values(answers).every(v => typeof v === 'string')) problems.push('answers must be text, by ask.')
  if (doc.invite !== undefined && !text(doc.invite)) problems.push('invite must be text.')
  if (problems.length > 0) return { request: null, problems }

  const f = /** @type {Record<string, string>} */ (from)
  const h = /** @type {Record<string, string>} */ (hub)
  return {
    request: buildRequest({
      id: /** @type {string} */ (doc.id), from: { name: f.name, type: f.type, url: f.url }, hub: { name: h.name, url: h.url },
      network: /** @type {string} */ (doc.network), answers: /** @type {Record<string, string>} */ (answers),
      invite: /** @type {string | undefined} */ (doc.invite), now: /** @type {string} */ (doc.created),
    }),
    problems: [],
  }
}

/** The request as YAML, keys in a fixed order.  @param {FederationRequest} request @returns {string} */
export function requestText(request) {
  /** @type {Record<string, unknown>} */
  const ordered = {}
  for (const key of TOP) if (/** @type {Record<string, unknown>} */ (request)[key] !== undefined) ordered[key] = /** @type {Record<string, unknown>} */ (request)[key]
  return stringify(ordered)
}

/** The one `peers` entry a hub adds for an accepted request, built from validated fields only (R13). `did` is the one
 *  the node's own federation.json carries, as the hub last read it (never from the request); left out when unknown.
 *  @param {FederationRequest} request @param {string} decision where the choice was recorded
 *  @param {string | null} [did] */
export function hubPeerOf(request, decision, did) {
  return {
    name: request.from.name, url: request.from.url, type: request.from.type, trust: 'read', relationship: 'node',
    since: request.created.slice(0, 10), decision,
    ...(typeof did === 'string' && DID_PATTERN.test(did) ? { did } : {}),
  }
}
