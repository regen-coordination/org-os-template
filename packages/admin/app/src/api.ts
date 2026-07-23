export interface RegistrySummary { name: string; kind: 'collection' | 'document'; count: number | null }
export interface Status { org: string; branch: string; dirty: boolean }
export type Entity = Record<string, unknown> & { id: string }
export interface RegistryRead {
  name: string; kind: 'collection' | 'document'; schemaVersion: string | null
  entries?: Entity[]; document?: Record<string, unknown>
}
export interface FieldError { field: string; message: string }
export interface JsonSchema {
  properties?: Record<string, { type?: string | string[]; enum?: unknown[]; format?: string; items?: { type?: string } }>
  'x-order'?: string[]
}

export class ApiError extends Error {
  constructor(public status: number, public errors: FieldError[], message: string) { super(message) }
}

async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; errors?: FieldError[] }
    throw new ApiError(res.status, body.errors ?? [], body.error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

const json = (method: string, body: unknown): RequestInit => ({
  method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
})

export const api = {
  status: () => fetchJSON<Status>('/api/status'),
  registries: () => fetchJSON<RegistrySummary[]>('/api/registries'),
  registry: (name: string) => fetchJSON<RegistryRead>(`/api/registries/${name}`),
  schema: (name: string) => fetchJSON<JsonSchema>(`/api/schemas/${name}`),
  save: (name: string, id: string, entity: Entity) =>
    fetchJSON<Entity>(`/api/registries/${name}/${id}`, json('PUT', entity)),
  create: (name: string, entity: Entity) =>
    fetchJSON<Entity>(`/api/registries/${name}`, json('POST', entity)),
  remove: (name: string, id: string) =>
    fetchJSON<{ deleted: string }>(`/api/registries/${name}/${id}`, { method: 'DELETE' }),
}
