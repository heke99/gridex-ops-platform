import {defineConfig} from 'vitest/config'
import sourceOwner from './ediel-source-owner-native.config'

// Canonical native credentials, aliases, setup and serial execution for the DB-05 lifecycle proofs.
export default defineConfig({...sourceOwner,test:{...sourceOwner.test,include:[
 'scripts/db-05-hard-delete-guard-native.test.ts',
 'scripts/db-05-tenant-offboarding-native.test.ts',
]}})
