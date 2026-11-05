import Ajv, { type ErrorObject } from 'ajv'
import type { RecordError } from '../changes/types.ts'
import type { InstallOp, LibraryEntry } from './types.ts'

/** What an entry asks the person for, written into its `installs` (quoted in YAML): `"${config.<name>}"`, in a record
 *  id and in any string of `value` or `set`. A string that is exactly one becomes the supplied value, with its type; a
 *  string that holds one is interpolated. */
const PLACEHOLDER = /\$\{config\.([a-z_][a-z0-9_]*)\}/g
const EXACT = /^\$\{config\.([a-z_][a-z0-9_]*)\}$/

const isMapping = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const opsOf = (e: LibraryEntry): InstallOp[] => (e.builtin ? [] : e.installs ?? [])

/** Every string in a value, depth first, in the order it is written. */
function* strings(v: unknown): Generator<string> {
  if (typeof v === 'string') yield v
  else if (Array.isArray(v)) for (const x of v) yield* strings(x)
  else if (isMapping(v)) for (const x of Object.values(v)) yield* strings(x)
}

/** The placeholders an entry's installs name, e.g. ['id', 'name', 'url']: each once, in the order they first appear. */
export function placeholdersOf(e: LibraryEntry): string[] {
  const names = new Set<string>()
  for (const op of opsOf(e)) {
    for (const s of [op.record, ...strings(op.value), ...strings(op.set)]) for (const m of s.matchAll(PLACEHOLDER)) names.add(m[1]!)
  }
  return [...names]
}

/** A copy of `v` with every placeholder `known` holds put in. One it does not hold is kept as written (lenient) or
 *  left out: an exact one drops its key (null in a list), an interpolated one reads as empty. */
function fill(v: unknown, known: Record<string, unknown>, lenient: boolean): unknown {
  if (typeof v === 'string') {
    const exact = EXACT.exec(v)
    if (exact) return exact[1]! in known ? known[exact[1]!] : lenient ? v : undefined
    return v.replace(PLACEHOLDER, (whole, name: string) => (name in known ? String(known[name]) : lenient ? whole : ''))
  }
  if (Array.isArray(v)) return v.map(x => fill(x, known, lenient) ?? null)
  if (isMapping(v)) {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) { const y = fill(x, known, lenient); if (y !== undefined) out[k] = y }
    return out
  }
  return v
}

/** One ajv error as the person's field: `<name> is required.`, `<name> is not one of the things this entry asks for.`,
 *  or ajv's own words for a type. */
function configError(record: string, err: ErrorObject): RecordError {
  const params = err.params as { missingProperty?: string; additionalProperty?: string }
  if (err.keyword === 'required' && params.missingProperty) {
    return { record, field: `config.${params.missingProperty}`, message: `${params.missingProperty} is required.` }
  }
  if (err.keyword === 'additionalProperties' && params.additionalProperty) {
    return { record, field: `config.${params.additionalProperty}`, message: `${params.additionalProperty} is not one of the things this entry asks for.` }
  }
  const at = err.instancePath.slice(1).replace(/\//g, '.')
  return { record, field: at ? `config.${at}` : 'config', message: err.message ?? 'does not match what this entry asks for' }
}

/** The entry's ops with config applied. Config is checked against `{ type: object, properties, required,
 *  additionalProperties: false }`, defaults applied. lenient: defaults only, an unresolved placeholder kept as written,
 *  never errors (preview). Strict, the ops are [] when there are errors. */
export function resolveInstalls(e: LibraryEntry, config: unknown, opts: { lenient?: boolean } = {}): { ops: InstallOp[]; errors: RecordError[] } {
  const lenient = opts.lenient === true
  const ops = opsOf(e)
  const schema = { type: 'object', properties: e.config?.properties ?? {}, required: e.config?.required ?? [], additionalProperties: false }
  let known: Record<string, unknown> = {}
  const errors: RecordError[] = []
  if (lenient) {
    // Defaults only: what the entry itself says, never what was supplied.
    for (const [name, p] of Object.entries(schema.properties)) if (isMapping(p) && p.default !== undefined) known[name] = structuredClone(p.default)
  } else {
    const supplied = config === undefined || config === null ? {} : structuredClone(config)
    let validate
    try { validate = new Ajv({ allErrors: true, strict: false, useDefaults: true }).compile(schema) } catch (err) {
      return { ops: [], errors: [{ record: e.id, field: 'config', message: `this entry's config cannot be read: ${err instanceof Error ? err.message : String(err)}` }] }
    }
    if (!validate(supplied)) errors.push(...(validate.errors ?? []).map(err => configError(e.id, err)))
    if (errors.length > 0) return { ops: [], errors }
    known = supplied as Record<string, unknown>
  }
  const resolved = ops.map(op => {
    const out: InstallOp = { op: op.op, record: fill(op.record, known, lenient) as string }
    if (op.value !== undefined) out.value = fill(op.value, known, lenient) as Record<string, unknown>
    if (op.set !== undefined) out.set = fill(op.set, known, lenient) as Record<string, unknown>
    return out
  })
  return { ops: resolved, errors }
}
