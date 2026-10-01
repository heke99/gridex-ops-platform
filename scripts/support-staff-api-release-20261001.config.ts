import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
export default defineConfig({
  resolve: { alias: [{ find: '@', replacement: resolve(__dirname, '..') }] },
  test: { environment: 'node', include: ['scripts/support-staff-api-release-20261001.test.ts'], fileParallelism: false },
})
