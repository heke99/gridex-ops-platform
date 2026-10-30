import {defineConfig} from 'vitest/config'
import sourceOwner from './ediel-source-owner-native.config'

// Real local PostgREST/SQL and the real webhook dispatcher; only the outbound
// HTTPS transport is replaced by an in-process recorder. Serial and isolated.
export default defineConfig({...sourceOwner,test:{...sourceOwner.test,
 include:['scripts/webhook-public-event-id-native.test.ts'],
 testTimeout:120000,
}})
