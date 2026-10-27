import { defineConfig } from 'vitest/config'
import owner from './ediel-source-owner-native.config'

// Reality J2-B6: pricing a billing underlay bound to its exact source basis (gridex_persist_pricing_run).
export default defineConfig({ ...owner, test: { ...owner.test,
  include: ['scripts/reality-j2-b6-price-bound-underlay-native.test.ts'], fileParallelism: false, testTimeout: 120_000 } })
