import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

if (process.env.CI !== 'true' || !process.env.GRIDEX_NATIVE_STATUS) {
  throw new Error('notification_read_disposable_ci_replay_required')
}
const status = JSON.parse(readFileSync(process.env.GRIDEX_NATIVE_STATUS, 'utf8')) as Record<string, string>
if (status.API_URL !== 'http://127.0.0.1:54321') {
  throw new Error('notification_read_disposable_local_stack_required')
}

export default defineConfig({
  resolve: { alias: [{ find: '@', replacement: resolve(__dirname, '..') }] },
  test: {
    environment: 'node', include: ['scripts/customer-notification-read-native.test.ts'],
    testTimeout: 120_000, fileParallelism: false,
  },
})
