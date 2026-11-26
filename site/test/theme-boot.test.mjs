// site/test/theme-boot.test.mjs — runs the pre-paint script against fakes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { THEME_BOOT, THEME_KEY } from "../src/lib/theme-boot.mjs";

function boot({ saved = null, systemDark = false, storageThrows = false, mediaThrows = false } = {}) {
  const document = { documentElement: { dataset: {} } };
  const localStorage = { getItem: (k) => { if (storageThrows) throw new Error("blocked"); return k === THEME_KEY ? saved : null; } };
  const matchMedia = (q) => { if (mediaThrows) throw new Error("no matchMedia"); return { matches: systemDark && q.includes("dark") }; };
  new Function("document", "localStorage", "matchMedia", THEME_BOOT)(document, localStorage, matchMedia);
  return document.documentElement.dataset.theme;
}

test("a saved choice wins over the system setting", () => {
  assert.equal(boot({ saved: "light", systemDark: true }), "light");
  assert.equal(boot({ saved: "dark", systemDark: false }), "dark");
});

test("with nothing saved, the system setting decides", () => {
  assert.equal(boot({ systemDark: true }), "dark");
  assert.equal(boot({ systemDark: false }), "light");
});

test("a saved value that is neither theme is ignored", () => {
  assert.equal(boot({ saved: "purple", systemDark: true }), "dark");
});

test("blocked storage does not throw; the system setting still decides", () => {
  assert.equal(boot({ storageThrows: true, systemDark: true }), "dark");
  assert.equal(boot({ storageThrows: true, systemDark: false }), "light");
});

test("with neither storage nor matchMedia, the page is light", () => {
  assert.equal(boot({ storageThrows: true, mediaThrows: true }), "light");
});
