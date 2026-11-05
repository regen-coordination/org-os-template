// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { FieldsEdit, FieldsRead } from './SchemaFields.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import type { JsonSchema } from '../api.ts'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'
import { houseSource } from '../session/houseSource.ts'

const schema: JsonSchema = { 'x-order': ['id', 'title', 'status', 'lead', 'contributors', 'started'], properties: {
  id: { type: 'string' }, title: { type: 'string' }, status: { type: 'string' }, lead: { type: 'string' },
  contributors: { type: 'array', items: { type: 'string' } }, started: { type: 'string', format: 'date' } } }

describe('FieldsRead', () => {
  it('links references to their records by name, joins arrays, and marks staged fields', () => {
    const names = new Map([['person:steward-a', 'Steward A']])
    const { container } = renderAt(<FieldsRead registry="projects" schema={schema} names={names}
      value={{ id: 'br', title: 'River Commons', status: 'develop', lead: 'steward-a', contributors: ['steward-a', 'ana'], notes: { a: 1 } }}
      was={{ status: 'discovery' }} />)
    const stewardA = screen.getAllByRole('link', { name: 'Steward A' }) // lead and contributors
    expect(stewardA.map(a => a.getAttribute('href'))).toEqual(['/r/person/steward-a', '/r/person/steward-a'])
    expect(screen.getByRole('link', { name: 'ana' }).getAttribute('href')).toBe('/r/person/ana')
    // the references are one run of text and links, "Steward A, ana", never laid out as separate items (B1 fix I-1)
    const contributors = screen.getByRole('link', { name: 'ana' }).closest('.fields-v')!
    expect(contributors.textContent).toBe('Steward A, ana')
    expect(contributors.parentElement!.tagName).toBe('DD')
    const status = screen.getByText('develop').closest('dd')!
    expect(status.className).toBe('staged')
    expect(status.querySelector('.was s')!.textContent).toBe('discovery')
    expect(screen.getByText('Started').closest('dt')!.nextElementSibling!.textContent).toBe('—')
    expect(container.querySelector('pre.mono-well')!.textContent).toBe('a: 1\n')
  })
  it('a restricted field renders "Ops only" with the lock, in its schema place; no "restricted" row (L5 §11.5)', () => {
    const OPS = `eip155:42220:0x0000000d0002${'0'.repeat(52)}`
    const source = houseSource({ tree: [{ hat: OPS, name: 'Ops', above: [] }], worn: [], levels: ['public', 'members'], config: { collections: {}, defaults: {} }, writable: [] })
    const { container } = renderAt(<ViewAsProvider source={source}><FieldsRead registry="projects" schema={schema} names={new Map()}
      value={{ id: 'br', title: 'T', visibility: 'members', restricted: { lead: `hat:${OPS}` } }} was={{}} /></ViewAsProvider>)
    const labels = [...container.querySelectorAll('dt')].map(d => d.textContent)
    expect(labels.indexOf('Lead')).toBe(labels.indexOf('Title') + 2) // after status, where the schema puts it
    expect(labels).not.toContain('Restricted')
    const lead = [...container.querySelectorAll('dt')].find(d => d.textContent === 'Lead')!
    expect(lead.querySelector('svg')).toBeTruthy()
    expect(lead.nextElementSibling!.textContent).toBe('Ops only')
    expect(lead.nextElementSibling!.querySelector('.vis-field')).toBeTruthy()
  })

  it('marks a field staged where the entry had nothing without striking a "—" (final 14)', () => {
    renderAt(<FieldsRead registry="projects" schema={schema} names={new Map()} value={{ id: 'br', title: 'T', status: 'develop' }} was={{ status: undefined, title: '' }} />)
    for (const v of ['develop', 'T']) {
      const cell = screen.getByText(v).closest('dd')!
      expect(cell.className).toBe('staged')
      expect(cell.querySelector('.was')).toBeNull()
    }
  })
})
describe('FieldsRead, restricted and stale (E-60)', () => {
  it('draws a restricted field in schema order with the lock and "<hat> only", and a stale one in clay', () => {
    renderAt(<FieldsRead registry="projects" schema={schema} names={new Map()} value={{ id: 'br', title: 'T', status: 'execute' }} was={{}}
      restricted={{ lead: 'hat:ops', contributors: 'role:finance' }} stale={{ status: 'develop' }} />)
    const dts = [...screen.getByRole('group', { name: 'Fields' }).querySelectorAll('dt')].map(dt => dt.textContent)
    expect(dts).toEqual(['Id', 'Title', 'Status', 'Lead', 'Contributors', 'Started'])
    expect(screen.getByText('Lead').closest('dt')!.nextElementSibling!.textContent).toBe('Ops only')
    expect(screen.getByText('Contributors').closest('dt')!.nextElementSibling!.textContent).toBe('finance only')
    const status = screen.getByText('execute').closest('dd')!
    expect(status.className).toBe('stale')
    expect(status.textContent).toContain('now develop on the trunk')
  })
})

