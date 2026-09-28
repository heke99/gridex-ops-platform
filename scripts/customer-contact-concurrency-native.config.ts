import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const path = process.env.GRIDEX_NATIVE_STATUS
if (!path || JSON.parse(readFileSync(path, 'utf8')).API_URL !== 'http://127.0.0.1:54321') {
  throw new Error('contact_concurrency_disposable_replay_required')
}

export default defineConfig({
  resolve: { alias: [{ find: '@', replacement: resolve(__dirname, '..') }] },
  test: {
    environment: 'node',
    include: ['scripts/customer-contact-concurrency-native.test.ts'],
    testTimeout: 45_000,
    fileParallelism: false,
  },
})
