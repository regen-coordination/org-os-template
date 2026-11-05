import { describe, it, expect } from 'vitest'
import { memberKind } from '../../lib/members.mjs'
import { validateEntry, loadSchema, REFS, refMessage, referenceErrors, referrersOf, addressability, boardFieldsOf } from '../../lib/data-validate.mjs'

const errors = (registry: string, entry: unknown) => validateEntry(registry, entry).filter(p => p.level === 'error')
const SAFE_ADDRESS = '0x1111111111111111111111111111111111111111'

describe('validateEntry: members (F1 §3.2)', () => {
  it.each(['github:ana-example', 'did:fixture:ana', 'did:bloom:bloom', 'fixture:role:source-lead', 'ana'])(
    'accepts the id style %s', id => expect(errors('members', { id, name: 'Ana' })).toEqual([]))
  it('accepts an instance\'s own layer words', () => {
    for (const layer of ['dao-global', 'network', 'local-nodes', 'funders']) expect(errors('members', { id: 'x', layer })).toEqual([])
  })
  it('accepts kind, and handles with git and address as one value or a list', () => {
    expect(errors('members', {
      id: 'x', kind: 'agent',
      handles: { git: ['a@example.org', 'b@example.org'], github: 'ana-example', email: 'a@example.org', address: [`eip155:42220:${SAFE_ADDRESS}`] },
    })).toEqual([])
    expect(errors('members', { id: 'x', handles: { git: 'a@example.org', address: `eip155:42220:${SAFE_ADDRESS}` } })).toEqual([])
  })
  it('accepts type: individual, a top-level email and the hub\'s roles', () => {
    expect(errors('members', { id: 'x', type: 'individual', email: 'x@example.org', roles: [{ org: 'Fixture Org', role: 'steward' }] })).toEqual([])
  })
  it('accepts kind: null, which reads as person', () => {
    expect(errors('members', { id: 'x', kind: null })).toEqual([])
    expect(memberKind({ id: 'x', kind: null })).toBe('person')
  })
  it('refuses a kind outside the four, naming the field', () => {
    expect(errors('members', { id: 'x', kind: 'robot' })).toEqual([
      { file: '', id: 'x', path: 'kind', message: 'must be equal to one of the allowed values', level: 'error' },
    ])
  })
  it('refuses an address that is not CAIP-10', () => {
    expect(errors('members', { id: 'x', handles: { address: SAFE_ADDRESS } }).map(p => p.path)).toContain('handles.address')
  })
  it('refuses an entry with no id, naming the field', () => {
    expect(errors('members', { name: 'No id' })).toEqual([
      { file: '', path: 'id', message: 'must have required property \'id\'', level: 'error' },
    ])
  })
})

describe('validateEntry: governance (F1 §3.3)', () => {
  it.each(['solo-maintainer', 'consensus', 'steward-council', 'multisig', 'assembly', 'conviction'])(
    'accepts model %s', model => expect(errors('governance', { model })).toEqual([]))
  it('accepts model other with a description, and refuses it without one', () => {
    expect(errors('governance', { model: 'other', description: 'Sociocratic circles.' })).toEqual([])
    expect(errors('governance', { model: 'other' }).map(p => p.path)).toEqual(['description'])
  })
  it('accepts any status word, and fields of the instance\'s own, on a decision', () => {
    expect(errors('governance', {
      decisions: [{ id: 'd1', title: 'T', date: '2026-10-01', status: 'executed', passed_by: 'council', summary: 'S' }],
    })).toEqual([])
  })
  it('refuses a decision without its title or date', () => {
    expect(errors('governance', { decisions: [{ id: 'd1', status: 'open' }] }).map(p => p.message).sort())
      .toEqual(['must have required property \'date\'', 'must have required property \'title\''])
  })
  it('accepts roles as a map or a list, and rules as a list (reserved for F2)', () => {
    expect(errors('governance', { roles: {}, rules: [] })).toEqual([])
    expect(errors('governance', { roles: [] })).toEqual([])
  })
  it('warns, without refusing, when infrastructure still holds a value', () => {
    expect(validateEntry('governance', { model: 'consensus', infrastructure: { safe: SAFE_ADDRESS, hats_tree: null } })).toEqual([
      expect.objectContaining({ level: 'warn', path: 'infrastructure', message: expect.stringMatching(/deprecated in 0\.6: move safe to data\/systems\.yaml/) }),
    ])
  })
  it('says nothing about an infrastructure of nulls', () => {
    expect(validateEntry('governance', { infrastructure: { safe: null, hats_tree: null, gardens: null, snapshot: null } })).toEqual([])
  })
})

