import fs from 'node:fs'
import { defineConfig } from 'vitest/config'

const baseline = JSON.parse(fs.readFileSync(new URL('./config/coverage-baseline.json', import.meta.url), 'utf8'))

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
      reportOnFailure: true,
      include: [
        'lib/**/*.ts',
        'app/api/**/*.ts',
        'app/**/actions.ts',
        'app/**/route.ts',
      ],
      exclude: [
        '**/*.d.ts',
        '**/*.test.*',
        '**/*.spec.*',
        '**/__tests__/**',
        '**/node_modules/**',
        '**/.next/**',
        'supabase/database.types.ts',
      ],
      thresholds: {
        statements: baseline.statements,
        branches: baseline.branches,
        functions: baseline.functions,
        lines: baseline.lines,
      },
    },
  },
})
