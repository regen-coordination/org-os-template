// The approved gallery's shots beside this build's, side by side, in one page to look at.
//
// Usage, from packages/admin, after `npm run e2e:parts`:
//   npx tsx tests/e2e/gallery-compare.mts <out-dir>
// <out-dir> must be outside any git repository, its working tree or its .git (it is refused with exit 2 otherwise): the page and
// the copies of both sets of images are a look, not something to commit.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const GALLERY_SHOTS = join(here, '..', '..', '..', '..', 'docs', 'design', 'gallery-shots')
export const PARTS_SHOTS = join(here, '..', '..', 'app', 'e2e', 'parts')

/** The nearest directory on the way up from `dir` that exists (the out-dir may not, yet). */
function nearestExisting(dir: string): string {
  let d = resolve(dir)
  while (!existsSync(d) && dirname(d) !== d) d = dirname(d)
  return d
}

/** Is `dir` in a repository — its working tree or its `.git` directory? `rev-parse --git-dir` succeeds in both
 *  (`--is-inside-work-tree` prints false inside `.git`, which let copies land there: L4a final review M-20). The
 *  caller's GIT_DIR / GIT_WORK_TREE are left out, so only where `dir` is counts. A git that cannot run allows. */
function insideWorkTree(dir: string): boolean {
  const env = { ...process.env }
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE']) delete env[k]
  try {
    execFileSync('git', ['-C', nearestExisting(dir), 'rev-parse', '--git-dir'], { stdio: ['ignore', 'pipe', 'ignore'], env })
    return true
  } catch { return false }
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

/** Writes `<out>/index.html` and copies the gallery's shots into `<out>/gallery/` and this build's into
 *  `<out>/house/`. Returns the exit code: 2 when `out` is inside a git working tree (nothing written). */
export function galleryCompare(o: { out: string; gallery?: string; shots?: string; say?: (line: string) => void }): number {
  const say = o.say ?? console.log
  const gallery = o.gallery ?? GALLERY_SHOTS, shots = o.shots ?? PARTS_SHOTS
  if (insideWorkTree(o.out)) {
    say(`refused: ${o.out} is inside a git working tree; give a directory outside any repository (e.g. under the OS temp dir)`)
    return 2
  }
  const names = readdirSync(gallery).filter(f => f.endsWith('.png')).sort()
  mkdirSync(join(o.out, 'gallery'), { recursive: true })
  mkdirSync(join(o.out, 'house'), { recursive: true })
  const rows = names.map(name => {
    copyFileSync(join(gallery, name), join(o.out, 'gallery', name))
    const ours = join(shots, name)
    const has = existsSync(ours)
    if (has) copyFileSync(ours, join(o.out, 'house', name))
    const n = esc(name)
    return `<section><h2>${esc(name.replace(/\.png$/, ''))}</h2><div class="pair">
<figure><figcaption>gallery</figcaption><img src="gallery/${n}" alt="the gallery's ${n}"></figure>
<figure><figcaption>house</figcaption>${has ? `<img src="house/${n}" alt="this build's ${n}">` : '<p>not shot yet</p>'}</figure></div></section>`
  })
  writeFileSync(join(o.out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Gallery and house, side by side</title>
<style>body{font:14px/1.5 system-ui,sans-serif;margin:24px;background:#f4f2ec;color:#1c1d1a}h2{font-size:14px;margin:32px 0 8px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}figure{margin:0}figcaption{font:12px ui-monospace,monospace;color:#57554e}
img{max-width:100%;border:1px solid #d6d2c7}</style>
<h1>Gallery and house, side by side</h1>
${rows.join('\n')}
`)
  say(`wrote ${join(o.out, 'index.html')} (${names.length} pairs)`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = process.argv[2]
  if (!out) { console.error('usage: tsx tests/e2e/gallery-compare.mts <out-dir>'); process.exit(2) }
  process.exit(galleryCompare({ out }))
}
