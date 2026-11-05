import type { Board, RegistrySummary, Resource } from './api.ts'

/** `data/systems.yaml` entries by id, to place `system` records (contract gives only facts.driver). */
export type SystemEntries = Map<string, Record<string, unknown>>

export interface SectionDef {
  id: string
  label: string
  route: string
  group: 'organization' | 'systems'
  board: Board                 // the map its records sit on
  kinds: string[]              // resource kinds; empty for a registry-only section
  registry?: string            // a registry-only section reads its entries straight from the file
  systems?: (entry: { kind: string; section: string }) => boolean // which `system` records belong here
  newRegistry?: string         // where New creates a record
  absentKey?: string           // the adapter whose absence card explains an empty section
  empty: string                // the Empty line: a board's own list, the map, and the sections without words
  words?: SectionWords         // what an empty section says, and its page head's about line (design pass, 2026-11-04)
}

/** One greyed example row of a filled list: its title, its second column and its end. Never a record. */
export type ExampleRow = readonly [title: string, second: string, end: string]

/** What a section says of itself (the design pass's plate, spec 2026-11-04 §1): written for every instance, so
 *  nothing here names one org's data. A section people add to has the plate's words; a System section also says
 *  what connecting gives. */
export interface SectionWords {
  about: string                // the "what this is" line under the page title
  noun: string                 // one record: "Add opportunity", "Add the first opportunity"
  nouns: string                // several: "No funding opportunities yet", "3 funding opportunities you can't see"
  lead: string                 // the plate's heading: why the list is worth keeping
  why: string                  // one sentence on what a record holds and what that gives
  first: string                // the line under step 1, "Add the first one by hand"
  then?: { title: string; line: string } // the last first step, after the import step when there is one
  columns: readonly [string, string, string] // the example's column names, for "What a good entry looks like"
  example: readonly ExampleRow[]           // at most three
  connect?: { title: string; gives: string; readOnly: boolean; action: string } // a System section: not connected yet
}

const TREASURY = 'organization/treasury'

/** The words of each section people add to (the design pass, spec 2026-11-04 §1). Placeholders only: no real org,
 *  person or fund. Every claim is one the Hub keeps (a deadline within 14 days is marked: server/resources/attention.ts). */
