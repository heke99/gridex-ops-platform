import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')
const { buildStaffOnboardingFixture } = createRequire(import.meta.url)('../scripts/lib/staff-onboarding-sql-fixture.cjs') as { buildStaffOnboardingFixture(root: string): string }
const source = fs.readFileSync('supabase/migrations/20261005101527_staff_independent_onboarding_authority.sql', 'utf8')
// Execute the real wrapper and unchanged canonical acceptance/hash functions.
// This embedded scope is not full native replay/concurrency/hosted acceptance.
const wrapper = source.slice(0, source.indexOf('-- Exact onboarding route opt-in')) + 'COMMIT;'
const regression = fs.readFileSync('scripts/staff-onboarding-acceptance-regression.sql', 'utf8')
  .replace(/^\\set.*$/gm, '').replace(/^\\ir sql\/staff-native-role-catalog-fixture.sql$/m, fs.readFileSync('scripts/sql/staff-native-role-catalog-fixture.sql', 'utf8'))

describe('actual independent onboarding SQL authority', () => {
  it('demonstrates the required boundary is absent before the additive forward', async () => {
    const db = new PGlite()
    try {
      await db.exec(buildStaffOnboardingFixture(root))
      await expect(db.exec(regression)).rejects.toThrow('function "public.gridex_accept_staff_invitation_v1(jsonb)" does not exist')
    } finally { await db.close() }
  }, 20_000)
  it('locks and rechecks client/provider/Auth/origin authority, executes canonical accept once, and never reactivates disabled replay', async () => {
    const db = new PGlite()
    try {
      await db.exec(buildStaffOnboardingFixture(root))
      await db.exec(wrapper)
      await expect(db.exec(regression)).resolves.toBeDefined()
    } finally { await db.close() }
  }, 20_000)
})