describe('validateEntry: systems (F1 §3.4)', () => {
  const SAFE = { id: 'treasury-safe', kind: 'safe', name: 'Treasury', chain: 'eip155:42220', address: SAFE_ADDRESS, driver: 'safe', section: 'organization/treasury' }
  it('accepts an on-chain system with a chain and an address', () => expect(validateEntry('systems', SAFE)).toEqual([]))
  it('refuses an on-chain kind without them', () => {
    expect(errors('systems', { id: 's', kind: 'gardens-pool', name: 'Pool' }).map(p => p.path)).toEqual(['chain', 'address'])
  })
  it('refuses a Safe address that is not 0x and 40 hex digits', () => {
    expect(errors('systems', { ...SAFE, address: '0xabc' }).map(p => p.path)).toEqual(['address'])
  })
  it('refuses a chain that is not CAIP-2', () => {
    expect(errors('systems', { ...SAFE, chain: 'celo' }).map(p => p.path)).toEqual(['chain'])
  })
  it('accepts an off-chain system with a url, and refuses one without', () => {
    expect(errors('systems', { id: 'drive', kind: 'docs', name: 'Drive', url: 'https://drive.example/x', embeddable: false })).toEqual([])
    expect(errors('systems', { id: 'drive', kind: 'docs', name: 'Drive' }).map(p => p.path)).toEqual(['url'])
  })
  it('keeps an unknown kind, with a warning and no error', () => {
    expect(validateEntry('systems', { id: 'notes', kind: 'notion-db', name: 'Notes', url: 'https://notion.example/x' })).toEqual([
      expect.objectContaining({ level: 'warn', id: 'notes', path: 'kind', message: expect.stringMatching(/^kind "notion-db" is not one the framework knows/) }),
    ])
  })
  it('needs an id, a kind and a name', () => {
    expect(errors('systems', {}).map(p => p.path)).toEqual(['id', 'kind', 'name'])
  })
})

