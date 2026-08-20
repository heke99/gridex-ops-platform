import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vitest/config'

const coverageBaseline = JSON.parse(
  fs.readFileSync(new URL('./config/coverage-baseline.json', import.meta.url), 'utf8'),
) as {
  statements: number
  branches: number
  functions: number
  lines: number
}

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@',
        replacement: path.resolve(__dirname, '.'),
      },
    ],
  },
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    setupFiles: ['__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
      reportOnFailure: true,
      thresholds: {
        statements: coverageBaseline.statements,
        branches: coverageBaseline.branches,
        functions: coverageBaseline.functions,
        lines: coverageBaseline.lines,
      },
    },
  },
})
