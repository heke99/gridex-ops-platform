import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

if (process.env.CI !== 'true' || !process.env.GRIDEX_NATIVE_STATUS ||
  JSON.parse(readFileSync(process.env.GRIDEX_NATIVE_STATUS, 'utf8')).API_URL !== 'http://127.0.0.1:54321') {
  throw new Error('notification_concurrency_disposable_ci_replay_required')
}

export default defineConfig({
  resolve: { alias: [{ find: '@', replacement: resolve(__dirname, '..') }] },
  test: {
    environment: 'node', include: ['scripts/customer-notification-read-concurrency-native.test.ts'],
    testTimeout: 60_000, fileParallelism: false,
  },
})
