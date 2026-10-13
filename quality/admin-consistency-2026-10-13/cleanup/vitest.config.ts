import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['quality/admin-consistency-2026-10-13/cleanup/reset-guard.test.ts'],
  },
})
