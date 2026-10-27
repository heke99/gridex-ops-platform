import { defineConfig } from 'vitest/config'
import owner from './ediel-source-owner-native.config'

// Reality H-B6: invoicing an approved break fee through gridex_create_billing_export_run (D11).
export default defineConfig({ ...owner, test: { ...owner.test,
  include: ['scripts/reality-h-b6-break-fee-export-run-native.test.ts'], fileParallelism: false, testTimeout: 120_000 } })
