// theme-color.mjs — the browser-chrome colour of a theme, read from its css.
// Layout writes one <meta name="theme-color"> per colour scheme from these, at
// build time, so the page has a value before any script runs and the theme
// files stay the only place a colour is written.

/** The page background (`--color-bg`) of a theme file's text, as a 6-digit hex. */
export function themeColor(css) {
  const m = /--color-bg:\s*(#[0-9a-fA-F]{6})\b/.exec(css);
  if (!m) throw new Error("theme-color: no 6-digit --color-bg in the theme file");
  return m[1];
}
