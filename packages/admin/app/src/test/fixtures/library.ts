import type { LibraryList, LibraryPreview, ListedEntry, Receipt, RemovalPreview } from '../../api.ts'

/** Invented entries for the library's tests and for /parts: one of each kind the first set holds. */
export const listed = (over: Partial<ListedEntry> = {}): ListedEntry => ({
  id: 'board:onboarding', shelf: 'board', title: 'Onboarding', summary: 'A page for someone new. Who is here, what is being worked on, what needs a person.',
  version: '1.0.0', source: 'framework', standing: 'stated', as_of: '2026-10-18', maturity: 'raw', tags: { function: ['coordination'] },
  builtin: false, installable: true, adds: 'adds 1 board · 4 blocks', fits: null, added: [], ...over,
})

export const ENTRIES: ListedEntry[] = [
  listed({ id: 'board:treasury-council', title: 'Treasury & council', summary: "One Safe, what waits on signers, runway, the council's open items.", fits: { met: false, missing: ['a system of kind safe'] } }),
  listed(),
  listed({ id: 'board:treasury', title: 'Treasury', summary: 'The treasury section: its list, with a switch to its map.', version: 'built in', standing: 'recorded', as_of: '', maturity: 'field-informed', builtin: true, installable: false, adds: 'built in' }),
  listed({ id: 'rules:consent-7d', shelf: 'rules', title: 'Consent among maintainers', summary: 'Maintainers decide by consent after a 7-day window to object; anyone may propose records.', tags: { function: ['governance'] }, adds: 'adds 1 role · 3 rules' }),
  listed({ id: 'system:safe', shelf: 'system', title: 'Safe multisig', summary: 'Frames a Safe, with its signers, pending transactions and balances. It reads; it never signs.', maturity: 'field-informed', tags: { function: ['treasury'] }, adds: 'adds 1 system' }),
]

export const libraryList = (entries: ListedEntry[] = ENTRIES): LibraryList => {
  const shelves = new Map<string, number>()
  for (const e of entries) shelves.set(e.shelf, (shelves.get(e.shelf) ?? 0) + 1)
  return { sources: ['framework'], shelves: [...shelves].map(([shelf, count]) => ({ shelf: shelf as ListedEntry['shelf'], count })), entries, problems: [] }
}

export const preview = (over: Partial<LibraryPreview> = {}): LibraryPreview => ({
  id: 'board:treasury-council', builtin: false,
  adds: [{ record: 'boards:treasury-council', op: 'create', class: 'records', summary: 'board, 4 blocks' }],
  blocks: [{ id: 'safe', type: 'system', title: 'The Safe' }, { id: 'threshold', type: 'metric', title: 'Signers needed' }, { id: 'needs', type: 'list', title: 'Needs you' }, { id: 'treasury', type: 'list', title: 'Treasury' }],
  roles: [], rules: [],
  needs: [{ text: 'a system of kind safe', met: true }],
  asks: ['system'],
  fields: [{ name: 'system', description: 'The id, in data/systems.yaml, of the Safe it reads.', default: 'treasury-safe', required: true }],
  reaches: [],
  decided: [{ class: 'records', direct: true, sentence: 'the maintainer decides alone' }],
  source: { name: 'framework', version: '1.0.0', standing: 'stated', as_of: '2026-10-18' },
  refusal: null, cannotAdd: null, receipts: [], note: null, ...over,
})

/** An invented entry that can be added: one board, with the config a person fills in (its id, a name, an address). */
export const TEST_DESK: ListedEntry = listed({ id: 'board:test-desk', title: 'Test desk', summary: 'A desk for tests: who is in, and what waits.', maturity: 'field-informed', adds: 'adds 1 board' })

export const testDeskPreview = (over: Partial<LibraryPreview> = {}): LibraryPreview => preview({
  id: 'board:test-desk', needs: [], asks: ['id', 'name', 'url'], blocks: [],
  adds: [{ record: 'boards:test-desk', op: 'create', class: 'records', summary: 'board, 0 blocks' }],
  fields: [
    { name: 'id', description: 'The id the org will call it by.', default: 'test-desk', required: true },
    { name: 'name', description: 'What it is called here.', default: null, required: true },
    { name: 'url', description: 'The address of the page.', default: null, required: false },
  ],
  ...over,
})

/** What removing the test desk's receipt would do: one record as added, one edited since. */
export const removal = (over: Partial<RemovalPreview> = {}): RemovalPreview => ({
  receipt: 'board-test-desk', entry: 'board:test-desk', title: 'Test desk',
  records: [{ record: 'boards:test-desk', state: 'edited', referrers: [] }, { record: 'systems:test-link', state: 'as added', referrers: [] }],
  asks: ['boards:test-desk'],
  decided: [{ class: 'records', direct: true, sentence: 'the maintainer decides alone' }],
  refusal: null, ...over,
})

