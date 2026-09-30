// packages/org-os-kms/src/geo/config.mjs — validate kms.yaml `geo:` for `geo register`.
// errors = fatal in every mode; applyErrors = fatal only for --apply (a plan needs no space yet).
import { isGeoId } from './ids.mjs';

export const TESTNET_API = 'https://api-testnet.geobrowser.io/graphql';
const KINDS = new Set(['personal', 'dao']);

export function readGeoConfig(config) {
  const g = config.geo || {};
  const errors = []; const applyErrors = [];
  const network = g.network ?? 'testnet';
  if (network !== 'testnet') errors.push(`geo.network: only "testnet" is supported (got "${network}"; Geo mainnet has no date)`);
  if (!isGeoId(g.space)) applyErrors.push('geo.space must be the 32-hex id of the Geo space to write to');
  if (!KINDS.has(g.space_kind)) applyErrors.push('geo.space_kind must be "personal" or "dao"');
  if (!isGeoId(g.author_space)) applyErrors.push('geo.author_space must be your personal space id (32 hex)');
  const types = g.types ?? {};
  let anyUrl = false;
  for (const [schema, t] of Object.entries(types)) {
    if (!isGeoId(t?.type_id)) errors.push(`geo.types.${schema}.type_id must be a 32-hex Geo type id`);
    if (t?.url) { anyUrl = true; if (!String(t.url).includes('{slug}')) errors.push(`geo.types.${schema}.url must contain {slug}`); }
  }
  if (anyUrl && !isGeoId(g.url_property)) applyErrors.push('geo.url_property must be the 32-hex Geo property id used for page links');
  const vocabularies = g.vocabularies ?? [];
  vocabularies.forEach((v, i) => {
    if (!v?.path || !v?.namespace) errors.push(`geo.vocabularies[${i}] needs path and namespace`);
    if (!isGeoId(v?.type_id)) errors.push(`geo.vocabularies[${i}].type_id must be a 32-hex Geo type id`);
    (v?.links ?? []).forEach((l, j) => {
      if (!l?.field || !isGeoId(l?.property_id)) errors.push(`geo.vocabularies[${i}].links[${j}] needs field and a 32-hex property_id`);
      if (l?.to_space !== undefined && !isGeoId(l.to_space)) errors.push(`geo.vocabularies[${i}].links[${j}].to_space must be 32 hex`);
    });
  });
  const relations = g.relations ?? [];
  relations.forEach((r, i) => {
    if (!r?.from_field || !r?.to_vocabulary || !isGeoId(r?.property_id)) errors.push(`geo.relations[${i}] needs from_field, to_vocabulary and a 32-hex property_id`);
    else if (!vocabularies.some((v) => v.namespace === r.to_vocabulary)) errors.push(`geo.relations[${i}].to_vocabulary "${r.to_vocabulary}" is not a declared vocabulary`);
  });
  const select = g.select ?? [];
  if (!Array.isArray(select)) errors.push('geo.select must be a list of object ids or slugs');
  return {
    ok: errors.length === 0, errors, applyErrors,
    geo: { space: g.space ?? null, spaceKind: g.space_kind ?? null, authorSpace: g.author_space ?? null, network, api: g.api ?? TESTNET_API,
      urlProperty: g.url_property ?? null, types, vocabularies, relations, select: Array.isArray(select) ? select : [] },
  };
}