const WORDS: Record<string, SectionWords> = {
  projects: {
    about: 'The work this org is doing or planning: who leads each piece and where it stands',
    noun: 'project', nouns: 'projects', lead: 'Keep every piece of work in one place',
    why: 'Each project holds who leads it, where it stands and what it needs, so anyone can see what is moving without asking.',
    first: 'A name and a status. Everything else can wait.',
    then: { title: 'Name who leads it', line: 'Then the project’s page and the map show who works on what.' },
    columns: ['Name', 'Lead', 'Status'],
    example: [['Community garden', 'Steward A', 'active'], ['Open data portal', 'Steward B', 'planned'], ['Spring gathering', 'Steward C', 'done']],
  },
  people: {
    about: 'Who is part of this org, and the part each one plays',
    noun: 'person', nouns: 'people', lead: 'Know who is here',
    why: 'Each person holds their role and how to reach them, so projects, partners and ideas can name them.',
    first: 'A name and a role. Everything else can wait.',
    then: { title: 'Name them on projects', line: 'Then each person’s page shows what they lead.' },
    columns: ['Name', 'Role', 'Layer'],
    example: [['Steward A', 'Coordinator', 'core'], ['Steward B', 'Treasury steward', 'core'], ['Contributor C', 'Writer', 'community']],
  },
  funding: {
    about: 'Grants, rounds and calls this org is tracking or applying to',
    noun: 'opportunity', nouns: 'funding opportunities', lead: 'Keep every grant, round and call in one place',
    why: 'Each opportunity holds its funder, its deadline and where you stand. One whose deadline is within 14 days is marked, so nobody finds out the day after.',
    first: 'Name, funder, deadline. Everything else can wait.',
    then: { title: 'Link them to projects', line: 'Then each project’s page shows what could fund it.' },
    columns: ['Name', 'Funder', 'Deadline'],
    example: [['Open source round, spring', 'Example Fund', 'in 24 days'], ['Commons infrastructure grant', 'A foundation', 'rolling'], ['Local climate call', 'City council', 'closed']],
  },
  partners: {
    about: 'The organizations this org works with, and who here keeps in touch with each',
    noun: 'partner', nouns: 'partners', lead: 'Know who you work with',
    why: 'Each partner holds what you do together and who the contact is here, so a relationship never lives in one inbox.',
    first: 'A name and what you do together. Everything else can wait.',
    then: { title: 'Name the contact here', line: 'Then the partner’s page shows who to ask.' },
    columns: ['Name', 'Kind', 'Contact'],
    example: [['A neighbourhood association', 'community', 'Steward A'], ['A regional fund', 'funder', 'Steward B'], ['A university lab', 'research', 'Contributor C']],
  },
  ideas: {
    about: 'What people here would like to try, before it becomes a project',
    noun: 'idea', nouns: 'ideas', lead: 'Catch ideas before they get lost',
    why: 'Each idea holds who put it forward and who champions it, so a good one can grow into a project.',
    first: 'A title and a line on why. Everything else can wait.',
    then: { title: 'Name a champion', line: 'Then the idea’s page shows who carries it.' },
    columns: ['Idea', 'Put forward by', 'Status'],
    example: [['Seed library', 'Steward A', 'open'], ['Shared tool shed', 'Contributor C', 'discussing'], ['Monthly open call', 'Steward B', 'adopted']],
  },
  meetings: {
    about: 'When this org meets, and what each meeting agreed',
    noun: 'meeting', nouns: 'meetings', lead: 'Keep a record of every meeting',
    why: 'Each meeting holds its date, who came and what was agreed, so a decision never rests on someone’s memory.',
    first: 'A date and a title. Notes can follow.',
    then: { title: 'Write down what was agreed', line: 'Then anyone who missed it can catch up.' },
    columns: ['Meeting', 'Date', 'Kind'],
    example: [['Monthly circle', '2026-11-03', 'circle'], ['Treasury review', '2026-10-20', 'review'], ['Open assembly', '2026-10-01', 'assembly']],
  },
  treasury: {
    about: 'The org’s funds: what it holds, and what waits on its signers',
    noun: 'Safe', nouns: 'treasury systems', lead: 'Read the treasury where it lives',
    why: 'A Safe in the treasury shows its balances and the transactions waiting on signers here.',
    first: 'Its chain and its address.',
    columns: ['System', 'Chain', 'Signers'],
    example: [['Main Safe', 'Ethereum', '3 of 5'], ['Grants Safe', 'Optimism', '2 of 3'], ['Ops Safe', 'Base', '2 of 2']],
    connect: { title: 'Treasury isn’t connected', gives: 'Add your Safe’s address and the Hub reads its balances and the transactions waiting on signers.', readOnly: true, action: 'Connect a Safe' },
  },
  sources: {
    about: 'Where this org’s knowledge comes in from: channels, feeds and connectors',
    noun: 'source', nouns: 'sources', lead: 'Bring in what the org already writes',
    why: 'Each source says where knowledge comes from and how it is read.',
    first: 'A name and where it is read from.',
    columns: ['Source', 'Kind', 'Read'],
    example: [['Team chat', 'channel', 'daily'], ['Newsletter', 'feed', 'weekly'], ['Shared notes', 'connector', 'on change']],
    connect: { title: 'No source is connected', gives: 'Add a channel, a feed or a connector and the Hub lists what it brings in.', readOnly: false, action: 'Connect a source' },
  },
  systems: {
    about: 'The outside systems this org runs on: pools, voting, docs and more',
    noun: 'system', nouns: 'outside systems', lead: 'Read the systems the org runs on',
    why: 'Each system is read where it lives and shown beside your records.',
    first: 'Its kind and where it lives.',
    columns: ['System', 'Kind', 'Read'],
    example: [['Grants pool', 'pool', '2 min ago'], ['Voting space', 'voting', '5 min ago'], ['Docs space', 'docs', '1 h ago']],
    connect: { title: 'No outside system is connected', gives: 'Add a pool, a voting space or a docs space and the Hub reads it beside your records.', readOnly: true, action: 'Connect a system' },
  },
}

