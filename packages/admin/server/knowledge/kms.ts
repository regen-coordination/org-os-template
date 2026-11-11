/** The one bridge to org-os-kms. Every route in this lane calls kms's own functions through here and nowhere else
 *  (spec §9, R-35): the canon's files are read by kms's adapter, the gate by kms's `selectPublic`, the page model by
 *  kms's `buildCommons` — never a second reading of `data/kb/*.yaml`.
 *
 *  kms is a sibling package that an instance may not have (kms is replaceable by design). So the import is dynamic and
 *  one module deep: without it, every route in this lane answers `{ configured: false, reason }` and the app shows one
 *  sentence instead of a broken page.
 *
 *  The types below are deliberately loose. Mirroring kms's signatures in TypeScript would be a second copy of kms's
 *  shape — the thing R-35 exists to prevent. */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Where kms's code is. Two places, in this order: the repository this server serves (an org-os checkout carries
 *  `packages/org-os-kms` beside `packages/admin`), and then this package's own sibling — so a server started against
 *  another instance still finds the kms it shipped with. The *data* is always the served repository's. */
export function kmsSrc(repo: string): string {
  const beside = join(repo, 'packages', 'org-os-kms', 'src')
  if (existsSync(join(beside, 'framework.mjs'))) return beside
  return fileURLToPath(new URL('../../../org-os-kms/src/', import.meta.url)).replace(/\/$/, '')
}

/** One load per file, kept: kms's modules are pure, and a route reads the canon on every request.
 *
 *  Loading is `require()` of kms's ESM (Node 22.12+): kms's modules have no top-level await, and this keeps the load
 *  out of a bundler's import transform — a dev server's or a test runner's — which refuses a path outside its own root.
 *  Node's own loader resolves kms's relative imports either way. */
const modules = new Map<string, Promise<unknown>>()
const req = createRequire(import.meta.url)

function load(repo: string, rel: string): Promise<unknown> {
  const path = join(kmsSrc(repo), rel)
  let hit = modules.get(path)
  if (!hit) {
    hit = Promise.resolve().then(() => req(path))
    modules.set(path, hit)
    // A module that failed to load must not poison every later request with the same rejection.
    hit.catch(() => modules.delete(path))
  }
  return hit
}

/* eslint-disable @typescript-eslint/no-explicit-any -- kms's own shapes, imported as they are (see the header). */

/** The kms functions this lane calls. Each is kms's own export, untyped here on purpose. */
export interface Kms {
  loadKmsConfig: (dir: string) => any
  getAdapter: (name: string) => any
  selectPublic: (input: { dir: string; config: any; all: any[] }) => Promise<any>
  buildCommons: (input: any) => any
  readReads: (dir: string) => Record<string, any>
  readManifest: (dir: string) => any
  planeRole: (config: any) => string | null
  slugFromRef: (ref: string) => string
  glyphFor: (schema: string, entities?: any) => string
  kindLabel: (schema: string) => string
  maturityMark: (maturity: string) => { shape: string; word: string } | null
  validateObject: (schema: string, object: Record<string, unknown>) => { errors?: string[]; ok?: boolean }
  isAwaitingReview: (object: Record<string, unknown>) => boolean
  isPublishable: (object: Record<string, unknown>, opts?: { schema?: string; types?: string[] }) => boolean
  publishableTypes: (config: any) => string[]
  publicView: (object: Record<string, unknown>) => Record<string, unknown>
  privateFields: readonly string[]
  publishablePublicUse: readonly string[]
  /** kms's own field labels (KI K-14), so a field row is named as the page names it. */
  labelFor: (field: string, opts?: { config?: any; pack?: any }) => string
}

export type KmsLoad = { ok: true; kms: Kms } | { ok: false; reason: string }

/** Whether this repository carries kms at all. `reason` is the sentence the app shows. */
export function kmsPresence(repo: string): { ok: true } | { ok: false; reason: string } {
  const src = kmsSrc(repo)
  if (!existsSync(join(src, 'framework.mjs'))) {
    return { ok: false, reason: 'the KMS is not here (no packages/org-os-kms/src/framework.mjs). Point this repository at org-os-kms to manage a knowledge commons.' }
  }
  if (!existsSync(join(repo, 'kms.yaml'))) {
    return { ok: false, reason: 'the commons is not set up here (no kms.yaml). Setting it up writes one; until then the canon has no path.' }
  }
  return { ok: true }
}

/** kms's functions, or the sentence that says why not. Called once per request; the imports are cached. */
export async function kms(repo: string): Promise<KmsLoad> {
  const present = kmsPresence(repo)
  if (!present.ok) return present
  try {
    const [fw, config, gate, model, reads, manifest, role, icons, labels] = await Promise.all([
      load(repo, 'framework.mjs'),
      load(repo, 'config.mjs'),
      load(repo, 'gate.mjs'),
      load(repo, 'pages/model.mjs'),
      load(repo, 'reads.mjs'),
      load(repo, 'manifest.mjs'),
      load(repo, 'planes/role.mjs'),
      load(repo, 'house/icons.mjs'),
      load(repo, 'pages/labels.mjs'),
    ]) as any[]
    return {
      ok: true,
      kms: {
        loadKmsConfig: config.loadKmsConfig,
        getAdapter: fw.getAdapter,
        selectPublic: gate.selectPublic,
        buildCommons: model.buildCommons,
        readReads: reads.readReads,
        readManifest: manifest.readManifest,
        planeRole: role.planeRole,
        slugFromRef: manifest.slugFromRef,
        glyphFor: icons.glyphFor,
        kindLabel: labels.kindLabel,
        maturityMark: (m: string) => labels.MATURITY_MARK?.[m] ?? null,
        validateObject: fw.validateObject,
        isAwaitingReview: fw.isAwaitingReview,
        isPublishable: fw.isPublishable,
        publishableTypes: fw.publishableTypes,
        publicView: fw.publicView,
        privateFields: fw.PRIVATE_FIELDS ?? [],
        publishablePublicUse: fw.PUBLISHABLE_PUBLIC_USE ?? [],
        labelFor: labels.labelFor,
      },
    }
  } catch (err) {
    return { ok: false, reason: `the KMS could not be loaded: ${err instanceof Error ? err.message : String(err)}` }
  }
}

/** Read one of kms's modules directly (the writer needs `yaml` handling of its own; T3 does not go through here). */
export const kmsModule = load
