// Generated test configuration for quality-playbook executable tests.
import path from 'node:path'
import { defineConfig } from 'vitest/config'

const projectRoot = path.resolve(__dirname, '..')

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@',
        replacement: projectRoot,
      },
    ],
  },
  test: {
    environment: 'node',
    include: ['quality/**/*.test.ts'],
    // Archived audit evidence reproduces findings as they were before their
    // fixes; the permanent regressions live under __tests__/.
    exclude: ['quality/audits/**/evidence/**', '**/node_modules/**'],
    setupFiles: [path.join(projectRoot, '__tests__/setup.ts')],
  },
})
