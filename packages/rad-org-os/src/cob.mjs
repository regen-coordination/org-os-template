// COB <-> org-os record mapping. Preserves the COB oid in source_lineage so
// provenance survives round-trips (spec). Distinct from the KMS ingestion connector.
const HEX40 = /\b[0-9a-f]{40}\b/;

export function issueCobToRecord(cob) {
  return {
    kind: 'issue',
    title: cob.title || '',
    status: cob.state?.status || 'open',
    author: cob.author?.id || null,
    source_lineage: { type: 'xyz.radicle.issue', cob_oid: cob.id },
  };
}

export function patchCobToRecord(cob) {
  return {
    kind: 'change',
    title: cob.title || '',
    status: cob.state?.status || 'open',
    source_lineage: { type: 'xyz.radicle.patch', cob_oid: cob.id },
  };
}

export function parsePatchId(stdout) {
  const m = HEX40.exec(stdout || '');
  return m ? m[0] : null;
}
export const parseIssueId = parsePatchId; // same shape: "✓ <Type> <oid> opened"
