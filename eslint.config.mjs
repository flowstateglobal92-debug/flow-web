import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The desktop app (Electron, own toolchain), the promo video (Remotion)
    // and the Supabase Edge Functions (Deno) are checked by their own configs.
    "desktop/**",
    "promo-video/**",
    "supabase/functions/**",
  ]),
]);

export default eslintConfig;
