// site/test/shortcuts.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { pageShortcut } from "../src/lib/shortcuts.mjs";

const key = (over = {}) => ({ key: "ArrowRight", shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, repeat: false, defaultPrevented: false, ...over });
const ctx = (over = {}) => ({ activeTag: "BODY", barVisible: true, dialogOpen: false, ...over });

test("an arrow key with nothing focused moves between pages", () => {
  assert.equal(pageShortcut(key(), ctx()), "ArrowRight");
  assert.equal(pageShortcut(key({ key: "ArrowLeft" }), ctx()), "ArrowLeft");
});

test("the document element and no active element count as nothing focused", () => {
  assert.equal(pageShortcut(key(), ctx({ activeTag: "HTML" })), "ArrowRight");
  assert.equal(pageShortcut(key(), ctx({ activeTag: null })), "ArrowRight");
});

test("a focused code block keeps its arrow keys (it scrolls)", () => {
  assert.equal(pageShortcut(key(), ctx({ activeTag: "PRE" })), null);
});

test("a focused link, button, field or table keeps its arrow keys", () => {
  for (const activeTag of ["A", "BUTTON", "INPUT", "TEXTAREA", "SELECT", "TABLE", "DIV", "SUMMARY"]) {
    assert.equal(pageShortcut(key(), ctx({ activeTag })), null, activeTag);
  }
});

test("a held key does not repeat the shortcut", () => {
  assert.equal(pageShortcut(key({ repeat: true }), ctx()), null);
});

test("Shift extends a selection, it does not navigate", () => {
  assert.equal(pageShortcut(key({ shiftKey: true }), ctx()), null);
});

test("Meta, Control and Alt belong to the browser", () => {
  for (const mod of ["metaKey", "ctrlKey", "altKey"]) {
    assert.equal(pageShortcut(key({ [mod]: true }), ctx()), null, mod);
  }
});

test("no shortcut when the bar is not displayed", () => {
  assert.equal(pageShortcut(key(), ctx({ barVisible: false })), null);
});

test("no shortcut while a dialog is open, or when something already handled the key", () => {
  assert.equal(pageShortcut(key(), ctx({ dialogOpen: true })), null);
  assert.equal(pageShortcut(key({ defaultPrevented: true }), ctx()), null);
});

test("other keys, including the letter T and the slash, do nothing here", () => {
  for (const k of ["t", "T", "/", "Enter", "ArrowUp", "ArrowDown"]) {
    assert.equal(pageShortcut(key({ key: k }), ctx()), null, k);
  }
});
