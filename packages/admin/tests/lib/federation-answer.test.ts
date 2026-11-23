// The hub's answer as the node says it (Task 15 ruling, concern 4): the verdict word once, never "Accepted: Accepted: …".
import { describe, it, expect } from 'vitest'
import { answerLine, verdictReason } from '../../lib/federation/answer.mjs'

describe('answerLine', () => {
  it('says the word once, whether or not the reason starts with it', () => {
    expect(answerLine('accepted', 'Accepted: Welcome to Delta.')).toBe('Accepted: Welcome to Delta.')
    expect(answerLine('accepted', 'Welcome to Delta.')).toBe('Accepted: Welcome to Delta.')
    expect(answerLine('refused', 'Refused: not a fit.')).toBe('Refused: not a fit.')
    expect(answerLine('refused', 'refused - full this season')).toBe('Refused: full this season')
    expect(answerLine('accepted', 'Accepted')).toBe('Accepted.')
    expect(answerLine('accepted', undefined)).toBe('Accepted.')
    expect(answerLine('refused', '')).toBe('Refused.')
  })
  it('leaves a reason that only begins like the word alone', () => {
    expect(verdictReason('Acceptedly so')).toBe('Acceptedly so')
    expect(verdictReason('  Accepted:  yes ')).toBe('yes')
  })
})
