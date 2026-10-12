import {defineConfig} from 'vitest/config'
import sourceOwner from './ediel-source-owner-native.config'

// Real local GoTrue/PostgREST/SQL, serial and isolated. No unit fallback.
export default defineConfig({...sourceOwner,test:{...sourceOwner.test,
 include:['scripts/db-05-customer-close-due-purge-native.test.ts'],
 testTimeout:180000,
}})
