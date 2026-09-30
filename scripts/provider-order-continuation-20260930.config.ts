import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Controlled persistence-boundary proof; not an external provider or native DB run.
export default defineConfig({
  resolve: { alias: [{ find: '@', replacement: resolve(__dirname, '..') }] },
  test: { environment: 'node', include: ['scripts/provider-order-continuation-20260930.test.ts'], fileParallelism: false },
})
