import { Route, Switch } from 'wouter'
import type { JsonSchema } from '../api.ts'
import RecordPage from '../pages/Record.tsx'
import { safeDecode } from '../hrefs.ts'
import { fetchRoutes } from './fetchRoutes.ts'
import { renderAt } from './render.tsx'
import { baseRoutes, resource } from './data.ts'

export const projectSchema = { 'x-order': ['id', 'title', 'status', 'lead', 'started'], properties: {
  id: { type: 'string' }, title: { type: 'string' }, status: { type: 'string' }, lead: { type: 'string' }, started: { type: 'string', format: 'date' } } }

/** A schema annotated as the framework's are: titles, help, groups, choices of every kind. */
export const annotatedProjectSchema: JsonSchema = {
  required: ['id'],
  'x-order': ['id', 'title', 'summary', 'kind', 'lead', 'status', 'started'],
  'x-groups': [
    { label: 'What it is', fields: ['title', 'summary', 'kind'] },
    { label: 'Who', fields: ['lead', 'contributors'] },
    { label: 'Where it stands', fields: ['status', 'relevance', 'started'] },
    { label: 'Milestones', fields: ['milestones'], optional: true },
  ],
  properties: {
    id: { type: 'string' },
    title: { type: ['string', 'null'], title: 'Title' },
    summary: { type: ['string', 'null'], title: 'Summary', description: 'One or two sentences, shown on cards and the door.', 'x-format': 'textarea' },
    kind: { type: ['string', 'null'], title: 'Kind', examples: ['programme', 'project'] },
    lead: { type: ['string', 'null'], title: 'Lead', description: 'The person accountable for it.' },
    contributors: { type: ['array', 'null'], title: 'Contributors', items: { type: 'string' } },
    status: { type: ['string', 'null'], title: 'Status' },
    relevance: { enum: ['high', 'medium', 'low', null], title: 'Relevance' },
    started: { type: ['string', 'null'], format: 'date', title: 'Started' },
    milestones: { type: ['array', 'null'], title: 'Milestones', items: { type: 'object', title: 'Milestone', properties: { title: { title: 'What' }, date: { title: 'When', 'x-format': 'date' } } } },
    tags: { type: ['array', 'null'], items: { type: ['string', 'number'] } },
    target_completion: { type: ['string', 'null'], format: 'date' },
    handles: { type: ['object', 'null'] },
  },
}

/** The record page at a path, routed as App.tsx routes it. */
export const page = (path: string, opts?: Parameters<typeof renderAt>[2]) =>
  renderAt(<Switch><Route path="/r/:kind/:id">{p => <RecordPage kind={safeDecode(p.kind)} id={safeDecode(p.id)} />}</Route></Switch>, path, opts)

export const p1 = resource({ name: 'Seed Library', changed: { at: new Date().toISOString(), by: 'Steward A' } })

/** Project p1, led by steward-a, with nothing staged; `over` replaces any route. `entries` may be a
 *  function, so a test can change the file under an open page. */
export const projectRoutes = (over: Record<string, unknown> = {}, entries: () => unknown[] = () => [{ id: 'p1', title: 'Seed Library', status: 'develop', lead: 'steward-a' }]) => fetchRoutes({
  ...baseRoutes(),
  'GET /api/resources/project%3Ap1': { resource: p1, edges: [{ from: 'project:p1', to: 'person:steward-a', kind: 'lead' }], neighbours: [resource({ id: 'person:steward-a', kind: 'person', name: 'Steward A' })] },
  'GET /api/registries/projects': () => ({ name: 'projects', kind: 'collection', schemaVersion: '2.0', entries: entries() }),
  'GET /api/schemas/projects': projectSchema,
  'GET /api/registries/members': { name: 'members', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 'steward-a', name: 'Steward A' }, { id: 'steward-b', name: 'Steward B' }] },
  'GET /api/operations': [], 'GET /api/jobs': [],
  ...over,
})
