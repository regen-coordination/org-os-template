// packages/admin/lib/decision-status.mjs
//
// Decision `status` stays a free word in governance.yaml (F1 spec §3.3):
// instances write approved, executed, adopted, closed, open… This groups the
// words for display and for F2. The table is schemas/decision-status.json at the
// framework root.

import { readFileSync } from 'node:fs'

/** @typedef {'ratified'|'open'|'rejected'|'expired'|'withdrawn'} StatusGroup */

const TABLE = JSON.parse(readFileSync(new URL('../../../schemas/decision-status.json', import.meta.url), 'utf8'))

/** @type {Readonly<Record<StatusGroup, readonly string[]>>} */
export const STATUS_GROUPS = Object.freeze(TABLE.groups)

/**
 * @param {unknown} word
 * @returns {StatusGroup | null} null for a word the table does not hold: show it as written
 */
export function statusGroup(word) {
  if (typeof word !== 'string') return null
  const w = word.trim().toLowerCase()
  for (const [group, words] of Object.entries(STATUS_GROUPS)) {
    if (words.includes(w)) return /** @type {StatusGroup} */ (group)
  }
  return null
}
