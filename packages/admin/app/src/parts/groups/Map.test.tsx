// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderAt } from '../../test/render.tsx'
import { flowEnv } from '../../test/flowEnv.ts'
import { MAP_ANATOMY, MAP_NODES } from '../../test/fixtures/house/map.ts'
import MapGroup from './Map.tsx'

afterEach(() => vi.unstubAllGlobals())

describe('/parts/map', () => {
  it('draws the members’ map with its caption, a node in each state, value moving, the phone form and the door (B8)', async () => {
    flowEnv()
    renderAt(<MapGroup />, '/parts/map')
    await waitFor(() => expect(document.querySelectorAll('.hmap .react-flow__edge').length).toBeGreaterThan(0))
    expect(document.querySelectorAll('.hmap')).toHaveLength(4)
    expect(document.querySelectorAll('.hmap-door')).toHaveLength(1)
    expect(document.querySelectorAll('.hcap')).toHaveLength(1)
    expect(document.querySelectorAll('.pg-anat .hnode')).toHaveLength(MAP_ANATOMY.length)
    expect(screen.getAllByRole('group', { name: '9 Systems, as a map' })).toHaveLength(4)
  })

  it('turns the members’ map into its List twin, the same Systems as rows', async () => {
    flowEnv()
    renderAt(<MapGroup />, '/parts/map')
    fireEvent.click(screen.getByRole('button', { name: 'List' }))
    const list = await screen.findByRole('list', { name: 'The DAO’s Systems' })
    expect(list.querySelectorAll('[data-row]')).toHaveLength(MAP_NODES.length)
  })
})
