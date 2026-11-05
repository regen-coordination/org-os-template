import type { Hono } from 'hono'
import { HttpError } from '../errors.ts'
import { viewerOf } from '../request.ts'
import { gateGovernance, Levels } from '../visibility/gate.ts'
import { governanceView, decisionMarkdown } from './read.ts'

export function mountGovernance(app: Hono, repo: string): void {
  // Gated (L5 spec §9.5): the public reads only what the governance document makes public.
  app.get('/api/governance', c => c.json(gateGovernance(viewerOf(c), governanceView(repo), new Levels(repo))))
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
