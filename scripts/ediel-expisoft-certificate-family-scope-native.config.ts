import { defineConfig } from 'vitest/config'
import sourceOwner from './ediel-source-owner-native.config'

// Owned local Supabase only (reality finding F96). The real Expisoft certificate
// materializer writes ediel_certificates; only the external LDAP directory is substituted.
export default defineConfig({ ...sourceOwner, test: { ...sourceOwner.test,
  include: ['scripts/ediel-expisoft-certificate-family-scope-native.test.ts'],
  testTimeout: 120_000, retry: 0,
} })
