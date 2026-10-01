import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const quote = value => "'" + value.replaceAll("'", "'\"'\"'") + "'"
const baseURL = 'http://127.0.0.1:3004'
export default defineConfig({
  testDir: '.', testMatch: 'support-staff-api-release-20261001.spec.mjs', fullyParallel: false,
  workers: 1, retries: 0, forbidOnly: true, timeout: 300_000, reporter: 'line',
  outputDir: resolve(process.env.RUNNER_TEMP || '/tmp', 'support-staff-api-release-20261001-results'),
  use: { baseURL, trace: 'off', video: 'off', screenshot: 'off', ignoreHTTPSErrors: false },
  webServer: {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    command: `${quote(process.execPath)} node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 3004`,
    url: baseURL + '/api/v1/openapi/release-manifest.json', reuseExistingServer: false, timeout: 120_000,
    stdout: 'pipe', stderr: 'pipe', env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=2048',
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:15431', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'nonworking-public-artifact-fixture',
      SUPABASE_SERVICE_ROLE_KEY: 'nonworking-public-artifact-fixture' },
  },
  projects: [{ name: 'local-public-http' }],
})
