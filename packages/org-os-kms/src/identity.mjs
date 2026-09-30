// src/identity.mjs — mint object ids at first publish, only for objects that passed every gate. git holds the ids.
import { randomUUID } from 'node:crypto';
import * as fw from './framework.mjs';

const RKEY = /^[a-zA-Z0-9.\-_:~]{1,512}$/;
export function assertRkey(id) {
  if (typeof id !== 'string' || !RKEY.test(id)) throw new Error(`invalid rkey: ${JSON.stringify(id)}`);
  return id;
}

export function ensureIds({ adapter, target, items, uuid = randomUUID, write = true }) {
  const a = fw.getAdapter(adapter);
  const minted = [];
  const out = [];
  for (const it of items) {
    const patch = {};
    if (!it.object.id) patch.id = uuid();   // Geo ids are derived from this id at `geo register`; never minted here
    if (Object.keys(patch).length) {
      minted.push({ ref: it.ref, id: patch.id });
      if (write) a.update(target, it.ref, patch);
    }
    out.push({ ...it, object: { ...it.object, ...patch } });
  }
  const items2 = write ? (() => { const refs = new Set(items.map((i) => i.ref)); return a.list(target).filter((i) => refs.has(i.ref)); })() : out;
  for (const { object } of items2) assertRkey(object.id);   // assertRkey on id only
  return { minted, items: items2 };
}
