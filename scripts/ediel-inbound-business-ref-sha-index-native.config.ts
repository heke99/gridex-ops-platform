import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {defineConfig} from 'vitest/config'

// Mandatory native suite for track 3 finding 016 (pattern:
// scripts/ediel-source-owner-native.config.ts). Owned local stack only; the
// proof itself runs in a rolled-back transaction.
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
  resolve:{alias:[{find:'@',replacement:resolve(__dirname,'..')},{find:/^server-only$/,replacement:resolve(__dirname,'../node_modules/next/dist/compiled/server-only/empty.js')}]},
  test:{environment:'node',include:['scripts/ediel-inbound-business-ref-sha-index-native.test.ts'],testTimeout:120000,hookTimeout:120000,fileParallelism:false},
})
