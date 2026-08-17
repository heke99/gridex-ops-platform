import { defineConfig, devices } from '@playwright/test'

const configuredBaseUrl = String(process.env.GRIDEX_E2E_BROWSER_BASE_URL || '').trim().replace(/\/$/, '')
const baseURL = configuredBaseUrl || 'http://127.0.0.1:3000'
const usesExternalTarget = configuredBaseUrl.length > 0
const inCi = Boolean(process.env.CI)

const localWebServerEnv = {
  ...process.env,
  // Public browser smoke must be self-contained. The auth proxy requires the
  // public Supabase variables even when no authenticated session exists.
  // Pointing at an unused localhost port is deliberate: public routes fail
  // open for an unavailable auth provider while protected routes still fail closed.
  NEXT_PUBLIC_SUPABASE_URL:
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'gridex-public-browser-e2e-anon-key',
}

export default defineConfig({
  testDir: './e2e/browser',
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  forbidOnly: inCi,
  retries: inCi ? 2 : 0,
  workers: inCi ? 1 : undefined,
  reporter: [
    ['line'],
    ['html', { outputFolder: 'e2e-artifacts/playwright-report', open: 'never' }],
    ['junit', { outputFile: 'e2e-artifacts/playwright-junit.xml' }],
  ],
  outputDir: 'e2e-artifacts/playwright-results',
  use: {
    baseURL,
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: false,
  },
  webServer: usesExternalTarget
    ? undefined
    : {
        command: 'npm run dev -- --hostname 127.0.0.1',
        url: baseURL,
        env: localWebServerEnv,
        reuseExistingServer: !inCi,
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
