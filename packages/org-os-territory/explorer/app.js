// explorer/app.js — DOM wiring only: event → reduce → view → slots, then put focus back. tour.mjs, model.mjs and render.mjs are inlined
// ahead of this file, with the same house atoms. Nothing here computes a claim. There is no appearance control: light and dark follow the
// reader (P-11).
// Keys: the layer trees are APG trees (treeKey: ↑↓, → / ←, Home/End, Enter/Space, type-ahead; one tab stop per tree); the View as menu is
// an APG menu button (↓ or Enter opens on the checked view; ↑↓ Home End move; Esc closes and returns to the button; Tab closes); Esc ends
// the tour and focus goes back to "Take the tour".
(function () {
  const facts = JSON.parse(document.getElementById('facts').textContent);
  const slot = { tools: document.getElementById('tools'), band: document.getElementById('band'), app: document.getElementById('app') };
  const liveEl = document.getElementById('live'); // outside the slots, so it persists across renders and announces changes
  let state = initialState();
  let bandHtml = slot.band.innerHTML;
  const byKey = (key) => (key ? document.querySelector('[data-key="' + (window.CSS && CSS.escape ? CSS.escape(key) : key) + '"]') : null);

  // The tour card sits under its target, inside the artifact frame (the frame is its containing block).
  // One ring at a time, and none once the tour is over: #band survives re-renders, so its ring must be taken off by hand.
  function clearTour() {
    Array.prototype.slice.call(document.querySelectorAll('.is-tour-target')).forEach((el) => el.classList.remove('is-tour-target'));
  }
  function placeTour() {
    clearTour();
    const card = document.getElementById('tour');
    if (!card) return;
    const target = byKey(card.dataset.target);
    if (!target) return;
    target.classList.add('is-tour-target');
    const art = card.closest && card.closest('.art');
    if (art && target.getBoundingClientRect) {
      card.classList.add('anchored');
      const a = art.getBoundingClientRect(); const r = target.getBoundingClientRect(); const edge = 16;
      const w = card.offsetWidth; const x = r.left - a.left;
      if (x > a.width / 2 && x - w - 12 >= edge) { card.style.left = (x - w - 12) + 'px'; card.style.top = (r.top - a.top) + 'px'; } // beside a target on the right
      else { card.style.left = Math.max(edge, Math.min(x, a.width - w - edge)) + 'px'; card.style.top = (r.bottom - a.top + 8) + 'px'; } // else under it
    }
    if (target.scrollIntoView) target.scrollIntoView({ block: 'nearest' });
  }

  function dispatch(action, focusKey) {
    const before = state.tour;
    state = reduce(state, action, facts);
    const v = view(state, facts);
    const html = slots(v);
    slot.tools.innerHTML = html.tools;
    if (html.band !== bandHtml) { slot.band.innerHTML = html.band; bandHtml = html.band; } // the status band speaks once per change
    slot.app.innerHTML = html.app;
    if (liveEl && liveEl.textContent !== v.live) liveEl.textContent = v.live;
    placeTour();
    const key = state.tour !== null && state.tour !== before ? 'tour-h' : focusKey;
    // a tour that just ended took its own button (Finish / Skip) with it: hand focus back to the button that opens it
    const focus = byKey(key) || (before !== null && state.tour === null ? byKey('tour-start') : null);
    if (focus) focus.focus();
  }

  const MENU = { menu: 1, share: 1, view: 1 };
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    const a = el && el.dataset.action;
    if (state.menu && !MENU[a]) { // a click anywhere else closes the menu first
      state = reduce(state, { type: 'menu', value: 'close' }, facts);
      if (!el) { dispatch({ type: 'none' }, null); return; }
    }
    if (!el) return;
    if (a === 'select' || a === 'toggle-open') dispatch({ type: a, id: el.dataset.id }, 'unit:' + el.dataset.id);
    else if (a === 'menu') dispatch({ type: 'menu', value: el.dataset.value }, state.menu ? 'viewas' : 'view:' + state.view);
    else if (a === 'view') dispatch({ type: 'view', value: el.dataset.value }, 'viewas');
    else dispatch({ type: a, value: el.dataset.value }, el.dataset.key);
  });
  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-change]');
    if (!el) return;
    const c = el.dataset.change;
    dispatch(c === 'toggle-inside' ? { type: c } : { type: c, value: el.value }, el.dataset.key);
  });

  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (e.key === 'Escape') {
      if (state.menu) dispatch({ type: 'menu', value: 'close' }, 'viewas'); // the innermost thing open closes first
      else if (state.tour !== null) dispatch({ type: 'tour', value: 'end' }, null);
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (!state.menu && t.dataset && t.dataset.key === 'viewas' && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault(); dispatch({ type: 'menu', value: 'open' }, 'view:' + state.view); return;
    }
    const menu = state.menu && t.closest && t.closest('[role="menu"]');
    if (menu) {
      if (e.key === 'Tab') { dispatch({ type: 'menu', value: 'close' }, 'viewas'); return; } // Tab then moves on from the button
      const items = Array.prototype.slice.call(menu.querySelectorAll('[role="menuitemradio"]'));
      const i = items.indexOf(t); const n = items.length;
      const to = { ArrowDown: (i + 1) % n, ArrowUp: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
      if (to !== undefined) { e.preventDefault(); items[to].focus(); }
      return;
    }
    const item = t.closest && t.closest('[role="treeitem"]');
    if (!item || item !== t) return;
    const els = Array.prototype.slice.call(item.closest('[role="tree"]').querySelectorAll('[role="treeitem"]'));
    const items = els.map((el) => ({ id: el.dataset.id, depth: Number(el.getAttribute('aria-level')), name: el.dataset.name,
      expanded: el.hasAttribute('aria-expanded') ? el.getAttribute('aria-expanded') === 'true' : null }));
    const r = treeKey(items, els.indexOf(item), e.key);
    if (!r) return;
    e.preventDefault();
    if ('focus' in r) els[r.focus].focus();
    else if ('toggle' in r) dispatch({ type: 'toggle-open', id: r.toggle }, 'unit:' + r.toggle);
    else dispatch({ type: 'select', id: r.select }, 'unit:' + r.select);
  });

  // roving tabindex: the tree item that has focus is its tree's one tab stop
  document.addEventListener('focusin', (e) => {
    const item = e.target;
    if (!item.getAttribute || item.getAttribute('role') !== 'treeitem') return;
    item.closest('[role="tree"]').querySelectorAll('[role="treeitem"]').forEach((el) => el.setAttribute('tabindex', el === item ? '0' : '-1'));
  });
  if (window.addEventListener) window.addEventListener('resize', placeTour);
})();
