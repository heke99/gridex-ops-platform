import { defineConfig } from 'vitest/config'
import sourceOwner from './ediel-source-owner-native.config'

// Owned local Supabase only (reality finding F92). Registry materialization creates the
// technical CONTRL/APERAK reply routes; the installed ACK route selector predicate is evaluated.
export default defineConfig({ ...sourceOwner, test: { ...sourceOwner.test,
  include: ['scripts/ediel-technical-ack-route-materialization-native.test.ts'],
  testTimeout: 300_000, retry: 0,
} })
