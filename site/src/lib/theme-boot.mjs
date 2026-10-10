// theme-boot.mjs — the script that picks the theme before first paint.
// Kept as a string so Layout can inline it in <head> (a module script would
// run after paint and flash) and so the test can run the same text.
// It must not throw: storage can be blocked, and matchMedia can be missing.
export const THEME_KEY = "org-os-theme";

export const THEME_BOOT = `(function () {
  var theme = "light";
  try {
    var saved = null;
    try { saved = localStorage.getItem(${JSON.stringify(THEME_KEY)}); } catch (e) {}
    if (saved === "dark" || saved === "light") theme = saved;
    else if (matchMedia("(prefers-color-scheme: dark)").matches) theme = "dark";
  } catch (e) {}
  document.documentElement.dataset.theme = theme;
})();`;
