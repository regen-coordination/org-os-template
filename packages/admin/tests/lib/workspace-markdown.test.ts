// packages/admin/tests/lib/workspace-markdown.test.ts
//
// The Hub's Markdown dialect (L6 spec §5.2), page front matter and ids (§4.1). Pure: no git, no store.
import { describe, it, expect } from 'vitest'
import { hubMarkdownIt, refsOf, embedRefs } from '../../lib/workspace/markdown.mjs'
import { splitPage, joinPage, newPageId, orderBetween } from '../../lib/workspace/pages.mjs'

const hex = (n: number) => () => 'abcdef0123456789'.slice(0, n)

describe('newPageId', () => {
  it('gives a git page <slug>-<4 hex> from its title', () => {
    expect(newPageId('Onboarding: how we start', 'git')).toMatch(/^onboarding-how-we-start-[0-9a-f]{4}$/)
    expect(newPageId('Onboarding: how we start', 'git', hex(16))).toBe('onboarding-how-we-start-abcd')
  })
  it('slugs an empty title, or one with no ASCII letter or digit, as page', () => {
    expect(newPageId('', 'git')).toMatch(/^page-[0-9a-f]{4}$/)
    expect(newPageId('🌱 ✨', 'git')).toMatch(/^page-[0-9a-f]{4}$/)
  })
  it('folds accents to ASCII', () => {
    expect(newPageId('Ação coletiva', 'git', hex(4))).toBe('acao-coletiva-abcd')
  })
  it('cuts a 90-character title\'s slug at 48', () => {
    const id = newPageId('a'.repeat(90), 'git', hex(4))
    expect(id).toBe(`${'a'.repeat(48)}-abcd`)
    const spaced = newPageId('word '.repeat(18), 'git', hex(4))
    const slug = spaced.slice(0, -5)
    expect(slug.length).toBeLessThanOrEqual(48)
    expect(slug).not.toMatch(/-$/)
  })
  it('gives a private page p-<12 hex>, nothing of its title', () => {
    const id = newPageId('Salaries 2027', 'private')
    expect(id).toMatch(/^p-[0-9a-f]{12}$/)
    expect(id).not.toContain('salar')
    expect(newPageId('x', 'private', hex(16))).toBe('p-abcdef012345')
  })
  it('refuses a random source that is not hex or too short', () => {
    expect(() => newPageId('x', 'private', () => 'abc')).toThrow()
    expect(() => newPageId('x', 'git', () => 'zzzz')).toThrow()
  })
})

describe('orderBetween', () => {
  it('takes the mean of two neighbours', () => {
    expect(orderBetween(1000, 2000)).toBe(1500)
  })
  it('steps 1000 past an end, and starts at 1000 alone', () => {
    expect(orderBetween(null, null)).toBe(1000)
    expect(orderBetween(3000, null)).toBe(4000)
    expect(orderBetween(null, 1000)).toBe(0)
  })
  it('asks to renumber when the neighbours are closer than 1e-6', () => {
    expect(orderBetween(1, 1.0000001)).toBe('renumber')
    expect(orderBetween(5, 5)).toBe('renumber')
  })
})

