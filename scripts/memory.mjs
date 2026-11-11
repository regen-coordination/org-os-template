#!/usr/bin/env node
// scripts/memory.mjs — the agent layer's memory, split by visibility (DAO-OS L6 spec §14, Q76).
//
//   npm run memory -- add --level <level> --date <YYYY-MM-DD> --title <t> (--file <md> | -) [--session <s>]
//   npm run memory -- list --date <YYYY-MM-DD>
//
//   --dir <path>   the instance (default: the current directory)
//   --hub <url>    the running Hub (default: ORG_OS_HUB_URL, else http://localhost:4680); on this machine only
//
// Org memory (`--level members`) is appended to memory/<date>.md in the repository and nothing is committed: the
// session's close commits it, as it always has. Council memory (a stricter level: hat:<hat ref>, role:<role id>) never
// touches the repository: it is posted to the running Hub's POST /api/memory, so the gate applies and the entry is a
// record of the private collection `council-memory`. With no Hub running it is refused in words, and nothing is written
// anywhere else instead. `list` prints both: the day's org memory headings, and the Council entries the Hub answers this
// actor.
//
// Node built-ins and js-yaml only: an instance receives this script without packages/admin.

import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

export const NO_HUB =
  'Council memory is written through the Hub, so it can be read only by those it is for: start it (npm start), then run this again.';
/** The spec's sentence names `npm start`; the framework's checkout starts the Hub with `npm run admin` (R-L6-T15-5). */
const HOW_TO_START = '(From the framework\'s checkout: npm run admin -- --repo <this instance>.)';
const DEFAULT_HUB = 'http://localhost:4680';
const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);

const USAGE = `Usage:
  npm run memory -- add --level <level> --date <YYYY-MM-DD> --title <title> (--file <md> | -) [--session <s>]
  npm run memory -- list --date <YYYY-MM-DD>

  --level members            org memory: appended to memory/<date>.md (nothing is committed)
  --level hat:<hat ref>      Council memory: written through the running Hub, kept in the private store
  --level role:<role id>     likewise
  --dir <path>               the instance (default: the current directory)
  --hub <url>                the running Hub (default: ORG_OS_HUB_URL, else ${DEFAULT_HUB}); this machine only`;

class UsageError extends Error {}
const usage = (msg) => {
  throw new UsageError(msg);
};

function parse(argv) {
  const [verb, ...rest] = argv;
  const opts = { verb, dir: process.cwd(), hub: null, level: null, date: null, title: null, file: null, stdin: false, session: null };
  while (rest.length > 0) {
    const arg = rest.shift();
    const value = () => {
      const v = rest.shift();
      if (v === undefined) usage(`${arg} needs a value.`);
      return v;
    };
    if (arg === '--dir') opts.dir = value();
    else if (arg === '--hub') opts.hub = value();
    else if (arg === '--level') opts.level = value();
    else if (arg === '--date') opts.date = value();
    else if (arg === '--title') opts.title = value();
    else if (arg === '--file') opts.file = value();
    else if (arg === '--session') opts.session = value();
    else if (arg === '-') opts.stdin = true;
    else if (arg === '-h' || arg === '--help') opts.verb = 'help';
    else usage(`${arg} is not an option of npm run memory.`);
  }
  return opts;
}

