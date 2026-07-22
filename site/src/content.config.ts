import { defineCollection, z } from 'astro:content'
import { defineKmsConfig } from '@org-os/knowledge-commons'
import { notesLoader, registriesLoader } from '@org-os/knowledge-commons/loaders'
import rawConfig from '../kms.config.mjs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const kmsConfig = defineKmsConfig(rawConfig)

const notes = defineCollection({
  loader: notesLoader(kmsConfig, ROOT),
  schema: z.object({
    source: z.string(), slug: z.string(), relPath: z.string(), title: z.string(),
    tags: z.array(z.string()), date: z.string().nullable(),
    frontmatter: z.record(z.unknown()), body: z.string(), html: z.string(),
    headings: z.array(z.object({ depth: z.number(), text: z.string(), id: z.string() })),
    excerpt: z.string(),
    backlinks: z.array(z.object({ fromSlug: z.string(), fromTitle: z.string(), fromSource: z.string() })),
  }),
})

const registries = defineCollection({
  loader: registriesLoader(kmsConfig, ROOT),
  schema: z.object({ source: z.string(), kind: z.string(), items: z.array(z.unknown()) }),
})

export const collections = { notes, registries }
