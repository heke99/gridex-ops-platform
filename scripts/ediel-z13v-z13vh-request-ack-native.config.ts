// masterplan: AT-Z13V-ESCO, AT-Z13VH-ESCO
import {defineConfig} from 'vitest/config'
import sourceOwner from './ediel-source-owner-native.config'

// Retain the canonical local-stack/secret/setup guards. Select only this
// producer's new boundary; do not execute another owner's native suite.
export default defineConfig({...sourceOwner,test:{...sourceOwner.test,
 include:['scripts/ediel-z13v-z13vh-request-ack-native.test.ts'],
}})
