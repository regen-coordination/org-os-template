// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { BlockFrame } from './BlockFrame.tsx'
import { metricBlock } from './index.ts'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { SYSTEMS_UNREAD, baseRoutes, entryPlacedSafe, resource } from '../test/data.ts'

const rs = [resource({ id: 'funding:a', kind: 'funding', facts: { amount: 1000 } }), resource({ id: 'funding:b', kind: 'funding', facts: { amount: '250' } }),
  resource({ id: 'funding:c', kind: 'funding', facts: { amount: 'TBC' } })]
const safe = (driver: unknown) => resource({ id: 'system:safe', kind: 'system', name: 'Treasury Safe', facts: { driver } })

describe('the metric block', () => {
  it('counts the records its source names', async () => {
    fetchRoutes({ ...baseRoutes(), 'GET /api/resources': rs, 'GET /api/jobs': [] })
    renderAt(<BlockFrame def={metricBlock} id="m" cfg={{ title: 'Funding', source: { kind: 'funding' }, view: { label: 'opportunities' } }} />)
    const region = await screen.findByRole('region', { name: 'Funding' })
    await waitFor(() => expect(region.querySelector('.bmetric')).not.toBeNull())
    // the amount large (§14.2): the display face, then its label
    expect(region.querySelector('.amt-display .amt-v')!.textContent).toBe('3')
    expect(region.querySelector('.bmetric-l')!.textContent).toBe('opportunities')
  })

  it('sums a number field, leaving out what is not a number: numeric strings and booleans too (M-9)', async () => {
    const more = [...rs, resource({ id: 'funding:d', kind: 'funding', facts: { amount: true } }), resource({ id: 'funding:e', kind: 'funding', facts: { amount: 5 } })]
    fetchRoutes({ ...baseRoutes(), 'GET /api/resources': more, 'GET /api/jobs': [] })
    renderAt(<BlockFrame def={metricBlock} id="m" cfg={{ title: 'Asked', source: { kind: 'funding' }, view: { measure: 'sum', field: 'amount' } }} />)
    const region = await screen.findByRole('region', { name: 'Asked' })
    await waitFor(() => expect(region.querySelector('.bmetric')).not.toBeNull())
    expect(region.querySelector('.amt-v')!.textContent).toBe('1,005')
  })

  it("shows a system reading's value with its age, and the last good one when the read fails", async () => {
    const read = { ok: true, readAt: new Date(Date.now() - 120_000).toISOString(), facts: { threshold: '2 of 4' }, sections: [], open: null }
    fetchRoutes({ ...baseRoutes(), 'GET /api/resources/system%3Asafe': { resource: safe(read), edges: [], neighbours: [] }, 'GET /api/jobs': [] })
    const { unmount } = renderAt(<BlockFrame def={metricBlock} id="m" cfg={{ title: 'Signers', source: { system: 'safe', fact: 'threshold' } }} />)
    const region = await screen.findByRole('region', { name: 'Signers' })
    await waitFor(() => expect(region.querySelector('.bmetric')).not.toBeNull())
    expect(region.querySelector('.bmetric-t')!.textContent).toBe('2 of 4')
    // its read age is the read age element (§7.9), dated by the block's clock
    expect(region.querySelector('time.age')!.textContent).toBe('read 2\u00a0min ago')
    unmount()
    fetchRoutes({ ...baseRoutes(), 'GET /api/resources/system%3Asafe': { resource: safe({ ...read, ok: false, error: 'HTTP 429' }), edges: [], neighbours: [] }, 'GET /api/jobs': [] })
    renderAt(<BlockFrame def={metricBlock} id="m" cfg={{ title: 'Signers', source: { system: 'safe', fact: 'threshold' } }} />)
    expect((await screen.findByRole('note')).textContent).toBe('Read failed: HTTP 429. The last good read, 2\u00a0min ago: 2 of 4.')
  })

  it('draws an amount with its unit and places, in the display face', async () => {
    const read = { ok: true, readAt: new Date(Date.now() - 60_000).toISOString(), facts: { balance: '1271.5' }, sections: [], open: null }
    fetchRoutes({ ...baseRoutes(), 'GET /api/resources/system%3Asafe': { resource: safe(read), edges: [], neighbours: [] }, 'GET /api/jobs': [] })
    renderAt(<BlockFrame def={metricBlock} id="m" cfg={{ title: 'Held', source: { system: 'safe', fact: 'balance' }, view: { label: 'in the Safe', unit: 'USDGLO', decimals: 2 } }} />)
    const region = await screen.findByRole('region', { name: 'Held' })
    await waitFor(() => expect(region.querySelector('.amt-display')).not.toBeNull())
    expect(region.querySelector('.amt-display')!.textContent).toBe('1,271.50\u00a0USDGLO')
    expect(region.querySelector('.bmetric-l')!.textContent).toBe('in the Safe')
  })

  it("names the system's fact with `fact`, and keeps `reading` for which reading, as the system block does (P4-C9, I-4)", () => {
    const keys = metricBlock.config.map(c => c.key)
    expect(keys).toContain('source.fact')
    expect(keys).toContain('source.reading')
  })

  // review I-2's follow-up: a section that sorts systems by their data/systems.yaml entry is counted once it answered
  for (const [what, answer] of SYSTEMS_UNREAD) {
    it(`counts no treasury system while data/systems.yaml ${what}: loading, then the read's error, never "0"`, async () => {
      const { calls } = fetchRoutes({ ...baseRoutes(), 'GET /api/resources': [entryPlacedSafe], 'GET /api/jobs': [], 'GET /api/registries/systems': answer })
      renderAt(<BlockFrame def={metricBlock} id="m" cfg={{ title: 'Treasury systems', source: { section: 'treasury' } }} />)
      await waitFor(() => expect(calls.some(c => c.path === '/api/resources')).toBe(true))
      await new Promise(r => setTimeout(r, 30))
      const block = document.querySelector('[data-block="m"]')!
      expect(block.querySelector('.bmetric')).toBeNull()
      if (what === 'could not be read') expect(block.textContent).toContain('data/systems.yaml cannot be read')
      else expect(block.getAttribute('data-state')).toBe('loading')
    })
  }
})
