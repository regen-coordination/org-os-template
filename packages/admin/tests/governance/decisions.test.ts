import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REAL_REPO } from '../fixtures.ts'
import { DECISIONS } from './fixtures.ts'
import { parseDecisions, sectionText } from '../../server/governance/decisions.ts'

describe('parseDecisions', () => {
  it('reads both heading styles, with and without an id, and the Status line in each form', () => {
    expect(parseDecisions(DECISIONS).map(({ date, id, title, status, anchor }) => ({ date, id, title, status, anchor }))).toEqual([
      { date: '2026-10-16', id: 'LD-2026-035', title: 'co-fund becomes a platform', status: 'active', anchor: '2026-10-16-ld-2026-035' },
      { date: '2026-10-12', id: '', title: 'Buzz lane graduated — to the hosted relay', status: 'superseded', anchor: '2026-10-12-buzz-lane-graduated-to-the-hosted-relay' },
      { date: '2026-08-21', id: '', title: 'External-validation milestone', status: 'withdrawn', anchor: '2026-08-21-external-validation-milestone' },
      { date: '2026-08-21', id: '', title: 'External-validation milestone', status: '', anchor: '2026-08-21-external-validation-milestone-2' },
    ])
  })

  it('a section is its text up to the next heading, without the closing rule', () => {
    const [first] = parseDecisions(DECISIONS)
    expect(sectionText(DECISIONS, first!)).toBe(
      '## 2026-10-16 · LD-2026-035 — co-fund becomes a platform\n\n- **Status:** active; amends `LD-2026-012`\n- **Scope:** co-fund\n\n**Decision** — It does.')
    expect(sectionText(DECISIONS, parseDecisions(DECISIONS)[1]!)).toContain('### Detail\n\nText.')
  })

  it('reads every dated heading of the framework\'s own DECISIONS.md, each with a status and its own anchor', () => {
    const text = readFileSync(join(REAL_REPO, 'DECISIONS.md'), 'utf8')
    const dated = text.split('\n').filter(l => /^## \d{4}-\d{2}-\d{2}/.test(l)).length
    const rows = parseDecisions(text)
    expect(rows).toHaveLength(dated)
    expect(rows.filter(r => r.status === '').map(r => r.title)).toEqual([])
    expect(new Set(rows.map(r => r.anchor)).size).toBe(rows.length)
  })
})
