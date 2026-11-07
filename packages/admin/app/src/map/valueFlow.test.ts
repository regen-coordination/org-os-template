import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { FLOW_RUNS, FLOW_RUN_MS, flowDirection, flowSentence, withNeeds } from './valueFlow.ts'
import type { MapNodeData } from './HouseNode.tsx'
import { blockAfter, declarations } from '../design/skins/read.ts'

const house = readFileSync(join(process.cwd(), 'app/src/design/skins/house.css'), 'utf8') // vitest runs from packages/admin

describe('value moving (§8.5)', () => {
  it('says what moved, prepared and read back executed', () => {
    expect(flowSentence({ nonce: 18, phase: 'prepared', amount: '3,100 USDGLO', from: 'the two pools', to: 'the Treasury' }))
      .toBe('Transaction 18 prepared. It moves 3,100 USDGLO from the two pools to the Treasury.')
    expect(flowSentence({ nonce: 18, phase: 'executed', amount: '3,100 USDGLO', from: 'the two pools', to: 'the Treasury' }))
      .toBe('Transaction 18 executed. It moved 3,100 USDGLO from the two pools to the Treasury.')
  })

  it('runs three times, each as long as the skin’s --dur-flow', () => {
    expect(FLOW_RUNS).toBe(3)
    expect(`${FLOW_RUN_MS}ms`).toBe(declarations(blockAfter(house, ':root[data-skin="house"] {'))['dur-flow'])
  })

  it('touches an edge either way: along it, or against it (value going back up)', () => {
    const flow = { id: 'f', edges: [['b', 'a'], ['b', 'c']] as [string, string][], sentence: '' }
    expect(flowDirection(flow, 'a', 'b')).toBe('against')
    expect(flowDirection(flow, 'b', 'c')).toBe('along')
    expect(flowDirection(flow, 'a', 'c')).toBeNull()
    expect(flowDirection(null, 'a', 'b')).toBeNull()
  })
})

describe('attention on the map (§8.5: it matches Needs you one to one)', () => {
  const node = (id: string, states: MapNodeData['states'] = []): MapNodeData => ({ item: { id, kind: 'safe', name: id }, facts: '', states })
  it('lights every node a need names, with the first need that names it', () => {
    const out = withNeeds([node('a'), node('b', ['staged']), node('c')], [
      { title: 'Sign nonce 18', nodes: ['a'] }, { title: 'Return the pools', nodes: ['a', 'b'] }, { title: 'Elsewhere', nodes: ['z'] },
    ])
    expect(out.map(d => [d.item.id, d.states, d.need])).toEqual([
      ['a', ['needs'], 'Sign nonce 18'], ['b', ['staged', 'needs'], 'Return the pools'], ['c', [], undefined],
    ])
  })
})
