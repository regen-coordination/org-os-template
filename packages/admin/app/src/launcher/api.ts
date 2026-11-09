import { cloneName } from '../../../lib/clone-name.mjs'
/** The launcher's own API (launcher/serve.ts). Each call returns the parsed JSON, or throws Error(body.error);
 *  a 409 that carries `adoptable` keeps it, with the path, on the error. Tasks 4-6 add their calls here. */

import type { Answers } from '../../../lib/open-instance.mjs'

export type RecentEntry = { path: string; name: string | null; found: boolean; instance: boolean }
export type Door = { id: 'open' | 'create' | 'adopt' | 'join'; available: boolean; note?: string }
export type LauncherState = { base: string; recent: RecentEntry[]; doors: Door[] }

export class LauncherError extends Error {
  adoptable?: boolean
  path?: string
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const err = new LauncherError(typeof json.error === 'string' ? json.error : `The launcher answered ${res.status}.`)
    if (json.adoptable === true) { err.adoptable = true; err.path = typeof json.path === 'string' ? json.path : undefined }
    throw err
  }
  return json as T
}

export const launcherState = () => call<LauncherState>('GET', '/api/launcher/state')
export const openInstance = (path: string) => call<{ url: string }>('POST', '/api/launcher/open', { path })
export const forgetRecent = (path: string) => call<{ recent: RecentEntry[] }>('DELETE', '/api/launcher/recent', { path })
export const cloneInstance = (url: string, folder: string) => call<{ url: string }>('POST', '/api/launcher/clone', { url, folder })

export const launcherWizard = () => call<import('../../../lib/wizards.mjs').WizardDef>('GET', '/api/launcher/wizard')
/** Creates the instance the answers describe and answers where it opened; throws Error(body.error), with the command's log on `log`. */
export const createInstance = (answers: Answers) => call<{ url: string }>('POST', '/api/launcher/create', { answers })

/** The default folder for a clone: the repo's name, inside `base`. */
export function defaultCloneFolder(url: string, base: string): string {
  return `${base.replace(/\/+$/, '')}/${cloneName(url)}`
}
