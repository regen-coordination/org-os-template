import { describe, it, expect } from 'vitest'
import { buildRequest, requestText } from '../../lib/federation/request.mjs'
import { transports, transportOf, registerTransport } from '../../server/federation/transports/index.ts'
import type { Transport, TransportCtx } from '../../server/federation/transports/types.ts'

const request = buildRequest({
  id: '11111111-2222-4333-8444-555555555555',
  from: { name: 'Fern Node', type: 'cooperative', url: 'https://fern.example.org' },
  hub: { name: 'Moss Hub', url: 'https://moss.example.org' },
  network: 'moss-network', answers: {}, now: '2026-11-22T10:00:00Z',
})
const ctx: TransportCtx = { run: async () => ({ code: 0, stdout: '', stderr: '', timedOut: false }), repo: '/nowhere' }

describe('request transports', () => {
  it('lists exactly file, github, hosted, p2p, atproto', () => {
    expect(transports().map(t => t.id)).toEqual(['file', 'github', 'hosted', 'p2p', 'atproto'])
  })
  it('file sends the exact requestText and is always available', async () => {
    const t = transportOf('file')!
    expect(t.unavailable(null, null)).toBeNull()
    expect(await t.ready(ctx)).toBeNull()
    const sent = await t.send(request, null, ctx)
    expect(sent).toEqual({ ref: `file:${request.id}`, summary: 'Saved as a file to send.', text: requestText(request) })
    expect(t.poll).toBeUndefined(); expect(t.status).toBeUndefined(); expect(t.reply).toBeUndefined()
  })
  it.each([
    ['hosted', 'Comes with hosted hubs, after sign-in.'],
    ['p2p', 'Comes later.'],
    ['atproto', 'Comes with the network index.'],
  ])('%s waits with its sentence and send throws', async (id, sentence) => {
    const t = transportOf(id)!
    expect(t.unavailable('https://moss.example.org', request)).toBe(sentence)
    await expect(t.send(request, null, ctx)).rejects.toThrow(sentence)
  })
  it('atproto is labelled as a public route', () => {
    expect(transportOf('atproto')!.label).toBe('Publish a request (public)')
  })
  it('github is a placeholder until its own task', () => {
    expect(transportOf('github')!.unavailable(null, null)).toBe('Not built yet.')
  })
  it('a sixth transport is found and listed with no caller change, and removes itself', async () => {
    const fake: Transport = {
      id: 'carrier-pigeon', label: 'Pigeon', unavailable: () => null, ready: async () => null,
      send: async r => ({ ref: `pigeon:${r.id}`, summary: 'Sent.' }),
    }
    const off = registerTransport(fake)
    expect(transportOf('carrier-pigeon')).toBe(fake)
    expect(transports().map(t => t.id)).toEqual(['file', 'github', 'hosted', 'p2p', 'atproto', 'carrier-pigeon'])
    off()
    expect(transportOf('carrier-pigeon')).toBeNull()
    expect(transports()).toHaveLength(5)
  })
  it('registering over an id replaces it, and unregistering restores the original', () => {
    const gh = transportOf('github')!
    const fake: Transport = { ...gh, label: 'Fake github' }
    const off = registerTransport(fake)
    expect(transportOf('github')).toBe(fake)
    expect(transports().map(t => t.id)).toEqual(['file', 'github', 'hosted', 'p2p', 'atproto'])
    off()
    expect(transportOf('github')).toBe(gh)
  })
})
