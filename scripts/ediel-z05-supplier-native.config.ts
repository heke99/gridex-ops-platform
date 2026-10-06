import {defineConfig} from 'vitest/config'
import owner from './ediel-source-owner-native.config'

// Retain the completed twenty producer and four LK controls unchanged beside
// the new whole-contract observations. Strict disposable/local ownership stays.
export default defineConfig({...owner,test:{...owner.test,fileParallelism:false,
 include:['scripts/ediel-bilateral-prodat-h-original-native.test.ts',
  'scripts/ediel-at-z08lk-supplier-native.test.ts',
  'scripts/ediel-at-z05-supplier-native.test.ts']}})
