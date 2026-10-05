import { defineConfig } from 'vitest/config'
import canonical from '../../../../scripts/ediel-source-owner-native.config'

// Selected execution of the canonical native stack for the DB-04 query-plan
// measurement and the DB-05 hard-delete guard and tenant offboarding. Never fabricates a status file or falls back to mocks.
export default defineConfig({
  ...canonical,
  test: {
    ...canonical.test,
    include: ['scripts/ediel-transport-data-query-plan-native.test.ts', 'scripts/db-05-hard-delete-guard-native.test.ts', 'scripts/db-05-tenant-offboarding-native.test.ts', 'scripts/ediel-customer-retention-native.test.ts'],
  },
})
