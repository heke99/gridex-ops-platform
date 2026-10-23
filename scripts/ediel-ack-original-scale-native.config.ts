import { defineConfig } from 'vitest/config'
import sourceOwner from './ediel-source-owner-native.config'

// Owned local Supabase only: ACK original read bound (20261020120200) and its
// service_role-safe derived UCI column (20261023120000, F99).
export default defineConfig({ ...sourceOwner, test: { ...sourceOwner.test,
  include: ['scripts/ediel-ack-original-scale-native.test.ts', 'scripts/ediel-contrl-uci-ref-service-role-native.test.ts'],
  testTimeout: 120_000, retry: 0,
} })
