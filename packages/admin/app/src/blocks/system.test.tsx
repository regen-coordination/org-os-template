// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { BlockFrame } from './BlockFrame.tsx'
import { systemBlock } from './index.ts'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes, resource } from '../test/data.ts'

const read = { ok: true, readAt: new Date().toISOString(), facts: {}, open: { url: 'https://app.safe.global/home?safe=gno:0xabc', embeddable: false },
  sections: [{ title: 'Signers', rows: [{ cells: ['Steward A', '0xabc…1234'] }] }] }
const at = (driver: unknown) => fetchRoutes({ ...baseRoutes(), 'GET /api/jobs': [],
  'GET /api/resources/system%3Asafe': { resource: resource({ id: 'system:safe', kind: 'system', name: 'Treasury Safe', status: 'safe', facts: { kind: 'safe', driver } }), edges: [], neighbours: [] } })

describe('the system block', () => {
  it("shows the driver's sections, with the System's own link-out in its foot", async () => {
    at(read)
    const { container } = renderAt(<BlockFrame def={systemBlock} id="s" cfg={{ title: 'Treasury Safe', source: { system: 'safe' } }} />)
    expect(await screen.findByRole('group', { name: 'Signers' })).toBeTruthy()
    const open = screen.getByRole('link', { name: 'Open in Safe (opens in a new tab)' })
    expect(open.getAttribute('href')).toBe('https://app.safe.global/home?safe=gno:0xabc')
    expect(open.getAttribute('target')).toBe('_blank')
    expect(container.querySelectorAll('a')).toHaveLength(1)
  })

  it('says a failed read in a note, with the last good read under it (E-67)', async () => {
    at({ ...read, ok: false, error: 'HTTP 429' })
    renderAt(<BlockFrame def={systemBlock} id="s" cfg={{ title: 'Treasury Safe', source: { system: 'safe' } }} />)
    expect((await screen.findByText('Couldn’t read: HTTP 429')).closest('.note-error')).not.toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('group', { name: 'Signers' })).toBeTruthy()
  })

  it('is unavailable, saying why, when nothing has read it yet', async () => {
    at(undefined)
    renderAt(<BlockFrame def={systemBlock} id="s" cfg={{ title: 'Treasury Safe', source: { system: 'safe' } }} />)
    expect((await screen.findByRole('note')).textContent).toBe('Nothing has read this system yet: its driver reports here once it does.')
  })

  it('says a first failed read (no sections, no last good read) in an error note, never "not read yet" (I-2, E-67)', async () => {
    at({ ok: false, readAt: null, error: 'HTTP 500', facts: {}, open: null, sections: [] })
    renderAt(<BlockFrame def={systemBlock} id="s" cfg={{ title: 'Treasury Safe', source: { system: 'safe' } }} />)
    const said = await screen.findByText('Couldn’t read: HTTP 500')
    expect(said.closest('.note-error')).not.toBeNull()
    expect(screen.queryByRole('note')).toBeNull()
  })
})
