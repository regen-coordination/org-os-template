// packages/admin/lib/standards/validate.mjs
//
// The standards output against its JSON Schemas (schemas/standards/, each transcribed from the standard's
// template at a pinned commit and citing it). One Problem per violation, naming the file and the JSON pointer.

import { readFileSync } from 'node:fs'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { MECHANISMS, APPLICATION_STATUSES } from './daoip5.mjs'

/** @typedef {{ level: 'error' | 'warn', file: string, text: string }} Problem */

/** Output file → its schema name. governance.md and the org-os extras have no schema. */
export const SCHEMA_OF = {
  'dao.json': 'eip4824-dao',
  'members.json': 'eip4824-members',
  'proposals.json': 'eip4824-proposals',
  'activities.json': 'eip4824-activities',
  'contracts.json': 'eip4824-contracts',
  'grant-pools.json': 'daoip5-grant-pools',
  'applications.json': 'daoip5-applications',
  'attestation-issuers.json': 'daoip3-attestation-issuers',
}

const ajv = new Ajv({ allErrors: true, strict: false })
addFormats(ajv)

/** @param {string} name @returns {any} */
function loadSchema(name) {
  return JSON.parse(readFileSync(new URL(`../../schemas/standards/${name}.schema.json`, import.meta.url), 'utf8'))
}

/** @type {Map<string, import('ajv').ValidateFunction>} */
const compiled = new Map()
function validatorOf(name) {
  let v = compiled.get(name)
  if (!v) {
    v = ajv.compile(loadSchema(name))
    compiled.set(name, v)
  }
  return v
}

/** DAOIP-5's 31 funding mechanisms and 6 application statuses (one copy: daoip5.mjs, kept equal to the schemas by a test). */
export { MECHANISMS, APPLICATION_STATUSES }

/**
 * One error Problem per schema violation (ajv allErrors, ajv-formats). Files with no schema are skipped.
 * @param {Record<string, unknown>} files output file name → document
 * @returns {Problem[]}
 */
export function validateStandards(files) {
  /** @type {Problem[]} */
  const problems = []
  for (const [file, name] of Object.entries(SCHEMA_OF)) {
    if (!(file in files)) continue
    const validate = validatorOf(name)
    if (validate(files[file])) continue
    for (const e of validate.errors ?? []) {
      const at = e.instancePath === '' ? '/' : e.instancePath
      const detail = e.keyword === 'required' ? `missing required field "${e.params.missingProperty}"` : e.message
      problems.push({ level: 'error', file, text: `${at}: ${detail} (${name})` })
    }
  }
  return problems
}
