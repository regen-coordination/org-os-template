import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { stateDir, fileSafe } from '../state.ts'
import type { Change } from './types.ts'

export const newChangeId = (): string => `chg_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`

/** One open change per actor, kept in the admin state directory, outside the repository, so
 *  staging never dirties the working tree and never trips the dirty-file guard. */
export class ChangeStore {
  private dir: string
  constructor(repo: string) { this.dir = join(stateDir(repo), 'changes') }

  file(actor: string): string { return join(this.dir, `${fileSafe(actor)}.json`) }

  load(actor: string): Change | null {
    const file = this.file(actor)
    if (!existsSync(file)) return null
    try {
      const change = JSON.parse(readFileSync(file, 'utf8')) as Change
      if (change && Array.isArray(change.ops) && change.actor === actor) return change
    } catch { /* put aside below */ }
    // A file that cannot be read is someone's staged work: it is kept beside, never overwritten.
    try { renameSync(file, `${file}.unreadable-${Date.now()}`) } catch { /* gone already */ }
    return null
  }

  /** Written whole to a temporary file, then renamed over the old one: a reader never sees half a
   *  change. A change with no ops, git or private, is removed. */
  save(change: Change): void {
    const file = this.file(change.actor)
    if (change.ops.length === 0 && !(change.private?.length)) { rmSync(file, { force: true }); return }
    mkdirSync(this.dir, { recursive: true })
    const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
    writeFileSync(tmp, JSON.stringify(change, null, 2))
    renameSync(tmp, file)
  }

  clear(actor: string): void { rmSync(this.file(actor), { force: true }) }
}
