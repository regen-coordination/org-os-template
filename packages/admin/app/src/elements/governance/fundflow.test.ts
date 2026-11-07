import { describe, it, expect } from 'vitest'
import { FLOWS, FLOW_WINDOW, MIXED_FLOWS } from '../../test/fixtures/house/governance.ts'
import { bandWidths, flowSentence, type Flow } from './fundflow.ts'

/** NBSP between an amount and its unit, read as a space. */
const plain = (s: string) => s.replace(/\u00a0/g, ' ')
const flow = (value: string, unit = 'USDGLO'): Flow => ({ from: 'A', to: 'B', value, unit, status: 'executed' })

describe('bandWidths (§9.8, C-31)', () => {
  it('is 2 + 12 × value ÷ the largest value, in one unit', () => {
    expect(bandWidths([flow('100'), flow('100'), flow('200')])).toEqual([8, 8, 14])
  })

  it('draws a zero value 2 wide, and a window where nothing moved all 2', () => {
    expect(bandWidths([flow('0'), flow('50')])).toEqual([2, 14])
    expect(bandWidths([flow('0'), flow('0')])).toEqual([2, 2])
  })

  it('draws every band 8 wide when the window holds two units', () => {
    expect(bandWidths([flow('100'), flow('100', 'G$'), flow('200')])).toEqual([8, 8, 8])
    expect(bandWidths(MIXED_FLOWS)).toEqual([8, 8, 8])
  })

  it('reads exact decimal strings: 18-decimal values and values above 2^53 keep their share', () => {
    expect(bandWidths([flow('0.000000000000000001'), flow('0.000000000000000002')])).toEqual([8, 14])
    expect(bandWidths([flow('9007199254740993'), flow('18014398509481986')])).toEqual([8, 14])
    expect(bandWidths(FLOWS)).toEqual([14, 3.98, 8.1, 10.78])
  })

  it('no flows, no bands', () => {
    expect(bandWidths([])).toEqual([])
  })
})

describe('flowSentence', () => {
  it('says every flow: its amount and unit, from, to, and its status, in the window', () => {
    expect(plain(flowSentence(FLOWS, FLOW_WINDOW))).toBe(
      'In the last 90 days: 2,500.00 USDGLO from Ops wallet to Treasury, executed; 412.00 USDGLO from Gitcoin round to Treasury, executed; '
      + '1,271.00 USDGLO from Treasury to Network Projects, proposed; 1,829.00 USDGLO from Treasury to Local Starter, prepared.',
    )
  })

  it('says nothing moved when nothing did', () => {
    expect(flowSentence([], FLOW_WINDOW)).toBe('Nothing moved in the last 90 days.')
  })
})
