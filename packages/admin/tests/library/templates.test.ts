import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadEntries, installsOf } from '../../server/library/read.ts'

/** The statuses the framework's own funding register documents: `status: pending # pending | applied | …`. */
const REGISTER = fileURLToPath(new URL('../../../../data/funding-opportunities.yaml', import.meta.url))
const registerStatuses = (): string[] => {
  const m = /status:\s*\S+\s*#\s*([a-z|\s]+)/.exec(readFileSync(REGISTER, 'utf8'))
  return m ? m[1]!.split('|').map(s => s.trim()).filter(Boolean) : []
}

describe('the board templates speak the framework\'s own vocabulary', () => {
  it('reads the register\'s statuses (the check can fail: it finds them)', () => {
    expect(registerStatuses()).toEqual(['pending', 'applied', 'approved', 'rejected', 'expired'])
  })

  it('funding-pipeline sorts by the register\'s statuses, so a real record lands in a real column and a move writes a real status', () => {
    const entry = loadEntries().find(e => e.id === 'board:funding-pipeline')!
    const stages = installsOf(entry).flatMap(op => (op.value?.blocks as { type: string; view?: { group?: string; columns?: string[] } }[] ?? []))
      .find(b => b.type === 'kanban')!
    expect(stages.view!.group).toBe('status')
    expect(stages.view!.columns).toEqual(registerStatuses())
  })
})
