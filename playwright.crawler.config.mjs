import baseConfig from './playwright.config.mjs'
import { defineConfig } from '@playwright/test'

export default defineConfig({
  ...baseConfig,
  retries: 0,
  reporter: [
    ['line'],
    ['junit', { outputFile: 'e2e-artifacts/playwright-junit.xml' }],
  ],
  outputDir: 'e2e-artifacts/playwright-results',
  use: {
    ...baseConfig.use,
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure',
  },
})
