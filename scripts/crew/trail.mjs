// scripts/crew/trail.mjs
//
// The crew's trail: one Markdown file per assignment or handoff under memory/crew/
// in the main checkout. Frontmatter is the state, the body is the story.
// See docs/superpowers/specs/2026-10-10-org-os-crew-design.md §6–7.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import matter from 'gray-matter';

/** Statuses of an assignment that still holds a seat. */
export const ACTIVE = ['seating', 'working', 'reported'];

export function trailDir(mainDir) {
  return join(mainDir, 'memory', 'crew');
}

export function slugify(text, max = 40) {
  const slug = String(text)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '');
  return slug || 'work';
}

const pad = (n) => String(n).padStart(2, '0');

export function localDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isoLocal(date) {
  const off = -date.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return (
    `${localDate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

export function freeId(mainDir, base) {
  let id = base;
  for (let n = 2; existsSync(join(trailDir(mainDir), `${id}.md`)); n += 1) id = `${base}-${n}`;
  return id;
}

export function writeRecord(path, data, body) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, matter.stringify(body.endsWith('\n') ? body : `${body}\n`, data));
}

export function readRecord(path) {
  // The empty options object bypasses gray-matter's content cache, which would
  // otherwise hand two callers the same mutable object.
  const { data, content } = matter(readFileSync(path, 'utf-8'), {});
  return { data, body: content };
}

export function updateRecord(path, patch) {
  const { data, body } = readRecord(path);
  const next = { ...data, ...patch };
  writeRecord(path, next, body);
  return next;
}

export function briefOf(body) {
  const m = String(body).match(/## Brief[ \t]*\n+([\s\S]*?)(?=\n## |$)/);
  return m ? m[1].trim() : '';
}

export function readTrail(mainDir) {
  const dir = trailDir(mainDir);
  const trail = { assignments: [], handoffs: [], unreadable: [] };
  if (!existsSync(dir)) return trail;
  for (const name of readdirSync(dir).sort()) {
    const file = join(dir, name);
    if (!name.endsWith('.md') || !statSync(file).isFile()) continue;
    let record;
    try {
      record = readRecord(file);
    } catch {
      trail.unreadable.push(name);
      continue;
    }
    const { data, body } = record;
    if (typeof data.id !== 'string' || typeof data.status !== 'string') {
      trail.unreadable.push(name);
      continue;
    }
    const entry = { ...data, file, brief: briefOf(body) };
    (name.startsWith('handoff-') ? trail.handoffs : trail.assignments).push(entry);
  }
  return trail;
}
