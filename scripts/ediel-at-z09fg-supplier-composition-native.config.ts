import {defineConfig} from 'vitest/config'
import shared from './ediel-source-owner-native.config'

// Supplemental entry only. Importing the immutable owner configuration retains
// GRIDEX_NATIVE_STATUS, exact loopback keys, catalog setup, aliases and serial
// execution. Existing mandatory includes/gates remain present. The existing
// qualified producer owns native execution; this source packet is NOT_RUN.
export default defineConfig({...shared,test:{...shared.test,include:[
 ...(shared.test?.include??[]),
 'scripts/ediel-at-z09fg-supplier-composition-native.test.ts',
]}})
