import {defineConfig} from 'vitest/config'
import owner from './ediel-source-owner-native.config'

// FINDINGS H7 (20261022140000) and H2/H3 re-gating (20261022150000): the owner's strict disposable status boundary, aliases and setup.
export default defineConfig({...owner,test:{...owner.test,include:['scripts/supply-move-out-z05lk-native.test.ts','scripts/supply-end-regate-native.test.ts'],fileParallelism:false}})
