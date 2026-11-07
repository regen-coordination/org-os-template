// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { useLayoutEffect } from 'react'
import { screen } from '@testing-library/react'
import { BlockFrame, BlockView, eventFor } from './BlockFrame.tsx'
import type { BlockData, BlockDef } from './types.ts'
import { NO_MARKS } from '../parts/marks.ts'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes } from '../test/data.ts'
import { errorNote } from '../test/notes.ts'

const ctx = { now: new Date('2026-10-17T12:00:00Z'), marks: NO_MARKS, stage: vi.fn(async () => {}) }
const def: BlockDef = {
  type: 'probe', label: 'Probe', config: [], title: cfg => String(cfg.title ?? 'Probe'),
  useData: () => ({ state: 'loading' }),
  Body: ({ data }) => <p>body: {String(data)}</p>,
  Foot: () => <button type="button">More</button>,
}
const view = (data: BlockData, over: Partial<Parameters<typeof BlockView>[0]> = {}) =>
  <BlockView def={def} cfg={{ title: 'Projects', view: { empty: 'No projects yet.' } }} id="p" data={data} ctx={ctx} {...over} />

describe('eventFor', () => {
  it("names the block machine's event for each state of the data", () => {
    expect(eventFor({ state: 'loading' })).toEqual({ type: 'RELOAD' })
    expect(eventFor({ state: 'ready', count: 3 })).toEqual({ type: 'LOADED', count: 3 })
    expect(eventFor({ state: 'empty' })).toEqual({ type: 'LOADED', count: 0 })
    expect(eventFor({ state: 'error', error: 'x' })).toEqual({ type: 'FAILED', error: 'x' })
    expect(eventFor({ state: 'notYet' })).toEqual({ type: 'NOT_YET' })
    expect(eventFor({ state: 'unavailable', error: 'gone' })).toEqual({ type: 'UNAVAILABLE', error: 'gone' })
  })
})

