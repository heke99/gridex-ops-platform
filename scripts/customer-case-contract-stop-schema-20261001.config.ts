import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: [
    { find: /^server-only$/, replacement: resolve(__dirname, '../node_modules/next/dist/compiled/server-only/empty.js') },
    { find: '@', replacement: resolve(__dirname, '..') },
  ] },
  test: { environment: 'node', include: ['scripts/customer-case-contract-stop-schema-20261001.test.ts'], testTimeout: 15_000, hookTimeout: 15_000 },
})
