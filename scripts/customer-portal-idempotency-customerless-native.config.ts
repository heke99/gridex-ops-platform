import {defineConfig} from 'vitest/config'
import sourceOwner from './ediel-source-owner-native.config'

// Real local PostgREST/SQL, the real idempotency ledger owner and Partner API
// route. Serial and isolated.
export default defineConfig({...sourceOwner,test:{...sourceOwner.test,
 include:['scripts/customer-portal-idempotency-customerless-native.test.ts'],
 testTimeout:120000,
}})
