import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

if (process.env.CI !== 'true' || !process.env.GRIDEX_NATIVE_STATUS || !process.env.GRIDEX_ANALYTICS_INCIDENT_FIXTURE_PATH) throw new Error('analytics_incident_disposable_ci_required')
const status = JSON.parse(readFileSync(process.env.GRIDEX_NATIVE_STATUS, 'utf8')) as Record<string, string>
if (status.API_URL !== 'http://127.0.0.1:54321' || !status.ANON_KEY || !status.SERVICE_ROLE_KEY) throw new Error('analytics_incident_local_stack_required')
if (['RESEND_API_KEY', 'EDIEL_SMTP_PASS', 'EDIEL_SMTP_PASSWORD'].some(key => Boolean(process.env[key]?.trim()))) throw new Error('analytics_incident_provider_credentials_forbidden')
process.env.NEXT_PUBLIC_SUPABASE_URL = status.API_URL
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = status.ANON_KEY
process.env.SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY
export default defineConfig({
  resolve: { alias: [
    { find: /^server-only$/, replacement: resolve(__dirname, '../node_modules/next/dist/compiled/server-only/empty.js') },
    { find: '@', replacement: resolve(__dirname, '..') },
  ] },
  test: { environment: 'node', include: ['scripts/analytics-incident-20261001.native.test.ts'], testTimeout: 120_000, fileParallelism: false },
})
