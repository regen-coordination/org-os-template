// packages/admin/lib/standards/index.mjs
//
// The framework's standards builder (lane L8, spec §8): the pure core of build.mjs with the schema check of
// validate.mjs (ajv). The server, L9 and the framework's generate:schemas use it; an instance's vendored copy runs the
// core alone and writes the same files.
import { buildCore, STANDARD_FILES } from './build.mjs'
import { validateStandards } from './validate.mjs'

export { STANDARD_FILES }

/**
 * Pure. Projection → documents → leak scan → schema validation. Files that have nothing to say (no pool, no issuer,
 * no pool read) are absent. `testing.afterProject` exists for the leak test only (it may alter the projection before
 * the builders run); nothing else passes it.
 * @param {import('./project.mjs').StandardsInput} input
 * @param {{ afterProject?: (pub: import('./project.mjs').PublicInput) => void }} [testing]
 * @returns {import('./build.mjs').StandardsOutput}
 */
export function buildStandards(input, testing = {}) {
  return buildCore(input, { ...testing, validate: validateStandards })
}
