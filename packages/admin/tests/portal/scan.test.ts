// The scan (DAO-OS L9 spec §3.4 points 2 and 3): a withheld string anywhere in the output, or a structure the portal must
// not have, refuses the release. A refusal names the file and the path, never the value.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { collectPortalInput, type PortalInput } from '../../server/portal/inputs.ts'
import { scanPortal } from '../../server/portal/scan.ts'
import { ACTOR, PORTAL_ORIGIN, NOW, SAFE_ID, SENTINEL, makePortalInstance, standInReader, type PortalInstance } from '../fixtures/portal/instance.ts'

let inst: PortalInstance
let input: PortalInput

beforeAll(async () => {
  inst = await makePortalInstance()
  const got = await collectPortalInput(inst.repo, { reader: standInReader(), store: inst.store, storeConfigured: true, now: NOW, portalOrigin: PORTAL_ORIGIN })
  if ('refuse' in got) throw new Error(got.refuse)
  input = got
}, 60_000)
afterAll(() => inst?.remove())

const modelScript = (model: unknown) =>
  `<script type="application/json" id="portal-model">${JSON.stringify(model).replace(/</g, '\\u003c')}</script>`
const page = (body: string, head = '') =>
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n${head}\n<link rel="stylesheet" href="/assets/portal-1a2b.css">\n</head>\n<body>\n${body}\n<script type="module" src="/assets/portal-1a2b.js"></script>\n</body>\n</html>\n`
const MODEL = { org: { name: 'Portal Test Org' }, decisions: [{ id: 'p-1', title: 'Move the public project', state: 'ratified' }], treasury: { address: SAFE_ID } }
const clean = () => ({
  'index.html': page(`<main><h1>Portal Test Org</h1><a href="https://forum.example.org">Forum</a></main>\n${modelScript(MODEL)}`),
  '.well-known/dao.json': JSON.stringify({ name: 'Portal Test Org' }, null, 2),
  'robots.txt': 'User-agent: *\nAllow: /\n',
})
const texts = (problems: { text: string }[]) => problems.map(p => p.text).join('\n')

describe('scanPortal: the withheld strings', () => {
  it('a clean portal passes', () => {
    expect(scanPortal(clean(), input)).toEqual([])
  })

  it('finds a sentinel planted in HTML, and names the file and line, never the value', () => {
    const files = { ...clean(), 'index.html': page(`<main>\n<p>${SENTINEL.store}</p>\n</main>`) }
    const problems = scanPortal(files, input)
    expect(problems).toEqual([{
      level: 'error', file: 'index.html',
      text: `a withheld value (${SENTINEL.store.length} characters) is published at line 10; nothing is published while it is`,
    }])
  })

  it('finds a sentinel escaped as HTML writes it', () => {
    const secret = 'Fish & Chips <Co>'
    const files = { ...clean(), 'index.html': page('<p>Fish &amp; Chips &lt;Co&gt;</p>') }
    const problems = scanPortal(files, { ...input, secrets: new Set([...input.secrets, secret]) })
    expect(problems.map(p => p.file)).toEqual(['index.html'])
    expect(texts(problems)).not.toContain('Fish')
  })

  it('finds a sentinel written with numeric references to its capitals, decimal or hex', () => {
    for (const body of [
      '<p>&#83;ENTINEL-store-1</p>', '<p>&#x53;ENTINEL-store-1</p>', '<p>&#X53;&#x45;NTINEL-store-1</p>',
    ]) {
      const problems = scanPortal({ ...clean(), 'index.html': page(`<main>\n${body}\n</main>`) }, input)
      expect([body, problems.map(p => p.file)]).toEqual([body, ['index.html']])
      expect(problems[0]!.text).toContain('line 10')
      expect(texts(problems)).not.toContain('SENTINEL')
    }
  })

  it('a secret that spans a line break is found in the whole text, decoded too, at the line it starts on', () => {
    const secret = 'SENTINEL-multi\nline-7'
    const problems = scanPortal({ ...clean(), 'index.html': page('<main>\n<p>SENTINEL-multi\n&#108;ine-7</p>\n</main>') },
      { ...input, secrets: new Set([...input.secrets, secret]) })
    expect(problems).toEqual([{
      level: 'error', file: 'index.html',
      text: `a withheld value (${secret.length} characters) is published at line 10; nothing is published while it is`,
    }])
  })

  it('finds a sentinel split by markup, as a reader sees it', () => {
    for (const body of [
      `<p>SENTINEL-<b>store</b>-1</p>`,
      `<p>SENTINEL-<span class="x" data-note="a>b">store</span>-&#49;</p>`,
      `<p>SENTINEL-st<!-- a comment -->ore-1</p>`,
    ]) {
      const problems = scanPortal({ ...clean(), 'index.html': page(`<main>\n${body}\n</main>`) }, input)
      expect([body, problems.map(p => p.file)]).toEqual([body, ['index.html']])
      expect(problems[0]!.text).toContain('line 10')
      expect(texts(problems)).not.toContain('SENTINEL')
    }
  })

  it('finds a secret of several words broken by a newline, by runs of whitespace, by a tag between words, or by &nbsp;', () => {
    const secret = 'Council salary bands'
    const withSecret = { ...input, secrets: new Set([...input.secrets, secret]) }
    for (const body of [
      '<p>Council\n   salary bands</p>', '<p>Council  \t salary\n\nbands</p>', '<p>Council<br>salary <em>bands</em></p>',
      '<p>Council&nbsp;salary&#32;bands</p>', '<li>Council</li><li>salary bands</li>',
    ]) {
      const problems = scanPortal({ ...clean(), 'index.html': page(`<main>\n${body}\n</main>`) }, withSecret)
      expect([body, problems.map(p => p.file)]).toEqual([body, ['index.html']])
      expect(problems[0]!.text).toContain('line 10')
      expect(texts(problems)).not.toContain('salary')
    }
    // words that only touch across markup, and no secret's own spelling, are not found
    expect(scanPortal({ ...clean(), 'index.html': page('<p>Council</p>\n<p>salaries</p>') }, withSecret)).toEqual([])
  })

  it('finds a sentinel in the embedded model JSON and names its JSON path', () => {
    const model = { ...MODEL, decisions: [{ id: 'p-1', title: SENTINEL.members, state: 'open' }] }
    const problems = scanPortal({ ...clean(), 'index.html': page(`<main></main>\n${modelScript(model)}`) }, input)
    expect(problems).toEqual([expect.objectContaining({ level: 'error', file: 'index.html#portal-model' })])
    expect(problems[0]!.text).toContain('$.decisions[0].title')
    expect(texts(problems)).not.toContain('SENTINEL')
  })

  it('finds a sentinel (and the actor account) in a .well-known file and names its path', () => {
    const files = { ...clean(), '.well-known/members.json': JSON.stringify({ members: [{ id: ACTOR, note: `by ${SENTINEL.field}` }] }) }
    const problems = scanPortal(files, input)
    expect([...new Set(problems.map(p => p.file))]).toEqual(['.well-known/members.json'])
    expect(texts(problems)).toContain('$.members[0].note')
    expect(texts(problems)).toContain('$.members[0].id')
    expect(texts(problems)).not.toContain('SENTINEL')
    expect(texts(problems).toLowerCase()).not.toContain(ACTOR.slice(-10).toLowerCase())
  })

  it('finds a sentinel in robots.txt and the manifest', () => {
    const problems = scanPortal({ ...clean(), 'robots.txt': `Disallow: /${SENTINEL.budget}\n`, 'portal-manifest.json': JSON.stringify({ note: SENTINEL.pending }) }, input)
    expect(problems.map(p => p.file).sort()).toEqual(['portal-manifest.json', 'robots.txt'])
    expect(texts(problems)).not.toContain('SENTINEL')
  })
})

