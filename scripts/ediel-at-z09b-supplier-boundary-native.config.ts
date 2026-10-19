import {defineConfig} from 'vitest/config'
import owner from './ediel-source-owner-native.config'

// The owner configuration supplies the actual loopback status, aliases and
// permission setup. This supplementary producer runs only the Z09B boundary file.
export default defineConfig({...owner,test:{...owner.test,fileParallelism:false,
  include:['scripts/ediel-at-z09b-supplier-boundary-native.test.ts'],
  hookTimeout:300000,testTimeout:900000}})
