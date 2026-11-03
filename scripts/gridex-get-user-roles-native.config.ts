import {defineConfig} from 'vitest/config'
import sourceOwner from './ediel-source-owner-native.config'

// Real local GoTrue/PostgREST/SQL. Serial and isolated.
export default defineConfig({...sourceOwner,test:{...sourceOwner.test,
 include:['scripts/gridex-get-user-roles-native.test.ts'],
 testTimeout:120000,
}})
