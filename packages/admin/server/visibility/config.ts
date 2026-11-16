// packages/admin/server/visibility/config.ts
//
// data/visibility.yaml as the gate reads it (L5 spec §9.2): through `readFullPolicy` (R-L5-2.3), never `readPolicy`, so a
// field meant as a hat or a role that L8 would read as members admits nobody here. Read through the repository's read
// cache (L9 §7.6, server/hosted/readCache.ts): read again only when the file changes, and on every request while it is
// too fresh for the cache to vouch for.

import { join } from 'node:path'
import { parse } from 'yaml'
import { readFullPolicy, stricterOf, type VisibilityPolicy } from '../../lib/visibility.mjs'
import { deepFreeze, readCacheFor } from '../hosted/readCache.ts'

export type { VisibilityPolicy }

const REL = join('data', 'visibility.yaml')

/** No policy: every collection is members (rule 2), so nothing is public. A file that cannot be read reads the same way,
 *  which fails closed for the public. */
const empty = (): VisibilityPolicy => deepFreeze({ collections: {}, defaults: {} })

/** The policy a text holds; the empty one when it cannot be read. Frozen: every request shares it. */
function policyOf(text: string): VisibilityPolicy {
  try { return deepFreeze(readFullPolicy(parse(text)).policy) } catch { return empty() }
}

/** The repository's visibility policy (a missing file: the empty one). */
export function readConfig(repo: string): VisibilityPolicy {
  try { return readCacheFor(repo).get(join(repo, REL), policyOf) } catch { return empty() }
}

/**
 * The policy a write is judged under (DAO-OS L6 Task 11 review I-4): data/visibility.yaml as it is, or, when the write's
 * own ops edit that file whole, the stricter of it and the text the write leaves (`stricterOf`, field by field). A
 * narrowing in the same change then keeps what it restricts out of git: a move's field stays in the store, and a value
 * typed into a git record is refused. A text that cannot be read leaves the policy as it is (its file op is refused).
 */
export function commitPolicy(repo: string, ops: readonly unknown[]): VisibilityPolicy {
  const now = readConfig(repo)
  const edit = ops.find((o): o is { text: unknown } => typeof o === 'object' && o !== null && (o as { op?: unknown }).op === 'file'
    && (o as { path?: unknown }).path === 'data/visibility.yaml')
  if (!edit || typeof edit.text !== 'string') return now
  let after: VisibilityPolicy
  try { after = readFullPolicy(parse(edit.text)).policy } catch { return now }
  return stricterOf(now, after)
}
