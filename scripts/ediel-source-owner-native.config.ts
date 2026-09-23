import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {defineConfig} from 'vitest/config'

// A separate, mandatory native suite. It cannot fall back to unit placeholders
// or a hosted project. The CLI status file stays in RUNNER_TEMP, never artifacts.
const statusPath = process.env.GRIDEX_NATIVE_STATUS
if (!statusPath) throw new Error('owned_native_status_required')
const status = JSON.parse(readFileSync(statusPath,'utf8')) as Record<string,string>
if (status.API_URL !== 'http://127.0.0.1:54321' || !status.SERVICE_ROLE_KEY || !status.ANON_KEY) {
  throw new Error('owned_local_supabase_required')
}
process.env.NEXT_PUBLIC_SUPABASE_URL = status.API_URL
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = status.ANON_KEY
process.env.SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY
export default defineConfig({
  resolve:{alias:[{find:'@',replacement:resolve(__dirname,'..')}]},
  test:{environment:'node',include:['scripts/ediel-source-owner-native.test.ts','scripts/ediel-closure-wire-native.test.ts','scripts/ediel-utilts-consumption-native.test.ts','scripts/ediel-correction-context-native.test.ts'],testTimeout:30000,hookTimeout:30000,fileParallelism:false},
})
