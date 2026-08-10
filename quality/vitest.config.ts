// Generated test configuration for quality-playbook executable tests.
import path from 'node:path'
import { defineConfig } from 'vitest/config'

const projectRoot = path.resolve(__dirname, '..')

export default defineConfig({
  resolve: {
    alias: {
      '@': projectRoot,
    },
  },
  test: {
    environment: 'node',
    include: ['quality/**/*.test.ts'],
    setupFiles: [path.join(projectRoot, '__tests__/setup.ts')],
  },
})
