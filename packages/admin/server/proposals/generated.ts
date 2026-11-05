// packages/admin/server/proposals/generated.ts
//
// Whether the generated files are behind the data (0.6 P2 spec 3.8, P2-R20): a ratify does not run generate:schemas, so
// `.well-known/` can lag the data it is generated from. Behind means: the newest ratify on the trunk's first-parent line
// (a commit with both an Org-Proposal and an Org-Decision trailer) that changed something the generator reads is newer
// than the newest commit that changed `.well-known/`. A read of local history only: no network, no write, no new git form.

import type { Hono } from 'hono'
import { messageOf, resolveRev, treeDiffNames, trunkLine } from '../git.ts'

/** What scripts/generate-all-schemas.mjs reads: data/*.yaml, federation.yaml, and the Markdown under content/projects and
 *  content/meetings. A path under one of these (a prefix ending in "/", else the exact file) is a generated source. */
export const GENERATED_SOURCES = ['data/', 'federation.yaml', 'content/projects/', 'content/meetings/'] as const
const OUTPUT = '.well-known/'
/** How many first-parent commits are looked at, newest first. */
export const WALK_LIMIT = 500

export interface GeneratedState { behind: boolean; since?: string }

const isSource = (p: string) => GENERATED_SOURCES.some(s => (s.endsWith('/') ? p.startsWith(s) : p === s))
const isRatify = (message: string) => /^Org-Proposal:/m.test(message) && /^Org-Decision:/m.test(message)

/** The first-parent commits of HEAD, oldest first, at most WALK_LIMIT of them (the root itself is left out). */
async function recent(repo: string): Promise<string[]> {
  if ((await resolveRev(repo, 'HEAD')) === null) return []
  if ((await resolveRev(repo, `HEAD~${WALK_LIMIT}`)) !== null) return trunkLine(repo, `HEAD~${WALK_LIMIT}`, 'HEAD')
  // a shorter history: the deepest HEAD~k that exists is the root, found by bisection
  let lo = 0, hi = WALK_LIMIT
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if ((await resolveRev(repo, `HEAD~${mid}`)) !== null) lo = mid; else hi = mid
  }
  return trunkLine(repo, `HEAD~${lo}`, 'HEAD')
}

/** The answer for the HEAD it was computed at: a repeat costs one rev-parse. Few repositories are served, so it stays small. */
const kept = new Map<string, GeneratedState>()

export async function generatedBehind(repo: string): Promise<GeneratedState> {
  const head = await resolveRev(repo, 'HEAD')
  if (head === null) return { behind: false }
  const key = `${repo}\0${head}`
  const known = kept.get(key)
  if (known) return known
  const answer = await walk(repo)
  if (kept.size >= 32) kept.clear()
  kept.set(key, answer)
  return answer
}

async function walk(repo: string): Promise<GeneratedState> {
  const line = await recent(repo)
  for (let i = line.length - 1; i >= 0; i--) {
    const commit = line[i]!
    const paths = await treeDiffNames(repo, `${commit}^`, commit)
    if (paths.some(p => p.startsWith(OUTPUT))) return { behind: false }
    if (paths.some(isSource) && isRatify(await messageOf(repo, commit))) return { behind: true, since: commit }
  }
  return { behind: false }
}

export function mountGenerated(app: Hono, { repo }: { repo: string }): void {
  app.get('/api/generated', async c => c.json(await generatedBehind(repo)))
}
