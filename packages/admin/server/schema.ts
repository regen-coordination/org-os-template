import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import Ajv, { type ValidateFunction } from 'ajv'
import addFormats from 'ajv-formats'
import { readRegistry, registryPath, type Entity } from './registry.ts'

const SCHEMA_DIR = fileURLToPath(new URL('../schemas/', import.meta.url))
const ajv = new Ajv({ allErrors: true, strict: false })
addFormats(ajv)
const compiled = new Map<string, ValidateFunction>()

export interface FieldError { field: string; message: string }
export interface ValidationResult { valid: boolean; errors: FieldError[] }

export function loadSchema(name: string): Record<string, unknown> & { $id: string } {
  const path = join(SCHEMA_DIR, `${name}.schema.json`)
  const file = existsSync(path) ? path : join(SCHEMA_DIR, '_generic.schema.json')
  return JSON.parse(readFileSync(file, 'utf8'))
}

function validator(name: string): ValidateFunction {
  let fn = compiled.get(name)
  if (!fn) {
    fn = ajv.compile(loadSchema(name))
    compiled.set(name, fn)
  }
  return fn
}

/** Cross-references from docs/DATA-MODEL.md. `ideas.source` (a file path) is
 *  deliberately unchecked in M1 — it references a knowledge file, not a registry id. */
const REFS: { registry: string; field: string; target: string; array?: boolean }[] = [
  { registry: 'projects', field: 'lead', target: 'members' },
  { registry: 'projects', field: 'contributors', target: 'members', array: true },
  { registry: 'projects', field: 'related_ideas', target: 'ideas', array: true },
  { registry: 'projects', field: 'funding_source', target: 'funding-opportunities' },
  { registry: 'meetings', field: 'participants', target: 'members', array: true },
  { registry: 'events', field: 'related_project', target: 'projects' },
]

const noun = (target: string) => target.replace(/-opportunities$/, '').replace(/s$/, '')

function refErrors(repo: string, name: string, entity: Entity): FieldError[] {
  const errors: FieldError[] = []
  for (const ref of REFS.filter(r => r.registry === name)) {
    const value = entity[ref.field]
    if (value === null || value === undefined) continue
    let ids: Set<string>
    try {
      if (!existsSync(registryPath(repo, ref.target))) continue // absent registry → skip check
      ids = new Set((readRegistry(repo, ref.target).entries ?? []).map(e => String(e.id)))
    } catch { continue }
    const check = (v: unknown) => {
      if (typeof v === 'string' && !ids.has(v)) {
        errors.push({ field: ref.field, message: `no ${noun(ref.target)} with id "${v}" in ${ref.target}` })
      }
    }
    if (ref.array && Array.isArray(value)) value.forEach(check)
    else check(value)
  }
  return errors
}

export function validateEntity(repo: string, name: string, entity: Entity): ValidationResult {
  const fn = validator(name)
  const errors: FieldError[] = []
  if (!fn(entity)) {
    for (const e of fn.errors ?? []) {
      errors.push({ field: e.instancePath.replace(/^\//, '').replace(/\//g, '.') || String(e.params.missingProperty ?? ''), message: e.message ?? 'invalid' })
    }
  }
  errors.push(...refErrors(repo, name, entity))
  return { valid: errors.length === 0, errors }
}
