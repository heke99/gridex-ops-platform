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
    // Historical patch snapshots are delivery artifacts, not active source.
    ".patch-backups/**",
    // Installed agent skills are vendored tooling, not application source.
    ".agents/**",
    // CommonJS regression scripts are executable Node utilities with their own checks.
    "scripts/**/*.cjs",
  ]),
]);

export default eslintConfig;
