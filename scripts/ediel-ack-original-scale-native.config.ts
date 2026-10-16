import { defineConfig } from 'vitest/config'
import sourceOwner from './ediel-source-owner-native.config'

// Owned local Supabase only: ACK original read bound (20261016013000).
export default defineConfig({ ...sourceOwner, test: { ...sourceOwner.test,
  include: ['scripts/ediel-ack-original-scale-native.test.ts'],
  testTimeout: 120_000, retry: 0,
} })
