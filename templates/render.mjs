// Minimal Mustache-style template renderer.
// Supports: {{ var }} (with dot path), {{ #if cond }} ... {{ /if }}, {{ #each list }} {{ . }} {{ /each }}
// No partials, no helpers, no escaping (markdown context).

function lookup(path, ctx) {
  if (path === '.') return ctx['.'] !== undefined ? ctx['.'] : ctx;
  const keys = path.trim().split('.');
  let cur = ctx;
  for (const k of keys) {
    if (cur == null) return '';
    cur = cur[k];
  }
  return cur == null ? '' : cur;
}

function renderEachBlocks(tmpl, ctx) {
  const re = /\{\{\s*#each\s+([^\s}]+)\s*\}\}([\s\S]*?)\{\{\s*\/each\s*\}\}/g;
  return tmpl.replace(re, (_, listPath, body) => {
    const list = lookup(listPath, ctx);
    if (!Array.isArray(list)) return '';
    return list.map(item => render(body, { ...ctx, '.': item })).join('');
  });
}

function renderIfBlocks(tmpl, ctx) {
  const re = /\{\{\s*#if\s+([^\s}]+)\s*\}\}([\s\S]*?)\{\{\s*\/if\s*\}\}/g;
  return tmpl.replace(re, (_, cond, body) => {
    const v = lookup(cond, ctx);
    return v ? render(body, ctx) : '';
  });
}

function renderVars(tmpl, ctx) {
  return tmpl.replace(/\{\{\s*([^\s#/}][^}]*?)\s*\}\}/g, (_, expr) => {
    return String(lookup(expr, ctx));
  });
}

export function render(tmpl, ctx) {
  let out = renderEachBlocks(tmpl, ctx);
  out = renderIfBlocks(out, ctx);
  out = renderVars(out, ctx);
  return out;
}
