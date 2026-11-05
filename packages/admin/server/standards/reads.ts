// The reads the live copy of the standards is built from (DAO-OS L8, spec §2 and §8): every System that is public, all
// of whose fields are public, and that has a driver, read through the reader (its cache, its pacing, its time limit).
// A members-level System is never asked; nor is a public one with a withheld field, since a driver reads the raw record
// and its read could carry that field (C1).
import type { SystemReader } from '../systems/reader.ts'
import type { DriverRead } from '../systems/driver.ts'
import type { StandardsInput } from '../../lib/standards/project.mjs'
import { readable } from '../../lib/standards/project.mjs'

type Record_ = Record<string, unknown>

/** Reads every fully public System that has a driver. A failed read is passed on as it was read (`ok: false`, with the last
 *  good facts), so the builder decides what to make of it. Never rejects: the reader does not. */
export async function readsFor(reader: SystemReader, input: StandardsInput): Promise<Record<string, DriverRead>> {
  const systems = (input.records.systems as Record_[]).filter(s =>
    typeof s.driver === 'string' && s.driver !== '' && typeof s.id === 'string' && readable(input.policy, s))
  const members = input.records.members as Record_[]
  const entries = await Promise.all(systems.map(async s => [s.id as string, await reader.read(s, members)] as const))
  return Object.fromEntries(entries)
}
