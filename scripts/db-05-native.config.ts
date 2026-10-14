import {defineConfig} from 'vitest/config'
import sourceOwner from './ediel-source-owner-native.config'

// Real local GoTrue/PostgREST/SQL, serial and isolated. No unit fallback.
export default defineConfig({...sourceOwner,test:{...sourceOwner.test,
 include:['scripts/db-05-customer-close-due-purge-native.test.ts','scripts/ediel-customer-record-retention-native.test.ts','scripts/ediel-process-journal-retention-native.test.ts'],
 testTimeout:180000,
}})
