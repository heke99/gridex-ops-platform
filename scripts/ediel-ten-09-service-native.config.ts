// masterplan: TEN-09, AT-TEN-09
import {defineConfig,mergeConfig} from 'vitest/config'
import sourceOwner from './ediel-source-owner-native.config'

// Extend the exact shared native setup without editing another agent's file.
// The CLI selects both the original SC003/005 and this supplemental suite.
export default mergeConfig(sourceOwner,defineConfig({test:{include:[
 'scripts/ediel-ten-09-service-coordination-native.test.ts',
]}}))
