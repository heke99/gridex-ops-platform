import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const path = process.env.GRIDEX_NATIVE_STATUS
if (!path) throw new Error('ediel_case_native_status_required')
const status = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>
if (status.API_URL !== 'http://127.0.0.1:54321' || !status.SERVICE_ROLE_KEY || !status.ANON_KEY || !process.env.GRIDEX_EDIEL_CASE_TEST_PASSWORD || !process.env.GRIDEX_EDIEL_CASE_FIXTURE_PATH) {
  throw new Error('ediel_case_disposable_local_stack_required')
}
process.env.NEXT_PUBLIC_SUPABASE_URL = status.API_URL
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = status.ANON_KEY
process.env.SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY

export default defineConfig({
  resolve: { alias: [{ find: '@', replacement: resolve(__dirname, '..') }] },
  test: { environment: 'node', include: ['scripts/ediel-case-view-native.test.ts'], testTimeout: 60_000, hookTimeout: 60_000, fileParallelism: false },
})
