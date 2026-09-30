import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

if (process.env.CI !== 'true' || !process.env.GRIDEX_NATIVE_STATUS || !process.env.GRIDEX_OPS_EFFECT_FIXTURE_PATH || !process.env.GRIDEX_OPS_EFFECT_PASSWORD) throw new Error('ops_effect_disposable_ci_required')
const status = JSON.parse(readFileSync(process.env.GRIDEX_NATIVE_STATUS,'utf8')) as Record<string,string>
if (status.API_URL!=='http://127.0.0.1:54321' || !status.ANON_KEY || !status.SERVICE_ROLE_KEY) throw new Error('ops_effect_local_stack_required')
process.env.NEXT_PUBLIC_SUPABASE_URL=status.API_URL
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY=status.ANON_KEY
process.env.SUPABASE_SERVICE_ROLE_KEY=status.SERVICE_ROLE_KEY

export default defineConfig({
  resolve:{alias:[{find:'@',replacement:resolve(__dirname,'..')}]},
  test:{environment:'node',include:['scripts/ops-effect-browser-native.test.ts'],testTimeout:120_000,fileParallelism:false},
})
