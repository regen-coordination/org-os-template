import { existsSync } from 'node:fs'
import { readRegistry, registryPath, type Entity } from './registry.ts'
import { loadSchema as loadSchemaFile, validateEntry, referenceErrors, referrersOf, addressability } from '../lib/data-validate.mjs'

export interface FieldError { field: string; message: string }
export interface ValidationResult { valid: boolean; errors: FieldError[] }

/** A registry's JSON Schema, or the generic one. lib/data-validate.mjs reads the files. */
export function loadSchema(name: string): Record<string, unknown> & { $id: string } {
  return loadSchemaFile(name)
}

/** The entries of a registry on disk, or null when the file is absent or unreadable. */
function entriesOf(repo: string, registry: string): Entity[] | null {
  try {
    if (!existsSync(registryPath(repo, registry))) return null
    return readRegistry(repo, registry).entries ?? []
  } catch { return null }
}

/** A registry's entries as a pending write would leave them; `undefined` reads the file. */
export type Overlay = (registry: string) => Entity[] | undefined

/** The entries of `registry` through the overlay first, else from disk (null when absent or unreadable). */
function entriesThrough(repo: string, registry: string, overlay?: Overlay): Entity[] | null {
  return overlay?.(registry) ?? entriesOf(repo, registry)
}

export interface Referrer { registry: string; id: string; field: string }

/** The entries that name `id` of registry `name` in a reference field: what
 *  would be left pointing at nothing if it were deleted. The reference table
 *  and the matching are lib/data-validate.mjs's, the same as the writes use. */
export function referrers(repo: string, name: string, id: string, overlay?: Overlay): Referrer[] {
  return referrersOf(name, id, registry => {
    const entries = entriesThrough(repo, registry, overlay)
    if (!entries) return null
    // An entry with no id is named by its position (1-based, as validate:data names it), never "undefined".
    const { noId } = addressability(entries)
    return noId.length === 0 ? entries : entries.map((e, i) => (noId.includes(i) ? { ...e, id: `#${i + 1}` } : e))
  })
}

/**
 * A key named `__proto__`, anywhere in the body, is refused. It is valid JSON
 * and valid YAML, and this server would store it as plain data; but it is the
 * one key that a caller's ordinary JavaScript (`target[key] = value`, a deep
 * merge) turns into something other than data: it replaces the object's
 * prototype. No registry needs the name, so it is kept out of the files.
 * `constructor`, `toString` and the like are ordinary field names and are accepted.
 */
function protoErrors(value: unknown, path: string[] = []): FieldError[] {
  if (typeof value !== 'object' || value === null) return []
  return Object.entries(value).flatMap(([key, inner]) => (key === '__proto__'
    ? [{ field: [...path, key].join('.'), message: 'a field cannot be named "__proto__": leave it out. (An entry that already holds it loses it when saved without it.)' }]
    : protoErrors(inner, [...path, key])))
}

/** Both halves are lib/data-validate.mjs's, the ones `npm run validate:data`
 *  runs: validateEntry for the schema, referenceErrors for the references. A
 *  write that names an id the target registry does not hold is refused.
 *  Warnings from validateEntry (an unknown System kind, the deprecated
 *  `infrastructure` block) never refuse a save; its errors do. */
export function validateEntity(repo: string, name: string, entity: Entity, overlay?: Overlay): ValidationResult {
  const errors: FieldError[] = protoErrors(entity)
  for (const p of validateEntry(name, entity)) {
    if (p.level === 'error') errors.push({ field: p.path, message: p.message })
  }
  errors.push(...referenceErrors(name, entity, target => {
    const entries = entriesThrough(repo, target, overlay)
    return entries ? addressability(entries).ids : null
  }))
  return { valid: errors.length === 0, errors }
}
