// GET /api/standards: the members' preview of the live copy of the standards (DAO-OS L8, spec §2). Reads only: no lock,
// no write. The answer is the builder's output as it is: the files (public by construction), the problems, what was
// withheld (counts, for the members' side) and which reads were used.
import type { Hono } from 'hono'
import { parse } from 'yaml'
import type { SystemReader } from '../systems/reader.ts'
import { loadStandardsInput } from '../../lib/standards/load.mjs'
import { buildStandards } from '../../lib/standards/index.mjs'
import { readsFor } from './reads.ts'

/** YAML as the CLI reads it (scripts/generate-all-schemas.mjs: js-yaml's core schema, no timestamp type): the 1.2 core
 *  schema of the `yaml` package, so an unquoted date stays the string the record wrote, and `<<` merges as in js-yaml. */
export const serverYaml = (text: string): unknown => parse(text, { schema: 'core', merge: true })

export function mountStandards(app: Hono, { repo, systems }: { repo: string; systems: SystemReader }): void {
  // Seam S4: L5 wraps this route with its members' gate. Until then the server listens on 127.0.0.1 only (as in 0.6).
  app.get('/api/standards', async c => {
    const { input, problems } = loadStandardsInput(repo, { parseYaml: serverYaml })
    if (!input) {
      const why = problems.map(p => `${p.file}: ${p.text}`).join('; ')
      return c.json({ error: `No standards can be built: ${why || 'identity.daoURI is not set'}` }, 409)
    }
    const out = buildStandards({ ...input, reads: await readsFor(systems, input) })
    return c.json({ files: out.files, problems: [...problems, ...out.problems], withheld: out.withheld, reads: out.reads })
  })
}
