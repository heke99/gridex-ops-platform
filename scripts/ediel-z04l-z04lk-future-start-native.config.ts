import {defineConfig} from 'vitest/config'
import owner from './ediel-source-owner-native.config'

// Exact new suite only. No C03 five-case registration, old33 or shared backend.
export default defineConfig({...owner,test:{...owner.test,fileParallelism:false,bail:1,
  include:['scripts/ediel-z04l-z04lk-future-start-native.test.ts'],
  hookTimeout:900000,testTimeout:600000}})
