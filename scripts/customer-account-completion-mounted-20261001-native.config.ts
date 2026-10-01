import { readFileSync, realpathSync, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { defineConfig } from 'vitest/config'

const runner = process.env.RUNNER_TEMP ? realpathSync(process.env.RUNNER_TEMP) : ''
function privateInput(value: string | undefined) {
  try {
    if (!runner || !value) throw new Error()
    const path = realpathSync(value)
    if (!path.startsWith(runner + sep) || (statSync(path).mode & 0o077) !== 0) throw new Error()
    return path
  } catch {
    throw new Error('account_mounted_private_input_required')
  }
}
if (process.env.CI !== 'true') throw new Error('account_mounted_disposable_ci_required')
const status = JSON.parse(readFileSync(privateInput(process.env.GRIDEX_NATIVE_STATUS), 'utf8')) as Record<string, string>
if (status.API_URL !== 'http://127.0.0.1:54321' || !status.ANON_KEY || !status.SERVICE_ROLE_KEY ||
    !process.env.GRIDEX_ACCOUNT_MOUNTED_PASSWORD || process.env.GRIDEX_E2E_BROWSER_BASE_URL) {
  throw new Error('account_mounted_disposable_status_required')
}
process.env.NEXT_PUBLIC_SUPABASE_URL = status.API_URL
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = status.ANON_KEY
process.env.SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY
export default defineConfig({
  resolve: { alias: [
    { find: /^server-only$/, replacement: resolve(__dirname, '../node_modules/next/dist/compiled/server-only/empty.js') },
    { find: '@', replacement: resolve(__dirname, '..') },
  ] },
  test: { environment: 'node', include: ['scripts/customer-account-completion-mounted-20261001-native.test.ts'],
    testTimeout: 60_000, hookTimeout: 60_000, fileParallelism: false },
})
