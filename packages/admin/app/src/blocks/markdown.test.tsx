// @vitest-environment jsdom
// packages/admin/app/src/blocks/markdown.test.tsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { renderMarkdown, safeHref } from './markdown.tsx'

const html = (md: string) => render(<div>{renderMarkdown(md)}</div>).container.innerHTML

describe('renderMarkdown', () => {
  it('draws headings, paragraphs, lists, emphasis, code and links', () => {
    const out = html('## Council\n\nMeets **Thursdays**, *online*.\n\n- one\n- two `x`\n\n[site](https://example.org)')
    expect(out).toContain('<h3>Council</h3>')
    expect(out).toContain('<p>Meets <strong>Thursdays</strong>, <em>online</em>.</p>')
    expect(out).toContain('<ul><li>one</li><li>two <code>x</code></li></ul>')
    expect(out).toContain('<a href="https://example.org" rel="noreferrer noopener" target="_blank">site</a>')
  })
  it('renders HTML and scripts as text (Review Focus 4)', () => {
    const out = html('<script>alert(1)</script> <b>bold</b>')
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &lt;b&gt;bold&lt;/b&gt;')
  })
  it('links only http(s) and mailto (Review Focus 4)', () => {
    expect(html('[x](javascript:alert(1))')).not.toContain('<a')
    expect(html('[x](javascript:alert(1))')).toContain('x')
    expect(safeHref('mailto:a@b.org')).toBe('mailto:a@b.org')
    expect(safeHref('data:text/html,hi')).toBeNull()
  })

  const refused = ['javascript:alert(1)', 'JavaScript:alert(1)', 'JAVASCRIPT:alert(1)', ' javascript:alert(1)', 'data:text/html,hi', 'DATA:text/html,hi',
    'vbscript:msgbox(1)', 'VbScript:x', '//evil.example/x', '/relative', 'ftp://example.org', 'file:///etc/passwd', 'java\tscript:alert(1)', '']
  it.each(refused)('safeHref refuses %j', url => { expect(safeHref(url)).toBeNull() })
  it.each(['http://example.org', 'https://example.org/a?b=1', 'HTTPS://EXAMPLE.ORG', 'mailto:a@b.org', 'MAILTO:a@b.org'])('safeHref allows %j', url => {
    expect(safeHref(url)).toBe(url)
  })
  it.each(refused.filter(u => u !== '' && !/\s/.test(u)))('draws a link to %j as its text, with no anchor and no href', url => {
    const { container } = render(<div>{renderMarkdown(`[label](${url})`)}</div>)
    expect(container.querySelector('a')).toBeNull()
    expect(container.innerHTML).not.toContain('href')
    expect(container.textContent!.startsWith('label')).toBe(true) // a url holding ) leaves its tail as text
  })
  it('opens external links safely', () => {
    const { container } = render(<div>{renderMarkdown('[a](https://example.org) [m](mailto:a@b.org)')}</div>)
    const [a, m] = [...container.querySelectorAll('a')]
    expect(a!.getAttribute('rel')!.split(' ').sort()).toEqual(['noopener', 'noreferrer'])
    expect(a!.getAttribute('target')).toBe('_blank')
    expect(m!.getAttribute('href')).toBe('mailto:a@b.org')
  })
  it('never emits raw markup elements from the text', () => {
    const { container } = render(<div>{renderMarkdown('<img src=x onerror=alert(1)> <iframe src="//x"></iframe> ![i](https://e.org/i.png)')}</div>)
    expect(container.querySelector('img,iframe,script')).toBeNull()
  })

  // Review fix: an unclosed span must not make the scanner quadratic.
  it.each([['[', 100_000], ['[a', 50_000], ['[a](x', 20_000]])('renders %j x %i in well under a second, as text', (unit, n) => {
    const text = unit.repeat(n)
    const t0 = performance.now()
    const { container } = render(<div>{renderMarkdown(text)}</div>)
    expect(performance.now() - t0).toBeLessThan(500)
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toBe(text)
  })
})
