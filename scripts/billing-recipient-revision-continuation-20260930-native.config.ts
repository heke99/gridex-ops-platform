import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const status = process.env.GRIDEX_NATIVE_STATUS
if (!status || JSON.parse(readFileSync(status, 'utf8')).API_URL !== 'http://127.0.0.1:54321'
  || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321' || process.env.CI !== 'true') {
  throw new Error('billing_recipient_disposable_replay_required')
}
export default defineConfig({
  resolve: { alias: [{ find: '@', replacement: resolve(__dirname, '..') }] },
  test: { environment: 'node', include: ['scripts/billing-recipient-revision-continuation-20260930-native.test.ts'],
    testTimeout: 120_000, fileParallelism: false },
})
