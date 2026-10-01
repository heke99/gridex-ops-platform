import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// These actual Page/Form/guard controls initialize the separate PostgreSQL
// company core. CI provides its pinned, isolated PGlite dependency via NODE_PATH.
export default defineConfig({
  resolve: { alias: [
    { find: /^server-only$/, replacement: resolve(__dirname, '../node_modules/next/dist/compiled/server-only/empty.js') },
    { find: '@', replacement: resolve(__dirname, '..') },
  ] },
  test: { environment: 'node', include: ['scripts/grid-owner-agreement-runtime-company-render-20261001.test.ts'],
    testTimeout: 15_000, hookTimeout: 15_000, fileParallelism: false },
})
