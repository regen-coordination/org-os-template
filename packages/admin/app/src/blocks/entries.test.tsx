// @vitest-environment jsdom
// packages/admin/app/src/blocks/entries.test.tsx
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import { BlockFrame, blockType, listBlock, metricBlock } from './index.ts'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes, resource } from '../test/data.ts'
import { flowEnv } from '../test/flowEnv.ts'

afterEach(() => vi.unstubAllGlobals())

// validate:data accepts every field of a kind's registry schema (boardFieldsOf), but a Resource's facts
// are a hand-picked few: a block must read the rest from the record's file entry (final review I-1).
const project = (id: string, name: string) => resource({ id: `project:${id}`, name, facts: {},
  source: { path: 'data/projects.yaml', editable: true, registry: 'projects', entityId: id } })
const projects = [project('a', 'Alpha'), project('b', 'Beta'), project('c', 'Gamma')]
const projectEntries = [
  { id: 'a', title: 'Alpha', type: 'research', started: '2026-03-01' },
  { id: 'b', title: 'Beta', type: 'service', started: '2026-01-01' },
  { id: 'c', title: 'Gamma', type: 'research', started: '2026-02-01' },
]
const registry = (name: string, entries: unknown[]) => ({ name, kind: 'collection', schemaVersion: null, entries })
const rowNames = (table: HTMLElement) => [...table.querySelectorAll('tbody tr')].map(tr => tr.querySelector('a')?.textContent)

describe("a block reads a record's file entry for fields its Resource lacks (I-1)", () => {
  it('lists the projects a schema-only field picks out', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/resources': projects, 'GET /api/registries/projects': registry('projects', projectEntries) }))
    renderAt(<BlockFrame def={listBlock} id="l" cfg={{ title: 'Services', source: { kind: 'project', where: { type: 'service' } }, view: { empty: 'No services.' } }} />)
    expect(await screen.findByRole('link', { name: 'Beta' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Alpha' })).toBeNull()
    expect(screen.queryByText('No services.')).toBeNull()
  })

  it('sorts a list by a schema-only field', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/resources': projects, 'GET /api/registries/projects': registry('projects', projectEntries) }))
    renderAt(<BlockFrame def={listBlock} id="l" cfg={{ title: 'By start', source: { kind: 'project', sort: 'started' } }} />)
    const table = await screen.findByRole('grid', { name: 'By start' }) // its status cell can be edited (C1, I-1)
    await waitFor(() => expect(rowNames(table)).toEqual(['Beta', 'Gamma', 'Alpha']))
  })

  it('stays loading until the file has answered, never saying empty early', async () => {
    let answer: (v: unknown) => void = () => {}
    const late = new Promise(resolve => { answer = resolve })
    fetchRoutes(baseRoutes({ 'GET /api/resources': projects, 'GET /api/registries/projects': () => late }))
    renderAt(<BlockFrame def={listBlock} id="l" cfg={{ title: 'Services', source: { kind: 'project', where: { type: 'service' } }, view: { empty: 'No services.' } }} />)
    const region = await screen.findByRole('region', { name: 'Services' })
    await act(() => new Promise(r => { setTimeout(r, 30) })) // the reads that answer meanwhile land inside act
    expect(region.getAttribute('data-state')).toBe('loading')
    expect(screen.queryByText('No services.')).toBeNull()
    await act(async () => { answer(registry('projects', projectEntries)) })
    expect(await screen.findByRole('link', { name: 'Beta' })).toBeTruthy()
  })

  it('sums a schema-only number field of funding entries', async () => {
    const funding = (id: string) => resource({ id: `funding:${id}`, kind: 'funding', name: id, facts: {},
      source: { path: 'data/funding-opportunities.yaml', editable: true, registry: 'funding-opportunities', entityId: id } })
    fetchRoutes(baseRoutes({ 'GET /api/resources': [funding('f1'), funding('f2'), funding('f3')], 'GET /api/jobs': [],
      'GET /api/registries/funding-opportunities': registry('funding-opportunities', [
        { id: 'f1', amount_available: 1000 }, { id: 'f2', amount_available: 250 }, { id: 'f3', amount_available: 'TBC' }]) }))
    renderAt(<BlockFrame def={metricBlock} id="m" cfg={{ title: 'Available', source: { kind: 'funding' }, view: { measure: 'sum', field: 'amount_available' } }} />)
    const region = await screen.findByRole('region', { name: 'Available' })
    await waitFor(() => expect(region.querySelector('.bmetric .amt-v')?.textContent).toBe('1,250'))
  })

  it('draws records on a map by a schema-only field', async () => {
    flowEnv()
    fetchRoutes(baseRoutes({ 'GET /api/resources': projects, 'GET /api/registries/projects': registry('projects', projectEntries),
      'GET /api/graph/organization': { board: 'organization', nodes: projects, edges: [], portals: [] } }))
    const def = blockType('map')!
    renderAt(<BlockFrame def={def} id="m" cfg={{ title: 'Services', source: { kind: 'project', where: { type: 'service' } }, view: { empty: 'No services.' } }} />)
    const region = await screen.findByRole('region', { name: 'Services' })
    await waitFor(() => expect(region.querySelector('[data-node-id="project:b"]')).not.toBeNull())
    expect(region.getAttribute('data-state')).toBe('ready')
    expect(region.querySelector('[data-node-id="project:a"]')).toBeNull()
  })
})
