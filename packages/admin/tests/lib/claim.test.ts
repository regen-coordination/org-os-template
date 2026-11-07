// packages/admin/tests/lib/claim.test.ts
//
// W2a's gate and its edit (wizards spec §5.4a): the one function every caller asks, and the
// text it writes. Each refusal is a case that must be able to fail.
import { describe, it, expect } from 'vitest'
import { parse } from 'yaml'
import {
  CLAIM_RULE, claimCandidates, claimRefusal, rulesAreImpliedSolo, rulesGate, planClaim, verifyClaim, slugOf, type ClaimState,
  OWNER_CLAIM_RULE, OWNER_CLAIM_COMMAND, NOT_LOCKED_OUT, lockedOut, oneHandleAdded,
} from '../../lib/claim.mjs'

const MEMBERS = `schema_version: "2.0"

# Members Registry
members:
  - id: "ana"          # the first
    name: "Ana Costa"
    role: "maintainer"
    handles:
      github: "ana-costa"
      address: "eip155:1:0xabc"
    joined: "2026-01-01"
  - id: "bo"
    name: "Bo Lind"
    handles:
      git: "bo@example.org"
  - id: "cy"
    name: "Cy Reed"
    joined: "2026-02-02"
`

const base = (over: Partial<ClaimState> = {}): ClaimState => ({
  address: 'ana@example.org',
  membersText: MEMBERS,
  governanceText: null,
  authors: ['ana@example.org', 'bo@example.org'],
  dirty: [],
  target: { member: 'ana' },
  ...over,
})

describe('rulesAreImpliedSolo: the one place the rule inputs are read', () => {
  it('is true with no governance file, an empty one, a solo model or an unstated one', () => {
    expect(rulesAreImpliedSolo(base({ governanceText: null }))).toBe(true)
    expect(rulesAreImpliedSolo(base({ governanceText: '' }))).toBe(true)
    expect(rulesAreImpliedSolo(base({ governanceText: '# nothing yet\n' }))).toBe(true)
    expect(rulesAreImpliedSolo(base({ governanceText: 'governance:\n  model: solo-maintainer\n' }))).toBe(true)
    expect(rulesAreImpliedSolo(base({ governanceText: 'governance:\n  model: solo-maintainer\n  rules: []\n' }))).toBe(true)
    expect(rulesAreImpliedSolo(base({ governanceText: 'governance:\n  decisions: {}\n' }))).toBe(true)
  })

  it('is false when any rule is written, whether or not it names members', () => {
    const rules = 'governance:\n  model: solo-maintainer\n  rules:\n    - id: r1\n      applies_to: [records]\n'
    expect(rulesAreImpliedSolo(base({ governanceText: rules }))).toBe(false)
    expect(rulesGate(base({ governanceText: rules }))).toBe('written')
  })

  it('treats a rules list of only malformed entries as written rules: refusing wins (LOW-2)', () => {
    expect(rulesGate(base({ governanceText: 'governance:\n  rules:\n    - nonsense\n    - 3\n' }))).toBe('written')
  })

  it('sees rules written at the top of a flat file, beside no governance block', () => {
    expect(rulesGate(base({ governanceText: 'model: solo-maintainer\nrules:\n  - id: r1\n' }))).toBe('written')
    expect(rulesGate(base({ governanceText: 'rules:\n  - id: r1\n' }))).toBe('unreadable')
  })

  it('refuses rules written at the top level beside a governance block: the wrapper does not hide them (M-1)', () => {
    // The gate reads the raw top level as well as the wrapper; a change that read only the wrapper would let a claim through.
    expect(rulesGate(base({ governanceText: 'governance:\n  model: solo-maintainer\nrules:\n  - id: r1\n' }))).toBe('written')
  })

  it('is false for a model that is not solo, even with no rules (the safe side)', () => {
    const s = base({ governanceText: 'governance:\n  model: consensus\n' })
    expect(rulesAreImpliedSolo(s)).toBe(false)
    expect(rulesGate(s)).toBe('model')
  })

  it('is false when governance.yaml is present and cannot be read (MEDIUM-1)', () => {
    for (const text of [
      'governance: [unclosed\n',                 // malformed YAML
      'governance:\n\tmodel: tab-indented\n',    // tabs
      '- a\n- list\n',                          // not a mapping
      'governance: 3\n',                         // a governance that is not a mapping
      'governance:\n  model: solo-maintainer\n---\nsecond: doc\n', // two documents
    ]) {
      const s = base({ governanceText: text })
      expect(rulesGate(s), text).toBe('unreadable')
      expect(rulesAreImpliedSolo(s), text).toBe(false)
    }
  })
})

