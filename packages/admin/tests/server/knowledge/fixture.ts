/** A temp kms instance built from the repo's own fixture (`packages/org-os-kms/test/fixtures/pages/commons.mjs`), so
 *  every count a test asserts is the fixture's — the same world the gallery draws. Nothing here reads a real vault. */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { stringify } from 'yaml'

export interface FixtureInstance {
  dir: string
  /** Every file the instance holds, with its bytes: the "nothing was written" check. */
  snapshot: () => Record<string, string>
  cleanup: () => void
}

export const FIXTURE_NOW = '2026-10-29T12:00:00Z'

/** The eight objects of the fixture: three encyclopedia entries, a lineage, an option, a source, a peer's resource and a
 *  claim. They cover every lane and both reference states on purpose. */
export const FIXTURE_OBJECTS: { schema: string; slug: string; object: Record<string, unknown> }[] = [
  { schema: 'encyclopedia-entry', slug: 'living-mulch', object: {
    title: 'Living mulch', type: 'encyclopedia-entry', id: 'id-living-mulch', page_type: 'concept', maturity: 'reviewed',
    public_use: 'reviewed-for-guidance', summary: 'A cover crop kept growing between rows to hold soil and feed the next planting.',
    known_tensions: ['Competes with young seedlings for water.', 'Needs a mowing rhythm the crew can keep.'],
    audience: 'Field crews', steward: 'Field steward', currentness: 'Checked this season', updated: '2026-10-20',
    notes: 'PRIVATE: ask about the neighbour’s field', source_lineage: 'seed-library',
    related_concepts: ['cover-cropping', 'staff-handbook', 'no-such-note'],
    related_resources: ['at://did:plc:hillsidepeer/org.hillside.resource/seedsaving1'],
  } },
  { schema: 'concept-lineage', slug: 'cover-cropping', object: {
    title: 'Cover cropping', type: 'concept-lineage', id: 'id-cover-cropping', maturity: 'field-informed', public_use: 'ok-with-caveat',
    short_description: 'Planting something to protect the ground rather than to harvest.',
    toolkit_usage: 'Used as a default in the spring planting checklist.', updated: '2026-09-02',
    related_concepts: ['living-mulch'],
  } },
  { schema: 'encyclopedia-entry', slug: 'rotational-grazing', object: {
    title: 'Rotational grazing', type: 'encyclopedia-entry', id: 'id-rotational-grazing', page_type: 'guide', maturity: 'reviewed',
    public_use: 'reviewed-for-explanation', summary: 'Moving animals between paddocks so each one rests.',
    known_tensions: 'Fencing costs fall on the first year.', updated: '2026-08-14',
  } },
  { schema: 'option-entry', slug: 'three-sisters-guild', object: {
    title: 'Three sisters guild', type: 'option-entry', id: 'id-three-sisters-guild', maturity: 'deprecated', public_use: 'ok-with-caveat',
    superseded_by: 'cover-cropping', use_cases: 'Small beds with a trellis.', not_for: 'Wide rows.', updated: '2026-03-01',
  } },
  { schema: 'source-system', slug: 'seed-library', object: {
    title: 'Riverbend Seed Library', type: 'source-system', id: 'id-seed-library', maturity: 'reviewed', public_use: 'reviewed-for-guidance',
    what_it_curates: 'Seed records and field notes.', how_to_credit: 'Credit the Riverbend Seed Library, CC BY.', updated: '2026-07-01',
  } },
  { schema: 'resource', slug: 'seed-saving', object: {
    title: 'Seed saving for small farms', type: 'resource', id: 'id-peer-seed-saving', maturity: 'source-linked',
    public_use: 'source-linked-unreviewed', sourceUri: 'at://did:plc:hillsidepeer/org.hillside.resource/seedsaving1',
    viaUri: 'at://did:plc:hillsidepeer/org.hillside.resource/seedsaving1',
    url: 'https://hillside.example/resources/seed-saving', updated: '2026-10-01',
  } },
  { schema: 'encyclopedia-entry', slug: 'staff-handbook', object: {
    title: 'Staff handbook', type: 'encyclopedia-entry', id: 'id-staff-handbook', page_type: 'guide', maturity: 'reviewed',
    public_use: 'internal-only', summary: 'How the crew works week to week.', related_concepts: ['living-mulch'], updated: '2026-10-10',
  } },
  { schema: 'claim-evidence', slug: 'seed-swap-notes', object: {
    title: 'Seed swap notes', type: 'claim-evidence', id: 'id-seed-swap-notes', maturity: 'raw', public_use: 'not-public-yet',
    ai_assisted: true, claim: 'Swaps raise local variety.', evidence: 'Counted at the autumn swap.', updated: '2026-10-25',
  } },
]

