import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { insertDecisionRow, nextDecisionId, insertDecisionsMdEntry } from '../../lib/decision-write.mjs'

const ROW = {
  id: 'gov-20261018-001', proposal: 'p-2026-10-18-001', rule: 'records', method: 'approve', outcome: 'ratified', status: 'ratified',
  by: ['bruno'], date: '2026-10-18', title: 'Move one project to develop', summary: '1 approval (bruno); no objection.',
}
type Spliced = ReturnType<typeof insertDecisionRow>
const ok = (r: Spliced): string => { if (!r.ok) throw new Error(r.reason); return r.text }
const reason = (r: Spliced): string => { if (r.ok) throw new Error('expected a refusal'); return r.reason }

describe('the module is pure text', () => {
  const src = readFileSync(new URL('../../lib/decision-write.mjs', import.meta.url), 'utf8')
  it('imports nothing from node:fs, node:child_process or server/', () => {
    const specifiers = [...src.matchAll(/^\s*import[^'"]*['"]([^'"]+)['"]/gm)].map(m => m[1])
    expect(specifiers).toEqual(['yaml'])
    expect(src).not.toMatch(/node:fs|node:child_process|server\//)
  })
  it('no exported function takes a repository path or a revision', async () => {
    const mod = await import('../../lib/decision-write.mjs')
    expect(Object.keys(mod).sort()).toEqual(['insertDecisionRow', 'insertDecisionsMdEntry', 'nextDecisionId'])
    for (const name of ['insertDecisionRow', 'insertDecisionsMdEntry', 'nextDecisionId'] as const) {
      expect(src).not.toMatch(new RegExp(`export function ${name}\\([^)]*(repo|rev|path|head)`, 'i'))
    }
  })
})

describe('nextDecisionId', () => {
  it('counts among that day’s rows, starting at 001', () => {
    expect(nextDecisionId([], '2026-10-18')).toBe('gov-20261018-001')
    expect(nextDecisionId([{ id: 'gov-20261018-001' }, { id: 'gov-20261017-009' }], '2026-10-18')).toBe('gov-20261018-002')
    expect(nextDecisionId([{ id: 'gov-20261018-002' }, { id: 'odd' }, {}], '2026-10-18')).toBe('gov-20261018-003')
  })
})

describe('insertDecisionRow', () => {
  it('writes `status`, equal to the outcome, which the governance schema requires of every row (Task 11a ruling)', () => {
    const out = ok(insertDecisionRow('governance:\n  decisions: []\n', ROW))
    expect(out).toContain('      outcome: "ratified"\n      status: "ratified"\n')
    expect(parse(out).governance.decisions[0].status).toBe('ratified')
  })
  const empty = 'schema_version: "2.0"\ngovernance:\n  model: consensus\n  decisions: []\n  # a comment after\n  review: yearly\n'
  it('turns decisions: [] into a block list and keeps the comment lines after it', () => {
    const out = ok(insertDecisionRow(empty, ROW))
    expect(out).toContain('  decisions:\n    - id: "gov-20261018-001"\n')
    expect(out).toContain('  # a comment after\n  review: yearly\n')
    expect(parse(out).governance.decisions).toEqual([ROW])
    expect(parse(out).governance.review).toBe('yearly')
  })
  it('appends to a non-empty block list, after the last row and before the next key', () => {
    const text = 'governance:\n  decisions:\n    - id: "gov-1"\n      title: "One"\n    # between\n    - id: "gov-2"\n      title: "Two"\n  review: yearly\n'
    const out = ok(insertDecisionRow(text, ROW))
    expect(parse(out).governance.decisions.map((d: { id: string }) => d.id)).toEqual(['gov-1', 'gov-2', 'gov-20261018-001'])
    expect(out.startsWith(text.slice(0, text.indexOf('  review')))).toBe(true)
    expect(out.endsWith('  review: yearly\n')).toBe(true)
  })
  it('adds the key when the governance block has none', () => {
    const text = '# top\ngovernance:\n  model: consensus\n\nother: 1\n'
    const out = ok(insertDecisionRow(text, ROW))
    expect(parse(out).governance.decisions).toEqual([ROW])
    expect(parse(out).other).toBe(1)
    expect(out).toContain('# top\n')
  })
  it('keeps every other byte: the text before and after the splice is untouched', () => {
    const text = 'a: 1   # trailing   \ngovernance:\n  decisions: []\nz:   2\n'
    const out = ok(insertDecisionRow(text, ROW))
    expect(out.startsWith('a: 1   # trailing   \ngovernance:\n')).toBe(true)
    expect(out.endsWith('z:   2\n')).toBe(true)
  })
  it('keeps CRLF line endings, in the new lines too', () => {
    const text = 'governance:\r\n  decisions: []\r\n  review: yearly\r\n'
    const out = ok(insertDecisionRow(text, ROW))
    expect(out.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
    expect(parse(out).governance.decisions).toEqual([ROW])
  })
  it('a rules list that already carries a change keeps it', () => {
    const text = 'governance:\n  rules:\n    - id: records\n      applies_to: [records]\n    - id: added-by-the-branch\n      applies_to: [people]\n  decisions: []\n'
    const out = ok(insertDecisionRow(text, ROW))
    expect(parse(out).governance.rules.map((r: { id: string }) => r.id)).toEqual(['records', 'added-by-the-branch'])
    expect(parse(out).governance.decisions).toEqual([ROW])
  })
  it('the result is the original plus the row (re-parsed)', () => {
    const text = 'governance:\n  decisions:\n    - id: "x"\n  other: [1, 2]\n'
    const out = ok(insertDecisionRow(text, ROW))
    const expected = parse(text); expected.governance.decisions.push(ROW)
    expect(parse(out)).toEqual(expected)
  })
  it('refuses flow style, no wrapper, a multi-document file, and unparsable text — each with a sentence naming the row', () => {
    for (const bad of [
      'governance:\n  decisions: [{id: a}]\n',
      'decisions: []\nmodel: consensus\n',
      'governance:\n  decisions: []\n---\nsecond: 1\n',
      'governance: [unclosed\n',
      'governance: {decisions: []}\n',
    ]) {
      const why = reason(insertDecisionRow(bad, ROW))
      expect(why, bad).toMatch(/gov-20261018-001/)
      expect(why, bad).toMatch(/by hand/)
    }
  })
})

const MD = [
  '# DECISIONS.md — Key Decisions Log', '', '_Append-only._', '', '## Conventions', '', '- **Status** — x', '', '---', '',
  '## 2026-10-16 · LD-2026-035 — Co-fund becomes a platform', '', '**Status:** active', '**Scope:** x', '', '**Decision** — d', '',
  '---', '', '## 2026-08-29 · LD-2026-001 — Older', '', 'body', '', '---', '',
].join('\n')
const ENTRY = {
  date: '2026-10-18', title: 'Change the review rule', scope: 'governance',
  decision: 'Two approvals for governance changes.', why: 'One person should not decide alone.',
  proposal: 'p-2026-10-18-001', decisionId: 'gov-20261018-001',
}

describe('insertDecisionsMdEntry', () => {
  // Final review M3: a Decision or Why line that begins "## ", or a "---" line, starts an entry (or ends one) of its own,
  // so the file would read as two entries; a title or scope with a line break breaks the heading. Refused, in words.
  it.each([
    ['a Why line that begins "## "', { why: 'One person should not decide alone.\n## Not a heading' }, /why.*"## "/i],
    ['a Decision line that begins "# "', { decision: 'Two approvals.\n# Title' }, /decision.*heading/i],
    ['a "---" line in the Why', { why: 'First.\n---\nSecond.' }, /why.*"---"/i],
    ['a title with a line break', { title: 'Change\nthe rule' }, /title.*one line/i],
    ['a scope with a line break', { scope: 'governance\nrecords' }, /scope.*one line/i],
  ])('refuses %s, and writes nothing', (_name, over, said) => {
    const r = insertDecisionsMdEntry(MD, { ...ENTRY, ...over })
    expect(r.ok).toBe(false)
    expect((r as { reason: string }).reason).toMatch(said as RegExp)
  })
  it('a line that only holds "##" inside a word, or a "--" line, is written as it is', () => {
    const out = ok(insertDecisionsMdEntry(MD, { ...ENTRY, why: 'Tagged #governance ## inside.\n--\nok' }))
    expect(out).toContain('**Why** — Tagged #governance ## inside.\n--\nok')
  })
  it('continues the newest heading’s id and goes in after the Conventions block’s ---', () => {
    const out = ok(insertDecisionsMdEntry(MD, ENTRY))
    const heads = out.split('\n').filter(l => l.startsWith('## '))
    expect(heads).toEqual([
      '## Conventions',
      '## 2026-10-18 · LD-2026-036 — Change the review rule',
      '## 2026-10-16 · LD-2026-035 — Co-fund becomes a platform',
      '## 2026-08-29 · LD-2026-001 — Older',
    ])
    expect(out).toContain('**Status:** active\n**Scope:** governance\n\n**Decision** — Two approvals for governance changes.\n\n**Why** — One person should not decide alone.\n\n**Refs** — proposal p-2026-10-18-001, decision gov-20261018-001 in data/governance.yaml\n\n---\n\n## 2026-10-16')
  })
  it('never touches the rest: removing the new section gives the original', () => {
    const out = ok(insertDecisionsMdEntry(MD, ENTRY))
    const at = out.indexOf('## 2026-10-18')
    const to = out.indexOf('## 2026-10-16')
    expect(out.slice(0, at) + out.slice(to)).toBe(MD)
  })
  it('a different prefix and width continue as they are', () => {
    const md = MD.replace('LD-2026-035', 'GOV-0099').replace('LD-2026-001', 'GOV-0001')
    expect(ok(insertDecisionsMdEntry(md, ENTRY))).toContain('## 2026-10-18 · GOV-0100 — Change the review rule')
  })
  it('a newest heading with no id gives a date-and-title heading', () => {
    const md = MD.replace('## 2026-10-16 · LD-2026-035 — Co-fund becomes a platform', '## 2026-10-16 — Co-fund becomes a platform')
    expect(ok(insertDecisionsMdEntry(md, ENTRY))).toContain('\n## 2026-10-18 — Change the review rule\n')
  })
  it('keeps CRLF', () => {
    const out = ok(insertDecisionsMdEntry(MD.replace(/\n/g, '\r\n'), ENTRY))
    expect(out.replace(/\r\n/g, '')).not.toMatch(/\n/)
  })
  it('refuses a file without the --- or the Conventions block, naming what to add', () => {
    expect(reason(insertDecisionsMdEntry('# x\n\n## 2026-10-16 · LD-1 — t\n', ENTRY))).toMatch(/Conventions/)
    expect(reason(insertDecisionsMdEntry('# x\n\n## Conventions\n\n- a\n', ENTRY))).toMatch(/---/)
  })
})