/** The sections, from spec §5. Not from the server: a section is a way of looking, not a fact. */
export const SECTIONS: SectionDef[] = [
  { id: 'projects', label: 'Projects', route: '/b/projects', group: 'organization', board: 'organization', kinds: ['project'], newRegistry: 'projects',
    empty: 'No projects yet.', words: WORDS.projects },
  { id: 'people', label: 'People', route: '/b/people', group: 'organization', board: 'organization', kinds: ['person'], newRegistry: 'members',
    empty: 'No people yet.', words: WORDS.people },
  { id: 'funding', label: 'Funding', route: '/b/funding', group: 'organization', board: 'organization', kinds: ['funding'], newRegistry: 'funding-opportunities',
    empty: 'No funding opportunities yet.', words: WORDS.funding },
  { id: 'partners', label: 'Partners', route: '/b/partners', group: 'organization', board: 'organization', kinds: ['partner'], newRegistry: 'relationships',
    empty: 'No partners yet.', words: WORDS.partners },
  { id: 'ideas', label: 'Ideas', route: '/b/ideas', group: 'organization', board: 'organization', kinds: ['idea'], newRegistry: 'ideas',
    empty: 'No ideas yet.', words: WORDS.ideas },
  { id: 'meetings', label: 'Meetings', route: '/b/meetings', group: 'organization', board: 'organization', kinds: [], registry: 'meetings', newRegistry: 'meetings',
    empty: 'No meetings yet.', words: WORDS.meetings },
  { id: 'treasury', label: 'Treasury', route: '/b/treasury', group: 'organization', board: 'organization', kinds: ['system'],
    systems: e => e.section === TREASURY, newRegistry: 'systems',
    empty: 'No treasury here. To add one, give data/systems.yaml an entry with section: organization/treasury; a Safe also needs kind: safe, its chain and its address.',
    words: WORDS.treasury },
  { id: 'crew', label: 'Crew', route: '/b/crew', group: 'systems', board: 'systems', kinds: ['role', 'seat'], absentKey: 'crew',
    empty: 'No crew roles or seats here.' },
  { id: 'modules', label: 'Modules', route: '/b/modules', group: 'systems', board: 'systems', kinds: ['module'], absentKey: 'modules',
    empty: 'No modules installed.' },
  { id: 'fleet', label: 'Fleet', route: '/b/fleet', group: 'systems', board: 'systems', kinds: ['instance'], absentKey: 'fleet',
    empty: 'No instances in the fleet.' },
  { id: 'sources', label: 'Sources', route: '/b/sources', group: 'systems', board: 'systems', kinds: ['source', 'channel', 'connector', 'system'],
    systems: e => e.kind === 'kms-connector', newRegistry: 'sources', absentKey: 'sources',
    empty: 'No sources, channels or connectors.', words: WORDS.sources },
  { id: 'systems', label: 'Outside systems', route: '/b/outside-systems', group: 'systems', board: 'systems', kinds: ['system'],
    systems: e => e.section !== TREASURY && e.kind !== 'kms-connector', newRegistry: 'systems',
    empty: 'No outside systems yet.', words: WORDS.systems },
]

/** A system's kind and section: from its systems.yaml entry, else from what its resource says. */
export function systemEntry(r: Resource, systems: SystemEntries): { kind: string; section: string } {
  const e = r.source?.entityId ? systems.get(r.source.entityId) : undefined
  return { kind: String(e?.kind ?? r.facts.kind ?? ''), section: String(e?.section ?? r.facts.section ?? '') }
}

export function inSection(def: SectionDef, r: Resource, systems: SystemEntries): boolean {
  if (r.source?.entityId === '') return false // an entry with no id is never a record (contract C-6)
  if (!def.kinds.includes(r.kind)) return false
  if (r.kind !== 'system') return true
  return def.systems ? def.systems(systemEntry(r, systems)) : false
}

export const sectionRows = (def: SectionDef, resources: Resource[], systems: SystemEntries): Resource[] =>
  resources.filter(r => inSection(def, r, systems))

export const sectionOf = (r: Resource, systems: SystemEntries): SectionDef | undefined =>
  SECTIONS.find(def => inSection(def, r, systems))

/** The records a section may be counted from while `data/systems.yaml` has not answered, or failed (`read` false): a
 *  system is placed by its entry there, so until then it is placed in no section — never in the wrong one (review I-2);
 *  every other record is placed by its kind, read or not. */
export const placeable = (resources: Resource[], read: boolean): Resource[] =>
  read ? resources : resources.filter(r => r.kind !== 'system')

export function sectionCount(def: SectionDef, resources: Resource[], registries: RegistrySummary[], systems: SystemEntries): number {
  if (def.registry) return registries.find(g => g.name === def.registry)?.count ?? 0
  return sectionRows(def, resources, systems).length
}

export const sectionById = (id: string): SectionDef | undefined => SECTIONS.find(s => s.id === id)

const OLD_REGISTRY_ROUTE: Record<string, string> = {
  members: '/b/people', projects: '/b/projects', 'funding-opportunities': '/b/funding', relationships: '/b/partners',
  ideas: '/b/ideas', meetings: '/b/meetings', sources: '/b/sources', channels: '/b/sources', systems: '/b/outside-systems',
}
/** Where an old one-segment `/r/<registry>` address goes now (spec §5). */
export const routeOfRegistry = (registry: string): string =>
  OLD_REGISTRY_ROUTE[registry] ?? `/all/${encodeURIComponent(registry)}`
