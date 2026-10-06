import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')
const { buildStaffIntegrationAuthFixture } = createRequire(import.meta.url)('../scripts/lib/staff-api-integration-auth-fixture.cjs') as { buildStaffIntegrationAuthFixture(root: string): string }
const before = fs.readFileSync('supabase/migrations/20261004090602_staff_case_events_api_auth.sql', 'utf8')
const original = fs.readFileSync('supabase/migrations/20261005101527_staff_independent_onboarding_authority.sql', 'utf8')
const originalAuth = original.slice(original.indexOf('DO $auth_provenance$'))
const external = fs.readFileSync('supabase/migrations/20261005124901_tenant_staff_external_identity_bindings.sql', 'utf8')
const marker = 'DO $auth_identity_resolution$'
const newAuth = external.includes(marker) ? external.slice(external.indexOf(marker)) : ''
const company = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', client = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const resolve = '/api/v1/staff-onboarding/identity/resolve', accept = '/api/v1/staff-onboarding/invitations/accept'

async function fixture() {
  const db = new PGlite()
  await db.exec(buildStaffIntegrationAuthFixture(root))
  await db.exec(before)
  await db.exec(originalAuth)
  await db.exec(`INSERT INTO companies(id,name,status,is_active) VALUES('${company}','Synthetic independent tenant','active',true);
INSERT INTO integration_api_clients(id,company_id,name,key_prefix,secret_hash,scopes,status,allowed_origins)
VALUES('${client}','${company}','Synthetic staff-only client','support-test','synthetic-hash',ARRAY['staff_users.read','staff_users.write'],'active',ARRAY['https://support123.gridex.se']);`)
  return db
}
const auth = (db: PGlite, route: string, scope: string, secret = 'synthetic-hash') => db.query<{ auth_outcome: string; error_code: string }>(
  'SELECT auth_outcome,error_code FROM public.authenticate_integration_request_v1($1,$2,$3,ARRAY[$4]::text[])', ['support-test', secret, route, scope])

describe('actual independent identity resolution machine authorization SQL', () => {
  it('proves the 5.1 prototype cannot authenticate the new resolver namespace', async () => {
    const db = await fixture()
    try {
      expect((await auth(db, resolve, 'staff_users.read')).rows[0]).toMatchObject({ auth_outcome: 'denied', error_code: 'api_scope_missing' })
      expect((await auth(db, accept, 'staff_users.write')).rows[0].auth_outcome).toBe('allowed')
    } finally { await db.close() }
  }, 20_000)
  it('allows exactly the new resolver read scope while preserving accept and denying sibling, wrong-scope, credential and Website bypasses', async () => {
    const db = await fixture()
    try {
      await db.exec(newAuth)
      expect((await auth(db, resolve, 'staff_users.read')).rows[0].auth_outcome).toBe('allowed')
      expect((await auth(db, accept, 'staff_users.write')).rows[0].auth_outcome).toBe('allowed')
      for (const [route, scope] of [[resolve, 'staff_users.write'], [accept, 'staff_users.read'], ['/api/v1/staff-onboarding/identity/unknown', 'staff_users.read']]) {
        expect((await auth(db, route, scope)).rows[0]).toMatchObject({ auth_outcome: 'denied', error_code: 'api_scope_missing' })
      }
      expect((await auth(db, resolve, 'staff_users.read', 'wrong-secret')).rows[0].auth_outcome).toBe('denied')
      expect((await auth(db, '/api/v1/website/products', 'staff_users.read')).rows[0]).toMatchObject({ auth_outcome: 'denied', error_code: 'api_client_not_launch_ready' })
    } finally { await db.close() }
  }, 20_000)
  it('refuses an unexpected authorization definition before extending the namespace', async () => {
    const db = await fixture()
    try {
      await db.exec(`DO $$DECLARE definition text; BEGIN SELECT pg_get_functiondef('public.authenticate_integration_request_v1(text,text,text,text[],text[],text,text,integer,integer)'::regprocedure) INTO definition; EXECUTE replace(definition,'with staff_policy as (','with staff_policy as ( -- unexpected source'); END $$;`)
      await expect(db.exec(newAuth)).rejects.toThrow(/source_mismatch/)
    } finally { await db.close() }
  }, 20_000)
})
