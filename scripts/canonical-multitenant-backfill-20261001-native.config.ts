import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const mode = process.env.GRIDEX_BACKFILL_NATIVE_MODE ?? 'outer'
if (!['outer', 'inner', 'source-check'].includes(mode) ||
  (mode !== 'source-check' && (process.env.CI !== 'true' || !process.env.RUNNER_TEMP ||
    process.env.GRIDEX_BACKFILL_NATIVE_ALLOW_NEW_STACK !== '1')) || process.env.GRIDEX_REPLAY_DB_URL) {
  throw new Error('backfill_native_requires_exclusive_local_ci_stack')
}
export default defineConfig({
  resolve: { alias: [{ find: '@', replacement: resolve(__dirname, '..') }] },
  test: {
    environment: 'node', include: ['scripts/canonical-multitenant-backfill-20261001-native.test.ts'],
    testTimeout: 1_200_000, hookTimeout: 1_200_000, fileParallelism: false,
  },
})
