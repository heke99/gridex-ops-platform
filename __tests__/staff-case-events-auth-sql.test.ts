import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'

const { buildStaffIntegrationAuthFixture } = createRequire(import.meta.url)('../scripts/lib/staff-api-integration-auth-fixture.cjs') as { buildStaffIntegrationAuthFixture(root: string): string }
const root = path.resolve(import.meta.dirname, '..')
const previousMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261004083809_staff_api_integration_auth.sql'), 'utf8')
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261004090602_staff_case_events_api_auth.sql'), 'utf8')
const regression = fs.readFileSync(path.join(root, 'scripts/staff-case-events-api-auth-regression.sql'), 'utf8').replace(/^\\set.*$/gm, '')

describe('staff case events machine policy', () => {
  it('fails the history route closed before the new allowlist migration', async () => {
    const db = new PGlite()
    try {
      await db.exec(buildStaffIntegrationAuthFixture(root))
      await db.exec(previousMigration)
      await expect(db.exec(regression)).rejects.toThrow('staff case events route denied: api_scope_missing')
    } finally { await db.close() }
  }, 20_000)
  it('permits only the exact history read route with explicit read scope', async () => {
    const db = new PGlite()
    try {
      await db.exec(buildStaffIntegrationAuthFixture(root))
      await db.exec(migration)
      await expect(db.exec(regression)).resolves.toBeDefined()
    } finally { await db.close() }
  }, 20_000)
})
