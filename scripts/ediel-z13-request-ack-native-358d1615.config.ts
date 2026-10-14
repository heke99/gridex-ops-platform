import {defineConfig} from 'vitest/config'
import esco from './ediel-at-z14vh-z15v-esco-native.config'

// Preserve the existing local backend, catalog, aliases and serial guards.
export default defineConfig({
  ...esco,
  test: {...esco.test, include: ['scripts/ediel-z13-request-ack-native-358d1615.test.ts']},
})
