import { defineConfig } from 'astro/config'
import sitemap from '@astrojs/sitemap'
import pagefind from 'astro-pagefind'

export default defineConfig({
  site: 'https://commons.org-os.dev',
  integrations: [sitemap(), pagefind()],
})
