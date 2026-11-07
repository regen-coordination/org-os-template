// packages/admin/lib/members.mjs
//
// Who a member is, read from data/members.yaml entries as instances write them
// (F1 spec §3.2). Ids are opaque: nothing here parses one. Aliases are read and
// never rewritten: `type: individual` reads as kind person, and a top-level
// `email` (the vault hub) reads as a handle. Shared by the server's actor
// resolution and the root scripts.

import { isMap } from './yaml-util.mjs'

/** @typedef {'person'|'agent'|'organization'|'role'} MemberKind */

/** @type {readonly MemberKind[]} */
export const MEMBER_KINDS = Object.freeze(['person', 'agent', 'organization', 'role'])

/**
 * @param {Record<string, unknown> | null | undefined} entry
 * @returns {MemberKind}
 */
export function memberKind(entry) {
  const kind = entry?.kind
  if (typeof kind === 'string' && /** @type {readonly string[]} */ (MEMBER_KINDS).includes(kind)) return /** @type {MemberKind} */ (kind)
  if (entry?.type === 'individual') return 'person' // some instances say it this way
  return 'person' // absent means person (architecture §4.2)
}

/** @param {unknown} value @returns {string[]} */
const strings = value => (Array.isArray(value) ? value : [value]).filter(v => typeof v === 'string')

/**
 * The emails this member commits with: handles.git (one or a list), handles.email
 * and a top-level email, lowercased, each once.
 * @param {Record<string, unknown> | null | undefined} entry
 * @returns {string[]}
 */
export function gitEmails(entry) {
  const handles = isMap(entry?.handles) ? entry.handles : {}
  const all = [...strings(handles.git), ...strings(handles.email), ...strings(entry?.email)]
  return [...new Set(all.map(e => e.trim().toLowerCase()).filter(e => e !== ''))]
}

/**
 * The one member who commits with `email`, ignoring case. Null when no member
 * does, and when two or more do: which of them is acting is a question for
 * people, never a guess.
 * @param {Record<string, unknown>[]} members
 * @param {string | null | undefined} email
 * @returns {Record<string, unknown> | null}
 */
export function findMemberByEmail(members, email) {
  const wanted = typeof email === 'string' ? email.trim().toLowerCase() : ''
  if (wanted === '' || !Array.isArray(members)) return null
  const found = members.filter(m => isMap(m) && gitEmails(m).includes(wanted))
  return found.length === 1 ? /** @type {Record<string, unknown>} */ (found[0]) : null
}
