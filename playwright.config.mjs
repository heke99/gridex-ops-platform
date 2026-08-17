import { defineConfig, devices } from '@playwright/test'

const configuredBaseUrl = String(process.env.GRIDEX_E2E_BROWSER_BASE_URL || '').trim().replace(/\/$/, '')
const baseURL = configuredBaseUrl || 'http://127.0.0.1:3000'
const usesExternalTarget = configuredBaseUrl.length > 0
const inCi = Boolean(process.env.CI)

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
