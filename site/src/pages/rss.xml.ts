import rss from '@astrojs/rss'
import { getCollection } from 'astro:content'
import { kmsConfig } from '../content.config'

export async function GET(context: { site: string }) {
  const notes = (await getCollection('notes')).filter(n => n.data.date)
    .sort((a, b) => b.data.date!.localeCompare(a.data.date!)).slice(0, 30)
  return rss({
    title: kmsConfig.identity.name,
    description: 'Recently tended notes across the commons',
    site: context.site,
    items: notes.map(n => ({ title: n.data.title, link: `/${n.data.slug}`,
      pubDate: new Date(n.data.date!), description: n.data.excerpt })),
  })
}
