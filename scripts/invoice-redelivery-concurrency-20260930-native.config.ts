import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const status = process.env.GRIDEX_NATIVE_STATUS
if (!status || JSON.parse(readFileSync(status, 'utf8')).API_URL !== 'http://127.0.0.1:54321') {
  throw new Error('redelivery_concurrency_disposable_replay_required')
}
export default defineConfig({
  resolve: { alias: [{ find: '@', replacement: resolve(__dirname, '..') }] },
  test: { environment: 'node', include: ['scripts/invoice-redelivery-concurrency-20260930-native.test.ts'],
    testTimeout: 75_000, fileParallelism: false },
})
