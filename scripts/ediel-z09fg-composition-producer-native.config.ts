import {defineConfig} from 'vitest/config'
import shared from './ediel-source-owner-native.config'

// Preparation entry only: retain exact native status/loopback, aliases, setup,
// serial execution and time guards; never select the inherited whole suite.
export default defineConfig({...shared,test:{...shared.test,include:[
 'scripts/helpers/ediel-z09fg-composition-inputs-native-producer.ts',
]}})