describe('the dialect: hubMarkdownIt', () => {
  const md = hubMarkdownIt()
  const types = (src: string) => md.parse(src, {}).map((t) => t.type)

  it('parses GFM tables, strikethrough, task lists and autolinks', () => {
    expect(types('| a | b |\n| - | - |\n| 1 | 2 |\n')).toContain('table_open')
    expect(md.parseInline('~~gone~~', {})[0].children!.map((t) => t.type)).toContain('s_open')
    const tasks = md.parse('- [ ] open\n- [x] done\n- plain\n', {}).filter((t) => t.type === 'list_item_open')
    expect(tasks.map((t) => t.meta)).toEqual([{ task: true, checked: false }, { task: true, checked: true }, null])
    const inl = md.parse('- [x] done\n', {}).find((t) => t.type === 'inline')!
    expect(inl.content).toBe('done')
    expect(md.render('see https://example.org now')).toContain('<a href="https://example.org">')
  })
  it('parses > [!WARNING] as an alert and > [!NOPE] as a quote', () => {
    const alert = md.parse('> [!WARNING]\n> Keys stay off the Hub.\n', {})
    expect(alert.map((t) => t.type)).toEqual(['alert_open', 'paragraph_open', 'inline', 'paragraph_close', 'alert_close'])
    expect(alert[0].meta).toEqual({ kind: 'WARNING' })
    expect(alert[2].content).toBe('Keys stay off the Hub.')
    expect(md.render('> [!WARNING]\n> Keys stay off the Hub.\n')).not.toContain('[!WARNING]')
    expect(types('> [!NOPE]\n> Just a quote.\n')).toEqual(['blockquote_open', 'paragraph_open', 'inline', 'paragraph_close', 'blockquote_close'])
    for (const kind of ['NOTE', 'TIP', 'IMPORTANT', 'CAUTION']) expect(types(`> [!${kind}]\n> x\n`)[0]).toBe('alert_open')
  })
  it('parses the two leaf directives, each a line of its own', () => {
    const rec = md.parse('::record[T]{ref="tasks:t-1a2b"}\n', {})
    expect(rec.map((t) => t.type)).toEqual(['record_embed'])
    expect(rec[0].meta).toEqual({ label: 'T', ref: 'tasks:t-1a2b' })
    const view = md.parse('::view[Open]{collection="tasks" view="open"}\n', {})
    expect(view.map((t) => t.type)).toEqual(['view_embed'])
    expect(view[0].meta).toEqual({ label: 'Open', collection: 'tasks', view: 'open' })
    expect(types('::other[x]{ref="a"}\n')).toEqual(['paragraph_open', 'inline', 'paragraph_close'])
    expect(types('::record[T]{ref="tasks:t-1a2b"} and more\n')).toEqual(['paragraph_open', 'inline', 'paragraph_close'])
    expect(types('::record[T]{}\n')).toEqual(['paragraph_open', 'inline', 'paragraph_close'])
  })
  it('keeps raw HTML as html_block, for the editor\'s raw block', () => {
    expect(types('<details>\n<summary>x</summary>\n</details>\n')).toEqual(['html_block'])
  })
  it('renders raw HTML as text, kept as written, never as HTML', () => {
    const out = md.render('<script>alert(1)</script>\n\nA picture <img src=x onerror=alert(1)> here.\n')
    expect(out).not.toContain('<script')
    expect(out).not.toContain('<img')
    expect(out).toContain('<pre class="hub-raw">&lt;script&gt;alert(1)&lt;/script&gt;</pre>')
    expect(out).toContain('<code class="hub-raw">&lt;img src=x onerror=alert(1)&gt;</code>')
  })
})

describe('refsOf', () => {
  const page = [
    '# Week',
    '',
    'Ask [@Ops lead](hub:member/ops-lead) and [@Council](hub:role/council); see [x](./b-2c3d.md).',
    'The task [@Fix it](hub:record/tasks/t-9f9f) on [@Plan](hub:page/plan-0a0a), and [the web](https://example.org).',
    '',
    '::record[T]{ref="tasks:t-1a2b"}',
    '',
    '::view[Open]{collection="tasks" view="open"}',
    '',
  ].join('\n')

  it('finds page links, mentions and embeds', () => {
    expect(refsOf(page)).toEqual({
      links: ['b-2c3d'],
      mentions: [
        { kind: 'member', ref: 'ops-lead' },
        { kind: 'role', ref: 'council' },
        { kind: 'record', ref: 'tasks:t-9f9f' },
        { kind: 'page', ref: 'plan-0a0a' },
      ],
      embeds: [
        { kind: 'record', ref: 'tasks:t-1a2b' },
        { kind: 'view', ref: 'tasks:open' },
      ],
    })
  })
  it('does not take a ::record inside a fenced code block as an embed', () => {
    const r = refsOf('```\n::record[T]{ref="tasks:t-1a2b"}\n[@Ops](hub:member/ops-lead)\n```\n')
    expect(r).toEqual({ links: [], mentions: [], embeds: [] })
    expect(refsOf('Write `[@O](hub:member/ops-lead)` and ![a picture](./a-1b2c.md).\n')).toEqual({ links: [], mentions: [], embeds: [] })
    expect(refsOf('A paragraph\n::record[T]{ref="tasks:t-1a2b"}\n').embeds).toEqual([])
  })
  it('finds refs inside lists, tables and alerts, once each', () => {
    const r = refsOf('> [!NOTE]\n> [a](./b-2c3d.md)\n\n- [b](./b-2c3d.md#top)\n\n| c |\n| - |\n| [@C](hub:role/council) |\n')
    expect(r.links).toEqual(['b-2c3d'])
    expect(r.mentions).toEqual([{ kind: 'role', ref: 'council' }])
  })
})

