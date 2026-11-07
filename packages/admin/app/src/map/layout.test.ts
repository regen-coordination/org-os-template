import { describe, it, expect } from 'vitest'
import { layoutBoard, COL_W, ROW_H } from './layout.ts'

const n = (id: string, kind: string, name = id, level: 'warn' | 'alert' | null = null) => ({ id, kind, name, attention: level ? { level, text: '' } : null })

describe('layoutBoard', () => {
  it('puts each kind in its own column, in the fixed kind order', () => {
    const pos = layoutBoard([n('project:p', 'project'), n('person:a', 'person'), n('idea:i', 'idea')], [], [], {})
    expect([pos['person:a']!.x, pos['project:p']!.x, pos['idea:i']!.x]).toEqual([0, COL_W, 2 * COL_W])
  })

  it('orders the first column by attention, then name', () => {
    const pos = layoutBoard([n('person:c', 'person', 'Carla'), n('person:a', 'person', 'Ana'), n('person:z', 'person', 'Zé', 'alert'), n('person:b', 'person', 'Bia', 'warn')], [], [], {})
    expect(['person:z', 'person:b', 'person:a', 'person:c'].map(id => pos[id]!.y)).toEqual([0, ROW_H, 2 * ROW_H, 3 * ROW_H])
  })

  it('pulls a card towards its neighbours in earlier columns', () => {
    const nodes = [n('person:a', 'person', 'A'), n('person:b', 'person', 'B'), n('project:x', 'project', 'X'), n('project:y', 'project', 'Y')]
    const pos = layoutBoard(nodes, [{ from: 'project:x', to: 'person:b' }, { from: 'project:y', to: 'person:a' }], [], {})
    expect(pos['project:y']!.y).toBeLessThan(pos['project:x']!.y)
  })

  it('places portals after the last column, and lets saved positions win for known cards only', () => {
    const pos = layoutBoard([n('module:m', 'module')], [], [{ id: 'portal:organization' }], { 'module:m': { x: 5, y: 6 }, 'module:gone': { x: 1, y: 1 } })
    expect(pos).toEqual({ 'module:m': { x: 5, y: 6 }, 'portal:organization': { x: COL_W, y: 0 } })
  })
})
