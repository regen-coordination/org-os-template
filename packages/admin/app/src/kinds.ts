import type { Board, Resource } from './api.ts'
import { ago } from './time.ts'
import { REGISTRY_OF_KIND } from '../../lib/registries.mjs'

/** Left to right on a map: people before what they lead; running parts before what they feed. */
export const KIND_ORDER = ['person', 'project', 'idea', 'funding', 'partner', 'knowledge-gaps', 'proposal',
  'role', 'seat', 'module', 'instance', 'connector', 'source', 'channel', 'system', 'absent']

const LABEL: Record<string, string> = {
  'knowledge-gaps': 'knowledge gaps', role: 'crew role', seat: 'crew seat', connector: 'KMS connector', absent: 'not here',
}
export const kindLabel = (kind: string): string => LABEL[kind] ?? kind

const SYSTEMS = new Set(['module', 'role', 'seat', 'instance', 'source', 'channel', 'connector'])
/** The board a resource id belongs on, from its kind (for links built from a job). A `system` can sit
 *  on either board, so where the resource itself is to hand, its own `board` wins. */
export const boardOfKind = (kind: string): Board => (SYSTEMS.has(kind) ? 'systems' : 'organization')

/** The registry each record kind is read from (lib/registries.mjs, shared with the server). */
export { REGISTRY_OF_KIND }
export const KIND_OF_REGISTRY: Record<string, string> =
  Object.fromEntries(Object.entries(REGISTRY_OF_KIND).map(([kind, registry]) => [registry, kind]))

/** Every kind the resource store answers for. */
export const RESOURCE_KINDS = new Set(KIND_ORDER.filter(k => k !== 'absent'))

/** `<kind>:<id>` split at the first colon: ids may hold colons (`person:github:bruno`). */
export function splitId(resourceId: string): { kind: string; id: string } {
  const at = resourceId.indexOf(':')
  return at < 0 ? { kind: resourceId, id: '' } : { kind: resourceId.slice(0, at), id: resourceId.slice(at + 1) }
}

/** A fact as one line of text: empty for nothing, lists comma-joined, objects as JSON. */
export function factText(v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  if (Array.isArray(v)) return v.map(factText).filter(Boolean).join(', ')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** A fact column: its label, the entry field it reads (for the gate's `restricted` marker: rule 3, E-70), its value. */
export interface FactColumn { label: string; field?: string; value: (r: Resource, entry?: Record<string, unknown>) => string }
const fact = (key: string, label = key): FactColumn => ({ label, field: key, value: r => factText(r.facts[key]) })

function driverState(r: Resource): string {
  const d = r.facts.driver as { ok?: unknown; readAt?: unknown } | undefined
  if (!d || typeof d !== 'object') return ''
  if (d.ok !== true) return 'read failed'
  return typeof d.readAt === 'string' ? ago(d.readAt) : 'not read'
}

/** The two most useful facts of each kind, as list and inspector columns (spec §6.2). */
export const FACT_COLUMNS: Record<string, FactColumn[]> = {
  project: [fact('lead'), fact('started')],
  person: [fact('role'), fact('layer')],
  funding: [fact('deadline'), fact('fit')],
  partner: [fact('type'), fact('since')],
  proposal: [fact('author'), { label: 'closes', value: r => factText(r.facts.closesAt).slice(0, 10) }],
  idea: [fact('votes'), fact('updated')],
  role: [fact('circle'), fact('model')],
  seat: [fact('state'), fact('branch')],
  module: [fact('type'), fact('failing')],
  instance: [fact('type'), fact('last_sync', 'last sync')],
  source: [fact('platform'), fact('last_synced', 'last synced')],
  channel: [fact('platform'), fact('purpose')],
  connector: [fact('target'), fact('lastIngest', 'last ingest')],
  system: [{ label: 'kind', value: (r, e) => factText(e?.kind ?? r.facts.kind) }, { label: 'read', value: driverState }],
}

/** The facts a card shows for each kind, by FACT_COLUMNS label: all of them in a list row, the first
 *  two on a kanban tile. A module adds its own kinds' fields here (F3, `platform.kinds[].card`). */
export const CARD_FIELDS: Record<string, { row: string[]; tile: string[] }> = Object.fromEntries(
  Object.entries(FACT_COLUMNS).map(([kind, cols]) => [kind, { row: cols.map(c => c.label), tile: cols.slice(0, 2).map(c => c.label) }]),
)

/** The named facts of a record, as its columns read them (a system joined with its systems.yaml
 *  entry, C-4). Labels its kind has no column for are left out. */
export function cardFacts(r: Resource, labels: string[], entry?: Record<string, unknown>): { label: string; value: string }[] {
  const cols = FACT_COLUMNS[r.kind] ?? []
  return labels.flatMap(label => {
    const c = cols.find(x => x.label === label)
    return c ? [{ label, value: c.value(r, entry) }] : []
  })
}
