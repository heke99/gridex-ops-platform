import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {defineConfig} from 'vitest/config'

// Existing ROOT disposable native producer only. No hosted fallback or install.
const statusPath=process.env.GRIDEX_NATIVE_STATUS
if(!statusPath)throw Error('bounded_recovery_owned_native_status_required')
const status=JSON.parse(readFileSync(statusPath,'utf8')) as Record<string,string>
if(status.API_URL!=='http://127.0.0.1:54321'||status.DB_URL!=='postgresql://postgres:postgres@127.0.0.1:54322/postgres'||!status.SERVICE_ROLE_KEY||!status.ANON_KEY)throw Error('bounded_recovery_owned_local_stack_required')
process.env.NEXT_PUBLIC_SUPABASE_URL=status.API_URL
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY=status.ANON_KEY
process.env.SUPABASE_SERVICE_ROLE_KEY=status.SERVICE_ROLE_KEY
export default defineConfig({
  resolve:{alias:[{find:'@',replacement:resolve(__dirname,'..')},{find:/^server-only$/,replacement:resolve(__dirname,'../node_modules/next/dist/compiled/server-only/empty.js')}]},
  test:{environment:'node',include:['scripts/ediel-bounded-recovery-native.test.ts'],setupFiles:['scripts/helpers/ediel-native-permission-catalog.setup.ts'],fileParallelism:false,testTimeout:20000,hookTimeout:30000},
})
