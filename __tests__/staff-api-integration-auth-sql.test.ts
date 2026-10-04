import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'

const { buildStaffIntegrationAuthFixture } = createRequire(import.meta.url)('../scripts/lib/staff-api-integration-auth-fixture.cjs') as { buildStaffIntegrationAuthFixture(root: string): string }
const root = path.resolve(import.meta.dirname, '..')
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261004083809_staff_api_integration_auth.sql'), 'utf8')
const regression = fs.readFileSync(path.join(root, 'scripts/staff-api-integration-auth-regression.sql'), 'utf8').replace(/^\\set.*$/gm, '')

// PGlite executes the real source SQL as a quick regression. The ordinary clean
// Supabase replay separately executes this same regression on native PostgreSQL.
describe('staff integration machine authorization SQL', () => {
  it('reproduces Website provisioning blocking a legitimate staff-only key on the previous native wrapper', async () => {
    const db = new PGlite()
    try {
      await db.exec(buildStaffIntegrationAuthFixture(root))
      await expect(db.exec(regression)).rejects.toThrow('staff route /api/v1/staff/users with staff_users.read denied: api_client_not_launch_ready')
    } finally { await db.close() }
  }, 20_000)

  it('permits explicitly scoped staff operations while preserving credential, tenant, network, rate, grants and existing Website/customer readiness', async () => {
    const db = new PGlite()
    try {
      await db.exec(buildStaffIntegrationAuthFixture(root))
      await db.exec(migration)
      await expect(db.exec(regression)).resolves.toBeDefined()
    } finally { await db.close() }
  }, 20_000)
})
