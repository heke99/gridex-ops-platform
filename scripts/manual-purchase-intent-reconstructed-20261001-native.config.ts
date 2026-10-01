import { readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const statusPath = process.env.GRIDEX_NATIVE_STATUS
if (process.env.CI !== 'true' || !statusPath || !process.env.RUNNER_TEMP) {
  throw new Error('manual_purchase_native_disposable_ci_required')
}
realpathSync(process.env.RUNNER_TEMP)
let status: Record<string, string>
try { status=JSON.parse(readFileSync(statusPath, 'utf8')) as Record<string, string> }
catch { throw new Error('manual_purchase_native_status_unavailable') }
if (status.API_URL !== 'http://127.0.0.1:54321' || !status.ANON_KEY || !status.SERVICE_ROLE_KEY) {
  throw new Error('manual_purchase_native_local_stack_required')
}
process.env.NEXT_PUBLIC_SUPABASE_URL = status.API_URL
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = status.ANON_KEY
process.env.SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY
// A synthetic in-process fixture key, never a real provider credential.
process.env.GRIDEX_MANUAL_PURCHASE_NATIVE_SYNTHETIC_KEY = 'synthetic-local-only-never-provider'

export default defineConfig({
  resolve: { alias: [
    { find: /^server-only$/, replacement: resolve(__dirname, '../node_modules/next/dist/compiled/server-only/empty.js') },
    { find: '@', replacement: resolve(__dirname, '..') },
  ], conditions: ['react-server', 'node'] },
  test: { environment: 'node', include: ['scripts/manual-purchase-intent-reconstructed-20261001-native.test.ts'],
    testTimeout: 120_000, fileParallelism: false },
})
