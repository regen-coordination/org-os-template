# EIP-4824 Guide

**How to use EIP-4824 standards in your Organizational OS workspace**

## What is EIP-4824?

EIP-4824 (Common Interfaces for DAOs) is a standard that defines a common interface for organizations to publish metadata about their identity, membership, governance, and activities.

## Core Concepts

### daoURI

The main organizational identity document. Points to a JSON-LD file containing organizational metadata.

**Location**: `.well-known/dao.json`

**Example**:
```json
{
  "@context": "http://www.daostar.org/schemas",
  "type": "Organization",
  "name": "Your Organization",
  "membersURI": "https://your-org.com/.well-known/members.json",
  "proposalsURI": "https://your-org.com/.well-known/proposals.json",
  "governanceURI": "https://your-org.com/governance"
}
```

### Required Fields

Every organization MUST implement:

- `membersURI`: Membership registry
- `proposalsURI`: Governance proposals
- `activityLogURI`: Activity log
- `governanceURI`: Governance documentation
- `contractsURI`: Smart contract registry

### Extended Fields

Organizational OS adds operational fields:

- `meetingsURI`: Meeting registry (if meetings package enabled)
- `projectsURI`: Project registry (if projects package enabled)
- `financesURI`: Financial registry (if finances package enabled)

## Schema Generation

Schemas are automatically generated from your operational data:

1. **Source Data**: Stored in `data/` directory (YAML files) and `content/` directory (markdown files)
2. **Generation**: Run `npm run generate:schemas`
3. **Output**: JSON-LD schemas in `.well-known/` directory
4. **Automation**: GitHub Actions runs generation on data changes

## Validation

Validate your schemas:

```bash
npm run validate:schemas
```

Checks:
- Required fields present
- JSON-LD context correct
- URIs accessible
- Schema structure valid

## Publishing

### Off-Chain (Default)

1. Generate schemas: `npm run generate:schemas`
2. Commit and push to GitHub
3. Schemas published at `.well-known/` URIs
4. Accessible via HTTPS

### On-Chain (Optional)

1. Deploy EIP-4824 registration contract
2. Call `updateDaoURI()` with your daoURI
3. Register with DAOstar indexer

See [`../packages/web3/on-chain-registration/`](../packages/web3/on-chain-registration/) for details.

## Interoperability

Your schemas enable:

- **DAOstar Indexing**: Discoverable in DAOstar directory
- **Tool Integration**: Works with Snapshot, Tally, etc.
- **Cross-Org**: Interoperable with other EIP-4824 organizations

## Best Practices

1. **Keep Schemas Updated**: Run generation regularly
2. **Validate Before Publishing**: Use validation tools
3. **Use HTTPS**: All URIs must be accessible
4. **Version Control**: Track schema changes in Git
5. **Document Extensions**: Note any custom fields

## Related Documentation

- Framework: [`../../organizational-os-framework/docs/02-standards/eip-4824-integration.md`](../../organizational-os-framework/docs/02-standards/eip-4824-integration.md)
- Schemas: [`../../organizational-os-framework/schemas/`](../../organizational-os-framework/schemas/)
- Standard: https://eips.ethereum.org/EIPS/eip-4824
