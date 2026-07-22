import { z } from 'zod'

const SourceSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'source id must be a url-safe slug'),
  label: z.string(),
  emoji: z.string().optional(),
  tagline: z.string().optional(),
  dir: z.string(),
  content: z.array(z.string()).min(1),
  exclude: z.array(z.string()).default([]),
  data: z.string().optional(),          // registries dir, e.g. 'data/'
  graph: z.string().optional(),         // graphify artifact, e.g. 'graphify-out/graph.json'
  trails: z.string().optional(),        // journeys module path
})

const KmsConfigSchema = z.object({
  identity: z.object({
    name: z.string(),
    emoji: z.string().default('◉'),
    accent: z.string().default('#D6281E'),
  }),
  sources: z.array(SourceSchema).min(1),
  features: z.object({
    trails: z.boolean().default(true),
    wander: z.boolean().default(true),
    deepCut: z.boolean().default(true),
    gaps: z.string().optional(),        // path to knowledge-gaps.yaml
    registry: z.boolean().default(true),
    graph: z.boolean().default(true),
  }).default({}),
})

export type KmsConfig = z.infer<typeof KmsConfigSchema>
export type KmsSource = z.infer<typeof SourceSchema>

export function defineKmsConfig(input: unknown): KmsConfig {
  const config = KmsConfigSchema.parse(input)
  const ids = new Set<string>()
  for (const s of config.sources) {
    if (ids.has(s.id)) throw new Error(`duplicate source id: ${s.id}`)
    ids.add(s.id)
  }
  return config
}
