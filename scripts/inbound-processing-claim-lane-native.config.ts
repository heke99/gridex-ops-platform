import { defineConfig } from 'vitest/config'
import sourceOwner from './ediel-source-owner-native.config'

// Owned local Supabase only (reality finding F104). claim_inbound_processing_jobs claims only the run's own lane.
// The suite seeds and claims inside transactions that are always rolled back; it installs no setup rows.
export default defineConfig({ resolve: sourceOwner.resolve, test: {
  environment: 'node',
  include: ['scripts/inbound-processing-claim-lane-native.test.ts'],
  testTimeout: 120_000, retry: 0, fileParallelism: false,
} })
