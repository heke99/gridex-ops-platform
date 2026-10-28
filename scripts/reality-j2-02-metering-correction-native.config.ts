import { defineConfig } from 'vitest/config'
import owner from './ediel-source-owner-native.config'

// Reality J2-02: a metering correction of an invoiced month becomes a correction/credit document (owner decision 40).
export default defineConfig({ ...owner, test: { ...owner.test,
  include: ['scripts/reality-j2-02-metering-correction-native.test.ts'], fileParallelism: false, testTimeout: 120_000 } })
