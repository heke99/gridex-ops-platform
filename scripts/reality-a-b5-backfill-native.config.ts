import { defineConfig } from 'vitest/config'
import owner from './ediel-source-owner-native.config'

// Reality A-B5, owner decision 42: the bounded one-time backfill of metering_points.grid_owner_ediel_id.
export default defineConfig({ ...owner, test: { ...owner.test,
  include: ['scripts/reality-a-b5-backfill-native.test.ts'], fileParallelism: false, testTimeout: 120_000 } })
