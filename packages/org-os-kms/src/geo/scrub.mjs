// Mask a secret (and its 0x-less form) in text, case-insensitively. Pure.
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function scrubSecret(text, secret) {
  let out = String(text ?? '');
  if (typeof secret !== 'string' || !secret) return out;
  const variants = [secret, secret.replace(/^0x/i, '')].filter(Boolean);
  for (const v of [...new Set(variants)].sort((a, b) => b.length - a.length)) out = out.replace(new RegExp(esc(v), 'gi'), '***');
  return out;
}
