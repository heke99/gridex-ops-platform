import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// This checks local connection inputs only. Producer custody, disposable backend
// ownership, resource admission and quiescence must be qualified independently.
const statusPath = process.env.GRIDEX_NATIVE_STATUS
if (!statusPath) throw new Error('owned_private_native_status_required')
let status: Record<string, unknown>
try {
  if (!isAbsolute(statusPath) || realpathSync(statusPath) !== statusPath) {
    throw new Error('private_status_path_required')
  }
  const file = lstatSync(statusPath)
  if (!file.isFile() || file.uid !== process.getuid?.() || (file.mode & 0o077) !== 0
    || file.size > 65_536) throw new Error('private_status_file_required')
  status = JSON.parse(readFileSync(statusPath, 'utf8')) as Record<string, unknown>
  if (!status || typeof status !== 'object') throw new Error('private_status_object_required')
} catch {
  throw new Error('owned_private_native_status_invalid')
}
if (status.API_URL !== 'http://127.0.0.1:54321'
  || typeof status.SERVICE_ROLE_KEY !== 'string' || !status.SERVICE_ROLE_KEY
  || typeof status.ANON_KEY !== 'string' || !status.ANON_KEY) {
  throw new Error('owned_local_supabase_required')
}

export default defineConfig({
  root: resolve(__dirname, '..'),
  test: {
    environment: 'node',
    include: ['scripts/invoice-approval-atomic-native.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 45_000,
    hookTimeout: 45_000,
  },
})
