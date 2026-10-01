import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import { fixturePath, localStatus } from './support-attachment-next-denial-20261001.fixture'
const status = localStatus()
fixturePath()
if (!['seed', 'postcheck'].includes(process.env.GRIDEX_SUPPORT_NEXT_PHASE ?? '')) throw new Error('attachment_journey_explicit_phase_required')
process.env.NEXT_PUBLIC_SUPABASE_URL = status.API_URL
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = status.ANON_KEY
process.env.SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY
export default defineConfig({ resolve: { alias: [{ find: '@', replacement: resolve(__dirname, '..') }] },
  test: { environment: 'node', include: ['scripts/support-attachment-next-denial-20261001.native.test.ts'], fileParallelism: false, testTimeout: 120_000 } })
