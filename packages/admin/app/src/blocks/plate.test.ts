import { describe, it, expect } from 'vitest'
import { brokenFileOf, hiddenWords } from './plate.tsx'

describe('brokenFileOf: the file, line and reason from the server’s own sentence (walk R-6)', () => {
  it('reads a read refusal with its line', () => {
    expect(brokenFileOf('data/funding-opportunities.yaml cannot be read: at line 12, column 5, *a reuses a value marked &a. In the file, write the value.'))
      .toEqual({ file: 'data/funding-opportunities.yaml', line: 12, reason: '*a reuses a value marked &a. In the file, write the value.' })
  })

  it('reads the records adapter’s card, and a strict read’s write refusal, without "Nothing was written"', () => {
    expect(brokenFileOf('cannot be read: data/ideas.yaml cannot be read: at line 2, column 1, bad.')).toEqual({ file: 'data/ideas.yaml', line: 2, reason: 'bad.' })
    expect(brokenFileOf('Not saved: data/boards.yaml is not valid YAML, so this app will not rewrite it: at line 3, column 1, a tab. Nothing was written. Fix it.'))
      .toEqual({ file: 'data/boards.yaml', line: 3, reason: 'a tab. Fix it.' })
  })

  it('gives the reason alone where the sentence carries no line, and nothing for a sentence about no file it could not read', () => {
    expect(brokenFileOf('data/boards.yaml is not valid YAML: fix it by hand.')).toEqual({ file: 'data/boards.yaml', reason: 'fix it by hand.' })
    expect(brokenFileOf('No board "x". GET /api/boards lists the boards.')).toBeNull()
    expect(brokenFileOf('resources are down')).toBeNull()
  })
})

describe('hiddenWords: what the filters hid, most first', () => {
  it('counts each value, joins the last with "and", and says a row with none has no status', () => {
    expect(hiddenWords(['closed', 'draft', 'closed', 'closed', 'draft', 'closed'])).toBe('4 are closed and 2 are draft.')
    expect(hiddenWords(['open'])).toBe('1 is open.')
    expect(hiddenWords(['a', 'b', '', ''])).toBe('2 have no status, 1 is a and 1 is b.')
    expect(hiddenWords([])).toBe('')
  })
})
