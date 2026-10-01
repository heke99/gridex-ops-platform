import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve, sep } from 'node:path'
import { defineConfig } from 'vitest/config'
const require = createRequire(import.meta.url)
const statusPath = resolve(process.env.GRIDEX_NATIVE_STATUS ?? '')
if (process.env.CI !== 'true' || !process.env.RUNNER_TEMP || !statusPath.startsWith(resolve(process.env.RUNNER_TEMP) + sep)) {
  throw new Error('lifecycle_source_disposable_ci_required')
}
const status = JSON.parse(readFileSync(statusPath, 'utf8')) as Record<string, string>
if (status.API_URL !== 'http://127.0.0.1:54321' || !status.ANON_KEY || !status.SERVICE_ROLE_KEY) throw new Error('lifecycle_source_local_stack_required')
if (['RESEND_API_KEY', 'EDIEL_SMTP_PASS', 'EDIEL_SMTP_PASSWORD'].some(key => Boolean(process.env[key]?.trim()))) throw new Error('lifecycle_source_provider_credentials_forbidden')
process.env.NEXT_PUBLIC_SUPABASE_URL = status.API_URL
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = status.ANON_KEY
process.env.SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY
export default defineConfig({
  resolve: { alias: [{ find: /^server-only$/, replacement: require.resolve('next/dist/compiled/server-only/empty.js') }, { find: '@', replacement: resolve(__dirname, '..') }] },
  test: { environment: 'node', include: ['scripts/customer-lifecycle-source-binding-20261001.native.test.ts'], testTimeout: 60_000, fileParallelism: false },
})