/** The gallery's shelf (§11.1, /parts/lib): a DAO template not added, a System kind added, a rule set that needs a
 *  Garden, and the built-in Treasury board. `template` is a shelf value L7 adds (E-A1); the server's type learns it
 *  then, so the fixture names it through a cast. */
export const SHELF: ListedEntry[] = [
  listed({ id: 'template:council-safe-hats', shelf: 'template' as ListedEntry['shelf'], title: 'Council + Safe + Hats',
    summary: 'A council, a Safe it controls and the Hats roles that sign for it — added as one change.', version: '0.1.0', source: 'dao',
    maturity: 'field-informed', adds: 'adds 6 records' }),
  listed({ id: 'system:hats-tree', shelf: 'system', title: 'Hats tree', version: '0.1.0', source: 'dao', maturity: 'field-informed', adds: 'adds 1 system',
    summary: 'Read a Hats tree: hats, admins, wearers, eligibility and toggle modules. Empty hats become attention.',
    added: [{ receipt: 'system-hats-tree', at: '2026-10-12' }] }),
  listed({ id: 'rules:conviction-gardens', shelf: 'rules', title: 'Conviction via Gardens', version: '0.1.0', source: 'dao', maturity: 'field-informed',
    summary: 'Decide pool proposals by conviction voting in a Gardens pool.', adds: 'adds 2 rules', fits: { met: false, missing: ['a Garden'] } }),
  listed({ id: 'board:treasury', title: 'Treasury', summary: 'The Safe, its pending transactions, balances by chain and the decisions that moved money.',
    version: 'built in', standing: 'recorded', as_of: '', maturity: 'field-informed', builtin: true, installable: false, adds: 'built in' }),
]

/** What adding the DAO template would change (§11.2): four records, one whose id is taken, what it needs (one thing
 *  asked during compose), the hosts its Systems would read, and who decides. */
export const councilPreview = (over: Partial<LibraryPreview> = {}): LibraryPreview => preview({
  id: 'template:council-safe-hats',
  adds: [
    { record: 'systems:treasury', op: 'create', class: 'governed', summary: 'Treasury' },
    { record: 'systems:roles', op: 'create', class: 'governed', summary: 'Council' },
    { record: 'governance:council-approval', op: 'create', class: 'governed', summary: 'Rule: council approval' },
    { record: 'boards:treasury', op: 'create', class: 'governed', summary: 'Treasury board' },
  ],
  blocks: [], asks: [], fields: [],
  needs: [{ text: 'A governance file', met: true }, { text: 'The safe and hats-tree kinds', met: true }, { text: 'A chain for the Safe — asked during compose', met: false }],
  reaches: [{ host: 'safe-transaction-celo.safe.global', reads: 'read only' }, { host: 'api.hatsprotocol.xyz', reads: 'read only' }],
  decided: [{ class: 'governed', direct: false, sentence: 'Council consent: 4 of the 8 who wear the Council hat.' }],
  source: { name: 'dao', version: '0.1.0', standing: 'stated', as_of: '2026-10-18' },
  refusal: { sentence: 'A board with the id `treasury` already exists. Add it under another id.', nextFreeId: 'treasury-2' },
  ...over,
})

/** The Hats tree after its add (§11.2's receipt): one receipt, decided by a proposal, that created one record. */
export const hatsPreview = (over: Partial<LibraryPreview> = {}): LibraryPreview => preview({
  id: 'system:hats-tree', blocks: [], asks: [], fields: [],
  adds: [{ record: 'systems:hats-tree', op: 'create', class: 'governed', summary: 'Hats tree' }],
  needs: [{ text: 'A governance file', met: true }],
  reaches: [{ host: 'api.hatsprotocol.xyz', reads: 'read only' }],
  decided: [{ class: 'governed', direct: false, sentence: 'Council consent: 4 of the 8 who wear the Council hat.' }],
  source: { name: 'dao', version: '0.1.0', standing: 'stated', as_of: '2026-10-18' },
  refusal: { sentence: 'A system with the id `hats-tree` already exists. Add it under another id.', nextFreeId: 'hats-tree-2' },
  receipts: [{ id: 'system-hats-tree', at: '2026-10-12', by: 'steward-a' }],
  ...over,
})

/** The receipts as data/library.yaml holds them: the Hats tree's, decided by a proposal, and the test desk's,
 *  applied directly. */
export const RECEIPTS: Receipt[] = [
  { id: 'system-hats-tree', entry: 'system:hats-tree', version: '0.1.0', shelf: 'dao', created: [{ record: 'systems:hats-tree', base: 'b1' }],
    status: 'installed', by: 'steward-a', at: '2026-10-12', decision: { proposal: 'p-2026-10-12-001-ab12' }, removed: null },
  { id: 'board-test-desk', entry: 'board:test-desk', version: '1.0.0', shelf: 'framework',
    created: [{ record: 'boards:test-desk', base: 'b2' }, { record: 'systems:test-link', base: 'b3' }],
    status: 'installed', by: 'steward-a', at: '2026-10-29', decision: { rule: 'records', change: 'chg_1' }, removed: null },
]
