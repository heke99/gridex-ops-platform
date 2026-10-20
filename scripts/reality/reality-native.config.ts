import { defineConfig } from 'vitest/config'
import sourceOwner from '../ediel-source-owner-native.config'

// Production-simulating suite (docs/testing/verklighetssimulering-plan.md).
// Owned local Supabase, a local `next start` and local GreenMail only.
// Serial: scenarios share the cron schedule and the counterparty mailboxes.
export default defineConfig({ ...sourceOwner, test: { ...sourceOwner.test,
  include: [process.env.GRIDEX_REALITY_ONLY ?? 'scripts/reality/**/*.test.ts'],
  fileParallelism: false, testTimeout: 900_000, hookTimeout: 300_000, retry: 0,
} })
