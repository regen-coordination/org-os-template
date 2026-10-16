// An instance's own funding records, as .well-known/funding.json. Read by co-fund (and anyone):
// pools it runs, money it gave (contributions) or promised (pledges), calls it has open.
// Only the listed fields are published; anything else in data/funding.yaml stays internal.
// Entries missing a required field, or with an out-of-range enum, are dropped rather than
// published (one bad entry would make the whole file invalid). The dropped entries are listed
// on a non-enumerable `dropped` property of the result, so JSON.stringify never publishes it.
const asText = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v);
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k] != null).map((k) => [k, asText(o[k])]));
const blank = (v) => v == null || v === '';

const POOL_RULES = ['matching', 'direct', 'retro', 'stream', 'other'];
const FLOW_TYPES = ['contribution', 'pledge'];
const CALL_TYPES = ['web3', 'public', 'philanthropic', 'civic'];

export function fundingRegistry(funding, identity) {
  if (!funding) return null;
  const org = { id: funding.org?.id ?? identity?.id, name: funding.org?.name ?? identity?.name, ...(identity?.daoURI ? { daoURI: identity.daoURI } : {}) };
  if (blank(org.id) || blank(org.name)) return null;

  const dropped = [];
  const keep = (kind, list, fields, check) =>
    (list ?? []).flatMap((e) => {
      const reason = check(e ?? {});
      if (reason) { dropped.push({ kind, id: e?.id ?? null, reason }); return []; }
      return [fields(e)];
    });
  const missing = (e, keys) => { const m = keys.filter((k) => blank(e[k])); return m.length ? `missing ${m.join(', ')}` : null; };
  const badEnum = (name, v, allowed) => `${name} "${v}" is not one of ${allowed.join('/')}`;

  const pools = keep('pool', funding.pools, (p) => pick(p, ['id', 'name', 'rule', 'started', 'ended', 'url']), (p) =>
    missing(p, ['id', 'name']) ?? (!blank(p.rule) && !POOL_RULES.includes(p.rule) ? badEnum('rule', p.rule, POOL_RULES) : null));
  const flows = keep('flow', funding.flows, (f) => ({ ...pick(f, ['id', 'type', 'pool', 'amount_usd', 'date', 'evidence']), to: pick(f.to, ['name', 'url', 'addresses']) }), (f) =>
    missing(f, ['id', 'type', 'date']) ?? (!FLOW_TYPES.includes(f.type) ? badEnum('type', f.type, FLOW_TYPES) : null) ?? (blank(f.to?.name) ? 'missing to.name' : null));
  const calls = keep('call', funding.calls, (c) => pick(c, ['id', 'title', 'url', 'closes', 'call_type', 'amount', 'region']), (c) =>
    missing(c, ['id', 'title', 'call_type']) ?? (!CALL_TYPES.includes(c.call_type) ? badEnum('call_type', c.call_type, CALL_TYPES) : null));

  const registry = { '@context': 'https://www.daostar.org/schemas', type: 'FundingRegistry', org, pools, flows, calls };
  Object.defineProperty(registry, 'dropped', { value: dropped, enumerable: false });
  return registry;
}
