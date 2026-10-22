import { defineConfig } from 'vitest/config'
import owner from './ediel-source-owner-native.config'

// Native checks for reality scenario J4 (parse conformance). Same owned-local guards as the source-owner suite;
// only the include changes. Read-only against the local schema.
export default defineConfig({ ...owner, test: { ...owner.test,
  include: [process.env.GRIDEX_J4_ONLY ?? 'scripts/ediel-parse-conformance-native.test.ts'], fileParallelism: false } })
