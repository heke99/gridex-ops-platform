import {defineConfig} from 'vitest/config'
import owner from './ediel-source-owner-native.config'

// Genuine public reception only; inherited local ownership and permission setup.
export default defineConfig({...owner,test:{...owner.test,fileParallelism:false,
 // Failure formatting only: compare the complete values and retain every
 // test/assertion/outcome, while avoiding multi-GB copies of global graphs.
 diff:{truncateThreshold:200,maxDepth:6},
 include:['scripts/ediel-at-z05h-z08h-supplier-native.test.ts']}})
