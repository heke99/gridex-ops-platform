import {defineConfig} from 'vitest/config'
import owner from './ediel-source-owner-native.config'

// The owner configuration supplies the actual loopback status, aliases and
// permission setup. This supplementary producer runs only the Z04C file.
export default defineConfig({...owner,test:{...owner.test,fileParallelism:false,
  include:['scripts/ediel-at-z04c-supplier-prohibited-native.test.ts'],
  hookTimeout:300000,testTimeout:180000}})
