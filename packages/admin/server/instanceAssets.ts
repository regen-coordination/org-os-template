// The instance's own images: a mark and whatever else its skin draws (a wordmark, a texture). An instance keeps them
// in `house/` beside its skin, so the skin names them by address (`url(/instance-assets/wordmark.svg)`) instead of
// carrying them inline, and its mark reaches the org seal through `org.mark` (OrgSwitcher.tsx): `house/mark.svg`,
// `.png` or `.webp`, the first there is. Only image files directly in `house/`, by a plain name, up to a size cap.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const INSTANCE_ASSETS_PREFIX = '/instance-assets/'
export const INSTANCE_ASSETS_DIR = 'house'
/** Larger than any mark or wordmark needs. */
export const INSTANCE_ASSET_MAX_BYTES = 256 * 1024
export const ASSET_TYPES: Readonly<Record<string, string>> = {
  svg: 'image/svg+xml', png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg',
}
/** A plain file name: lower case, digits and dashes, one image extension. No folders, no dots before it. */
export const ASSET_NAME = /^[a-z0-9][a-z0-9-]{0,47}\.(svg|png|webp|jpg)$/
const MARKS = ['mark.svg', 'mark.png', 'mark.webp'] as const

export interface InstanceAsset { body: Buffer; type: string }

/** One of the instance's images by name, or null: a name that is not a plain image name, a file that is not there,
 *  not a file, or larger than the cap. Read on every call. */
export function readInstanceAsset(repo: string, name: string): InstanceAsset | null {
  const m = ASSET_NAME.exec(name)
  if (!m) return null
  const file = join(repo, INSTANCE_ASSETS_DIR, name)
  if (!existsSync(file)) return null
  const st = statSync(file)
  if (!st.isFile() || st.size > INSTANCE_ASSET_MAX_BYTES) return null
  return { body: readFileSync(file), type: ASSET_TYPES[m[1]!]! }
}

/** The address of the instance's mark, for the org seal, or null when it carries none. */
export function instanceMark(repo: string): string | null {
  const name = MARKS.find(n => readInstanceAsset(repo, n) !== null)
  return name ? `${INSTANCE_ASSETS_PREFIX}${name}` : null
}

/** The headers an instance image is served with. An SVG may hold script; served as an image with no permission to
 *  run or fetch anything, it can draw and nothing more. */
export function assetHeaders(type: string): Record<string, string> {
  return {
    'Content-Type': type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff',
    ...(type === 'image/svg+xml' ? { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" } : {}),
  }
}
