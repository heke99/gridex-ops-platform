import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const statusPath = process.env.GRIDEX_NATIVE_STATUS
if (!statusPath || process.env.CI !== 'true' || !process.env.GRIDEX_REDELIVERY_NAVIGATION_FIXTURE_PATH
  || !process.env.GRIDEX_REDELIVERY_NAVIGATION_PASSWORD) throw new Error('redelivery_navigation_disposable_ci_required')
const status = JSON.parse(readFileSync(statusPath, 'utf8')) as Record<string, string>
if (status.API_URL !== 'http://127.0.0.1:54321' || !status.ANON_KEY || !status.SERVICE_ROLE_KEY) {
  throw new Error('redelivery_navigation_disposable_local_stack_required')
}
process.env.NEXT_PUBLIC_SUPABASE_URL = status.API_URL
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = status.ANON_KEY
process.env.SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY

export default defineConfig({
  resolve: { alias: [{ find: '@', replacement: resolve(__dirname, '..') }] },
  test: { environment: 'node', include: ['scripts/invoice-redelivery-unsaved-navigation-20261001-native.test.ts'],
    testTimeout: 120_000, fileParallelism: false },
})
