import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

if (process.env.CI !== 'true' || !process.env.GRIDEX_NATIVE_STATUS ||
  JSON.parse(readFileSync(process.env.GRIDEX_NATIVE_STATUS, 'utf8')).API_URL !== 'http://127.0.0.1:54321') {
  throw new Error('partner_queue_continuation_disposable_replay_required')
}
export default defineConfig({
  resolve: { alias: [{ find: '@', replacement: resolve(__dirname, '..') }] },
  test: { environment: 'node', include: ['scripts/customer-queue-continuation-20260930-native.test.ts',
    'scripts/provider-order-continuation-20260930-native.test.ts'], testTimeout: 60_000, fileParallelism: false },
})