/** A real day, as YYYY-MM-DD. */
function isDay(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** A level token's shape: members, or a hat or role (the Hub reads a hat ref in full; here only its form is asked). */
function checkLevel(level) {
  if (level === null) usage('Say who the entry is for: --level members, or --level hat:<hat ref> / role:<role id>.');
  if (level === 'public') usage('public is not a level for memory: org memory is members (memory/<date>.md), and Council memory is a hat or a role.');
  if (level === 'members') return;
  if (!/^hat:\S+$/.test(level) && !/^role:[a-z][a-z0-9-]*$/.test(level)) usage(`${level} is not a level: members, hat:<hat ref> or role:<role id>.`);
}

/** The Hub's address: on this machine only, since the entry is what git must never hold. */
function hubOf(opts) {
  const raw = opts.hub ?? (process.env.ORG_OS_HUB_URL || DEFAULT_HUB);
  let url;
  try {
    url = new URL(raw);
  } catch {
    usage(`${raw} is not an address.`);
  }
  if (url.protocol !== 'http:' || !LOCAL.has(url.hostname)) {
    usage(`The Hub answers only on this machine: give its local address (http://localhost:<port>), not ${raw}. Nothing was sent.`);
  }
  return url.origin;
}

function readBody(opts) {
  if (opts.file !== null && opts.stdin) usage('Give the body once: --file <md> or -.');
  if (opts.file !== null) {
    try {
      return readFileSync(opts.file, 'utf8');
    } catch (e) {
      return usage(`--file ${opts.file} cannot be read (${e?.code ?? 'unreadable'}). Nothing was written.`);
    }
  }
  if (opts.stdin) return readFileSync(0, 'utf8');
  return usage('Give the body: --file <md> or - (read from stdin).');
}

/** The organisation the instance at `dir` names (federation.yaml identity.name), as the Hub names it; null when it names
 *  none (then no Hub can be told apart from another, and nothing is sent: M-2). */
function orgOf(dir) {
  try {
    const doc = yaml.load(readFileSync(path.join(dir, 'federation.yaml'), 'utf8'));
    const name = doc?.identity?.name;
    return typeof name === 'string' && name.trim() !== '' ? name.trim() : null;
  } catch {
    return null;
  }
}

class NoHub extends Error {}

/** A Hub that answered with a redirect: refused, and nothing is sent where it points (Task 15 review M-1). */
class Redirected extends Error {}
export const REDIRECTED = (hub) =>
  `The Hub at ${hub} answered with a redirect, and Council memory is never sent anywhere else: nothing was sent on. Nothing was written.`;

/** One request to the Hub; a Hub that is not there is NoHub. Sent as a command sends it: no Origin, JSON. A redirect is
 *  never followed (`redirect: 'manual'`): any 3xx is a refusal, and the body is never sent on. */
async function ask(hub, route, init = {}) {
  let res;
  try {
    res = await fetch(`${hub}${route}`, { ...init, redirect: 'manual', headers: { accept: 'application/json', ...(init.headers ?? {}) } });
  } catch {
    throw new NoHub();
  }
  if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) throw new Redirected(REDIRECTED(hub));
  const text = await res.text();
  let body = null;
  try {
    body = text === '' ? null : JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: res.status, body, text };
}

/** The Hub serves this instance, or nothing is sent to it. Fails closed (Task 15 review M-2): only a 200 naming, as a
 *  string, exactly the instance's own `identity.name` lets the entry go; an instance that names none sends nothing. */
async function sameOrg(hub, dir) {
  const want = orgOf(dir);
  if (want === null) {
    return `${path.resolve(dir)}/federation.yaml names no organisation (identity.name), so the Hub cannot be checked as this instance's: name it, then run this again. Nothing was written.`;
  }
  const status = await ask(hub, '/api/status');
  const org = status.body?.org;
  if (status.status !== 200 || typeof org !== 'string') {
    return `The Hub at ${hub} did not say which organisation it serves (it answered ${status.status}): start this instance's Hub, then run this again. Nothing was written.`;
  }
  if (org !== want) {
    return `The Hub at ${hub} serves ${org}, not ${want}: start this instance's Hub, then run this again. Nothing was written.`;
  }
  return null;
}

/** A body line Markdown reads as a level one or two heading (ATX, up to three spaces in), or as a setext underline, which
 *  makes the line above one and is also the `---` that separates sessions (L6 carries K3). */
