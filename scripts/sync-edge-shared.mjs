// Copies the runtime-neutral modules the Edge Functions share with the web
// admin into supabase/functions/_shared, so there is one source of truth.
// Supabase bundles each function from supabase/functions only, and Deno needs
// explicit ".ts" extensions on relative imports — this adds them.
//
//   node scripts/sync-edge-shared.mjs          write the copies
//   node scripts/sync-edge-shared.mjs --check  fail if a copy is out of date
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const shared = join(root, "supabase/functions/_shared");

const FILES = [
  ["src/lib/email/core.ts", "email/core.ts"],
  ["src/lib/email/types.ts", "email/types.ts"],
  ["src/lib/email/address.ts", "email/address.ts"],
  ["src/lib/admin/team-core.ts", "team-core.ts"],
];

const check = process.argv.includes("--check");
let stale = 0;

for (const [from, to] of FILES) {
  const source = readFileSync(join(root, from), "utf8");
  if (/from\s+["']@\//.test(source)) throw new Error(`${from} imports through "@/" — shared files must use relative imports only.`);
  const body = source.replace(/(from\s+["'])(\.{1,2}\/[^"']+?)(["'])/g, (_, a, path, b) =>
    path.endsWith(".ts") ? `${a}${path}${b}` : `${a}${path}.ts${b}`,
  );
  const out = `// GENERATED from ${from} by scripts/sync-edge-shared.mjs — edit the source, not this copy.\n${body}`;
  const target = join(shared, to);
  const current = existsSync(target) ? readFileSync(target, "utf8") : null;
  if (current === out) continue;
  stale++;
  if (check) {
    console.error(`out of date: ${relative(root, target)} (run node scripts/sync-edge-shared.mjs)`);
  } else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, out);
    console.log(`wrote ${relative(root, target)}`);
  }
}

if (check && stale) process.exit(1);
if (!stale) console.log("edge shared files are up to date");
