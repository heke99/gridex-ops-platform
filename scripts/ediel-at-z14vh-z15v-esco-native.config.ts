import {defineConfig} from 'vitest/config'
import technicalIntake from './ediel-sc014-technical-intake-native.config'

// Same local-only status boundary, permission catalog fixture, aliases and
// serial execution as the approved Z14V native proof; only this suite runs.
export default defineConfig({
  ...technicalIntake,
  test: {
    ...technicalIntake.test,
    include: ['scripts/ediel-at-z14vh-z15v-esco-native.test.ts'],
  },
})
