import { describe, it, expect } from 'vitest'
import { parseStatusV2 } from '../../lib/git-status-v2.mjs'

const head = (lines: string[]) => lines.join('\n') + '\n'

describe('parseStatusV2', () => {
  it('reads a clean tracked branch', () => {
    expect(parseStatusV2(head(['# branch.oid abc', '# branch.head main', '# branch.upstream origin/main', '# branch.ab +0 -0'])))
      .toEqual({ branch: 'main', ahead: 0, behind: 0, dirty: false })
  })
  it('reads ahead 2 and behind 1', () => {
    expect(parseStatusV2(head(['# branch.head dev', '# branch.ab +2 -1'])))
      .toEqual({ branch: 'dev', ahead: 2, behind: 1, dirty: false })
  })
  it('gives a null branch when detached', () => {
    expect(parseStatusV2(head(['# branch.oid abc', '# branch.head (detached)'])))
      .toEqual({ branch: null, ahead: null, behind: null, dirty: false })
  })
  it('gives null counts with no upstream', () => {
    expect(parseStatusV2(head(['# branch.oid abc', '# branch.head main'])))
      .toEqual({ branch: 'main', ahead: null, behind: null, dirty: false })
  })
  it('is dirty with one untracked line', () => {
    expect(parseStatusV2(head(['# branch.head main', '# branch.ab +0 -0', '? notes.txt'])).dirty).toBe(true)
  })
})
