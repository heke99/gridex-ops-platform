import { defineConfig } from 'vitest/config'
import owner from './ediel-source-owner-native.config'

// Reality H-B6b: invoicing a break-fee credit through gridex_create_billing_export_run (D11g1).
export default defineConfig({ ...owner, test: { ...owner.test,
  include: ['scripts/reality-h-b6b-break-fee-credit-export-run-native.test.ts'], fileParallelism: false, testTimeout: 120_000 } })
