import type { APIRoute } from 'astro'
import { getCollection } from 'astro:content'
import { kmsConfig } from '../content.config'

export const GET: APIRoute = async ({ site }) => {
  const notes = await getCollection('notes')
  const base = site?.toString().replace(/\/$/, '') ?? ''
  const lines = [
    `# ${kmsConfig.identity.name}`, '',
    '> Shared knowledge commons of the regen network. Machine-readable org data at /.well-known/.', '',
    ...kmsConfig.sources.flatMap(src => [
      `## ${src.label}`,
      ...notes.filter(n => n.data.source === src.id).slice(0, 200)
        .map(n => `- [${n.data.title}](${base}/${n.data.slug}): ${n.data.excerpt.slice(0, 100)}`),
      '',
    ]),
  ]
  return new Response(lines.join('\n'), { headers: { 'content-type': 'text/plain; charset=utf-8' } })
}
