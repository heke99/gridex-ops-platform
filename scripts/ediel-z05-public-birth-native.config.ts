import {defineConfig} from 'vitest/config'
import owner from './ediel-source-owner-native.config'

export default defineConfig({...owner,test:{...owner.test,fileParallelism:false,
 include:['scripts/ediel-z05-public-birth-native.test.ts']}})
