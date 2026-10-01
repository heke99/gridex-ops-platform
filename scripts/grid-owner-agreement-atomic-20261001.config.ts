import { createRequire } from 'node:module'
import path from 'node:path'
import { defineConfig } from 'vitest/config'

const require = createRequire(import.meta.url)

export default defineConfig({
  resolve: { alias: [
    { find: /^server-only$/, replacement: require.resolve('next/dist/compiled/server-only/empty.js') },
    { find: '@', replacement: path.resolve(__dirname, '..') },
  ] },
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    setupFiles: ['__tests__/setup.ts'],
  },
})
