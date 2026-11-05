// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import type { DriverRead } from '../../../../server/systems/driver.ts'
import { FromMark } from './FromMark.tsx'
import { RecordHeader } from '../records/RecordHeader.tsx'
import { PageHead } from '../../design/PageHead.tsx'
import type { From } from './from.ts'

const NOW = new Date('2026-10-17T12:00:00Z')
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString()
const read = (over: Partial<DriverRead> = {}): DriverRead => ({ ok: true, readAt: ago(2), facts: {}, sections: [], open: null, ...over })
const draw = (from: From) => render(<FromMark from={from} now={NOW} />).container.firstElementChild as HTMLElement

describe('the from mark (E-1, Q70)', () => {
  it('names a file of this repository and how long ago it was read; the age is a volatile <time>', () => {
    const mark = draw({ file: 'data/projects.yaml', readAt: ago(2) })
    expect(mark.textContent).toBe('from data/projects.yaml · read 2 min ago')
    const time = mark.querySelector('time')!
    expect(time.getAttribute('datetime')).toBe(ago(2))
    expect(time.hasAttribute('data-volatile')).toBe(true)
  })

  it('names another repository, and the file in it when there is one', () => {
    expect(draw({ repo: 'org-os', readAt: ago(2) }).textContent).toBe('from org-os · read 2 min ago')
    expect(draw({ repo: 'org-os', file: 'data/meetings.yaml', readAt: ago(60) }).textContent).toBe('from org-os · data/meetings.yaml · read 1 h ago')
  })

  it('names a System and its read age, and says a failed read failed, with the last good age', () => {
    const fresh = draw({ system: 'Treasury', read: read() })
    expect(fresh.textContent).toBe('from Treasury · read 2 min ago')
    expect(fresh.querySelector('[data-volatile] time')).toBeTruthy()
    expect(draw({ system: 'Treasury', read: read({ ok: false, state: 'failed', readAt: ago(120) }) }).textContent).toBe('from Treasury · couldn’t read · last 2 h ago')
    expect(draw({ system: 'Treasury', read: null }).textContent).toBe('from Treasury · not read yet')
  })

  it('shows the source alone when there is no time to name', () => {
    const mark = draw({ file: 'data/projects.yaml' })
    expect(mark.textContent).toBe('from data/projects.yaml')
    expect(mark.querySelector('time')).toBeNull()
    expect(draw({ file: 'data/projects.yaml', readAt: null }).textContent).toBe('from data/projects.yaml')
    expect(draw({ repo: 'org-os', readAt: 'not a time' }).textContent).toBe('from org-os')
  })

  it('names an import and the day it was exported, with no read age (R-L6-FM)', () => {
    const mark = draw({ import: 'Notion', exportedAt: '2026-08-12T09:00:00Z' })
    expect(mark.textContent).toBe('from Notion · exported 12 Aug')
    expect(mark.querySelector('time')!.getAttribute('datetime')).toBe('2026-08-12T09:00:00Z')
    expect(mark.textContent).not.toMatch(/read/)
    expect(draw({ import: 'Notion', exportedAt: '2025-08-12T09:00:00Z' }).textContent).toBe('from Notion · exported 12 Aug 2025')
  })

  it('names an import alone when its export time is not known (R-L6-FM)', () => {
    const mark = draw({ import: 'Notion', exportedAt: null })
    expect(mark.textContent).toBe('from Notion')
    expect(mark.querySelector('time')).toBeNull()
  })
})

describe('the from mark in the headers (E-2)', () => {
  const from = { file: 'data/projects.yaml', readAt: ago(2) }
  it('sits in a record header’s meta line, after its items', () => {
    const { container } = render(<RecordHeader variant="record" kind="project" id="project:br" title="Brasil" meta={['Opened 2 Oct']} from={from} now={NOW} />)
    expect([...container.querySelectorAll('.rh-meta .rh-m')].map(m => m.textContent)).toEqual(['Opened 2 Oct', 'from data/projects.yaml · read 2\u00a0min ago'])
  })

  it('sits at the end of a System header’s facts line', () => {
    const { container } = render(<RecordHeader variant="system" kind="safe" name="Treasury" read={read()} now={NOW} from={{ file: 'data/systems.yaml', readAt: ago(2) }} />)
    expect(container.querySelector('.rh-facts')!.lastElementChild!.textContent).toBe('from data/systems.yaml · read 2\u00a0min ago')
  })

  it('follows a page head’s meta, or stands alone in it', () => {
    const { container, unmount } = render(<PageHead title="Projects" meta={['data/projects.yaml', 'main']} from={from} now={NOW} />)
    expect(container.querySelector('.rh-meta')!.textContent).toBe('data/projects.yaml · main · from data/projects.yaml · read 2\u00a0min ago')
    unmount()
    const alone = render(<PageHead title="Projects" from={from} now={NOW} />)
    expect(alone.container.querySelector('.rh-meta')!.textContent).toBe('from data/projects.yaml · read 2\u00a0min ago')
  })

  it('draws nothing new where no from is given', () => {
    const { container } = render(<PageHead title="Projects" />)
    expect(container.querySelector('.rh-meta')).toBeNull()
  })
})