const KMS_YAML = `# A test canon, from the repo's own fixture.
instance: Riverbend Commons
adapter: repo-data
target: "."
publish:
  types_opt_in: [source-system]
  pages: true
connectors:
  - name: atproto
    config:
      peers: [did:plc:hillsidepeer]
atproto:
  did: did:plc:riverbendown
  pds: https://pds.example
  nsid_authority: org.riverbend
`

const KNOWLEDGE_JSON = {
  did: 'did:plc:riverbendown',
  description: 'Field notes and practice from the Riverbend growers.',
  sources: [{ title: 'Riverbend Seed Library' }],
}

/** The reads sidecar with the last read failed, nine days before the clock the tests pass: the gallery's clay row. */
const READS = { version: 1, reads: { atproto: { ok_at: '2026-10-20T12:00:00Z', attempt_at: FIXTURE_NOW, error: 'timeout' } } }

function walk(dir: string, rel: string, out: Record<string, string>): void {
  for (const name of readdirSync(join(dir, rel))) {
    const next = rel ? `${rel}/${name}` : name
    if (statSync(join(dir, next)).isDirectory()) walk(dir, next, out)
    else out[next] = readFileSync(join(dir, next), 'utf8')
  }
}

export function makeKmsInstance(): FixtureInstance {
  const dir = mkdtempSync(join(tmpdir(), 'kms-admin-'))
  const write = (rel: string, text: string) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text) }
  write('kms.yaml', KMS_YAML)
  write('.well-known/knowledge.json', JSON.stringify(KNOWLEDGE_JSON, null, 2))
  write('data/kms-reads.json', JSON.stringify(READS, null, 2))
  const bySchema = new Map<string, Record<string, unknown>>()
  for (const { schema, slug, object } of FIXTURE_OBJECTS) {
    const held = bySchema.get(schema) ?? {}
    held[slug] = object
    bySchema.set(schema, held)
  }
  for (const [schema, entries] of bySchema) write(`data/kb/${schema}.yaml`, stringify({ schema_version: '1.0', entries }))
  // A published manifest, so an entry's AT URI is its own rather than invented.
  const objects: Record<string, unknown> = {}
  for (const { schema, slug, object } of FIXTURE_OBJECTS) {
    if (slug === 'seed-saving') continue // a peer's entry is a row, never a page (KI R-34)
    objects[String(object.id)] = { slug, atUri: `at://did:plc:riverbendown/org.riverbend.${schema}/${String(object.id)}` }
  }
  write('data/kms-published.json', JSON.stringify({ version: 1, objects }, null, 2))
  return {
    dir,
    snapshot: () => {
      const out: Record<string, string> = {}
      if (existsSync(dir)) walk(dir, '', out)
      return out
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

/** A repository with no kms at all: a sentence, not a broken page. */
export function makeBareRepo(): FixtureInstance {
  const dir = mkdtempSync(join(tmpdir(), 'kms-bare-'))
  mkdirSync(join(dir, 'data'), { recursive: true })
  writeFileSync(join(dir, 'federation.yaml'), 'name: bare\n')
  return { dir, snapshot: () => ({}), cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/** The instance as a git repository of its own (a fresh temp dir), with a local identity: the request middleware reads
 *  `user.email` there, so a route judges the actor this names and never the machine's. */
export function asGitRepo(i: FixtureInstance, email = 'test@local'): FixtureInstance {
  const git = (...args: string[]) => execFileSync('git', ['-C', i.dir, ...args], { stdio: 'pipe' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', email)
  git('config', 'user.name', 'Test')
  git('add', '-A')
  git('commit', '-q', '-m', 'the canon as it was')
  return i
}