describe('claimRefusal: every way the claim is refused, each with its sentence', () => {
  it('lets the one good case through', () => {
    expect(claimRefusal(base())).toBeNull()
  })

  it('refuses without a git address', () => {
    expect(claimRefusal(base({ address: null }))).toMatch(/no user\.email/)
  })

  it('refuses a known actor, by any of the three places an address is held', () => {
    expect(claimRefusal(base({ address: 'bo@example.org', target: { member: 'cy' } }))).toMatch(/already `bo`/)
    expect(claimRefusal(base({ address: 'BO@Example.org', target: { member: 'cy' } }))).toMatch(/already `bo`/)
    const email = MEMBERS.replace('joined: "2026-02-02"', 'email: "cy@example.org"')
    expect(claimRefusal(base({ membersText: email, address: 'cy@example.org', target: { member: 'cy' } }))).toMatch(/already `cy`/)
    const viaEmail = MEMBERS.replace('github: "ana-costa"', 'email: "ana@example.org"')
    expect(claimRefusal(base({ membersText: viaEmail }))).toMatch(/already `ana`/)
  })

  it('refuses when two members hold the address', () => {
    const two = MEMBERS.replace('joined: "2026-02-02"', 'email: "bo@example.org"')
    expect(claimRefusal(base({ membersText: two, address: 'bo@example.org', target: { member: 'ana' } }))).toMatch(/two members/i)
  })

  it('refuses written rules, a non-solo model and an unreadable governance file, each in its words', () => {
    // Task 11 (L5 F-L3-1): `- id: r1` alone covers no class, so it locks the org out; a rule for members that bo can
    // propose under is what this case now needs to read as "rules, and someone can propose" (Replaced tests).
    const rules = 'governance:\n  roles:\n    stewards: { members: [bo] }\n  rules:\n    - id: r1\n      applies_to: [members]\n' +
      '      propose: stewards\n      decide: { by: stewards, method: direct }\n'
    expect(claimRefusal(base({ governanceText: rules })))
      .toBe('This organisation has rules for who its members are. Ask a maintainer to add your address, or propose it.')
    expect(claimRefusal(base({ governanceText: 'governance:\n  model: consensus\n' }))).toMatch(/decides by consensus|not decided by one maintainer/)
    expect(claimRefusal(base({ governanceText: 'governance: [unclosed\n' }))).toMatch(/data\/governance\.yaml cannot be read/)
  })

  it('refuses a members file that cannot be read, or is missing', () => {
    expect(claimRefusal(base({ membersText: 'members: [unclosed\n' }))).toMatch(/data\/members\.yaml cannot be read/)
    expect(claimRefusal(base({ membersText: null }))).toMatch(/data\/members\.yaml/)
  })

  it('refuses a member who already holds an address, who is not a person, or who does not exist', () => {
    expect(claimRefusal(base({ target: { member: 'bo' } }))).toMatch(/`bo` already has a git address/)
    const agent = MEMBERS.replace('name: "Cy Reed"', 'name: "Cy Reed"\n    kind: agent')
    expect(claimRefusal(base({ membersText: agent, target: { member: 'cy' } }))).toMatch(/not a person/)
    expect(claimRefusal(base({ target: { member: 'nobody' } }))).toMatch(/no member `nobody`/)
  })

  it('refuses a create when a person is already a member, and allows it when none is', () => {
    expect(claimRefusal(base({ target: { create: 'Dee Fox' } }))).toMatch(/already has people/)
    const agentsOnly = 'members:\n  - id: bot\n    kind: agent\n'
    expect(claimRefusal(base({ membersText: agentsOnly, target: { create: 'Dee Fox' } }))).toBeNull()
    expect(claimRefusal(base({ membersText: 'members: []\n', target: { create: 'Dee Fox' } }))).toBeNull()
    expect(claimRefusal(base({ membersText: 'members: []\n', target: { create: '   ' } }))).toMatch(/name/)
    expect(claimRefusal(base({ membersText: 'members: []\n', target: { create: '!!!' } }))).toMatch(/letters or digits/)
  })

  it('refuses an address git has never seen author a commit here', () => {
    expect(claimRefusal(base({ authors: ['bo@example.org'] }))).toBe(
      'Git has never seen ana@example.org author a commit here; add it to data/members.yaml yourself, or commit once and try again.')
    expect(claimRefusal(base({ authors: null }))).toMatch(/could not list/)
  })

  it('refuses a members file with changes that are not committed, or that git hides', () => {
    expect(claimRefusal(base({ dirty: ['data/members.yaml'] }))).toMatch(/not committed/)
  })

  it('asks the gate before it asks about the member', () => {
    expect(claimRefusal(base({ governanceText: 'governance:\n  rules:\n    - id: r\n', target: { member: 'nobody' } }))).toMatch(/has rules/)
  })

  it('without a target it judges only what is true of the whole organisation', () => {
    expect(claimRefusal(base({ target: undefined }))).toBeNull()
    expect(claimRefusal(base({ target: undefined, address: 'bo@example.org' }))).toMatch(/already `bo`/)
  })
})

