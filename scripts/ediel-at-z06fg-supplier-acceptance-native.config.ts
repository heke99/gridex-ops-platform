import {defineConfig} from 'vitest/config'
import shared from './ediel-source-owner-native.config'

// Supplemental entry only. Importing the immutable owner configuration retains
// GRIDEX_NATIVE_STATUS, exact loopback keys, catalog setup, aliases and serial
// execution without changing the shared file pinned by OPS-03 release evidence.
// The F/G composition workflow runs these two acceptance files explicitly.
export default defineConfig({...shared,test:{...shared.test,include:[
 ...(shared.test?.include??[]),
 'scripts/ediel-at-z06f-supplier-acceptance-native.test.ts',
 'scripts/ediel-at-z06g-supplier-acceptance-native.test.ts',
]}})
