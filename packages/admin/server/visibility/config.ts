// packages/admin/server/visibility/config.ts
//
// data/visibility.yaml as the gate reads it (L5 spec §9.2): through `readFullPolicy` (R-L5-2.3), never `readPolicy`, so a
// field meant as a hat or a role that L8 would read as members admits nobody here. Read again only when the file changes.

import { statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { readFullPolicy, type VisibilityPolicy } from '../../lib/visibility.mjs'

export type { VisibilityPolicy }

const REL = join('data', 'visibility.yaml')

/** No policy: every collection is members (rule 2), so nothing is public. A file that cannot be read reads the same way,
 *  which fails closed for the public. */
const empty = (): VisibilityPolicy => ({ collections: {}, defaults: {} })

const kept = new Map<string, { key: string; policy: VisibilityPolicy }>()

/** The repository's visibility policy, cached by the file's time and size (a change rereads it). */
export function readConfig(repo: string): VisibilityPolicy {
  const path = join(repo, REL)
  let key: string
  try { const st = statSync(path); key = `${st.ino}:${st.mtimeMs}:${st.ctimeMs}:${st.size}` } catch { kept.delete(repo); return empty() }
  const was = kept.get(repo)
  if (was && was.key === key) return was.policy
  let policy: VisibilityPolicy
  try { policy = readFullPolicy(parse(readFileSync(path, 'utf8'))).policy } catch { policy = empty() }
  kept.set(repo, { key, policy })
  return policy
}
