import { defineConfig } from 'vitest/config'
import ownerConfig from './ediel-source-owner-native.config'

// Native defect proofs for reality scenario I (the grid owner rejects or stays silent).
// Same owned-local guards and setup as the source-owner suite; only the include changes.
export default defineConfig({
  ...ownerConfig,
  test: {
    ...ownerConfig.test,
    include: ['scripts/ediel-grid-owner-rejects-native.test.ts'],
  },
})
