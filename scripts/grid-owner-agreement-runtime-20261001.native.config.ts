import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve, sep } from 'node:path'
import { defineConfig } from 'vitest/config'
const require = createRequire(import.meta.url)
const statusPath = resolve(process.env.GRIDEX_NATIVE_STATUS ?? '')
const fixturePath = resolve(process.env.GRIDEX_AGREEMENT_RUNTIME_FIXTURE_PATH ?? '')
const temp = process.env.RUNNER_TEMP
const secretBytes = Buffer.byteLength(process.env.GRIDEX_AGREEMENT_CLEANUP_SECRET ?? '')
if (process.env.CI !== 'true' || !temp || [statusPath, fixturePath].some(path => !path.startsWith(resolve(temp) + sep)) ||
    !process.env.GRIDEX_AGREEMENT_RUNTIME_PASSWORD || secretBytes < 32 || secretBytes > 256 || process.env.GRIDEX_E2E_BROWSER_BASE_URL) {
  throw new Error('agreement_runtime_private_disposable_ci_required')
}
const status = JSON.parse(readFileSync(statusPath, 'utf8')) as Record<string, string>
if (status.API_URL !== 'http://127.0.0.1:54321' || !status.ANON_KEY || !status.SERVICE_ROLE_KEY) throw new Error('agreement_runtime_local_stack_required')
if (process.env.GRID_OWNER_AGREEMENTS_BUCKET && process.env.GRID_OWNER_AGREEMENTS_BUCKET !== 'grid-owner-agreements') throw new Error('agreement_runtime_default_bucket_required')
if (['RESEND_API_KEY', 'SENDGRID_API_KEY', 'EDIEL_SMTP_PASS', 'EDIEL_SMTP_PASSWORD'].some(key => Boolean(process.env[key]?.trim()))) throw new Error('agreement_runtime_provider_credentials_forbidden')
process.env.NEXT_PUBLIC_SUPABASE_URL = status.API_URL
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = status.ANON_KEY
process.env.SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY
export default defineConfig({
  resolve: { alias: [{ find: /^server-only$/, replacement: require.resolve('next/dist/compiled/server-only/empty.js') }, { find: '@', replacement: resolve(__dirname, '..') }] },
  test: { environment: 'node', include: ['scripts/grid-owner-agreement-runtime-20261001.native.test.ts'], testTimeout: 65 * 60_000, fileParallelism: false },
})
