// Generated test configuration for quality-playbook executable tests.
import path from 'node:path'
import { defineConfig } from 'vitest/config'

const projectRoot = path.resolve(__dirname, '..')

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@/lib/pricing/commercialModel',
        replacement: path.join(projectRoot, 'lib/pricing/commercialModelCanonical.ts'),
      },
      {
        find: '@/lib/pricing/websiteQuotes',
        replacement: path.join(projectRoot, 'lib/pricing/websiteQuotesCanonical.ts'),
      },
      {
        find: '@',
        replacement: projectRoot,
      },
    ],
  },
  test: {
    environment: 'node',
    include: ['quality/**/*.test.ts'],
    setupFiles: [path.join(projectRoot, '__tests__/setup.ts')],
  },
})