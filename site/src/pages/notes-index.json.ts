import type { APIRoute } from 'astro'
import { getCollection } from 'astro:content'

export const GET: APIRoute = async () => {
  const notes = await getCollection('notes')
  const idx = notes.map(n => ({ slug: n.data.slug, title: n.data.title, source: n.data.source, degree: n.data.backlinks.length }))
  return new Response(JSON.stringify(idx), { headers: { 'content-type': 'application/json' } })
}
