import { defineConfig } from 'vitest/config'
import owner from './ediel-source-owner-native.config'

// Reality J2-B7: the billing export run (invoice draft) columns gridex_create_billing_export_run writes.
export default defineConfig({ ...owner, test: { ...owner.test,
  include: ['scripts/reality-j2-b7-billing-export-run-columns-native.test.ts'], fileParallelism: false, testTimeout: 120_000 } })
