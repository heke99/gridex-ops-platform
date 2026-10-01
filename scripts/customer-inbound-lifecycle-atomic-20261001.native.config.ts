import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
if (process.env.CI !== 'true' || !process.env.GRIDEX_NATIVE_STATUS || !process.env.RUNNER_TEMP) throw new Error('inbound_switch_disposable_ci_required')
const status = JSON.parse(readFileSync(process.env.GRIDEX_NATIVE_STATUS, 'utf8')) as Record<string, string>
if (status.API_URL !== 'http://127.0.0.1:54321' || !status.ANON_KEY || !status.SERVICE_ROLE_KEY) throw new Error('inbound_switch_local_stack_required')
process.env.NEXT_PUBLIC_SUPABASE_URL = status.API_URL
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = status.ANON_KEY
process.env.SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY
// Public synthetic credentials for the test's ONLY controlled boundary,
// Nodemailer sendMail. All readiness/MIME/S-MIME/Storage/state owners stay real.
process.env.EDIEL_EMAIL_PROVIDER = 'strato'
process.env.EDIEL_SMTP_HOST = '127.0.0.1'
process.env.EDIEL_SMTP_PORT = '2525'
process.env.EDIEL_SMTP_SECURE = 'false'
process.env.EDIEL_SMTP_FROM = 'synthetic-inbound@example.invalid'
process.env.EDIEL_SMTP_USER = 'synthetic-inbound@example.invalid'
process.env.EDIEL_SMTP_PASS = 'synthetic-local-no-provider'
process.env.EDIEL_SHARED_MAILBOX_ADDRESS = 'synthetic-inbound@example.invalid'
process.env.EDIEL_APP_DKIM_ENABLED = 'false'
export default defineConfig({ resolve: { alias: [{ find: '@', replacement: resolve(__dirname, '..') }] },
  test: { environment: 'node', include: ['scripts/customer-inbound-lifecycle-atomic-20261001.native.test.ts'],
    testTimeout: 360_000, hookTimeout: 60_000, fileParallelism: false } })
