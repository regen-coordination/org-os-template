import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../../templates/render.mjs';

test('render replaces {{ var }}', () => {
  assert.equal(render('Hello {{ name }}', { name: 'World' }), 'Hello World');
});

test('render replaces nested {{ org.name }}', () => {
  assert.equal(render('{{ org.name }}', { org: { name: 'org-os' } }), 'org-os');
});

test('render handles {{ #if cond }} ... {{ /if }} truthy', () => {
  assert.equal(render('{{ #if show }}YES{{ /if }}', { show: true }), 'YES');
});

test('render handles {{ #if cond }} ... {{ /if }} falsy', () => {
  assert.equal(render('A{{ #if show }}YES{{ /if }}B', { show: false }), 'AB');
});

test('render handles missing variables as empty string', () => {
  assert.equal(render('Hello {{ missing }}', {}), 'Hello ');
});

test('render passes through plain markdown without modification', () => {
  const md = '# Header\n\n- bullet\n\n```js\ncode\n```';
  assert.equal(render(md, {}), md);
});

test('render handles multiple if blocks', () => {
  assert.equal(render('{{ #if a }}A{{ /if }}{{ #if b }}B{{ /if }}', { a: true, b: false }), 'A');
});

test('render handles loop {{ #each items }}{{ . }}{{ /each }}', () => {
  assert.equal(render('{{ #each items }}- {{ . }}\n{{ /each }}', { items: ['a','b','c'] }), '- a\n- b\n- c\n');
});
