import {defineConfig} from 'vitest/config'
import owner from './ediel-source-owner-native.config'

export default defineConfig({...owner,test:{...owner.test,fileParallelism:false,
 include:['scripts/ediel-cancellation-public-acceptance-native.test.ts']}})
