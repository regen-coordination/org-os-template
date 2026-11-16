// packages/admin/lib/wizards.mjs
//
// A wizard is data (wizards spec §5.3): packages/admin/wizards/<id>.yaml. This reads them and checks
// their shape. The page draws them; lib/machines/wizard.mjs walks them. A wizard that does not say
// what each step writes is refused: "a visible 'what this writes' at every step" is the design rule.

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { isMap } from './yaml-util.mjs'

// A shelf wizard's answers and its result are read by the client too (the template runner), so they live in a file
// with no node imports; they are part of this module's interface as before.
export { readField, resultOf } from './wizard-answers.mjs'

/** The folder the wizards are in. A function, so that a page which only checks a definition (the client's
 *  tests) can import this file where `import.meta.url` is not a file address. */
export const wizardsDir = () => fileURLToPath(new URL('../wizards', import.meta.url))

/**
 * @typedef {object} WizardStep
 * @property {string} id
 * @property {string} title
 * @property {string} ask
 * @property {string} writes  what this step will write; "Nothing yet." is an answer
 * @property {WizardDoor[]} [doors]    a choice of one, each a sentence and a result; `later` marks one not built yet
 * @property {WizardField[]} [fields]  the step's inputs
 *
 * @typedef {{ value: string, label: string, help?: string, later?: boolean }} WizardDoor
 * @typedef {{ id: string, label: string, kind: 'text' | 'email' | 'choice' | 'addresses' | 'count', required?: boolean, help?: string, options?: { value: string, label: string, help?: string }[] }} WizardField
 *   `addresses`: one 0x or CAIP-10 address per line, read as a list; `count`: a whole number, 1 or more (L7 §7.1).
 *
 * @typedef {object} WizardDef
 * @property {string} id
 * @property {string} title
 * @property {string} summary
 * @property {{ body: string, writes: string }} intro
 * @property {WizardStep[]} steps
 * @property {{ title: string, ask: string, writes: string }} review  always the last screen before any write
 * @property {{ title: string, body: string }} done
 * @property {{ add: string, config: Record<string, string> }} [result]  a shelf wizard's end (L7 §7.1): the library
 *   entry to add, and its config, each value "${field.<id>}", the answer to a field of a step
 */

/** The field kinds a wizard may ask with. */
const KINDS = ['text', 'email', 'choice', 'addresses', 'count']
const FIELD_REF = /^\$\{field\.([^}]*)\}$/
const ENTRY_ID = /^[a-z]+:[a-z0-9][a-z0-9-]*$/

const text = (/** @type {unknown} */ v) => typeof v === 'string' && v.trim() !== ''

/** What is wrong with a wizard definition, one sentence each; empty when nothing is.
 *  @param {unknown} def @returns {string[]} */
export function validateWizard(def) {
  if (!isMap(def)) return ['A wizard is a mapping of keys to values.']
  const out = []
  if (typeof def.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(def.id)) out.push('The wizard\'s id is lowercase letters, digits and hyphens, starting with a letter.')
  for (const key of ['title', 'summary']) if (!text(def[key])) out.push(`The wizard has no ${key}.`)
  if (!isMap(def.intro) || !text(def.intro.body) || !text(def.intro.writes)) out.push('The wizard\'s intro needs a body and a "writes" sentence.')
  if (!Array.isArray(def.steps) || def.steps.length === 0) out.push('A wizard has at least one step.')
  else {
    const seen = new Set()
    for (const [i, step] of def.steps.entries()) {
      const name = isMap(step) && text(step.id) ? `"${step.id}"` : `${i + 1}`
      if (!isMap(step) || !text(step.id)) { out.push(`Step ${i + 1} has no id.`); continue }
      if (step.id === 'review') out.push('The id "review" is reserved: the review is the wizard\'s own last screen.')
      if (seen.has(step.id)) out.push(`Step id "${step.id}" is used twice.`)
      seen.add(step.id)
      for (const key of ['title', 'ask']) if (!text(step[key])) out.push(`Step ${name} has no ${key}.`)
      if (!text(step.writes)) out.push(`Step ${name} does not say what it writes (a "writes" sentence; "Nothing yet." is an answer).`)
      if (step.doors !== undefined) {
        if (!Array.isArray(step.doors) || step.doors.length === 0) out.push(`Step ${name} has doors that are not a list of choices.`)
        else for (const d of step.doors) if (!isMap(d) || !text(d.value) || !text(d.label)) out.push(`A door of step ${name} needs a value and a label.`)
      }
      if (step.fields !== undefined) {
        if (!Array.isArray(step.fields) || step.fields.length === 0) out.push(`Step ${name} has fields that are not a list.`)
        else {
          const ids = new Set()
          for (const f of step.fields) {
            if (!isMap(f) || !text(f.id) || !text(f.label)) { out.push(`A field of step ${name} needs an id and a label.`); continue }
            if (ids.has(f.id)) out.push(`Field "${f.id}" of step ${name} is used twice.`)
            ids.add(f.id)
            if (!KINDS.includes(/** @type {string} */ (f.kind))) out.push(`Field "${f.id}" of step ${name} has a kind that is not text, email, choice, addresses or count.`)
            if (f.kind === 'choice' && (!Array.isArray(f.options) || f.options.length === 0 || f.options.some(o => !isMap(o) || !text(o.value) || !text(o.label)))) {
              out.push(`Field "${f.id}" of step ${name} is a choice and needs options, each with a value and a label.`)
            }
          }
        }
      }
    }
  }
  if (!isMap(def.review)) out.push('The wizard has no review: the last screen before any write.')
  else {
    for (const key of ['title', 'ask']) if (!text(def.review[key])) out.push(`The review has no ${key}.`)
    if (!text(def.review.writes)) out.push('The review does not say what it writes (a "writes" sentence).')
  }
  if (!isMap(def.done) || !text(def.done.title) || !text(def.done.body)) out.push('The wizard\'s done needs a title and a body.')
  if (def.result !== undefined) out.push(...resultFaults(def))
  return out
}

