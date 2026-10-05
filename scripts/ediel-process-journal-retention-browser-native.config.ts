import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {defineConfig} from 'vitest/config'
const file=process.env.GRIDEX_NATIVE_STATUS
if(!file||!process.env.GRIDEX_PROCESS_RETENTION_FIXTURE_PATH||!process.env.GRIDEX_EDIEL_CASE_TEST_PASSWORD)throw Error('process_retention_disposable_fixture_required')
const status=JSON.parse(readFileSync(file,'utf8')) as Record<string,string>
if(status.API_URL!=='http://127.0.0.1:54321'||!status.ANON_KEY||!status.SERVICE_ROLE_KEY)throw Error('process_retention_owned_native_required')
process.env.NEXT_PUBLIC_SUPABASE_URL=status.API_URL;process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY=status.ANON_KEY;process.env.SUPABASE_SERVICE_ROLE_KEY=status.SERVICE_ROLE_KEY
export default defineConfig({resolve:{alias:[{find:'@',replacement:resolve(__dirname,'..')}]},test:{environment:'node',setupFiles:['scripts/helpers/ediel-native-permission-catalog.setup.ts'],include:['scripts/ediel-process-journal-retention-browser-native.test.ts'],testTimeout:180000,fileParallelism:false}})
