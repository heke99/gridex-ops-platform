import { defineConfig } from 'vitest/config'
import owner from './ediel-source-owner-native.config'

// Native defect proofs for reality scenario J1 (inbound PRODAT from the grid owner about switches and facilities).
// Same owned-local guards and setup as the source-owner suite; only the include changes.
export default defineConfig({ ...owner, test: { ...owner.test,
  include: [process.env.GRIDEX_J1_ONLY ?? 'scripts/inbound-prodat-j1-native.test.ts'], fileParallelism: false } })
