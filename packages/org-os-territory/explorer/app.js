// explorer/app.js — DOM wiring only: event → reduce → view → renderApp, then put focus back. tour.mjs, model.mjs and render.mjs are inlined
// ahead of this file. Nothing here computes a claim.
(function () {
  const facts = JSON.parse(document.getElementById('facts').textContent);
  const root = document.getElementById('app');
  let state = initialState();

  function dispatch(action, focusKey) {
    const before = state.tour;
    state = reduce(state, action, facts);
    const v = view(state, facts);
    root.innerHTML = renderApp(v);
    const liveEl = document.getElementById('live'); // outside #app, so it persists across renders and announces changes
    if (liveEl) liveEl.textContent = v.live;
    const key = state.tour !== null && state.tour !== before ? 'tour-h' : focusKey;
    const el = key && root.querySelector('[data-key="' + (window.CSS && CSS.escape ? CSS.escape(key) : key) + '"]');
    if (el) el.focus();
    const tour = document.getElementById('tour');
    root.querySelectorAll('.is-tour-target').forEach((x) => x.classList.remove('is-tour-target'));
    if (tour) { const t = root.querySelector('[data-key="' + tour.dataset.target + '"]'); if (t) t.classList.add('is-tour-target'); }
  }

  const isDark = () => { const r = document.documentElement; return r.dataset.theme === 'dark' || (r.dataset.theme === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); };
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    if (a === 'theme') { const dark = isDark(); document.documentElement.dataset.theme = dark ? 'light' : 'dark'; el.setAttribute('aria-pressed', String(!dark)); return; }
    if (a === 'select') dispatch({ type: 'select', id: el.dataset.id }, 'unit:' + el.dataset.id);
    else dispatch({ type: a, value: el.dataset.value }, el.dataset.key);
  });
  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-change]');
    if (!el) return;
    const c = el.dataset.change;
    dispatch(c === 'toggle-inside' ? { type: c } : { type: c, value: el.value }, el.dataset.key);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.tour !== null) { dispatch({ type: 'tour', value: 'end' }, null); const b = document.querySelector('[data-key="tour-start"]'); if (b) b.focus(); return; }
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const row = e.target.closest && e.target.closest('.layer');
    if (!row || !e.target.classList.contains('unit')) return;
    const units = Array.from(row.querySelectorAll('.unit'));
    const next = units[units.indexOf(e.target) + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1)];
    if (next) { e.preventDefault(); next.focus(); }
  });
})();