describe('embedRefs', () => {
  it('lists both directive kinds and hub: links as hub: refs, and page links', () => {
    const md = '::record[T]{ref="tasks:t-1a2b"}\n\n::view[Open]{collection="tasks" view="open"}\n\n[@Ops](hub:member/ops-lead) [x](./b-2c3d.md) [@P](hub:page/plan-0a0a) [@T](hub:record/tasks/t-9f9f)\n'
    expect(embedRefs(md)).toEqual([
      'hub:record/tasks/t-1a2b',
      'hub:view/tasks/open',
      'hub:member/ops-lead',
      'hub:page/b-2c3d',
      'hub:page/plan-0a0a',
      'hub:record/tasks/t-9f9f',
    ])
  })
})

describe('splitPage and joinPage', () => {
  const text = [
    '---',
    '# kept by hand',
    'id: plan-0a0a',
    'title: The plan',
    'parent: null # at the root',
    'order: 1000',
    'colour: green',
    '---',
    '# The plan',
    '',
    'Body.',
    '',
  ].join('\n')

  it('splits front matter from the body and keeps unknown keys', () => {
    const { front, body, problems } = splitPage(text)
    expect(problems).toEqual([])
    expect(front).toEqual({ id: 'plan-0a0a', title: 'The plan', parent: null, order: 1000, colour: 'green' })
    expect(body).toBe('# The plan\n\nBody.\n')
  })
  it('reports a missing id', () => {
    const { front, problems } = splitPage('---\ntitle: No id\n---\nBody\n')
    expect(problems).toEqual(['Its front matter has no id.'])
    expect(front.id).toBe('')
    expect(front.title).toBe('No id')
  })
  it('reports a page with no front matter, a bad order, a visibility past members and broken YAML', () => {
    expect(splitPage('# Just a body\n')).toEqual({ front: { id: '', title: '', parent: null, order: 0 }, body: '# Just a body\n', problems: ['The page has no front matter.'] })
    expect(splitPage('---\nid: a-1b2c\ntitle: A\norder: first\nvisibility: hat:Ops\n---\n').problems)
      .toEqual(['Its order is not a number.', 'Its visibility is neither public nor members.'])
    expect(splitPage('---\nid: [\n---\n').problems[0]).toMatch(/^Its front matter is not valid YAML/)
    expect(splitPage('---\nid: a-1b2c\n')).toEqual({ front: { id: '', title: '', parent: null, order: 0 }, body: '---\nid: a-1b2c\n', problems: ['Its front matter is not closed.'] })
  })
  it('joins a new page in the spec\'s key order, leaving out what is absent', () => {
    const out = joinPage({ from: { import: 'notion', exportedAt: '2026-10-01' }, order: 2000, parent: 'plan-0a0a', title: 'Child', id: 'child-1b1b', visibility: 'members' }, 'Hi\n')
    expect(out).toBe('---\nid: child-1b1b\ntitle: Child\nparent: plan-0a0a\norder: 2000\nvisibility: members\nfrom:\n  import: notion\n  exportedAt: 2026-10-01\n---\nHi\n')
    expect(splitPage(out).front.title).toBe('Child')
  })
  it('joinPage(front, body, before) keeps the before\'s comments and key order', () => {
    const { front, body } = splitPage(text)
    expect(joinPage(front, body, text)).toBe(text)
    const moved = joinPage({ ...front, title: 'The new plan', order: 1500, visibility: 'public' }, body, text)
    expect(moved).toBe([
      '---',
      '# kept by hand',
      'id: plan-0a0a',
      'title: The new plan',
      'parent: null # at the root',
      'order: 1500',
      'visibility: public',
      'colour: green',
      '---',
      '# The plan',
      '',
      'Body.',
      '',
    ].join('\n'))
    const { colour: _colour, ...noColour } = front
    expect(joinPage(noColour, body, text)).not.toContain('colour')
  })

  describe('a front matter it cannot read is kept byte for byte, never rewritten', () => {
    const cases = {
      'not valid YAML': '---\n# by hand\nid: [unclosed\ntitle: Kept\n---\nBody\n',
      'not closed': '---\nid: a-1b2c\ntitle: Kept\n\nBody\n',
      'absent': '# Only a body\n\nBody\n',
    }
    for (const [name, before] of Object.entries(cases)) {
      it(`${name}: an edit to the body leaves the rest as written`, () => {
        const { front, body } = splitPage(before)
        expect(joinPage(front, body, before)).toBe(before)
        const edited = body.replace('Body', 'Body edited')
        expect(edited).not.toBe(body)
        expect(joinPage(front, edited, before)).toBe(before.replace('Body', 'Body edited'))
      })
      it(`${name}: a change to its front matter is refused in words`, () => {
        const { front, body } = splitPage(before)
        expect(() => joinPage({ ...front, title: 'New' }, body, before)).toThrow(/Its front matter is kept as written, so it cannot be changed here\. Nothing was written\.$/)
      })
    }
  })
})
