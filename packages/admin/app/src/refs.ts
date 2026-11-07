/** The reference fields of server/schema.ts (`REFS`), mirrored for the client: which field of which
 *  registry names an id in which other registry. refs.test.ts pins it to the server's table. */
export interface Ref { registry: string; field: string; target: string; array?: boolean }

export const REFS: Ref[] = [
  { registry: 'projects', field: 'lead', target: 'members' },
  { registry: 'projects', field: 'contributors', target: 'members', array: true },
  { registry: 'projects', field: 'related_ideas', target: 'ideas', array: true },
  { registry: 'projects', field: 'funding_source', target: 'funding-opportunities' },
  { registry: 'meetings', field: 'participants', target: 'members', array: true },
  { registry: 'events', field: 'related_project', target: 'projects' },
]

export const refOf = (registry: string, field: string): Ref | undefined =>
  REFS.find(r => r.registry === registry && r.field === field)
