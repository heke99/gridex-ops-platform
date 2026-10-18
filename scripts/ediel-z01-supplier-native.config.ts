import {defineConfig} from 'vitest/config'
import nativeOwnerConfig from './ediel-source-owner-native.config'

// Preserve the shared local-only credentials, permissions and native timeouts.
export default defineConfig({...nativeOwnerConfig,test:{...nativeOwnerConfig.test,
 include:['scripts/ediel-at-z01-supplier-native.test.ts']}})
