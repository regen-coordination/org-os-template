// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { Links } from './Links.tsx'
import { renderAt } from '../test/render.tsx'
import { resource } from '../test/data.ts'

const mod = resource({ id: 'module:a', kind: 'module', board: 'systems', name: 'org-os-buzz', source: null })
const detail = {
  resource: mod,
  edges: [{ from: 'module:a', to: 'module:b', kind: 'depends-on' }, { from: 'seat:s', to: 'project:p', kind: 'works-on', crosses: true }, { from: 'module:a', to: 'project:p', kind: 'feeds', crosses: true }],
  neighbours: [resource({ id: 'module:b', kind: 'module', board: 'systems', name: 'org-os-standards', source: null }), resource({ id: 'project:p', name: 'studio.example' })],
}

describe('Links', () => {
  it('groups links by kind, each going to the other record, and skips edges between two others', () => {
    renderAt(<Links detail={detail} />)
    expect(screen.getByRole('link', { name: /org-os-standards/ }).getAttribute('href')).toBe('/r/module/b')
    expect(screen.getByRole('link', { name: /studio\.example/ }).getAttribute('href')).toBe('/r/project/p')
    expect(screen.getByText(/^depends-on/)).toBeTruthy()
    expect(screen.getByText(/^feeds/)).toBeTruthy()
    expect(screen.queryByText(/works-on/)).toBeNull()
  })

  it('draws each link as a data row: the kind tile, the record, the link’s kind and the record’s on the second line', () => {
    renderAt(<Links detail={detail} />)
    const list = screen.getByRole('list', { name: 'Links' })
    const rows = [...list.querySelectorAll('a.drow')]
    expect(rows.map(a => [a.querySelector('.drow-t')!.textContent, a.querySelector('.drow-s')!.textContent])).toEqual([
      ['org-os-standards', 'depends-on · module'], ['studio.example', 'feeds · project'],
    ])
    expect(rows[0]!.querySelector('.ktile')).not.toBeNull()
    expect(screen.getByRole('region', { name: 'Links' }).querySelector('.sect-n')!.textContent).toBe('2')
  })

  it('names a record that is not here without a link to it', () => {
    const gone = resource({ id: 'absent:x', kind: 'absent', name: 'Gone record', source: null })
    renderAt(<Links detail={{ resource: mod, edges: [{ from: 'module:a', to: 'absent:x', kind: 'feeds' }], neighbours: [gone] }} />)
    expect(screen.getByText('Gone record')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Gone record/ })).toBeNull()
  })

  it('says so when there are none', () => {
    renderAt(<Links detail={{ resource: mod, edges: [], neighbours: [] }} />)
    expect(screen.getByText('No links.')).toBeTruthy()
  })
})
