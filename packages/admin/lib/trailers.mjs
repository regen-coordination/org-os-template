// packages/admin/lib/trailers.mjs
//
// The commit trailers every platform commit carries (F1 spec §3.6, architecture
// §4.6), in git's own format: a blank line after the message, then one
// `Key: value` per line. `git interpret-trailers --parse` reads them back, and so
// does the activity trail (P3). F1 writes Org-Actor and Org-Rule; P1 adds
// Org-Change, P2 Org-Proposal and Org-Decision, DAO-OS L5 Org-Hat (§6.4: the hats a
// direct apply under a hat-sourced role acted under, `<hat ref> @<block>`, comma-separated).

export const TRAILER = Object.freeze({
  actor: 'Org-Actor',
  change: 'Org-Change',
  rule: 'Org-Rule',
  hat: 'Org-Hat',
  proposal: 'Org-Proposal',
  decision: 'Org-Decision',
})

/** The identity the house authors and commits a signed-in actor's writes with (DAO-OS L5 spec §6.4), passed through
 *  GIT_AUTHOR_* and GIT_COMMITTER_* for that one git call; Org-Actor names the actor. It lives here, beside the trailers,
 *  so the validators read it without importing the server: a commit by this email is judged by its Org-Actor. */
export const HOUSE_IDENT = Object.freeze({ name: 'org-os house', email: 'house@org-os.invalid' })

/** @typedef {{ actor?: string, change?: string, rule?: string, hat?: string, proposal?: string, decision?: string }} TrailerValues */

/** @type {(keyof typeof TRAILER)[]} */
const ORDER = /** @type {any} */ (Object.keys(TRAILER))

/** A trailer is one line: a line break in a value would end it and start a paragraph of its own. */
const oneLine = v => String(v).replace(/\s*[\r\n]+\s*/g, ' ').trim()

/**
 * @param {string} message
 * @param {TrailerValues} [values]
 * @returns {string}
 */
export function withTrailers(message, values = {}) {
  const lines = ORDER
    .filter(key => values[key] !== undefined && values[key] !== null && oneLine(values[key]) !== '')
    .map(key => `${TRAILER[key]}: ${oneLine(values[key])}`)
  if (lines.length === 0) return message
  return `${message.replace(/\s+$/, '')}\n\n${lines.join('\n')}`
}

/**
 * The inverse of withTrailers: the Org-* trailers in a commit message's last
 * paragraph. The first paragraph (the subject) never holds trailers, as in git.
 * @param {string} message
 * @returns {TrailerValues}
 */
export function parseTrailers(message) {
  const paragraphs = message.replace(/\r\n/g, '\n').trim().split(/\n[ \t]*\n/)
  if (paragraphs.length < 2) return {}
  const byName = new Map(ORDER.map(key => [TRAILER[key].toLowerCase(), key]))
  /** @type {TrailerValues} */
  const out = {}
  for (const line of paragraphs[paragraphs.length - 1].split('\n')) {
    const m = /^([A-Za-z0-9-]+):[ \t]*(.*)$/.exec(line.trim())
    const key = m ? byName.get(m[1].toLowerCase()) : undefined
    if (m && key) out[key] = m[2].trim()
  }
  return out
}