describe('BlockView', () => {
  // C9 (§14.2): a block frame is a section head, the body and the foot, inside a surface.
  it('is a section head, a body and a foot inside a surface (§14.2)', () => {
    fetchRoutes(baseRoutes())
    renderAt(view({ state: 'ready', data: 'x', count: 2 }, { cfg: { title: 'Needs you', view: { count: 'title', link: { href: '/needs', label: 'All →' } } } }))
    const region = screen.getByRole('region', { name: 'Needs you · 2' })
    expect(region.className).toBe('bf')
    expect(region.dataset.type).toBe('probe')
    const [head, body, foot] = [...region.children]
    expect(head!.className).toBe('sect-h')
    expect(head!.querySelector('h2.sect-t')!.firstChild!.textContent).toBe('Needs you')
    expect(head!.querySelector('.sect-n')!.textContent).toBe(' · 2')
    expect(head!.querySelector('.sect-end a')!.getAttribute('href')).toBe('/needs')
    expect(body!.className).toBe('bf-body')
    expect(body!.textContent).toBe('body: x')
    expect(foot!.className).toBe('bf-foot')
    expect(foot!.querySelector('button')!.textContent).toBe('More')
  })

  it('is a region named by its title: head, body, foot', () => {
    fetchRoutes(baseRoutes())
    renderAt(view({ state: 'ready', data: 'x', count: 2 }))
    const region = screen.getByRole('region', { name: 'Projects' })
    expect(region.dataset.state).toBe('ready')
    expect(region.textContent).toContain('body: x')
    expect(screen.getByRole('button', { name: 'More' })).toBeTruthy()
  })

  it("never says empty before the answer: loading, then the empty sentence; a failure alone (Review Focus 1)", () => {
    fetchRoutes(baseRoutes())
    const { rerender } = renderAt(view({ state: 'loading' }))
    // a skeleton of rows, never the spinner and "Loading…" (§6.2; walk 2026-11-04, L4c-fix 2)
    expect(screen.getByRole('region', { name: 'Loading Projects' }).getAttribute('aria-busy')).toBe('true')
    expect(screen.queryByText('Loading…')).toBeNull()
    expect(screen.queryByText('No projects yet.')).toBeNull()
    rerender(view({ state: 'empty', count: 0 }))
    expect(screen.getByText('No projects yet.')).toBeTruthy()
    rerender(view({ state: 'error', error: 'resources are down' }))
    expect(errorNote().textContent).toBe('resources are down')
    expect(screen.queryByText('No projects yet.')).toBeNull()
    expect(screen.queryByRole('button', { name: 'More' })).toBeTruthy()
  })

  it("draws the data's own state in every commit, never the machine's a render behind (Review Focus 1)", () => {
    fetchRoutes(baseRoutes())
    const seen: string[] = []
    const Spy = ({ want }: { want: string }) => {
      useLayoutEffect(() => { seen.push(`${want}>${document.querySelector('[data-block="p"]')!.getAttribute('data-state')}`) })
      return null
    }
    const both = (d: BlockData) => <>{view(d)}<Spy want={d.state} /></>
    const { rerender } = renderAt(both({ state: 'loading' }))
    rerender(both({ state: 'ready', data: 1, count: 1 }))
    rerender(both({ state: 'empty', count: 0 }))
    expect(seen.length).toBeGreaterThan(2)
    expect(seen.filter(s => s.split('>')[0] !== s.split('>')[1])).toEqual([])
  })

  it("follows the data through the block machine: the region's state is always the data's", () => {
    fetchRoutes(baseRoutes())
    const { rerender } = renderAt(view({ state: 'loading' }))
    const region = () => screen.getByRole('region', { name: /^Projects/ })
    for (const d of [{ state: 'ready', data: 1, count: 1 }, { state: 'empty', count: 0 }, { state: 'unavailable', error: 'No crew' }, { state: 'loading' }, { state: 'ready', data: 2, count: 1 }] as BlockData[]) {
      rerender(view(d))
      expect(region().dataset.state).toBe(d.state)
    }
  })

  it("says an absent adapter in its own words, and a later track's block as not yet", () => {
    fetchRoutes(baseRoutes())
    const { rerender } = renderAt(view({ state: 'unavailable', error: 'No crew: scripts/crew.mjs is missing' }))
    expect(screen.getByRole('note').textContent).toBe('No crew: scripts/crew.mjs is missing')
    rerender(<BlockView def={{ ...def, needs: 'P2' }} cfg={{ title: 'Proposals' }} id="q" data={{ state: 'notYet' }} ctx={ctx} />)
    expect(screen.getByRole('note').textContent).toBe('Arrives with P2.')
  })

  it("puts its count in the title, or a counted noun in the note, or a link", () => {
    fetchRoutes(baseRoutes())
    const { rerender } = renderAt(view({ state: 'ready', data: 1, count: 2 }, { cfg: { title: 'Needs you', view: { count: 'title', note: 'alerts first, then oldest' } } }))
    expect(screen.getByRole('region', { name: 'Needs you · 2' }).textContent).toContain('alerts first, then oldest')
    rerender(view({ state: 'ready', data: 1, count: 1 }, { cfg: { title: 'Crew', view: { count: 'note', noun: 'seat' } } }))
    expect(screen.getByRole('region', { name: 'Crew' }).textContent).toContain('1 seat')
    rerender(view({ state: 'ready', data: 1, count: 3 }, { cfg: { title: 'Projects', view: { link: { href: '/b/projects', label: 'all →' } } } }))
    expect(screen.getByRole('link', { name: 'all →' }).getAttribute('href')).toBe('/b/projects')
  })

  it('bare: no head and no region, the page heads it', () => {
    fetchRoutes(baseRoutes())
    const { container } = renderAt(view({ state: 'ready', data: 'x' }, { bare: true }))
    expect(screen.queryByRole('region')).toBeNull()
    expect(container.querySelector('[data-block="p"]')!.textContent).toContain('body: x')
  })

  it('bare: renders no foot, the page owns the actions', () => {
    fetchRoutes(baseRoutes())
    renderAt(view({ state: 'ready', data: 'x' }, { bare: true }))
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull()
  })

  it('announces a block that turns unavailable, through the one live region; an error is said once, by its note through the same region (M-4; C11 I-1)', () => {
    fetchRoutes(baseRoutes())
    const { rerender } = renderAt(view({ state: 'ready', data: 1 }))
    rerender(view({ state: 'error', error: 'the graph is down' }))
    expect(errorNote().textContent).toBe('the graph is down')
    expect(screen.getByTestId('live').textContent).toBe('the graph is down')
    rerender(view({ state: 'unavailable', error: 'No crew' }))
    expect(screen.getByTestId('live').textContent).toBe('Projects: No crew')
  })

  it('renders no foot while not yet (M-2)', () => {
    fetchRoutes(baseRoutes())
    renderAt(view({ state: 'notYet' }))
    expect(screen.getByRole('note').textContent).toBe('Not yet.')
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull()
  })

  it("reads nothing of the app's own when given a context: no jobs, no change (M-8)", async () => {
    const { calls } = fetchRoutes(baseRoutes())
    renderAt(view({ state: 'ready', data: 'x', count: 1 }))
    await new Promise(r => setTimeout(r, 30))
    expect(calls.map(c => c.path)).toEqual([])
  })
})

