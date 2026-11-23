// packages/admin/lib/federation/invite.mjs
//
// Invites (N2, spec R14, R18). The hub keeps only the SHA-256 of an invite's token; the token is shown once, in the
// link. An invite can be used once, expires, and is for one type. Pure: no node:* import, randomness comes in.

import { sha256Hex } from '../sha256.mjs'

/** @typedef {{ id: string, name: string, type: string, network: string, expires: string, token_sha256: string,
 *   used_by: string | null }} Invite */

/** @param {Uint8Array} bytes */
const base64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
/** @param {Uint8Array} bytes */
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')

/** @param {{ name: string, type: string, network: string, expires: string, random: (n: number) => Uint8Array }} a
 *  @returns {{ record: Invite, token: string }} */
export function makeInvite({ name, type, network, expires, random }) {
  const token = base64url(random(32))
  return {
    record: { id: `i-${hex(random(4))}`, name, type, network, expires, token_sha256: sha256Hex(token), used_by: null },
    token,
  }
}

/** The end of the expiry: a bare date is good through that whole day.  @param {string} expires @returns {number} */
const expiryTime = expires => new Date(/^\d{4}-\d{2}-\d{2}$/.test(expires) ? `${expires}T23:59:59.999Z` : expires).getTime()

/** @param {readonly Invite[]} invites @param {string | undefined} token @param {{ from: { type: string } }} request
 *  @param {string | Date} now @returns {{ invite: Invite } | { problem: string }} */
export function inviteMatch(invites, token, request, now) {
  const hash = typeof token === 'string' && token !== '' ? sha256Hex(token) : null
  const invite = hash === null ? undefined : invites.find(i => i.token_sha256 === hash)
  if (!invite) return { problem: "This invite doesn't match." }
  if (invite.used_by) return { problem: 'This invite has been used.' }
  if (!(new Date(now).getTime() <= expiryTime(invite.expires))) return { problem: 'This invite has expired.' }
  if (invite.type !== request.from.type) return { problem: `This invite is for a ${invite.type}.` }
  return { invite }
}
