import {defineConfig} from 'vitest/config'
import sourceOwner from './ediel-source-owner-native.config'

// Real local SQL/PostgREST ledger and membership check. Serial and isolated.
export default defineConfig({...sourceOwner,test:{...sourceOwner.test,
 include:['scripts/staff-user-idempotency-template-routes-native.test.ts'],
 testTimeout:120000,
}})
