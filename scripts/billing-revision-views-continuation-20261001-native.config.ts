import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
if (process.env.CI !== 'true' || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321'
  || !process.env.GRIDEX_NATIVE_STATUS || JSON.parse(readFileSync(process.env.GRIDEX_NATIVE_STATUS, 'utf8')).API_URL !== 'http://127.0.0.1:54321') {
  throw new Error('billing_revision_views_disposable_replay_required')
}
export default defineConfig({ resolve: { alias: [{ find: '@', replacement: resolve(__dirname, '..') }] },
  test: { environment: 'node', include: ['scripts/billing-revision-views-continuation-20261001-native.test.ts'], testTimeout: 120_000, fileParallelism: false } })
