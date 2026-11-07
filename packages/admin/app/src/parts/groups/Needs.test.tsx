// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderAt } from '../../test/render.tsx'
import Needs from './Needs.tsx'
import { errorNote } from '../../test/notes.ts'

describe('/parts/needs', () => {
  it('draws one of each kind of need, in order, and beside it nothing waiting, the first load and an error', () => {
    renderAt(<Needs />, '/parts/needs')
    const rows = within(screen.getByRole('list', { name: 'Needs you' })).getAllByRole('listitem').map(li => li.firstElementChild!)
    expect(rows.map(r => [r.querySelector('.need-t')!.textContent, r.querySelector('.need-end')!.textContent])).toEqual([
      ['Close the spring call for local nodes', 'Closed 2 days ago'],
      ['Return the Gardens pools to the treasury', 'Closes in 5 days'],
      ['3 hats have no wearer', 'Look'],
      ['Sign nonce 18 on the Treasury', 'Open in Safe (opens the Safe app in a new tab)'],
      ['The Treasury disagrees across chains', 'Look'],
      ['The Example DAO Garden couldn’t be read', 'Look'],
      ['Add a Treasury signer', 'Waiting on others'],
    ])
    expect(screen.getByText('Nothing waits on you.')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Loading Needs you' }).querySelectorAll('.skel-row-needs')).toHaveLength(2)
    expect(within(errorNote()).getByRole('button', { name: 'Try again' })).toBeTruthy()
  })
})
