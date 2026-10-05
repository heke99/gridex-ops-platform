// Local helper/preflight proof only. This does not substitute for the ordinary
// native config, its owned-status guard, disposable DB/Storage or native CI.
import {resolve} from 'node:path'
import {defineConfig} from 'vitest/config'
process.env.NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54321'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='synthetic-local-helper-only'
process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-local-helper-only'
export default defineConfig({
 resolve:{alias:{'@':resolve(process.cwd())}},
 test:{environment:'node',include:['scripts/ediel-correction-context-native.test.ts'],
  testNamePattern:/^outbound (helper|fixture preflight)/,testTimeout:30000},
})
