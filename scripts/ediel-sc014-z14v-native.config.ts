import { defineConfig } from 'vitest/config'
import technicalIntake from './ediel-sc014-technical-intake-native.config'

// Retain the local-only status boundary, actual permission catalog fixture,
// aliases and serial execution. Both selected suites call current consumers.
export default defineConfig({
  ...technicalIntake,
  test: {
    ...technicalIntake.test,
    include: [
      'scripts/ediel-sc014-technical-intake-native.test.ts',
      'scripts/ediel-at-z14v-current-effects-native.test.ts',
    ],
  },
})
