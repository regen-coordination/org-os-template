import type { Hono } from 'hono'
import { HttpError } from '../errors.ts'
import { viewerOf } from '../request.ts'
import { gateGovernance, Levels, PUBLIC_VIEWER } from '../visibility/gate.ts'
import { mayReadRecordsOf } from '../workspace/reads.ts'
import { governanceView, decisionMarkdown } from './read.ts'

export function mountGovernance(app: Hono, repo: string): void {
  // Gated (L5 spec §9.5): the public reads only what the governance document makes public.
  // 0.7.2 (review C2): a member data/governance.yaml is kept from (the `files` section) reads it as the public does.
  app.get('/api/governance', c => {
    const viewer = viewerOf(c)
    const as = viewer.kind === 'member' && !mayReadRecordsOf(repo, viewer, 'governance') ? PUBLIC_VIEWER : viewer
    return c.json(gateGovernance(as, governanceView(repo), new Levels(repo)))
  })
  // DECISIONS.md is members' (the public is refused it before this route: visibility/gate.ts publicReads).
  app.get('/api/governance/decisions/:anchor', c => {
    const anchor = c.req.param('anchor')
    const markdown = decisionMarkdown(repo, anchor)
    if (markdown === null) {
      throw new HttpError(404, `No decision "${anchor}" in DECISIONS.md. GET /api/governance lists the decisions with their anchors.`)
    }
    return c.json({ markdown })
  })
}
