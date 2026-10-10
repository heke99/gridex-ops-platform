import {defineConfig} from 'vitest/config'
import owner from './ediel-source-owner-native.config'

// Genuine public reception only; inherited local ownership and permission setup.
export default defineConfig({...owner,test:{...owner.test,fileParallelism:false,
 include:['scripts/ediel-at-z05h-z08h-supplier-native.test.ts']}})
