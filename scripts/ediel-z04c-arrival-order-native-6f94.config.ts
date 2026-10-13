import {defineConfig} from 'vitest/config'
import owner from './ediel-source-owner-native.config'

// SOURCE preparation only; the existing qualified producer owns execution.
// Import preserves mandatory GRIDEX_NATIVE_STATUS exact loopback/keys, catalog
// setup, aliases, timeouts and serial operation. Append without dropping gates.
export default defineConfig({...owner,test:{...owner.test,include:[
 ...(owner.test?.include??[]),'scripts/ediel-z04c-arrival-order-native-6f94.test.ts',
]}})
