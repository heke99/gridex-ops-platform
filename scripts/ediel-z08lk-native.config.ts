import {defineConfig} from 'vitest/config'
import owner from './ediel-source-owner-native.config'

// Run the affected retained producer tests unchanged alongside new LK negatives.
// The existing strict local status, permission setup and disposable DB stay real.
export default defineConfig({...owner,test:{...owner.test,fileParallelism:false,
 include:['scripts/ediel-bilateral-prodat-h-original-native.test.ts',
  'scripts/ediel-at-z08lk-supplier-native.test.ts']}})