const ENTRY_HEADING = /^ {0,3}(?:#{1,2}(?:[ \t]|$)|=+[ \t]*$|-+[ \t]*$)/;
/** The entry's text with such a line escaped (`\` before its first mark), so the command's own `## <title>` is the only
 *  entry heading it writes; `###` and below stay, as the close's format has them. Every line ending is read as Markdown
 *  reads one (`\r\n`, `\r`, `\n`). A title that starts with `#` keeps them as text. */
function entryText(title, body) {
  const lines = body.replace(/\s+$/, '').split(/\r\n|\r|\n/).map((l) => (ENTRY_HEADING.test(l) ? l.replace(/^( {0,3})/, '$1\\') : l));
  return `## ${title.replace(/^#/, '\\#')}\n\n${lines.join('\n')}\n`;
}

/** memory/<date>.md, appended as a session entry: its heading made when the file is new. Nothing is committed. */
function appendOrgMemory(dir, date, title, body) {
  const folder = path.join(dir, 'memory');
  mkdirSync(folder, { recursive: true });
  const file = path.join(folder, `${date}.md`);
  const text = entryText(title, body);
  if (existsSync(file)) {
    if (!lstatSync(file).isFile()) usage(`memory/${date}.md is not a plain file: nothing was written.`);
    const was = readFileSync(file, 'utf8');
    appendFileSync(file, `${was === '' || was.endsWith('\n\n') ? '' : was.endsWith('\n') ? '\n' : '\n\n'}${text}`);
  } else {
    writeFileSync(file, `# ${date}\n\n${text}`, { flag: 'wx' });
  }
  return `memory/${date}.md`;
}

async function add(opts, out, err) {
  checkLevel(opts.level);
  if (!isDay(opts.date)) usage(`--date takes a day as YYYY-MM-DD${opts.date ? `, not ${opts.date}` : ''}.`);
  if (opts.title === null || opts.title.trim() === '' || /[\r\n]/.test(opts.title)) usage('--title takes one line of text.');
  const hub = opts.level === 'members' ? null : hubOf(opts);
  const body = readBody(opts);
  const title = opts.title.trim();

  if (opts.level === 'members') {
    const rel = appendOrgMemory(path.resolve(opts.dir), opts.date, title, body);
    out(`Appended "${title}" to ${rel} (org memory, members: every member reads it). Nothing was committed: the session's close commits it.`);
    return 0;
  }

  try {
    const other = await sameOrg(hub, opts.dir);
    if (other) {
      err(other);
      return 1;
    }
    const sent = await ask(hub, '/api/memory', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ level: opts.level, date: opts.date, title, body, ...(opts.session ? { session: opts.session } : {}) }),
    });
    if (sent.status !== 201) {
      err(sent.body?.error ?? sent.body?.reason ?? `The Hub answered ${sent.status}. Nothing was written.`);
      return 1;
    }
    out(`Wrote Council memory entry ${sent.body?.id} through the Hub, kept at ${sent.body?.visibility ?? opts.level}. Nothing is in the repository.`);
    return 0;
  } catch (e) {
    if (e instanceof Redirected) {
      err(e.message);
      return 1;
    }
    if (!(e instanceof NoHub)) throw e;
    err(NO_HUB);
    err(HOW_TO_START);
    return 1;
  }
}

async function list(opts, out) {
  if (!isDay(opts.date)) usage(`--date takes a day as YYYY-MM-DD${opts.date ? `, not ${opts.date}` : ''}.`);
  const hub = hubOf(opts);
  const dir = path.resolve(opts.dir);
  const rel = `memory/${opts.date}.md`;
  const file = path.join(dir, rel);
  const headings = existsSync(file)
    ? readFileSync(file, 'utf8').split('\n').filter((l) => /^## /.test(l)).map((l) => l.slice(3).trim())
    : [];
  if (headings.length === 0) out(`members · ${rel} · (nothing)`);
  for (const h of headings) out(`members · ${rel} · ${h}`);
  try {
    const other = await sameOrg(hub, dir);
    if (other) {
      out(`Council memory is not listed: ${other}`);
      return 0;
    }
    const got = await ask(hub, `/api/memory?date=${opts.date}`);
    if (got.status !== 200 || !Array.isArray(got.body?.entries)) {
      out(`Council memory is not listed: ${got.body?.error ?? `the Hub answered ${got.status}`}`);
      return 0;
    }
    for (const e of got.body.entries) out(`${e.visibility} · ${e.id} · ${e.title}`);
  } catch (e) {
    if (e instanceof Redirected) {
      out(`Council memory is not listed: ${e.message}`);
      return 0;
    }
    if (!(e instanceof NoHub)) throw e;
    out(`Council memory is not listed: ${NO_HUB}`);
  }
  return 0;
}

export async function main(argv = process.argv.slice(2), { out = console.log, err = console.error } = {}) {
  try {
    const opts = parse(argv);
    if (opts.verb === 'add') return await add(opts, out, err);
    if (opts.verb === 'list') return await list(opts, out);
    if (opts.verb === 'help') {
      out(USAGE);
      return 0;
    }
    usage(opts.verb ? `${opts.verb} is not a command of npm run memory: add or list.` : 'Say what to do: add or list.');
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    err(e.message);
    err(USAGE);
    return 2;
  }
  return 2;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main();
}