/** What is wrong with a wizard's `result`, one sentence each.
 *  @param {Record<string, any>} def @returns {string[]} */
function resultFaults(def) {
  const r = def.result
  if (!isMap(r) || !isMap(r.config)) return ['The wizard\'s result needs add (a library entry) and config (a mapping).']
  const out = []
  if (typeof r.add !== 'string' || !ENTRY_ID.test(r.add)) out.push(`The result's add is "${String(r.add)}"; it names a library entry, <shelf>:<slug>.`)
  const fields = new Set((Array.isArray(def.steps) ? def.steps : []).flatMap(st => (isMap(st) && Array.isArray(st.fields) ? st.fields : []))
    .flatMap(f => (isMap(f) && typeof f.id === 'string' ? [f.id] : [])))
  for (const [key, value] of Object.entries(r.config)) {
    const ref = typeof value === 'string' ? FIELD_REF.exec(value) : null
    if (!ref) out.push(`The result's config.${key} is "${String(value)}"; each value is "\${field.<id>}", a field of a step.`)
    else if (!fields.has(ref[1])) out.push(`The result's config.${key} names the field "${ref[1]}", which no step asks for.`)
  }
  return out
}

/** One wizard file (a shelf wizard's), read and checked: the definition, or what is wrong with it, one sentence each,
 *  prefixed with `shown` (how the file is named to a person).
 *  @param {string} path @param {string} shown
 *  @returns {{ def: WizardDef | null, problems: string[] }} */
export function readWizardFile(path, shown) {
  let def
  try { def = parse(readFileSync(path, 'utf8')) } catch (err) {
    return { def: null, problems: [`${shown}: not valid YAML (${String(err instanceof Error ? err.message : err).split('\n')[0]})`] }
  }
  const faults = validateWizard(def)
  return faults.length > 0 ? { def: null, problems: faults.map(f => `${shown}: ${f}`) } : { def: /** @type {WizardDef} */ (def), problems: [] }
}

/** Every wizard in the platform's wizards/ folder, and what is wrong with the ones that are not usable.
 *  @param {string} [dir]
 *  @returns {{ wizards: WizardDef[], problems: string[] }} */
export function loadWizards(dir = wizardsDir()) {
  /** @type {WizardDef[]} */
  const wizards = []
  const problems = []
  for (const file of readdirSync(dir).filter(f => f.endsWith('.yaml')).sort()) {
    let def
    try { def = parse(readFileSync(`${dir}/${file}`, 'utf8')) } catch (err) { problems.push(`${file}: not valid YAML (${String(err instanceof Error ? err.message : err).split('\n')[0]})`); continue }
    const faults = validateWizard(def)
    if (faults.length > 0) { problems.push(...faults.map(f => `${file}: ${f}`)); continue }
    if (def.id !== file.replace(/\.yaml$/, '')) { problems.push(`${file}: the id "${def.id}" must match the file name.`); continue }
    wizards.push(/** @type {WizardDef} */ (def))
  }
  return { wizards, problems }
}
