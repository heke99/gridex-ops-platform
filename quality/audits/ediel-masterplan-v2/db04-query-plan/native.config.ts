import { defineConfig } from 'vitest/config'
import canonical from '../../../../scripts/ediel-source-owner-native.config'

// Selected execution of the canonical native stack for the DB-04 query-plan
// measurement only. Never fabricates a status file or falls back to mocks.
export default defineConfig({
  ...canonical,
  test: {
    ...canonical.test,
    include: ['scripts/ediel-transport-data-query-plan-native.test.ts'],
  },
})