describe('planClaim: the lines that will be written, and the file after', () => {
  it('adds one line under an existing handles map, in that map\'s own indent', () => {
    const plan = planClaim(base())
    expect(plan.refusal).toBeNull()
    expect(plan.lines).toEqual(['      git: ana@example.org'])
    expect(plan.text!.split('\n').slice(7, 13)).toEqual([
      '    handles:', '      github: "ana-costa"', '      address: "eip155:1:0xabc"', '      git: ana@example.org', '    joined: "2026-01-01"', '  - id: "bo"',
    ])
  })

  it('adds two lines when the member has no handles map, after the member\'s last field', () => {
    const plan = planClaim(base({ target: { member: 'cy' } }))
    expect(plan.lines).toEqual(['    handles:', '      git: ana@example.org'])
    expect(plan.text!.endsWith('    joined: "2026-02-02"\n    handles:\n      git: ana@example.org\n')).toBe(true)
  })

  it('keeps every other byte: comments, blank lines, quoting', () => {
    const { text } = planClaim(base())
    const removed = text!.split('\n').filter(l => l !== '      git: ana@example.org')
    expect(removed.join('\n')).toBe(MEMBERS)
  })

  it('puts a new member in the shape the file already uses, and shows the id', () => {
    const plan = planClaim(base({ membersText: 'schema_version: "2.0"\nmembers:\n- id: bot\n  kind: agent\n', target: { create: 'Ana Costa' } }))
    expect(plan.refusal).toBeNull()
    expect(plan.id).toBe('ana-costa')
    expect(plan.lines).toEqual(['- id: ana-costa', '  name: "Ana Costa"', '  handles:', '    git: ana@example.org'])
    expect(plan.text).toBe('schema_version: "2.0"\nmembers:\n- id: bot\n  kind: agent\n- id: ana-costa\n  name: "Ana Costa"\n  handles:\n    git: ana@example.org\n')
  })

  it('writes the registry\'s own shape into an empty file or an empty list', () => {
    const empty = planClaim(base({ membersText: '', target: { create: 'Ana Costa' } }))
    expect(empty.text).toBe('schema_version: "2.0"\nmembers:\n  - id: ana-costa\n    name: "Ana Costa"\n    handles:\n      git: ana@example.org\n')
    const none = planClaim(base({ membersText: 'schema_version: "2.0"\n# nobody yet\nmembers: []\n', target: { create: 'Ana Costa' } }))
    expect(none.text).toBe('schema_version: "2.0"\n# nobody yet\nmembers:\n  - id: ana-costa\n    name: "Ana Costa"\n    handles:\n      git: ana@example.org\n')
  })

  it('quotes a name, so no name can write anything but a name', () => {
    const plan = planClaim(base({ membersText: 'members: []\n', target: { create: 'Ana "Nana" # Costa: ok' } }))
    expect(plan.refusal).toBeNull()
    const parsed = parse(plan.text!) as { members: { name: string }[] }
    expect(parsed.members[0]!.name).toBe('Ana "Nana" # Costa: ok')
    expect(planClaim(base({ membersText: 'members: []\n', target: { create: 'Ana\nid: root' } })).refusal).toMatch(/one line/)
  })

  it('refuses an address that could not be written as a plain value, and a layout it will not edit', () => {
    expect(planClaim(base({ address: 'a b@example.org', authors: ['a b@example.org'] })).refusal).toMatch(/cannot be written/)
    const flow = MEMBERS.replace('  - id: "cy"\n    name: "Cy Reed"\n    joined: "2026-02-02"\n', '  - { id: "cy", name: "Cy Reed" }\n')
    const plan = planClaim(base({ membersText: flow, target: { member: 'cy' } }))
    expect(plan.refusal).toMatch(/add this yourself/)
    expect(plan.text).toBeNull()
  })

  it('passes the same refusal the gate gives', () => {
    expect(planClaim(base({ governanceText: 'governance:\n  rules:\n    - id: r\n' })).refusal).toBe(claimRefusal(base({ governanceText: 'governance:\n  rules:\n    - id: r\n' })))
  })
})

