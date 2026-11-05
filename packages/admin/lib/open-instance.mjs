// packages/admin/lib/open-instance.mjs
//
// W1's first screens (wizards spec §5.4, "Open an instance"). What a person answers becomes the config
// file the framework's own `clone:framework` takes, and the command to run with it. Nothing here runs
// anything: the platform has no way to create a folder yet (that is a new write path, spec §5.2), so
// the wizard shows the command and stops at the review.
//
// The config is only what the command reads: `org` (name, type, short_description, license, language)
// and `operator` (name, email). tests/lib/open-instance.test.ts asks the command itself, with --dry,
// whether it accepts what this makes.

import { stringify } from 'yaml'

/** The kinds the framework names (docs: federation `type`), with the sentence that says what each is. */
export const ORG_TYPES = Object.freeze([
  { value: 'Cooperative', label: 'Cooperative', help: 'Members own and run it together.' },
  { value: 'DAO', label: 'DAO', help: 'Governance runs on-chain.' },
  { value: 'LocalNode', label: 'Local node', help: 'Works within one place.' },
  { value: 'RegionalNode', label: 'Regional node', help: 'Works across a region.' },
  { value: 'PersonalNode', label: 'Personal node', help: 'One person\'s own practice, portfolio or garden.' },
  { value: 'Project', label: 'Project', help: 'A focused initiative.' },
])

/** The languages the framework has templates for; English is what a config states nothing for. */
export const LANGUAGES = Object.freeze([{ value: 'en', label: 'English' }, { value: 'pt-BR', label: 'Português (Brasil)' }])

/** @typedef {{ name?: string, type?: string, description?: string, language?: string, license?: string, folder?: string, operatorName?: string, email?: string }} Answers */

const text = (/** @type {unknown} */ v) => (typeof v === 'string' ? v.trim() : '')

/** The folder suggested from a name, beside where the person works: ../alder-commons.
 *  @param {string} name */
export function defaultFolder(name) {
  const slug = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `../${slug || 'new-organization'}`
}

/** Why the organization step cannot be left yet, in a sentence; null when it can.
 *  @param {Answers} a @returns {string | null} */
export function orgProblem(a) {
  if (text(a.name) === '') return 'Write the organization\'s name.'
  if (!ORG_TYPES.some(t => t.value === a.type)) return 'Choose what kind of organization it is.'
  if (text(a.description) === '') return 'Write one line about it.'
  if (/[\r\n]/.test(a.description ?? '')) return 'One line means one line.'
  if (a.language !== undefined && a.language !== '' && !LANGUAGES.some(l => l.value === a.language)) return 'Choose a language from the list.'
  if (text(a.folder) === '') return 'Say which folder to make.'
  return null
}

/** @param {Answers} a @returns {string | null} */
export function youProblem(a) {
  if (text(a.operatorName) === '') return 'Write your name.'
  if (!/^[^\s@]+@[^\s@]+$/.test(text(a.email))) return 'Write the email git commits with, like ana@example.org.'
  return null
}

/** The config file the framework's clone command takes, as YAML text.
 *  @param {Answers} a */
export function cloneConfigText(a) {
  /** @type {Record<string, unknown>} */
  const org = { name: text(a.name), type: a.type, short_description: text(a.description) }
  if (text(a.license) !== '') org.license = text(a.license)
  if (a.language && a.language !== 'en') org.language = a.language
  return stringify({ org, operator: { name: text(a.operatorName), email: text(a.email) } }, { lineWidth: 0 })
}

/** A word safe to paste into a shell: left alone when it is plain, else in single quotes. */
const shellWord = (/** @type {string} */ w) => (/^[A-Za-z0-9._\/@:=+,-]+$/.test(w) ? w : `'${w.replace(/'/g, `'\\''`)}'`)

/** The command to run with the config saved as `configFile`. Never a force flag: the framework's command
 *  refuses a folder that is not empty, and that refusal is kept. Shown, not run.
 *  @param {Answers} a @param {string} configFile */
export function cloneCommand(a, configFile) {
  return `npm run clone:framework -- --target ${shellWord(text(a.folder))} --config ${shellWord(configFile)}`
}
