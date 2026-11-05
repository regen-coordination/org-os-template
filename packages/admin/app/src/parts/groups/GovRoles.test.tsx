// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderAt } from '../../test/render.tsx'
import GovRoles from './GovRoles.tsx'

describe('/parts/gov-roles', () => {
  it('draws the role tree, tree #13 and six levels deep, then the fund flow in one unit and in two (B6)', () => {
    renderAt(<GovRoles />, '/parts/gov-roles')
    const roles = screen.getByRole('tree', { name: 'Hats tree 13' })
    expect(within(roles).getAllByRole('treeitem')).toHaveLength(9)
    expect(roles.querySelectorAll('.rt-empty')).toHaveLength(2)
    const deep = screen.getByRole('tree', { name: 'Hats tree 14' })
    expect(Math.max(...within(deep).getAllByRole('treeitem').map(i => Number(i.getAttribute('aria-level'))))).toBe(6)
    const flows = screen.getAllByRole('img').filter(i => i.classList.contains('ff-svg'))
    expect(flows).toHaveLength(2)
    expect(flows.map(f => [...f.querySelectorAll('path.ff-band')].map(b => b.getAttribute('stroke-width')))).toEqual([['14', '3.98', '8.1', '10.78'], ['8', '8', '8']])
  })
})
