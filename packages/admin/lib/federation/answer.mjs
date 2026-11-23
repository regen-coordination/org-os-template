// packages/admin/lib/federation/answer.mjs
//
// A hub's answer to a join request, as the node says it (network N2). The answer a transport reads back is the hub's
// whole verdict line ("Accepted: welcome aboard."), so the word is said once: `answerLine` never repeats it. Pure.

const VERDICT = /^\s*(accepted|refused)\b\s*[:.\-–—]?\s*/i

/** The reason without a leading `Accepted`/`Refused` word, trimmed; '' when nothing is left.
 * @param {string | null | undefined} reason @returns {string} */
export function verdictReason(reason) {
  return typeof reason === 'string' ? reason.replace(VERDICT, '').trim() : ''
}

/** `Accepted: <reason>` or `Refused: <reason>`, the word once; `Accepted.` / `Refused.` with no reason.
 * @param {'accepted' | 'refused'} state @param {string | null | undefined} reason @returns {string} */
export function answerLine(state, reason) {
  const word = state === 'accepted' ? 'Accepted' : 'Refused'
  const rest = verdictReason(reason)
  return rest ? `${word}: ${rest}` : `${word}.`
}