describe('FieldsEdit', () => {
  beforeEach(() => { fetchRoutes({}) }) // the reference pickers ask for their registries; here they get none
  const edit = (over: Partial<Parameters<typeof FieldsEdit>[0]> = {}) => renderAt(
    <FieldsEdit registry="projects" schema={schema} draft={{ id: 'br', title: 'New title', status: 'develop' }} file={{ id: 'br', title: 'Old title', status: 'develop' }}
      creating={false} errors={[]} problems={{}} onChange={() => {}} onProblem={() => {}} {...over} />)

  it('a restricted field is drawn as its level, not as an input, and the gate\'s marker is no field (L5 §11.5)', () => {
    const draft = { id: 'br', title: 'T', status: 'develop', restricted: { lead: 'hat:eip155:42220:0x0000000d0002' + '0'.repeat(52) } }
    const { container } = edit({ draft, file: draft })
    expect(screen.queryByLabelText('Lead')).toBeNull()
    expect(screen.queryByLabelText(/^restricted/i)).toBeNull()
    const lead = [...container.querySelectorAll('dt')].find(d => d.textContent === 'Lead')!
    expect(lead.nextElementSibling!.querySelector('.vis-field')).toBeTruthy()
  })

  it('labels each field by its schema title, else its id in words, as the new-record form does (DP-70)', () => {
    const titled: JsonSchema = { ...schema, properties: { ...schema.properties, status: { type: 'string', title: 'Stage' }, target_completion: { type: 'string' } } }
    edit({ schema: titled, draft: { id: 'br', title: 'T', status: 'develop', target_completion: '2027-01' } })
    expect(screen.getByLabelText('Stage')).toBeTruthy()
    expect(screen.getByLabelText('Target completion')).toBeTruthy()
    expect(screen.queryByText('status')).toBeNull()
  })

  it('marks a changed field with the ink rule and the old value struck, and keeps the id read-only', () => {
    edit()
    const title = screen.getByLabelText('Title')
    expect(title.closest('dd')!.className).toBe('staged')
    expect(title.closest('dd')!.querySelector('.was s')!.textContent).toBe('Old title')
    expect((screen.getByLabelText('Id') as HTMLInputElement).readOnly).toBe(true)
  })

  it('marks a field the file did not hold, now filled, without striking a "—" (final 14)', () => {
    edit({ draft: { id: 'br', title: 'Old title', status: 'develop', started: '2026-10-01' } })
    const cell = screen.getByLabelText('Started').closest('dd')!
    expect(cell.className).toBe('staged')
    expect(cell.querySelector('.was')).toBeNull()
  })

  it('does not mark a field the file does not hold that is empty in the draft (I1)', () => {
    edit({ draft: { id: 'br', title: 'Old title', status: 'develop', lead: null, started: '' } })
    expect(screen.getByLabelText('Lead').closest('dd')!.className).toBe('')
    expect(screen.getByLabelText('Started').closest('dd')!.className).toBe('')
  })

  it('puts an error under its field, and names a refusal about a field it does not draw', () => {
    edit({ errors: [{ field: 'status', message: 'must be equal to one of the allowed values' }, { field: 'ghost', message: 'is not a field this registry has' }] })
    expect(screen.getByText('must be equal to one of the allowed values').closest('dd')!.previousElementSibling!.textContent).toContain('Status')
    expect(screen.getByText('ghost: is not a field this registry has')).toBeTruthy()
  })

  it('draws a field named like something every object inherits', () => {
    edit({ draft: JSON.parse('{"id":"a","toString":"x","constructor":"y"}') as Record<string, unknown>, file: null })
    expect(screen.getByText('ToString (YAML)')).toBeTruthy()
    expect(screen.getByText('Constructor (YAML)')).toBeTruthy()
  })
})
