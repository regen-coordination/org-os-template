// packages/admin/lib/wizard-answers.mjs
//
// A wizard's answers as its fields read them, and a shelf wizard's result with the answers put in (DAO-OS L7 §7.1).
// Pure, with no node imports: the server's wizard checks (lib/wizards.mjs re-exports these) and the client's template
// runner (app/src/wizards/TemplateWizard.tsx) read answers the same way.

const FIELD_REF = /^\$\{field\.([^}]*)\}$/
const ADDRESS = /^(?:[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}:)?0x[0-9a-fA-F]{40}$/

/** One answer, as its field's kind reads it: `addresses` is the list of its non-blank lines, each a 0x or CAIP-10
 *  address; `count` is a whole number, 1 or more; any other kind is the text as it is. An answer that does not read is
 *  `{ error }`, in words.
 *  @param {{ label: string, kind: string }} field @param {string} answer
 *  @returns {{ value: unknown } | { error: string }} */
export function readField(field, answer) {
  const raw = typeof answer === 'string' ? answer : ''
  if (field.kind === 'addresses') {
    const lines = raw.split('\n').map((l, i) => ({ n: i + 1, text: l.trim() })).filter(l => l.text !== '')
    if (lines.length === 0) return { error: 'Write at least one address.' }
    const bad = lines.find(l => !ADDRESS.test(l.text))
    if (bad) return { error: `Line ${bad.n}, "${bad.text}", is not an address: write 0x and 40 hex digits, or a CAIP-10 account.` }
    return { value: lines.map(l => l.text) }
  }
  if (field.kind === 'count') {
    const t = raw.trim()
    if (!/^[1-9][0-9]*$/.test(t)) return { error: `${field.label} is a whole number, 1 or more.` }
    return { value: Number(t) }
  }
  return { value: raw }
}

/** A wizard's result with the answers put in: `{ add, config }`, each config value the answer its "${field.<id>}"
 *  names (left out when there is no answer). Null for a wizard with no result.
 *  @param {import('./wizards.mjs').WizardDef} def @param {Record<string, unknown>} answers
 *  @returns {{ add: string, config: Record<string, unknown> } | null} */
export function resultOf(def, answers) {
  if (!def.result) return null
  /** @type {Record<string, unknown>} */
  const config = {}
  for (const [key, value] of Object.entries(def.result.config)) {
    const id = FIELD_REF.exec(value)?.[1]
    if (id !== undefined && answers[id] !== undefined) config[key] = answers[id]
  }
  return { add: def.result.add, config }
}
