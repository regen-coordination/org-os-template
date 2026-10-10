// scripts/crew/trail.mjs
//
// The crew's trail: one Markdown file per assignment or handoff under memory/crew/
// in the main checkout. Frontmatter is the state, the body is the story.
// See docs/superpowers/specs/2026-10-10-org-os-crew-design.md §6–7.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import matter from 'gray-matter';

const ASSIGNMENT_FIELDS = ['id', 'status', 'role', 'agent', 'branch'];
const HANDOFF_FIELDS = ['id', 'status', 'from', 'to_role'];

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

/**
 * The first unused id among base, base-2, base-3 … The id is reserved by creating
 * its file exclusively, so two commands running at once never share one.
 */
export function freeId(mainDir, base) {
  const dir = trailDir(mainDir);
  mkdirSync(dir, { recursive: true });
  for (let n = 1; ; n += 1) {
    const id = n === 1 ? base : `${base}-${n}`;
    try {
      writeFileSync(join(dir, `${id}.md`), '', { flag: 'wx' });
      return id;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
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
    if (!name.endsWith('.md')) continue;
    const isHandoff = name.startsWith('handoff-');
    let record;
    try {
      if (!statSync(file).isFile()) continue; // throws on a link to nowhere
      record = readRecord(file);
    } catch {
      trail.unreadable.push(name);
      continue;
    }
    const { data, body } = record;
    // Everything the board and the guardrails read must be there, so a hand
    // edit that drops a field is reported instead of crashing a later step.
    const required = isHandoff ? HANDOFF_FIELDS : ASSIGNMENT_FIELDS;
    if (!required.every((field) => typeof data[field] === 'string')) {
      trail.unreadable.push(name);
      continue;
    }
    const entry = { ...data, file, brief: briefOf(body) };
    (isHandoff ? trail.handoffs : trail.assignments).push(entry);
  }
  return trail;
}
