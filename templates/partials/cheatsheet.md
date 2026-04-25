## Common operations

| Command | What it does |
|---|---|
| `/initialize` | Open a session: dashboard + recent context |
| `/close` | Wrap up session: write memory, commit, push |
| `npm run sync:upstream` | Pull framework updates (skills, packages, schemas) |
| `npm run sync:packages` | Re-materialize packages from framework |
| `npm run generate:schemas` | Regenerate `.well-known/*.json` from `data/*.yaml` |
| `npm run validate:schemas` | Verify schemas pass |
| `npm run validate:structure` | Verify file structure is canonical |
| `npm run selftest` | Run all reliability checks |
{{ #if isFramework }}
| `node scripts/clone-framework.mjs --target ../<name> --type <type>` | Create a new instance |
| `npm run analyze:instances` | Cross-instance drift report (framework only) |
{{ /if }}
