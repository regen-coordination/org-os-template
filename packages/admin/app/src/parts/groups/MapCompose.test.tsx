// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderAt } from '../../test/render.tsx'
import MapCompose from './MapCompose.tsx'

describe('/parts/map-compose', () => {
  it('draws the small map on a record page (six neighbours and "+1 on the map") and in the inspector, then the compose canvas (B9)', () => {
    renderAt(<MapCompose />, '/parts/map-compose')
    const page = screen.getByRole('region', { name: 'small map · a record page · the record and up to six neighbours, one hop' })
    expect(page.querySelector('.mini.mini-page')!.querySelectorAll('.mini-n:not(.is-me)')).toHaveLength(6)
    expect(within(page).getByRole('link', { name: '+1 on the map' })).toBeTruthy()
    expect(page.querySelector('.mini-n.is-attn')).not.toBeNull()
    const insp = screen.getByRole('region', { name: 'small map · in the inspector · 188 tall' })
    expect(insp.querySelector('.mini.mini-inspector')).not.toBeNull()
    const canvas = screen.getByRole('region', { name: 'compose canvas · the Signers selected · a link that cannot sign for a Safe' })
    expect(canvas.querySelectorAll('.cmp-canvas .hnode.is-draft')).toHaveLength(5)
    expect(canvas.querySelectorAll('.cmp-handle')).toHaveLength(4)
    expect(within(canvas).getByRole('alert').textContent).toBe('A link can’t sign for a Safe. Connect a hat or addresses.')
    expect(within(canvas).getByText('5 prepared transactions, in order · Sepolia')).toBeTruthy()
    expect(within(canvas).getByRole('region', { name: 'Signers' })).toBeTruthy()
  })
})
