import { defineConfig, devices } from '@playwright/test'

const baseURL = String(process.env.GRIDEX_E2E_PROD_BASE_URL || '').trim().replace(/\/$/, '')

if (!baseURL) {
  throw new Error('GRIDEX_E2E_PROD_BASE_URL is required for production certification E2E.')
}

export default defineConfig({
  testDir: './e2e/production',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [
    ['line'],
    ['junit', { outputFile: 'e2e-artifacts/production-certification-junit.xml' }],
  ],
  outputDir: 'e2e-artifacts/production-certification-results',
  use: {
    baseURL,
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
    ignoreHTTPSErrors: false,
    // Production certification can contain customer PII and credentials.
    // Never persist browser traces, screenshots or video from these runs.
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    {
      name: 'production-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
