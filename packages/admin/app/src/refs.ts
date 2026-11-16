/** The reference fields of server/schema.ts (`REFS`), mirrored for the client: which field of which
 *  registry names an id in which other registry. refs.test.ts pins it to the server's table. */
export interface Ref { registry: string; field?: string; path?: string; target: string; array?: boolean; relation?: boolean }

export const REFS: Ref[] = [
  { registry: 'projects', field: 'lead', target: 'members' },
  { registry: 'projects', field: 'contributors', target: 'members', array: true },
  { registry: 'projects', field: 'related_ideas', target: 'ideas', array: true },
  { registry: 'projects', field: 'funding_source', target: 'funding-opportunities' },
  { registry: 'meetings', field: 'participants', target: 'members', array: true },
  { registry: 'events', field: 'related_project', target: 'projects' },
  // DAO-OS L6 §7.2: a task's project and meeting.
  { registry: 'tasks', field: 'project', target: 'projects' },
  { registry: 'tasks', field: 'meeting', target: 'meetings' },
  // DAO-OS L7 (L1-Q1): a board block and a System's relation name a System, by a path (no form field: `refOf` finds
  // field rows only); a relation also in the map's forms (PF-R129).
  { registry: 'boards', path: 'blocks.*.source.system', target: 'systems' },
  { registry: 'systems', path: 'relates.*.to', target: 'systems', relation: true },
]

export const refOf = (registry: string, field: string): Ref | undefined =>
  REFS.find(r => r.registry === registry && r.field === field)