describe('validateEntry: systems, several chains and communities (DAO-OS L2)', () => {
  const A = (n: number) => `0x${String(n).repeat(40)}`
  const CHAINS7 = ['eip155:1', 'eip155:10', 'eip155:100', 'eip155:137', 'eip155:8453', 'eip155:42161', 'eip155:42220']
  const EXAMPLE_DAO = [
    { id: 'treasury-safe', kind: 'safe', name: 'Treasury', chain: 'eip155:42220', chains: CHAINS7, address: A(1), driver: 'safe' },
    { id: 'roles', kind: 'hats-tree', name: 'Roles', chain: 'eip155:42220', address: '13', driver: 'hats-tree' },
    { id: 'vote', kind: 'snapshot-space', name: 'Vote', url: 'https://snapshot.org/#/example.eth', space: 'example.eth', driver: 'snapshot-space' },
    { id: 'community', kind: 'gardens-community', name: 'Community', chain: 'eip155:42220', address: A(2), driver: 'gardens-community' },
    { id: 'pool-a', kind: 'gardens-pool', name: 'Pool A', chain: 'eip155:42220', address: A(3), driver: 'gardens-pool' },
    { id: 'pool-b', kind: 'gardens-pool', name: 'Pool B', chain: 'eip155:42220', address: A(4), driver: 'gardens-pool' },
  ]
  it('accepts a Example-DAO-shaped set: a seven-chain Safe, a Hats tree, a space, a community, two pools', () => {
    for (const e of EXAMPLE_DAO) expect(validateEntry('systems', e)).toEqual([])
  })
  it('refuses chains on a kind other than safe', () => {
    const e = { ...EXAMPLE_DAO[1], chains: ['eip155:42220'] }
    expect(errors('systems', e)).toEqual([expect.objectContaining({ path: 'chains', message: 'chains is read for a Safe only' })])
  })
  it('refuses a duplicate chain and a chain that is not CAIP-2 in chains', () => {
    expect(errors('systems', { ...EXAMPLE_DAO[0], chains: ['eip155:1', 'eip155:1'] }).map(p => p.path)).toContain('chains')
    expect(errors('systems', { ...EXAMPLE_DAO[0], chains: ['celo'] }).map(p => p.path)).toEqual(expect.arrayContaining(['chains.0']))
  })
  it('refuses a gardens-community without chain, and one whose address is not 0x', () => {
    const { chain: _c, ...bare } = EXAMPLE_DAO[3] as Record<string, unknown>
    expect(errors('systems', bare).map(p => p.path)).toEqual(['chain'])
    expect(errors('systems', { ...EXAMPLE_DAO[3], address: '0xabc' }).map(p => p.path)).toEqual(['address'])
  })
  it('takes a Hats tree id as decimal or short hex, and refuses anything else', () => {
    for (const a of ['13', '0x0000000d', '1234567890']) expect(errors('systems', { ...EXAMPLE_DAO[1], address: a })).toEqual([])
    for (const a of ['0', '13.5', 'abc', '12345678901', '0x123456789']) expect(errors('systems', { ...EXAMPLE_DAO[1], address: a }).map(p => p.path)).toEqual(['address'])
  })
  it('keeps url required on a snapshot-space', () => {
    const { url: _u, ...bare } = EXAMPLE_DAO[2] as Record<string, unknown>
    expect(errors('systems', bare).map(p => p.path)).toEqual(['url'])
  })
  it('lists gardens-community among the known kinds (no warning)', () => {
    expect(validateEntry('systems', EXAMPLE_DAO[3]).filter(p => p.level === 'warn')).toEqual([])
  })
})

describe('loadSchema', () => {
  it('loads the systems schema', () => expect(loadSchema('systems').$id).toBe('orgos://registry/systems'))
  it('falls back to the generic schema', () => expect(loadSchema('__missing__').$id).toBe('orgos://registry/_generic'))
  it('validates two registries that both fall back to the generic schema', () => {
    expect(errors('__one__', { id: 'a' })).toEqual([])
    expect(errors('__two__', {}).map(p => p.path)).toEqual(['id'])
  })
})

describe('REFS and refMessage', () => {
  it('are the cross-references of docs/DATA-MODEL.md', () => {
    expect(REFS.map(r => `${r.registry}.${r.field} → ${r.target}`)).toEqual([
      'projects.lead → members', 'projects.contributors → members', 'projects.related_ideas → ideas',
      'projects.funding_source → funding-opportunities', 'meetings.participants → members', 'events.related_project → projects',
    ])
  })
  it('say what the server has always said', () => {
    expect(refMessage('members', 'ghost')).toBe('no member with id "ghost" in members')
    expect(refMessage('funding-opportunities', 'f1')).toBe('no funding with id "f1" in funding-opportunities')
  })
})

describe('referenceErrors and referrersOf', () => {
  const ids = (m: Record<string, string[]>) => (t: string) => (m[t] ? new Set(m[t]) : null)
  it('names each broken reference, skipping absent registries and null fields', () => {
    const idsOf = ids({ members: ['ana'] })
    expect(referenceErrors('projects', { lead: 'ghost', contributors: ['ana', 'bo'], related_ideas: ['x'], funding_source: null }, idsOf)).toEqual([
      { field: 'lead', message: 'no member with id "ghost" in members' },
      { field: 'contributors', message: 'no member with id "bo" in members' },
    ])
  })
  it('finds who points at an id', () => {
    const entries = (r: string) => (r === 'projects' ? [{ id: 'p1', lead: 'ana' }, { id: 'p2', contributors: ['ana'] }, { id: 'p3', lead: 'bo' }] : null)
    expect(referrersOf('members', 'ana', entries)).toEqual([
      { registry: 'projects', id: 'p1', field: 'lead' }, { registry: 'projects', id: 'p2', field: 'contributors' },
    ])
  })
})

