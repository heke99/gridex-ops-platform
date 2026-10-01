import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { defineConfig, devices } from '@playwright/test'
const fixture = createRequire(import.meta.url)('../../scripts/support-attachment-next-denial-20261001.fixture.ts')
const { localStatus, readFixture } = fixture

const status = localStatus(), f = readFixture()
if (process.env.GRIDEX_SUPPORT_NEXT_BROWSER !== '1') throw new Error('attachment_journey_explicit_browser_phase_required')
const baseURL = 'http://127.0.0.1:3000'
export default defineConfig({
  testDir: '.', testMatch: 'support-attachment-next-denial-20261001.spec.mjs', fullyParallel: false,
  workers: 1, retries: 0, forbidOnly: true, timeout: 240_000, expect: { timeout: 10_000 }, reporter: 'line',
  outputDir: resolve(process.env.RUNNER_TEMP, 'support-attachment-next-denial-results'),
  use: { baseURL, actionTimeout: 15_000, navigationTimeout: 30_000, trace: 'off', screenshot: 'off', video: 'off', ignoreHTTPSErrors: false },
  webServer: { command: 'npm run dev -- --hostname 127.0.0.1', url: baseURL + '/login', reuseExistingServer: false, timeout: 120_000,
    stdout: 'pipe', stderr: 'pipe', env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
      GRIDEX_SUPPORT_ATTACHMENT_SCANNER_TRUST: f.trust, GRIDEX_SUPPORT_SCANNER_CALLBACK_SECRET: f.callbackSecret,
      GRIDEX_SUPPORT_SCANNER_PROCESS_SECRET: f.processSecret } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
