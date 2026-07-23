import type { APIRoute } from 'astro'
import { commonsFor } from '@org-os/knowledge-commons/loaders'
import { kmsConfig, ROOT } from '../content.config'

export const GET: APIRoute = async () => {
  const c = await commonsFor(kmsConfig, ROOT)
  return new Response(JSON.stringify(c.linkReport, null, 2), { headers: { 'content-type': 'application/json' } })
}