describe('verifyClaim: the written file is the old one plus the address, and nothing else', () => {
  it('passes the planned text', () => {
    const plan = planClaim(base())
    expect(verifyClaim(MEMBERS, plan.text!, base())).toBeNull()
  })

  it('fails when another member changed, the address went to another member, or the file is not YAML', () => {
    const plan = planClaim(base())
    expect(verifyClaim(MEMBERS, plan.text!.replace('Bo Lind', 'Bo Lynd'), base())).toMatch(/other than/)
    expect(verifyClaim(MEMBERS, plan.text!.replace('ana@example.org', 'bo@example.org'), base())).toMatch(/does not name/)
    expect(verifyClaim(MEMBERS, 'members: [unclosed\n', base())).toMatch(/not valid YAML/)
    expect(verifyClaim(MEMBERS, MEMBERS, base())).toMatch(/does not name/)
  })

  it('fails when the result no longer matches the members schema', () => {
    const plan = planClaim(base())
    expect(verifyClaim(MEMBERS, plan.text!.replace('id: "ana"', 'id: ""'), base())).not.toBeNull()
  })
})

describe('every plan it makes verifies, in each layout the registries use', () => {
  const layouts: [string, string, ClaimState['target']][] = [
    ['an empty handles key', 'members:\n  - id: ana\n    handles:\n    joined: "2026"\n', { member: 'ana' }],
    ['handles last in the entry', 'members:\n  - id: ana\n    name: Ana\n    handles:\n      github: ana\n', { member: 'ana' }],
    ['a list at the margin', 'members:\n- id: ana\n  name: Ana\n  handles:\n    github: ana\n- id: bot\n  kind: agent\n', { member: 'ana' }],
    ['no trailing newline', 'members:\n  - id: ana\n    name: Ana', { member: 'ana' }],
    ['a trailing comment after the last field', 'members:\n  - id: ana\n    name: Ana # the first\n\n# next\n  - id: bo\n    name: Bo\n', { member: 'ana' }],
    ['a block list, create', 'members:\n  - id: bot\n    kind: agent\n', { create: 'Ana Costa' }],
    ['another top key, no members', '# only comments\nschema_version: "2.0"\n', { create: 'Ana Costa' }],
    ['members with nothing after it', 'members:\n', { create: 'Ana Costa' }],
  ]
  for (const [name, membersText, target] of layouts) {
    it(name, () => {
      const state = base({ membersText, target })
      const plan = planClaim(state)
      expect(plan.refusal).toBeNull()
      expect(verifyClaim(membersText, plan.text!, state)).toBeNull()
      expect(plan.text!.length).toBeGreaterThan(membersText.length)
    })
  }
})

