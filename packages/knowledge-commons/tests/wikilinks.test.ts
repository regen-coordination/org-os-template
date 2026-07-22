import { describe, it, expect } from 'vitest'
import { extractWikilinks } from '../src/wikilinks.ts'

describe('extractWikilinks', () => {
  it('parses target, heading, and alias forms', () => {
    const links = extractWikilinks('See [[Mutual Credit]] and [[Reserve Ratio#math|the math]].')
    expect(links).toEqual([
      { raw: '[[Mutual Credit]]', target: 'Mutual Credit', heading: null, alias: null },
      { raw: '[[Reserve Ratio#math|the math]]', target: 'Reserve Ratio', heading: 'math', alias: 'the math' },
    ])
  })
  it('ignores code fences and inline code', () => {
    const md = 'a `[[not a link]]` b\n```\n[[also not]]\n```\n[[Real]]'
    expect(extractWikilinks(md).map(l => l.target)).toEqual(['Real'])
  })
})
