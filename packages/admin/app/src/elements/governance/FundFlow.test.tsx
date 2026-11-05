// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { screen, within } from '@testing-library/react'
import { renderAt } from '../../test/render.tsx'
import { FLOWS, FLOW_SAFE, FLOW_WINDOW, MIXED_FLOWS } from '../../test/fixtures/house/governance.ts'
import { AMOUNT_MAX, FundFlow, NAME_MAX, SAFE_NAME_MAX } from './FundFlow.tsx'
import { flowSentence } from './fundflow.ts'

/** NBSP between an amount and its unit, read as a space. */
const plain = (s: string | null) => (s ?? '').replace(/\u00a0/g, ' ')
const css = readFileSync(join(process.cwd(), 'app/src/design/css/governance.css'), 'utf8') // vitest runs from packages/admin

describe('FundFlow (§9.8)', () => {
  it('is an img whose <title> is the full sentence', () => {
    const { container } = renderAt(<FundFlow flows={FLOWS} safe={FLOW_SAFE} window={FLOW_WINDOW} />)
    const img = screen.getByRole('img', { name: flowSentence(FLOWS, FLOW_WINDOW) })
    expect(img.tagName.toLowerCase()).toBe('svg')
    expect(img.querySelector('title')!.textContent).toBe(flowSentence(FLOWS, FLOW_WINDOW))
    // sources at the start, the Safe in the centre, destinations at the end: one node each, and the Safe's
    expect(container.querySelectorAll('rect.ff-nd')).toHaveLength(5)
    expect(container.querySelectorAll('rect.ff-safe')).toHaveLength(1)
    expect([...img.querySelectorAll('text.ff-m')].map(t => plain(t.textContent))).toEqual([
      '2,500.00 USDGLO', '412.00 USDGLO', '1,271.00 USDGLO · proposed', '1,829.00 USDGLO · prepared',
    ])
  })

  it('draws each band its width as the stroke-width attribute (data, not CSS); proposed and prepared carry the moss .5 class, executed neutral', () => {
    const { container } = renderAt(<FundFlow flows={FLOWS} safe={FLOW_SAFE} window={FLOW_WINDOW} />)
    const bands = [...container.querySelectorAll('path.ff-band')]
    expect(bands.map(b => b.getAttribute('stroke-width'))).toEqual(['14', '3.98', '8.1', '10.78'])
    expect(bands.map(b => b.classList.contains('ff-band-on'))).toEqual([false, false, true, true])
    expect(css).toMatch(/\.ff-band \{[^}]*stroke: var\(--rule-strong\);/)
    expect(css).toMatch(/\.ff-band-on \{[^}]*stroke: var\(--accent\);[^}]*opacity: var\(--o-proposed\);/)
    expect(css).not.toMatch(/stroke-width/)
  })

  it('a window of two units draws equal bands and labels each amount with its unit (C-31)', () => {
    const { container } = renderAt(<FundFlow flows={MIXED_FLOWS} safe={FLOW_SAFE} window={FLOW_WINDOW} />)
    expect([...container.querySelectorAll('path.ff-band')].map(b => b.getAttribute('stroke-width'))).toEqual(['8', '8', '8'])
    expect([...container.querySelectorAll('text.ff-m')].map(t => plain(t.textContent))).toEqual(['27,561,390.98 G$', '412.00 USDGLO', '1,271.00 USDGLO · proposed'])
  })

  it('under 600px of its container it is a list of "From → To · amount · status" rows', () => {
    renderAt(<FundFlow flows={FLOWS} safe={FLOW_SAFE} window={FLOW_WINDOW} />)
    const list = screen.getByRole('list', { name: `Fund flow, ${FLOW_WINDOW}` })
    expect(within(list).getAllByRole('listitem').map(li => plain(li.textContent))).toEqual([
      'Ops wallet → Treasury · 2,500.00 USDGLO · Executed', 'Gitcoin round → Treasury · 412.00 USDGLO · Executed',
      'Treasury → Network Projects · 1,271.00 USDGLO · Proposed', 'Treasury → Local Starter · 1,829.00 USDGLO · Prepared',
    ])
    expect(css).toMatch(/\.ff \{[^}]*container: flow \/ inline-size;/)
    expect(css).toMatch(/\.ff-list \{[^}]*display: none;/)
    const at = css.indexOf('@container flow (max-width: 599px) {')
    expect(at, 'no @container flow (max-width: 599px) block').toBeGreaterThanOrEqual(0)
    const narrow = css.slice(at, css.indexOf('\n}', at))
    expect(narrow).toMatch(/\.ff-svg \{ display: none;/)
    expect(narrow).toMatch(/\.ff-list \{ display: block;/)
  })

  it('a name or an amount too long for its box ends in "…" inside it, the whole of it in the node’s title (review M-2)', () => {
    const long = { from: 'A counterparty with a very long registered name', to: FLOW_SAFE, value: '123456789012345.67', unit: 'USDGLO', status: 'prepared' as const }
    const { container } = renderAt(<FundFlow flows={[long]} safe={FLOW_SAFE} window={FLOW_WINDOW} />)
    const t = container.querySelector('text.ff-t')!.textContent!
    expect(t).toHaveLength(NAME_MAX)
    expect(t.endsWith('…')).toBe(true)
    const m = plain(container.querySelector('text.ff-m')!.textContent)
    expect(m).toHaveLength(AMOUNT_MAX)
    expect(m.endsWith('…')).toBe(true)
    const g = container.querySelector('text.ff-t')!.parentElement!
    expect(g.getAttribute('clip-path')).toMatch(/^url\(#.+\)$/)
    expect(container.querySelector(g.getAttribute('clip-path')!.slice(4, -1).replace(/:/g, '\\:'))!.tagName.toLowerCase()).toBe('clippath')
    expect(plain(g.parentElement!.querySelector(':scope > title')!.textContent)).toBe('A counterparty with a very long registered name: 123,456,789,012,345.67 USDGLO · prepared')
  })

  it('a Safe name too long for its box ends in "…" inside it, the whole of it in the Safe’s title (final M-5)', () => {
    const name = 'The cooperative’s long-named common treasury Safe'
    const flow = { from: 'A source', to: name, value: '10', unit: 'USDGLO', status: 'executed' as const }
    const { container } = renderAt(<FundFlow flows={[flow]} safe={name} window={FLOW_WINDOW} />)
    const sn = container.querySelector('text.ff-sn')!
    expect(sn.textContent).toHaveLength(SAFE_NAME_MAX)
    expect(sn.textContent!.endsWith('…')).toBe(true)
    const g = sn.parentElement!
    expect(g.getAttribute('clip-path')).toMatch(/^url\(#.+\)$/)
    expect(container.querySelector(g.getAttribute('clip-path')!.slice(4, -1).replace(/:/g, '\\:'))!.tagName.toLowerCase()).toBe('clippath')
    expect(g.parentElement!.querySelector(':scope > title')!.textContent).toBe(`Safe: ${name}`)
    // a short name is drawn whole
    const { container: short } = renderAt(<FundFlow flows={FLOWS} safe={FLOW_SAFE} window={FLOW_WINDOW} />)
    expect(short.querySelector('text.ff-sn')!.textContent).toBe(FLOW_SAFE)
  })

  it('a window where nothing moved draws the Safe alone and says so', () => {
    renderAt(<FundFlow flows={[]} safe={FLOW_SAFE} window={FLOW_WINDOW} />)
    expect(screen.getByRole('img', { name: 'Nothing moved in the last 90 days.' })).toBeTruthy()
    expect(screen.getByRole('list', { name: `Fund flow, ${FLOW_WINDOW}` }).children).toHaveLength(0)
  })
})