describe('claimCandidates: who the page offers', () => {
  it('lists the persons who hold no address, and offers a first member only when no person exists', () => {
    expect(claimCandidates(base())).toEqual({ candidates: [{ id: 'ana', name: 'Ana Costa' }, { id: 'cy', name: 'Cy Reed' }], canCreate: false })
    expect(claimCandidates(base({ membersText: 'members: []\n' }))).toEqual({ candidates: [], canCreate: true })
    expect(claimCandidates(base({ membersText: 'members:\n  - id: bot\n    kind: agent\n' }))).toEqual({ candidates: [], canCreate: true })
    expect(claimCandidates(base({ membersText: 'members: [unclosed\n' }))).toEqual({ candidates: [], canCreate: false })
  })
})

describe('slugOf', () => {
  it('lowercases, drops accents, and keeps letters, digits and hyphens', () => {
    expect(slugOf('Ana Costa')).toBe('ana-costa')
    expect(slugOf('  José   Ñandú  ')).toBe('jose-nandu')
    expect(slugOf('A_B--C')).toBe('a-b-c')
    expect(slugOf('???')).toBe('')
  })
})

describe('the rule name', () => {
  it('is bootstrap/claim', () => { expect(CLAIM_RULE).toBe('bootstrap/claim') })
})

// ── DAO-OS L5 Task 11 (F-L3-1, spec §8.1): the owner's claim ─────────────────────────────────────────────
// Placeholders only: steward-a … ops-lead, addresses 0x…a1 … a4, tree eip155:42220:13.
describe("the owner's claim (L5 spec §8.1)", () => {
  const A1_LOWER = 'eip155:42220:0x00000000000000000000000000000000000000a1'
  const A1 = 'eip155:42220:0x00000000000000000000000000000000000000A1' // EIP-55, computed with @noble/hashes in Task 3's tests
  const STEWARDS = `schema_version: "2.0"
members:
  - id: "steward-a"
    name: "Steward A"
    handles:
      github: "steward-a"
  - id: "steward-b"
    name: "Steward B"
  - id: "ops-lead"
    name: "Ops lead"
    kind: agent
    handles:
      git: "ops-lead@example.invalid"
`
  const LOCKED = `governance:
  model: steward-council
  roles:
    stewards: { members: [steward-a] }
  rules:
    - id: members
      applies_to: [members, governance]
      propose: stewards
      decide: { by: stewards, method: direct }
`
  const SYSTEMS = 'systems:\n  - id: hats-main\n    kind: hats-tree\n    name: Hats\n    chain: "eip155:42220"\n    address: "13"\n'
  const LOCKED_SENTENCE = 'This organisation has rules for who its members are, and nobody can propose a change to them: the stewards role, ' +
    'which proposes them, holds no person with a git or wallet handle. Its owner can add a handle on the machine that holds the ' +
    'repository: node scripts/claim-handle.mjs --repo <instance> --owner --member <id> (--git <email> | --wallet <CAIP-10>)'
  const owner = (over: Partial<ClaimState> = {}): ClaimState => ({
    address: 'steward-a@example.invalid', membersText: STEWARDS, governanceText: LOCKED, systemsText: null,
    authors: ['steward-a@example.invalid'], dirty: [], target: { member: 'steward-a' }, owner: true, ...over,
  })

  it('names its rule and its command', () => {
    expect(OWNER_CLAIM_RULE).toBe('bootstrap/owner-claim')
    expect(OWNER_CLAIM_COMMAND).toBe('node scripts/claim-handle.mjs --repo <instance> --owner --member <id> (--git <email> | --wallet <CAIP-10>)')
  })

  it('locked out: rules written, and the members rule is missing or its propose role holds nobody who can act', () => {
    expect(lockedOut(owner())).toBe(true)
    expect(lockedOut(owner({ governanceText: LOCKED.replace('[members, governance]', '[governance]') }))).toBe(true)
    expect(lockedOut(owner({ governanceText: LOCKED.replace('[steward-a]', '[steward-a, ops-lead]') }))).toBe(true) // an agent is no person who can act
    expect(lockedOut(owner({ governanceText: LOCKED.replace('[steward-a]', '[steward-a, steward-b]'),
      membersText: STEWARDS.replace('    name: "Steward B"\n', '    name: "Steward B"\n    handles:\n      git: "steward-b@example.invalid"\n') }))).toBe(false)
    expect(lockedOut(owner({ governanceText: LOCKED.replace('stewards: { members: [steward-a] }', 'stewards: { hat: "eip155:42220:0x0000000d00010000000000000000000000000000000000000000000000000000" }') }))).toBe(false)
    expect(lockedOut(owner({ governanceText: null }))).toBe(false)
    expect(lockedOut(owner({ governanceText: 'governance:\n  model: solo-maintainer\n' }))).toBe(false)
  })

  it('a wallet off the membership tree\'s chain does not unlock it; one on the chain does', () => {
    const wallet = (w: string) => STEWARDS.replace('      github: "steward-a"\n', `      github: "steward-a"\n      wallet: "${w}"\n`)
    expect(lockedOut(owner({ membersText: wallet('eip155:1:0x00000000000000000000000000000000000000a1'), systemsText: SYSTEMS }))).toBe(true)
    expect(lockedOut(owner({ membersText: wallet(A1_LOWER), systemsText: SYSTEMS }))).toBe(false)
  })

  it('the 0.6 claim in a locked-out org refuses, and its sentence names the command', () => {
    const { owner: _o, ...asked } = owner({ address: 'someone@example.invalid', authors: ['someone@example.invalid'] })
    expect(claimRefusal(asked)).toBe(LOCKED_SENTENCE)
    expect(claimRefusal({ ...asked, governanceText: 'governance:\n  rules:\n    - id: r1\n' }))
      .toBe(LOCKED_SENTENCE.replace('the stewards role, which proposes them, holds no person with a git or wallet handle', 'no rule covers the class members'))
  })

  it('is refused when the org is not locked out', () => {
    const open = owner({ governanceText: LOCKED.replace('[steward-a]', '[steward-a, steward-b]'),
      membersText: STEWARDS.replace('    name: "Steward B"\n', '    name: "Steward B"\n    handles:\n      git: "steward-b@example.invalid"\n') })
    expect(NOT_LOCKED_OUT).toBe('This organisation is not locked out: someone can propose. Ask them.')
    expect(claimRefusal(open)).toBe(NOT_LOCKED_OUT)
    expect(claimRefusal(owner({ governanceText: null }))).toBe(NOT_LOCKED_OUT)
    expect(claimRefusal(owner({ governanceText: 'governance: [unclosed\n' }))).toMatch(/governance\.yaml cannot be read/)
  })

  it('keeps every other 0.6 check', () => {
    expect(claimRefusal(owner())).toBeNull()
    expect(claimRefusal(owner({ target: { member: 'ghost' } }))).toMatch(/no member `ghost`/)
    expect(claimRefusal(owner({ target: { member: 'ops-lead' } }))).toMatch(/not a person/)
    expect(claimRefusal(owner({ target: { create: 'Steward Z' } }))).toMatch(/--member/)
    expect(claimRefusal(owner({ address: 'ops-lead@example.invalid', authors: ['ops-lead@example.invalid'] }))).toMatch(/already `ops-lead`/)
    expect(claimRefusal(owner({ dirty: ['data/members.yaml'] }))).toMatch(/not committed/)
    expect(claimRefusal(owner({ authors: ['someone@example.invalid'] }))).toMatch(/never seen/)
    expect(claimRefusal(owner({ address: '' }))).toMatch(/--git/)
  })

  it('a wallet: a CAIP-10 account, on the tree\'s chain, held by nobody yet', () => {
    expect(claimRefusal(owner({ target: { member: 'steward-a', wallet: A1_LOWER }, authors: [] }))).toBeNull()
    expect(claimRefusal(owner({ target: { member: 'steward-a', wallet: '0x00000000000000000000000000000000000000a1' } }))).toMatch(/not a CAIP-10 account/)
    expect(claimRefusal(owner({ target: { member: 'steward-a', wallet: 'eip155:1:0x00000000000000000000000000000000000000a1' }, systemsText: SYSTEMS })))
      .toMatch(/is on eip155:1, and the membership tree eip155:42220:13 is on eip155:42220/)
    const held = STEWARDS.replace('    name: "Steward B"\n', `    name: "Steward B"\n    handles:\n      wallet: "${A1_LOWER}"\n`)
    expect(claimRefusal(owner({ membersText: held, target: { member: 'steward-a', wallet: A1 } }))).toMatch(/already in data\/members\.yaml, under `steward-b`/)
  })

  it('plans the one line, a git handle or a wallet in its EIP-55 form, and checks it', () => {
    const git = owner()
    const plan = planClaim(git)
    expect(plan.refusal).toBeNull()
    expect(plan.lines).toEqual(['      git: steward-a@example.invalid'])
    expect(verifyClaim(STEWARDS, plan.text!, git)).toBeNull()
    expect(parse(plan.text!).members[0].handles).toEqual({ github: 'steward-a', git: 'steward-a@example.invalid' })
    const w = owner({ target: { member: 'steward-a', wallet: A1_LOWER } })
    const wp = planClaim(w)
    expect(wp.refusal).toBeNull()
    expect(wp.lines).toEqual([`      wallet: ${A1}`])
    expect(verifyClaim(STEWARDS, wp.text!, w)).toBeNull()
    expect(parse(wp.text!).members[0].handles).toEqual({ github: 'steward-a', wallet: A1 })
    expect(verifyClaim(STEWARDS, wp.text!.replace('github: "steward-a"', 'github: "other"'), w)).toMatch(/other than the one line/)
  })

  it('oneHandleAdded: exactly one handle, to one person, and nothing else', () => {
    const plan = planClaim(owner())
    expect(oneHandleAdded(STEWARDS, plan.text!)).toBeNull()
    const wallet = planClaim(owner({ target: { member: 'steward-a', wallet: A1_LOWER } })).text!
    expect(oneHandleAdded(STEWARDS, wallet)).toBeNull()
    const two = plan.text!.replace('      git: steward-a@example.invalid\n', `      git: steward-a@example.invalid\n      wallet: ${A1}\n`)
    expect(oneHandleAdded(STEWARDS, two)).toMatch(/adds 2 handles/)
    expect(oneHandleAdded(STEWARDS, STEWARDS)).toMatch(/adds no handle/)
    expect(oneHandleAdded(STEWARDS, plan.text!.replace('name: "Steward B"', 'name: "Steward Bee"'))).toMatch(/changes 2 members/)
    expect(oneHandleAdded(STEWARDS, plan.text!.replace('name: "Steward A"', 'name: "Steward Aye"'))).toMatch(/more of `steward-a` than its handles/)
    expect(oneHandleAdded(STEWARDS, STEWARDS.replace('      git: "ops-lead@example.invalid"\n', '      git: ["ops-lead@example.invalid", "ops-2@example.invalid"]\n'))).toMatch(/not a person/)
    expect(oneHandleAdded(STEWARDS, `${STEWARDS}  - id: "steward-c"\n`)).toMatch(/adds or removes a member/)
  })
})
