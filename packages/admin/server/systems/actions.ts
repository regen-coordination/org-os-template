import type { ActionParam, ActionSpec } from './driver.ts'
import { addressOf, parseCaip2 } from '../../lib/caip.mjs'
import { normalHatId, parseHatRef } from '../../lib/hats.mjs'

/** The most UTF-8 bytes of text an action takes (a hat's details: the platform's own limit, kept well within what a transaction carries). */
export const TEXT_MAX = 7000

const UINT256_MAX = (1n << 256n) - 1n
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/

type Read = { ok: true; value: unknown } | { ok: false; error: string }
const no = (name: string, why: string): Read => ({ ok: false, error: `"${name}" ${why}` })

function address(name: string, v: unknown): Read {
  if (typeof v !== 'string') return no(name, 'is not an address')
  try { return { ok: true, value: addressOf(v.trim()) } } catch {
    return no(name, `is not an address (0x and 40 hex digits, all lowercase or in its checksum case, or a CAIP-10 account): ${JSON.stringify(v)}`)
  }
}

function one(p: ActionParam, v: unknown): Read {
  const { name } = p
  switch (p.type) {
    case 'address': return address(name, v)
    case 'addresses': {
      if (!Array.isArray(v) || v.length === 0) return no(name, 'is not a list of addresses')
      const out: string[] = []
      for (const [i, a] of v.entries()) {
        const r = address(`${name}[${i}]`, a)
        if (!r.ok) return r
        out.push(r.value as string)
      }
      return { ok: true, value: out }
    }
    case 'uint': {
      const text = typeof v === 'number' && Number.isSafeInteger(v) ? String(v) : typeof v === 'string' ? v.trim() : null
      if (text === null || !/^\d+$/.test(text) || BigInt(text) > UINT256_MAX) return no(name, `is not a whole number of 0 or more: ${JSON.stringify(v)}`)
      return { ok: true, value: BigInt(text).toString(10) }
    }
    case 'string': return typeof v === 'string' ? { ok: true, value: v } : no(name, 'is not text')
    case 'text': {
      if (typeof v !== 'string') return no(name, 'is not text')
      const bytes = Buffer.byteLength(v, 'utf8')
      return bytes > TEXT_MAX ? no(name, `is ${bytes} bytes; at most ${TEXT_MAX}`) : { ok: true, value: v }
    }
    case 'strings':
      return Array.isArray(v) && v.every(x => typeof x === 'string') ? { ok: true, value: [...v] } : no(name, 'is not a list of text')
    case 'hat': {
      // Any form lib/hats.mjs reads: full hex, the pretty form (0x0000000d.0001), decimal, or a hat ref (eip155:<n>:0x…, which
      // keeps its chain so the driver can refuse another one). The answer is one canonical form: lowercase full hex, or the ref.
      const text = typeof v === 'string' ? v.trim() : null
      const ref = text === null ? null : parseHatRef(text)
      const id = ref ? `${ref.chain}:${ref.hatId}` : text === null ? null : normalHatId(text)
      return id === null ? no(name, `is not a hat (full hex, the form 0x0000000d.0001, a decimal number, or a hat ref like eip155:42220:0x…): ${JSON.stringify(v)}`) : { ok: true, value: id }
    }
    case 'chains': {
      if (!Array.isArray(v) || v.length === 0) return no(name, 'is not a list of chains')
      const bad = v.find(c => typeof c !== 'string' || !parseCaip2(c))
      return bad === undefined ? { ok: true, value: [...new Set(v as string[])] } : no(name, `holds ${JSON.stringify(bad)}, which is not a CAIP-2 chain id (like eip155:42220)`)
    }
    case 'datetime': {
      const t = typeof v === 'string' && ISO.test(v.trim()) ? Date.parse(v.trim()) : Number.NaN
      return Number.isNaN(t) ? no(name, `is not a date and time in ISO 8601 with its zone (like 2026-11-02T10:00:00Z): ${JSON.stringify(v)}`) : { ok: true, value: Math.floor(t / 1000) }
    }
  }
}

/** An action's parameters as the form sent them, read by `spec`: addresses checksummed, numbers as decimal text, times
 *  as unix seconds. Unknown keys and missing ones are refused by name; an optional one may be absent (or null). */
export function readParams(spec: ActionSpec, raw: unknown): { ok: true; params: Record<string, unknown> } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, error: `the parameters of ${spec.id} are not an object` }
  const given = raw as Record<string, unknown>
  const names = spec.params.map(p => p.name)
  const extra = Object.keys(given).find(k => !names.includes(k))
  if (extra !== undefined) return { ok: false, error: `"${extra}" is not a parameter of ${spec.id} (it takes ${names.length > 0 ? names.join(', ') : 'none'})` }
  const params: Record<string, unknown> = {}
  for (const p of spec.params) {
    const v = Object.hasOwn(given, p.name) ? given[p.name] : undefined
    if (v === undefined || v === null) {
      if (p.optional) continue
      return { ok: false, error: `"${p.name}" is missing` }
    }
    const r = one(p, v)
    if (!r.ok) return r
    params[p.name] = r.value
  }
  return { ok: true, params }
}
