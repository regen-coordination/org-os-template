// packages/admin/lib/standards/build.mjs
//
// The standards builder's pure core (lane L8, spec §2, §4, §8): the public projection, every document built from it,
// the leak scan over what was built, and — when given a validator — the schema check; then what the CLI writes.
// Relative imports only, no npm and no node:* (an instance carries a copy without admin's dependencies, Q56); the
// framework's entry, index.mjs, adds the schema validator (ajv).
import { projectPublic, checkNoLeak } from './project.mjs'
import { daoDoc, membersDoc, governanceMd, issuersDoc } from './dao.mjs'
import { contractsDoc, registrationProblems } from './contracts.mjs'
import { proposalsDoc, activitiesDoc, snapshotEntries } from './proposals.mjs'
import { grantPoolsDoc, applicationsDoc } from './grants.mjs'
import { extraDocs } from './extras.mjs'

/** @typedef {import('./project.mjs').StandardsInput} StandardsInput */
/** @typedef {import('./project.mjs').PublicInput} PublicInput */
/** @typedef {import('./project.mjs').Problem} Problem */
/** @typedef {import('./project.mjs').Withheld} Withheld */
/**
 * @typedef {object} StandardsOutput
 * @property {Record<string, unknown>} files output file name → document ('governance.md' → its text). Empty when
 *   nothing may be published: the daoURI is not an https URL, or the leak scan found a withheld value.
 * @property {Problem[]} problems
 * @property {Withheld[]} withheld members' side only; never written
 * @property {{ system: string, readAt: string | null }[]} reads the reads the live copy used, by system id
 */
/**
 * @typedef {object} BuildOptions
 * @property {(files: Record<string, unknown>) => Problem[]} [validate] the schema check (index.mjs passes validateStandards)
 * @property {(pub: PublicInput) => void} [afterProject] for the leak test only: may alter the projection before the
 *   builders run. Nothing else passes it.
 */

/** Every file the builder may write under .well-known/, in the order it writes them (L8 spec §5). */
export const STANDARD_FILES = Object.freeze(['dao.json', 'members.json', 'proposals.json', 'activities.json', 'contracts.json', 'governance.md',
  'grant-pools.json', 'applications.json', 'attestation-issuers.json', 'meetings.json', 'projects.json', 'finances.json', 'ideas.json', 'knowledge.json'])

/**
 * Projection → documents → leak scan → schema validation. Pure. Files that have nothing to say (no grant pool, no
 * attestation issuer, no pool read) are absent. A leak empties `files`: nothing is published while one exists.
 * Schema problems are added to `problems` and never change `files`.
 * @param {StandardsInput} input
 * @param {BuildOptions} [options]
 * @returns {StandardsOutput}
 */
export function buildCore(input, options = {}) {
  const { pub, withheld, secrets, problems: projected } = projectPublic(input)
  /** @type {Problem[]} */
  const problems = [...projected]
  const reads = Object.entries(pub.reads)
    .map(([system, read]) => ({ system, readAt: typeof read?.readAt === 'string' ? read.readAt : null }))
    .sort((a, b) => (a.system < b.system ? -1 : a.system > b.system ? 1 : 0))
  // no https daoURI: projectPublic said so with an error, and no id can be built
  if (pub.origin === '') return { files: {}, problems, withheld, reads }

  options.afterProject?.(pub)

  const contracts = contractsDoc(pub)
  const pools = grantPoolsDoc(pub)
  const applications = applicationsDoc(pub)
  const issuers = issuersDoc(pub)
  /** @type {Record<string, unknown>} */
  const built = {
    'members.json': membersDoc(pub),
    'proposals.json': proposalsDoc(pub, input?.urls, snapshotEntries(pub)),
    'activities.json': activitiesDoc(pub),
    'contracts.json': contracts.doc,
    'governance.md': governanceMd(pub),
    ...(pools.doc ? { 'grant-pools.json': pools.doc } : {}),
    ...(applications ? { 'applications.json': applications } : {}),
    ...(issuers ? { 'attestation-issuers.json': issuers } : {}),
    ...extraDocs(pub),
  }
  built['dao.json'] = daoDoc(pub, new Set(Object.keys(built)))
  problems.push(...contracts.problems, ...pools.problems, ...registrationProblems(pub))

  /** @type {Record<string, unknown>} */
  const files = {}
  for (const name of STANDARD_FILES) if (name in built) files[name] = built[name]

  const leaks = checkNoLeak(files, secrets)
  if (leaks.length > 0) return { files: {}, problems: [...problems, ...leaks], withheld, reads }
  if (options.validate) problems.push(...options.validate(files))
  return { files, problems, withheld, reads }
}

/** A file's bytes as written: JSON as `JSON.stringify(doc, null, 2)` and a newline; governance.md as it is.
 * @param {string} name @param {unknown} doc @returns {string} */
export function serializeFile(name, doc) {
  return name.endsWith('.md') ? String(doc) : JSON.stringify(doc, null, 2) + '\n'
}

/**
 * What the CLI does with an output: refuse (write nothing, remove nothing) when nothing may be published; else write
 * each file and remove each standard file it did not produce. Nothing outside STANDARD_FILES is ever named.
 * @param {StandardsOutput} out
 * @returns {{ refuse: boolean, write: Record<string, string>, remove: string[] }}
 */
export function planWrites(out) {
  if (!('dao.json' in out.files)) return { refuse: true, write: {}, remove: [] }
  /** @type {Record<string, string>} */
  const write = {}
  for (const name of STANDARD_FILES) if (name in out.files) write[name] = serializeFile(name, out.files[name])
  return { refuse: false, write, remove: STANDARD_FILES.filter(name => !(name in write)) }
}
