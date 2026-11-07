// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderAt } from '../../test/render.tsx'
import Rows from './Rows.tsx'

describe('/parts/rows', () => {
  it('draws the data row in every state, then its first load', () => {
    renderAt(<Rows />, '/parts/rows')
    const card = screen.getByRole('region', { name: 'Data row · every state' })
    const rows = within(within(card).getByRole('list', { name: 'Data row states' })).getAllByRole('listitem').map(li => li.firstElementChild!)
    expect(rows.map(r => r.querySelector('.drow-end')!.textContent)).toEqual(
      ['default', 'hover', 'focus', 'selected', 'Staged', 'Changed since staged', 'Needs you', 'Reading…', 'Closed'])
    expect(rows[3]!.getAttribute('aria-current')).toBe('true')
    expect(rows[3]!.getAttribute('aria-selected')).toBeNull()
    expect(rows[6]!.querySelector('.ktile-attn')).not.toBeNull()
    expect(rows[8]!.classList.contains('o-dim')).toBe(true)
    expect(within(card).getByRole('region', { name: 'Loading Data rows' }).getAttribute('aria-busy')).toBe('true')
  })

  it('draws the Systems list: each house System, one state each, the Treasury header from the same Resource', () => {
    renderAt(<Rows />, '/parts/rows')
    const list = within(screen.getByRole('region', { name: 'Systems · a list, every state' })).getByRole('list', { name: 'Systems' })
    const rows = within(list).getAllByRole('listitem').map(li => li.firstElementChild!)
    expect(rows.map(r => [r.querySelector('.drow-t')!.textContent, r.querySelector('.sysrow-state')!.textContent])).toEqual([
      ['Treasury', '1 to sign'], ['Council Safe', 'Reading…'], ['Roles', '3 empty hats'], ['exampledao.eth', 'Up to date'],
      ['Example DAO Garden', 'Couldn’t read'], ['Network Projects', 'Return proposed'], ['Local Starter', 'Old read'], ['Ops wallet', 'Linked, not read'],
    ])
    const header = screen.getByRole('region', { name: 'Record header · a System, a proposal' }).querySelector('.rh-sys')!
    expect(header.querySelector('.rh-gov')!.textContent).toBe('4 of 8 signers')
    expect(header.querySelector('time')!.textContent).toBe('read 4 min ago')
    expect(within(header as HTMLElement).getByRole('link', { name: /Open in Safe/ }).getAttribute('href')).toMatch(/^https:\/\/app\.safe\.global\/home\?safe=eth:0x6AFF/)
  })

  it('draws the inspector beside a list, the pool selected, and as the phone’s bottom sheet (B9, §5.10)', () => {
    renderAt(<Rows />, '/parts/rows')
    const beside = screen.getByRole('region', { name: 'Inspector · beside a list, at 1200 of frame width and over' })
    expect(beside.querySelector('.drow-sel .drow-t')!.textContent).toBe('Network Projects')
    const aside = within(beside).getByRole('complementary', { name: 'Network Projects inspector' })
    expect(aside.querySelector('.insp-k')!.textContent).toBe('Gardens pool')
    expect(aside.querySelector('.mini.mini-inspector')).not.toBeNull()
    expect(within(aside).getByRole('link', { name: 'Read now' })).toBeTruthy()
    expect(beside.querySelector('dialog')).toBeNull()
    const phone = screen.getByRole('region', { name: 'Inspector · a bottom sheet on the phone, over the scrim' })
    const sheet = phone.querySelector('dialog')!
    expect(sheet.className).toBe('insp-sheet insp-bottom insp-sheet-inline')
    expect(sheet.open).toBe(true)
    expect(phone.querySelector('.insp-scrim')).not.toBeNull()
  })
})

