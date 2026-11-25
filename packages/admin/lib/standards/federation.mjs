// packages/admin/lib/standards/federation.mjs
//
// .well-known/federation.json (network N0): this instance's public claims about its networks, peers and join policy.
// A peer is published only when its url is https and it is not marked private; everything else is counted, never
// written. Peer notes, contact, relationship, repo and any local path never appear. Pure; relative imports only
// (vendored into instances).
import { isPublicUrl } from '../federation/peers.mjs'

/** @typedef {import('../federation/read.mjs').Peer} Peer */

/** Whether a peer may be published: a public https url, and not private.
 * @param {Peer} peer @returns {boolean} */
export const isPublishedPeer = peer => !peer.private && isPublicUrl(peer.url)

/** @param {Record<string, unknown>} o @returns {Record<string, unknown>} without null and "" values */
const compact = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== ''))

/** Serialises the public projection (`pub.federation`); it holds nothing unpublishable.
 * @param {import('./project.mjs').PublicInput} pub
 * @returns {Record<string, unknown>}
 */
export function federationDoc(pub) {
  const fed = pub.federation
  return {
    spec: 'org-os/federation/1',
    ...compact({ name: pub.identity.name, type: pub.identity.type, scope: fed?.scope, daoURI: pub.identity.daoURI, did: fed?.did }),
    networks: (fed?.networks ?? []).map(n => compact({ ...n })),
    peers: (fed?.peers ?? []).map(p => compact({ ...p })),
    ...(fed?.join ? { join: compact({ ...fed.join }) } : {}),
  }
}
