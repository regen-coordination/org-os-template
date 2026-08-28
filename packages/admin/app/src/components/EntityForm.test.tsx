// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import EntityForm from './EntityForm.tsx'
import type { JsonSchema, Entity } from '../api.ts'

const schema: JsonSchema = {
  'x-order': ['id', 'title', 'status'],
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    status: { enum: ['idea', 'develop', 'execute', 'archive'] },
    tags: { type: 'array', items: { type: 'string' } },
  },
}
const entity: Entity = { id: 'proj-001', title: 'Old title', status: 'idea', tags: ['a', 'b'] }

const wrap = (ui: React.ReactElement) =>
  render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>)

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(entity), { status: 200 })))
})

describe('EntityForm', () => {
  it('renders enum fields as selects with schema options', () => {
    wrap(<EntityForm registry="projects" schema={schema} entity={entity} onClose={() => {}} />)
    const select = screen.getByLabelText('status') as HTMLSelectElement
    expect([...select.options].map(o => o.value)).toEqual(['', 'idea', 'develop', 'execute', 'archive'])
  })

  it('renders string arrays as comma-separated input', () => {
    wrap(<EntityForm registry="projects" schema={schema} entity={entity} onClose={() => {}} />)
    expect((screen.getByLabelText('tags') as HTMLInputElement).value).toBe('a, b')
  })

  it('PUTs the edited entity on save', async () => {
    wrap(<EntityForm registry="projects" schema={schema} entity={entity} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('title'), { target: { value: 'New title' } })
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    const [url, init] = vi.mocked(fetch).mock.calls[0]! as [string, RequestInit]
    expect(url).toBe('/api/registries/projects/proj-001')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body as string).title).toBe('New title')
  })

  it('shows field errors from a 422', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(
      JSON.stringify({ errors: [{ field: 'status', message: 'must be equal to one of the allowed values' }] }),
      { status: 422 },
    ))
    wrap(<EntityForm registry="projects" schema={schema} entity={entity} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() =>
      expect(screen.getByText(/allowed values/)).toBeTruthy())
  })
})
