import {defineConfig} from 'vitest/config'
import owner from './ediel-source-owner-native.config'

// The existing owner configuration supplies the actual loopback status, aliases
// and permission setup. This supplementary producer never imports/runs old33.
export default defineConfig({...owner,test:{...owner.test,fileParallelism:false,
  include:['scripts/ediel-at-z03c-supplier-boundary-native.test.ts'],
  hookTimeout:300000,testTimeout:180000}})
