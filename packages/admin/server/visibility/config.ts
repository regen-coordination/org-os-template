// packages/admin/server/visibility/config.ts
//
// data/visibility.yaml as the gate reads it (L5 spec §9.2): through `readFullPolicy` (R-L5-2.3), never `readPolicy`, so a
// field meant as a hat or a role that L8 would read as members admits nobody here. Read through the repository's read
// cache (L9 §7.6, server/hosted/readCache.ts): read again only when the file changes, and on every request while it is
// too fresh for the cache to vouch for.

import { join } from 'node:path'
import { parse } from 'yaml'
import { readFullPolicy, type VisibilityPolicy } from '../../lib/visibility.mjs'
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
