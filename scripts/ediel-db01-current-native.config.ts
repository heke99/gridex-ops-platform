import {execFileSync} from 'node:child_process'
import {readFileSync, realpathSync} from 'node:fs'
import {isAbsolute, resolve} from 'node:path'
import {defineConfig} from 'vitest/config'

// Supplemental unchanged BASE source + exact snapshot repair before births +
// two exact forwards, never canonical current clean/capture/upgrade credit.
const root = realpathSync(resolve(__dirname, '..'))
const phase = process.env.GRIDEX_DB01_NATIVE_PHASE
const receiptPath = process.env.GRIDEX_DB01_NATIVE_RECEIPT
const statusPath = process.env.GRIDEX_NATIVE_STATUS
const sourcePath = process.env.GRIDEX_DB01_SOURCE_ROOT
if (!receiptPath || !statusPath || !sourcePath || !isAbsolute(sourcePath) || !['historical', 'current'].includes(phase ?? '')) {
  throw new Error('db01_owned_native_phase_inputs_required')
}
const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as {
  root_path: string; base_path: string; checkout_sha: string; base_sha: string
}
const sourceRoot = realpathSync(sourcePath)
const head = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim()
if (receipt.root_path !== root || receipt.checkout_sha !== head || receipt.base_sha !== '56e58b95518ec4d5eef210ba16ba46228afb40ac' ||
    sourceRoot !== realpathSync(phase === 'historical' ? receipt.base_path : root)) {
  throw new Error('db01_native_source_identity_mismatch')
}
const status = JSON.parse(readFileSync(statusPath, 'utf8')) as Record<string, string>
if (status.API_URL !== 'http://127.0.0.1:54321' || !status.SERVICE_ROLE_KEY || !status.ANON_KEY) throw new Error('owned_local_supabase_required')
process.env.NEXT_PUBLIC_SUPABASE_URL = status.API_URL
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = status.ANON_KEY
process.env.SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY

export default defineConfig({
  resolve: {alias: [{find: '@', replacement: sourceRoot},
    {find: /^server-only$/, replacement: resolve(root, 'node_modules/next/dist/compiled/server-only/empty.js')}]},
  test: {environment: 'node', include: ['scripts/ediel-db01-legacy-address-containment-native.test.ts'],
    setupFiles: [resolve(sourceRoot, 'scripts/helpers/ediel-native-permission-catalog.setup.ts')],
    testTimeout: 240000, hookTimeout: 240000, fileParallelism: false},
})
