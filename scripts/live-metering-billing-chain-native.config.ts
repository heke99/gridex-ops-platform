import { defineConfig } from 'vitest/config'
import sourceOwner from './ediel-source-owner-native.config'

// Live-like local chain: owned local Supabase + local Next app + local GreenMail.
// Serial, no retries, stop at the first failing step.
export default defineConfig({ ...sourceOwner, test: { ...sourceOwner.test,
  include: ['scripts/live-metering-billing-chain-native.test.ts'],
  testTimeout: 900_000, hookTimeout: 300_000, bail: 1, retry: 0,
} })