describe('BlockFrame', () => {
  it("a type that needs a later track is not yet, whatever its data says, with no foot (M-2)", async () => {
    fetchRoutes(baseRoutes())
    const later: BlockDef = { ...def, needs: 'P2', useData: () => ({ state: 'ready', data: 'early', count: 1 }) }
    renderAt(<BlockFrame def={later} cfg={{ title: 'Proposals' }} id="n" />)
    const region = await screen.findByRole('region', { name: 'Proposals' })
    expect(region.dataset.state).toBe('notYet')
    expect(screen.getByRole('note').textContent).toBe('Arrives with P2.')
    expect(region.textContent).not.toContain('body: early')
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull()
  })

  it('reads its data through the type, and its context from the app', async () => {
    fetchRoutes(baseRoutes())
    const reading = { ...def, useData: () => ({ state: 'ready' as const, data: 'live', count: 1 }) }
    renderAt(<BlockFrame def={reading} cfg={{ title: 'Live' }} id="l" />)
    expect((await screen.findByRole('region', { name: 'Live' })).textContent).toContain('body: live')
  })
})

describe('BlockView quiet', () => {
  const quiet = (data: BlockData) => <BlockView def={def} cfg={{ title: 'Quiet', view: { quiet: true, empty: 'Nothing.' } }} id="q" data={data} ctx={ctx} />
  it('draws nothing while loading, empty or not yet, and the block when it has rows', () => {
    fetchRoutes(baseRoutes())
    for (const data of [{ state: 'loading' }, { state: 'empty', count: 0 }, { state: 'notYet' }] as BlockData[]) {
      const { container, unmount } = renderAt(quiet(data))
      expect(container.querySelector('[data-block="q"]'), data.state).toBeNull()
      unmount()
    }
    renderAt(quiet({ state: 'ready', data: 'x', count: 1 }))
    expect(screen.getByRole('region', { name: 'Quiet' })).toBeTruthy()
  })

  it('still draws a failure and an unavailable source, in their own words', () => {
    fetchRoutes(baseRoutes())
    const a = renderAt(quiet({ state: 'error', error: 'HTTP 500' }))
    expect(screen.getByText('HTTP 500')).toBeTruthy()
    a.unmount()
    renderAt(quiet({ state: 'unavailable', error: 'Your proposals are not known.' }))
    expect(screen.getByText('Your proposals are not known.')).toBeTruthy()
  })
})
