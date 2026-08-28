// Panel HTML is built from node fields that can originate in REMOTE peer manifests
// (frontier fetch), so it is untrusted. These tests lock the escaping + scheme
// allow-list that closes the stored-XSS hole (review 2026-07-19).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nodePanelHTML, safeUrl } from '../src/element.mjs';

test('safeUrl allow-lists http(s)/obsidian + relative, drops javascript:/data:', () => {
  assert.equal(safeUrl('https://ok.dev'), 'https://ok.dev');
  assert.equal(safeUrl('http://ok.dev'), 'http://ok.dev');
  assert.equal(safeUrl('obsidian://open?file=x'), 'obsidian://open?file=x');
  assert.equal(safeUrl('/relative'), '/relative');
  assert.equal(safeUrl('#node=x'), '#node=x');
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('  javascript:alert(1)'), null, 'leading whitespace does not smuggle a scheme');
  assert.equal(safeUrl('data:text/html,<script>x</script>'), null);
  assert.equal(safeUrl(undefined), null);
});

test('nodePanelHTML neutralizes a markup-injecting node name', () => {
  const html = nodePanelHTML({ id: 'x', kind: 'frontier', ring: 2, name: '<img src=x onerror=alert(1)>' });
  assert.ok(!html.includes('<img src=x'), 'raw tag must be escaped');
  assert.ok(html.includes('&lt;img'));
});

test('nodePanelHTML drops a javascript: url but keeps a valid https repo', () => {
  const html = nodePanelHTML({ id: 'x', kind: 'instance', ring: 1, name: 'N',
    url: 'javascript:alert(1)', repo: 'https://github.com/o/r' });
  assert.ok(!html.includes('javascript:'), 'javascript: link dropped');
  assert.ok(html.includes('https://github.com/o/r'));
});

test('nodePanelHTML: a quote-breakout url cannot escape the href attribute', () => {
  const html = nodePanelHTML({ id: 'x', kind: 'instance', ring: 1, name: 'N',
    url: 'https://x"/><script>alert(1)</script>' });
  assert.ok(!html.includes('<script>'), 'attribute breakout neutralized by esc');
});

test('nodePanelHTML escapes dl values (type from a peer manifest)', () => {
  const html = nodePanelHTML({ id: 'x', kind: 'instance', ring: 1, name: 'N', type: '<b>DAO</b>' });
  assert.ok(!html.includes('<b>DAO</b>'));
  assert.ok(html.includes('&lt;b&gt;DAO'));
});
