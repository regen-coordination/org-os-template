import { createHash } from 'node:crypto'
import { stringify } from 'yaml'
import { STRINGIFY } from '../splice.ts'
import { readGovernance } from '../../lib/governance-read.mjs'

/** The record `governance:governance` as a governance file's text holds it: `{ roles, rules }`, a key the file does not
 *  state absent, and no id. The one reading of it (stage, apply, a proposal's branch and revise, a receipt's base);
 *  null when the file is not read (several documents, unparseable). */
export function governanceRecord(text: string): Record<string, unknown> | null {
  const block = readGovernance(text).governance as Record<string, unknown> | null
  if (block === null) return null
  const record: Record<string, unknown> = {}
  for (const key of ['roles', 'rules']) if (block[key] !== undefined) record[key] = block[key]
  return record
}

/** The one serialisation an entry is hashed in: YAML, keys sorted at every depth, never folded.
 *  It is made from the parsed value, so the file's comments, quotes and layout never reach it,
 *  and two entries holding the same data in another key order read the same. */
export function canonicalYaml(value: unknown): string {
  return stringify(value ?? null, { ...STRINGIFY, sortMapEntries: true })
}

/** The base an op is staged against: SHA-256 (hex) of the entry's canonical YAML; null for none. */
export function baseOf(entry: Record<string, unknown> | null): string | null {
  return entry === null ? null : createHash('sha256').update(canonicalYaml(entry)).digest('hex')
}

/** Whether two values hold the same data. A field that is absent is not one that holds null. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === undefined || b === undefined) return a === b
  return canonicalYaml(a) === canonicalYaml(b)
}
