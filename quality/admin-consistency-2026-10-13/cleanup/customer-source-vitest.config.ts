import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@': resolve('.') } },
  test: { environment: 'node', include: ['quality/admin-consistency-2026-10-13/cleanup/customer-source-consistency.test.ts'] },
})