describe('scanPortal: the structure (§3.4 point 3)', () => {
  const withModel = (model: unknown) => ({ ...clean(), 'index.html': page(`<main></main>\n${modelScript(model)}`) })

  it('a model with a restricted key fails', () => {
    const problems = scanPortal(withModel({ ...MODEL, decisions: [{ id: 'p-1', restricted: true }] }), input)
    expect(problems).toEqual([expect.objectContaining({ level: 'error', file: 'index.html#portal-model' })])
    expect(problems[0]!.text).toContain('$.decisions[0]')
    expect(problems[0]!.text).toContain('restricted')
  })

  it('a model with visibility: members fails; visibility: public does not', () => {
    const problems = scanPortal(withModel({ ...MODEL, map: { nodes: [{ id: 'n', visibility: 'members' }] } }), input)
    expect(problems).toEqual([expect.objectContaining({ level: 'error', file: 'index.html#portal-model' })])
    expect(problems[0]!.text).toContain('$.map.nodes[0].visibility')
    expect(scanPortal(withModel({ ...MODEL, map: { nodes: [{ id: 'n', visibility: 'public' }] } }), input)).toEqual([])
  })

  it('a model with an actor\'s account fails, whatever its case; a public System\'s contract does not', () => {
    // an account the secrets do not hold (it is no recorded actor): the structure refuses it all the same
    const stranger = 'eip155:10:0x00000000000000000000000000000000000000A3'
    const problems = scanPortal(withModel({ ...MODEL, hats: [{ name: 'Council', by: stranger }] }), { ...input, secrets: new Set() })
    expect(problems).toEqual([expect.objectContaining({ level: 'error', file: 'index.html#portal-model' })])
    expect(problems[0]!.text).toContain('$.hats[0].by')
    expect(problems[0]!.text).not.toContain('0x')
    expect(scanPortal(withModel({ ...MODEL, treasury: { address: SAFE_ID.toLowerCase() } }), input)).toEqual([])
  })

  it('a <form> in the HTML fails', () => {
    const problems = scanPortal({ ...clean(), 'index.html': page('<form method="post" action="/api/x"><input name="a"></form>') }, input)
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.every(p => p.level === 'error' && p.file === 'index.html')).toBe(true)
    expect(texts(problems)).toContain('form')
  })

  it('a <button> whose action writes fails; a plain button does not', () => {
    expect(scanPortal({ ...clean(), 'index.html': page('<button formaction="/api/portal/rebuild" formmethod="post">Go</button>') }, input))
      .toEqual([expect.objectContaining({ level: 'error', file: 'index.html' })])
    expect(scanPortal({ ...clean(), 'index.html': page('<button type="button">Menu</button>') }, input)).toEqual([])
  })

  it('a script, a stylesheet, an image or a style from another host fails; the portal\'s own host and relative paths do not', () => {
    for (const html of [
      '<script src="https://cdn.other.test/x.js"></script>',
      '<script src="//cdn.other.test/x.js"></script>',
      '<img src="http://images.other.test/a.png" alt="">',
      '<link rel="preload" href="https://fonts.other.test/f.woff2" as="font">',
      '<div style="background: url(https://images.other.test/b.png)"></div>',
      '<style>@import "https://fonts.other.test/x.css";</style>',
      '<a href="/x" ping="https://track.other.test/p">x</a>',
    ]) {
      const problems = scanPortal({ ...clean(), 'index.html': page(html) }, input)
      expect([html, problems.length > 0 && problems.every(p => p.level === 'error' && p.file === 'index.html')]).toEqual([html, true])
      expect(texts(problems)).not.toContain('other.test')
    }
    for (const html of [
      `<script src="${PORTAL_ORIGIN}/assets/x.js"></script>`,
      '<img src="/assets/a.png" alt=""><img src="data:image/png;base64,AAAA" alt="">',
      '<a href="https://forum.example.org">Forum</a>',
    ]) expect([html, scanPortal({ ...clean(), 'index.html': page(html) }, input)]).toEqual([html, []])
  })

  it('a quoted ">" in an attribute hides no request after it', () => {
    for (const html of [
      '<img alt="a>b" src="https://images.other.test/a.png">',
      "<img alt='a>b' src=\"https://images.other.test/a.png\">",
      '<button data-x="1>0" formaction="/api/portal/rebuild">Go</button>',
    ]) {
      const problems = scanPortal({ ...clean(), 'index.html': page(html) }, input)
      expect([html, problems.length > 0 && problems.every(p => p.level === 'error' && p.file === 'index.html')]).toEqual([html, true])
    }
    expect(scanPortal({ ...clean(), 'index.html': page('<img alt="a>b" src="/assets/a.png">') }, input)).toEqual([])
  })

  it('an SVG <image xlink:href> or <use href> from another host fails', () => {
    for (const html of [
      '<svg><image xlink:href="https://images.other.test/a.png"/></svg>',
      '<svg><use href="https://sprites.other.test/s.svg#i"/></svg>',
    ]) {
      const problems = scanPortal({ ...clean(), 'index.html': page(html) }, input)
      expect([html, problems.length > 0 && problems.every(p => p.level === 'error' && p.file === 'index.html')]).toEqual([html, true])
      expect(texts(problems)).not.toContain('other.test')
    }
    expect(scanPortal({ ...clean(), 'index.html': page('<svg><image xlink:href="/assets/a.png"/></svg>') }, input)).toEqual([])
  })

  it('a JSON script whose opening tag holds a quoted ">" is still read as the model', () => {
    const html = `<main></main>\n<script data-note="a>b" type="application/json" id="portal-model">${JSON.stringify({ decisions: [{ id: 'p-1', restricted: true }] })}</script>`
    const problems = scanPortal({ ...clean(), 'index.html': page(html) }, input)
    expect(problems).toEqual([expect.objectContaining({ level: 'error', file: 'index.html#portal-model' })])
  })

  it('with no portal origin, any absolute request is another host', () => {
    const problems = scanPortal({ ...clean(), 'index.html': page(`<script src="${PORTAL_ORIGIN}/assets/x.js"></script>`) }, { ...input, portalOrigin: null })
    expect(problems).toEqual([expect.objectContaining({ level: 'error', file: 'index.html' })])
  })
})
