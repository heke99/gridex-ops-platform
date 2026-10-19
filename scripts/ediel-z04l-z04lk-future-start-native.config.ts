import {defineConfig} from 'vitest/config'
import owner from './ediel-source-owner-native.config'

// Exact new suite only. No C03 five-case registration, old33 or shared backend.
export default defineConfig({...owner,test:{...owner.test,
  // Reapply the owner's validated local status values after each worker preload.
  env:{...owner.test?.env,
    NEXT_PUBLIC_SUPABASE_URL:process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY:process.env.SUPABASE_SERVICE_ROLE_KEY},
  fileParallelism:false,bail:1,
  include:['scripts/ediel-z04l-z04lk-future-start-native.test.ts'],
  hookTimeout:900000,testTimeout:600000}})
