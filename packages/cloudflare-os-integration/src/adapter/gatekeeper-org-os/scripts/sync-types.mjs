// Regenerates src/types-code.ts from src/types.d.ts.
//
// getTypeScriptTypes() must return the type text at runtime, and a Worker cannot read its own
// source. Keeping the generated string in a committed .ts file (rather than a types.txt symlink)
// keeps the two in one place and makes drift visible in review.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const types = readFileSync(join(src, "types.d.ts"), "utf-8");
const escaped = types.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

writeFileSync(
  join(src, "types-code.ts"),
  `// GENERATED from types.d.ts by \`pnpm run sync:types\` — do not edit by hand.\nconst TYPES_CODE = \`${escaped}\`;\n\nexport default TYPES_CODE;\n`,
);

console.log("sync-types: src/types.d.ts -> src/types-code.ts");
