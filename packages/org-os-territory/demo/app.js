// demo/app.js — DOM wiring only. Reads the embedded facts and re-renders panels with the SAME pure functions the build used (render.mjs is
// inlined ahead of this file). Nothing here computes a claim; it only switches between recorded results.
(function () {
  const facts = JSON.parse(document.getElementById('facts').textContent);
  const ACTIONS = {};
  const setPanel = (name, html) => { const el = document.querySelector('[data-panel="' + name + '"]'); if (el) el.innerHTML = html; };

  ACTIONS['toggle-theme'] = (el) => {
    const root = document.documentElement;
    const dark = root.dataset.theme === 'dark' || (root.dataset.theme === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    root.dataset.theme = dark ? 'light' : 'dark';
    el.setAttribute('aria-pressed', String(!dark));
  };

  // <<ACTIONS>>

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (el && ACTIONS[el.dataset.action]) ACTIONS[el.dataset.action](el, facts);
  });
  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-change]');
    if (el && ACTIONS[el.dataset.change]) ACTIONS[el.dataset.change](el, facts);
  });
})();
