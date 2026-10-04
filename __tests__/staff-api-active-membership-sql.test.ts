import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'

const { buildStaffIntegrationAuthFixture } = createRequire(import.meta.url)('../scripts/lib/staff-api-integration-auth-fixture.cjs') as { buildStaffIntegrationAuthFixture(root: string): string }
const root = path.resolve(import.meta.dirname, '..')
const schema = fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8')
const bootstrap = fs.readFileSync(path.join(root, 'scripts/sql/gridex-supabase-compatible-bootstrap.sql'), 'utf8')
function declaration(source: string, name: string): string {
  const prefix = `CREATE TABLE public.${name} (`
  const start = source.indexOf(prefix)
  if (start < 0) throw new Error(`Missing fixture source table ${name}`)
  return source.slice(start, source.indexOf('\n);', start) + 4)
}
function authUsersDeclaration(): string {
  const start = bootstrap.indexOf('create table if not exists auth.users (')
  return bootstrap.slice(start, bootstrap.indexOf('\n);', start) + 4)
}

// Diagnostic execution of the actual source-defined SQL; CI runs the same
// rolled-back regression on the complete native Supabase clean replay.
it('refuses suspended, deleted, banned, unaccepted, disabled and foreign staff accounts at the authoritative membership loader', async () => {
  const db = new PGlite()
  try {
    await db.exec(buildStaffIntegrationAuthFixture(root))
    await db.exec(['CREATE SCHEMA auth;', authUsersDeclaration(), declaration(schema, 'user_profiles'), declaration(schema, 'company_memberships'),
      'ALTER TABLE public.user_profiles ADD PRIMARY KEY(id);'].join('\n'))
    await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/20261004085008_staff_active_membership.sql'), 'utf8'))
    const regression = fs.readFileSync(path.join(root, 'scripts/staff-api-active-membership-regression.sql'), 'utf8').replace(/^\\set.*$/gm, '')
    await expect(db.exec(regression)).resolves.toBeDefined()
  } finally { await db.close() }
}, 20_000)
