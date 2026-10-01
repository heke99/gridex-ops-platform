import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

if(process.env.CI!=='true'||!process.env.GRIDEX_NATIVE_STATUS)throw new Error('account_completion_disposable_ci_only')
const status=JSON.parse(readFileSync(process.env.GRIDEX_NATIVE_STATUS,'utf8')) as Record<string,string>
if(status.API_URL!=='http://127.0.0.1:54321'||!status.ANON_KEY||!status.SERVICE_ROLE_KEY)throw new Error('account_completion_disposable_status_required')
process.env.NEXT_PUBLIC_SUPABASE_URL=status.API_URL
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY=status.ANON_KEY
process.env.SUPABASE_SERVICE_ROLE_KEY=status.SERVICE_ROLE_KEY
export default defineConfig({resolve:{alias:[
  {find:/^server-only$/,replacement:resolve(__dirname,'../node_modules/next/dist/compiled/server-only/empty.js')},
  {find:'@',replacement:resolve(__dirname,'..')},
]},test:{environment:'node',include:['scripts/customer-account-completion-reconstructed-20261001-native.test.ts'],
  testTimeout:60_000,hookTimeout:60_000,fileParallelism:false}})
