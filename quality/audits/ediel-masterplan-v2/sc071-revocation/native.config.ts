import { defineConfig } from 'vitest/config'
import canonical from '../../../../scripts/ediel-source-owner-native.config'

// Selected execution of the existing canonical native stack, guards, aliases,
// setup and deadlines. Never fabricates a status file or falls back to mocks.
export default defineConfig({
  ...canonical,
  test: {
    ...canonical.test,
    include: ['scripts/ediel-sc-071-projection-revocation-native.test.ts'],
  },
})