describe('addressability', () => {
  it('counts an absent, null or empty-string id as no id, and an entry that is not a mapping too', () => {
    expect(addressability([{ id: 'a' }, { name: 'x' }, { id: null }, { id: '' }, 'just text', { id: 0 }])).toEqual({
      ids: new Set(['a', '0']), noId: [1, 2, 3, 4], shared: new Map(),
    })
  })
  it('counts each id that several entries share, and only those', () => {
    const r = addressability([{ id: 'm1' }, { id: 'm2' }, { id: 'm1' }, { id: 'm1' }, { id: 'm2' }, { id: 'm3' }, { id: '' }, { id: '' }])
    expect(r.shared).toEqual(new Map([['m1', 3], ['m2', 2]]))
    expect(r.ids).toEqual(new Set(['m1', 'm2', 'm3']))
    expect(r.noId).toEqual([6, 7]) // two empty ids are two entries with no id, not a shared id ""
  })
  it('an empty list has nothing to address', () => {
    expect(addressability([])).toEqual({ ids: new Set(), noId: [], shared: new Map() })
  })
})

describe('validateEntry: boards (P4 §5.1)', () => {
  const board = (blocks: unknown[], layout = 'grid') => ({ id: 'b', name: 'B', layout, blocks })
  const list = (source: unknown, place: unknown = { col: 1, span: 6, row: 1 }) => ({ id: 'l', type: 'list', source, place })
  const errs = (entry: unknown) => validateEntry('boards', entry).filter(p => p.level === 'error')

  it('passes a good board', () => {
    expect(errs(board([{ id: 'l', type: 'list', source: { kind: 'project', sort: '-started' }, place: { col: 1, span: 12, row: 1 } }]))).toEqual([])
  })
  it('refuses what the schema refuses: a missing layout, an unknown key', () => {
    expect(errs({ id: 'b', name: 'B', blocks: [] }).map(p => p.path)).toContain('layout')
    expect(errs({ ...board([]), colour: 'red' }).length).toBeGreaterThan(0)
  })
  it('refuses what validateBoard refuses, under blocks, naming the board, the block and the field', () => {
    expect(errs(board([list({ kind: 'project' }, { col: 1, span: 13, row: 1 })])))
      .toEqual([expect.objectContaining({ id: 'b', path: 'blocks', message: 'board "b": block "l": span 13 is outside 1–12' })])
    expect(errs(board([list({ kind: 'project', where: { titel: 'x' } })]))[0]!.message)
      .toMatch(/^board "b": block "l": where: "titel" is not a field of project/)
  })
  it('boardFieldsOf is the full list: every record\'s fields and the kind\'s schema\'s', () => {
    expect(boardFieldsOf('project')).toEqual(expect.arrayContaining(['id', 'name', 'status', 'attention', 'changed', 'title', 'lead', 'started']))
    expect(boardFieldsOf('module')).toBeNull()
  })
  it('accepts a base field in where, and refuses a misspelt one naming board, block and field', () => {
    expect(errs(board([list({ kind: 'project', where: { name: 'x' } })]))).toEqual([])
    expect(errs(board([{ id: 'k', type: 'kanban', source: { kind: 'project' }, view: { group: 'status', columns: ['a'] }, place: { col: 1, span: 6, row: 1 } }]))).toEqual([])
    const [p] = errs(board([list({ kind: 'project', where: { nmae: 'x' } })]))
    expect(p!.message).toMatch(/^board "b": block "l": where: "nmae" is not a field of project/)
    expect(p!.message.match(/\bname\b/g)).toHaveLength(1)
  })
  it('lists a base name once when a kanban group is misspelt', () => {
    const [p] = errs(board([{ id: 'k', type: 'kanban', source: { kind: 'project' }, view: { group: 'statuss', columns: ['a'] }, place: { col: 1, span: 6, row: 1 } }]))
    expect(p!.message).toMatch(/^board "b": block "k": view.group: "statuss" is not a field of project/)
    expect(p!.message.match(/\bid, kind\b/g)).toHaveLength(1)
  })
})
