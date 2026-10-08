// Deploys the desktop app's Edge Functions (mail, team) to the live Supabase
// project and gives them their secrets — all read from .env.local, none of
// them printed. Run it again whenever a function changes.
//
//   supabase login                                      once per computer
//   node scripts/deploy-edge-functions.mjs --check      is everything ready? (changes nothing)
//   node scripts/deploy-edge-functions.mjs              deploy, from the project folder
//
// --use-api bundles on Supabase's side (no Docker needed). --no-verify-jwt
// leaves the sign-in check to the functions themselves (supabase/functions/
// _shared/http.ts asks Supabase Auth about every caller's token), which works
// with both the legacy JWT secret and the newer signing keys.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

let text;
try {
  text = readFileSync(join(root, ".env.local"), "utf8");
} catch {
  fail("There's no .env.local in the project folder.");
}
const env = Object.fromEntries(
  text
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
    .filter(Boolean)
    .map(([, key, value]) => [key, value.replace(/^(["'])(.*)\1$/, "$2")]),
);

const ref = (env.NEXT_PUBLIC_SUPABASE_URL ?? "").match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
if (!ref) fail("NEXT_PUBLIC_SUPABASE_URL in .env.local isn't a Supabase project address.");
if (!env.RESEND_API_KEY) fail("RESEND_API_KEY isn't set in .env.local.");

if (process.argv.includes("--check")) {
  const list = spawnSync("supabase", ["projects", "list", "-o", "json"], { cwd: root, encoding: "utf8" });
  if (list.error) fail("The Supabase CLI isn't installed (brew install supabase/tap/supabase).");
  let projects = [];
  try {
    projects = JSON.parse(list.stdout);
  } catch {
    fail("Not signed in to Supabase. Run: supabase login");
  }
  if (!projects.some((p) => p.id === ref || p.ref === ref)) fail("Signed in, but not to the account that owns this project.");
  console.log("✓ .env.local has the project address and the Resend key");
  console.log("✓ Supabase CLI signed in to the account that owns the project");
  console.log("Ready: run it again without --check to deploy mail and team and set their secrets.");
  process.exit(0);
}

function supabase(args, step) {
  const result = spawnSync("supabase", args, { cwd: root, stdio: "inherit" });
  if (result.error) fail("The Supabase CLI isn't installed (brew install supabase/tap/supabase).");
  if (result.status !== 0) fail(`${step} didn't work — see the message above. Signed in? Run: supabase login`);
}

console.log("1/3  Copying the shared mailbox and team code into the functions…");
const sync = spawnSync(process.execPath, [join(root, "scripts/sync-edge-shared.mjs")], { cwd: root, stdio: "inherit" });
if (sync.status !== 0) fail("Copying the shared code didn't work.");

console.log("\n2/3  Deploying the functions…");
for (const name of ["mail", "team"]) {
  supabase(["functions", "deploy", name, "--use-api", "--no-verify-jwt", "--project-ref", ref], `Deploying ${name}`);
}

console.log("\n3/3  Setting their secrets (values aren't shown)…");
const quote = (value) => `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const dir = mkdtempSync(join(tmpdir(), "flowstate-secrets-"));
const file = join(dir, "secrets.env");
try {
  writeFileSync(
    file,
    [
      `RESEND_API_KEY=${quote(env.RESEND_API_KEY)}`,
      `EMAIL_FROM_ADDRESS=${quote(env.EMAIL_FROM_ADDRESS || "support@flowstate.lk")}`,
      `EMAIL_FROM_NAME=${quote(env.EMAIL_FROM_NAME || "Flow State")}`,
      `EMAIL_INBOX_ADDRESSES=${quote(env.EMAIL_INBOX_ADDRESSES || "support@flowstate.lk")}`,
    ].join("\n") + "\n",
    { mode: 0o600 },
  );
  supabase(["secrets", "set", "--env-file", file, "--project-ref", ref], "Setting the secrets");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("\n✓ mail and team are live. The desktop app's Email, Team & Users and emailed PDFs now work.");
