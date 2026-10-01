import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: [
    { find: /^server-only$/, replacement: resolve(__dirname, '../node_modules/next/dist/compiled/server-only/empty.js') },
    { find: '@', replacement: resolve(__dirname, '..') },
  ] },
  test: { environment: 'node', include: ['scripts/customer-account-role-preservation-20261001.test.ts'], fileParallelism: false },
})
