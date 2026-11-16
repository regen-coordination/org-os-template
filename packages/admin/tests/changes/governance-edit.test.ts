// DAO-OS L7-D10: the change engine edits data/governance.yaml's roles and rules and keeps every other byte of the file.
import { describe, it, expect } from 'vitest'
import { writeGovernanceBlocks } from '../../server/changes/governance-edit.ts'

const FILE = `# The governance of Test DAO.
schema_version: "2.0"

governance:
  # how decisions are made
  model: steward-council # keep this one
  # who does what
  roles:
    stewards: { members: [steward-a] } # the only one
  # when the roles decide
  rules:
    - id: members
      applies_to: [records, members]
      propose: stewards
      decide: { by: stewards, method: direct }
  decisions: []
  # a note kept after the blocks
`

describe('writeGovernanceBlocks', () => {
  it('replaces roles and rules and keeps every line outside them, comments included', () => {
    const out = writeGovernanceBlocks(FILE, {
      roles: { stewards: { members: ['steward-a', 'steward-b'] } },
      rules: [{ id: 'members', applies_to: ['records'], propose: 'stewards', decide: { by: 'stewards', method: 'direct' } }],
    })
    // Everything outside the two blocks is the file's own lines, in order.
    const wanted = [
      '# The governance of Test DAO.', 'schema_version: "2.0"', '', 'governance:', '  # how decisions are made',
      '  model: steward-council # keep this one', '  # who does what', '  roles:', '    stewards:', '      members:', '        - steward-a', '        - steward-b',
      '  # when the roles decide', '  rules:', '    - id: members', '      applies_to:', '        - records', '      propose: stewards', '      decide:',
      '        by: stewards', '        method: direct', '  decisions: []', '  # a note kept after the blocks', '',
    ]
    expect(out.split('\n')).toEqual(wanted)
    expect(out).toContain('# The governance of Test DAO.')
    expect(out).toContain('  # how decisions are made\n  model: steward-council # keep this one\n  # who does what\n')
    expect(out).toContain('  # when the roles decide\n')
    expect(out).toContain('  decisions: []\n  # a note kept after the blocks\n')
    expect(out).toContain('  roles:\n')
    expect(out).toContain('  rules:\n')
    expect(out).not.toContain('the only one')
  })

  it('touching only rules leaves the roles block byte for byte', () => {
    const out = writeGovernanceBlocks(FILE, { rules: [{ id: 'records', applies_to: ['records'], propose: 'stewards', decide: { by: 'stewards', method: 'direct' } }] })
    expect(out).toContain('    stewards: { members: [steward-a] } # the only one\n')
    expect(out).toContain('id: records')
    expect(out).not.toContain('id: members')
    expect(out.endsWith('  decisions: []\n  # a note kept after the blocks\n')).toBe(true)
  })

  it('a rules block that is the last thing in the file is replaced and the text after it stays', () => {
    const text = 'governance:\n  model: x\n  rules:\n    - id: a\n# the end\n'
    const out = writeGovernanceBlocks(text, { rules: [{ id: 'b' }] })
    expect(out).toBe('governance:\n  model: x\n  rules:\n    - id: b\n# the end\n')
  })

  it('inserts roles into a file that has none, before the first other key under governance', () => {
    const text = 'schema_version: "2.0"\ngovernance:\n  # the model\n  model: steward-council\n  decisions: []\n'
    const out = writeGovernanceBlocks(text, { roles: { stewards: { members: ['steward-a'] } } })
    expect(out).toBe('schema_version: "2.0"\ngovernance:\n  roles:\n    stewards:\n      members:\n        - steward-a\n  # the model\n  model: steward-council\n  decisions: []\n')
  })

  it('inserts roles then rules together, in that order', () => {
    const text = 'governance:\n  model: x\n'
    const out = writeGovernanceBlocks(text, { rules: [{ id: 'r' }], roles: { a: { members: [] } } })
    expect(out.indexOf('roles:')).toBeLessThan(out.indexOf('rules:'))
    expect(out.indexOf('rules:')).toBeLessThan(out.indexOf('model:'))
  })

  it('throws a sentence for a file of several documents', () => {
    expect(() => writeGovernanceBlocks('governance:\n  model: x\n---\nother: 1\n', { roles: {} }))
      .toThrow('data/governance.yaml holds several YAML documents; edit it by hand.')
  })

  it('throws a sentence for a file that does not parse', () => {
    expect(() => writeGovernanceBlocks('governance: [\n', { roles: {} }))
      .toThrow(/^data\/governance\.yaml is not valid YAML, so it is not edited here/)
  })
})
