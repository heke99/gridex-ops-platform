import { defineConfig } from 'vitest/config'
import sourceOwner from './ediel-source-owner-native.config'

// Owned local Supabase only (reality finding F95). The real SQL signing finalizers (token,
// record-retention predecessor, website, admin import) set contract_version when they sign.
export default defineConfig({ ...sourceOwner, test: { ...sourceOwner.test,
  include: ['scripts/contract-version-at-signing-native.test.ts'],
  testTimeout: 300_000, retry: 0, fileParallelism: false,
} })
