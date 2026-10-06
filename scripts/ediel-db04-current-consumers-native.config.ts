import {defineConfig} from 'vitest/config'
import sourceOwner from './ediel-source-owner-native.config'

// Preserve the canonical credentials, aliases, setup and serial execution.
// Existing seven-query proof runs unchanged with the new consumer workloads.
export default defineConfig({...sourceOwner,test:{...sourceOwner.test,include:[
 'scripts/ediel-transport-data-query-plan-native.test.ts',
 'scripts/ediel-db04-current-consumers-native.test.ts',
]}})
