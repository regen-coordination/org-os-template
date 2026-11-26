import federation from "../data/federation.json";

// What the site publishes about an instance: the three fields of PUBLIC_FIELDS in
// scripts/federation-aggregate.mjs. The registry holds more; none of it is here.
export interface FederationNode { name: string; type: string; repo: string | null; }
export interface Federation {
  root: FederationNode; nodes: FederationNode[];
  registered: number; operational: number; operationalDefinition: string;
  generatedAt: string;
}

export const federationData = federation as unknown as Federation;
