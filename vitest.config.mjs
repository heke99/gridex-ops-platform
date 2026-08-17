import { defineConfig } from 'vitest/config'

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
    },
  },
})
