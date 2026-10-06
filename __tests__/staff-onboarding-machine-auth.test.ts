import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')
const { buildStaffIntegrationAuthFixture } = createRequire(import.meta.url)('../scripts/lib/staff-api-integration-auth-fixture.cjs') as { buildStaffIntegrationAuthFixture(root: string): string }
const before = fs.readFileSync('supabase/migrations/20261004090602_staff_case_events_api_auth.sql', 'utf8')
const forward = fs.readFileSync('supabase/migrations/20261005101527_staff_independent_onboarding_authority.sql', 'utf8')
const after = forward.slice(forward.indexOf('DO $auth_provenance$'))
const company = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', client = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const endpoint = '/api/v1/staff-onboarding/invitations/accept'

async function fixture() {
  const db = new PGlite()
  await db.exec(buildStaffIntegrationAuthFixture(root))
  await db.exec(before)
  await db.exec(`INSERT INTO companies(id,name,status,is_active) VALUES('${company}','Synthetic support','active',true);
INSERT INTO integration_api_clients(id,company_id,name,key_prefix,secret_hash,scopes,status,allowed_origins)
VALUES('${client}','${company}','Synthetic staff-only key','support-test','synthetic-hash',ARRAY['staff_users.write'],'active',ARRAY['https://support123.gridex.se']);`)
  return db
}
const auth = (db: PGlite, route: string, scope = 'staff_users.write', secret = 'synthetic-hash') => db.query<{ auth_outcome: string; error_code: string }>(
  'SELECT auth_outcome,error_code FROM public.authenticate_integration_request_v1($1,$2,$3,ARRAY[$4]::text[])', ['support-test', secret, route, scope])

describe('actual independent onboarding machine auth SQL', () => {
  it('proves the exact new namespace was incorrectly held behind Website launch requirements before this forward', async () => {
    const db = await fixture()
    try {
      expect((await auth(db, endpoint)).rows[0]).toMatchObject({ auth_outcome: 'denied', error_code: 'api_client_not_launch_ready' })
      expect((await auth(db, '/api/v1/staff/users')).rows[0].auth_outcome).toBe('allowed')
    } finally { await db.close() }
  }, 20_000)
  it('uses exact-route staff scope opt-in without Website receipts and retains unknown route/scope/credential rejection', async () => {
    const db = await fixture()
    try {
      await db.exec(after)
      expect((await auth(db, endpoint)).rows[0].auth_outcome).toBe('allowed')
      expect((await auth(db, '/api/v1/staff-onboarding/unknown')).rows[0]).toMatchObject({ auth_outcome: 'denied', error_code: 'api_scope_missing' })
      expect((await auth(db, endpoint, 'staff_users.read')).rows[0].auth_outcome).toBe('denied')
      expect((await auth(db, endpoint, 'staff_users.write', 'wrong-secret')).rows[0].auth_outcome).toBe('denied')
      expect((await auth(db, '/api/v1/website/products')).rows[0]).toMatchObject({ auth_outcome: 'denied', error_code: 'api_client_not_launch_ready' })
    } finally { await db.close() }
  }, 20_000)
  it('fails the forward before overwriting an unexpected current machine authorization definition', async () => {
    const db = await fixture()
    try {
      await db.exec(`DO $$DECLARE d text; BEGIN SELECT pg_get_functiondef('public.authenticate_integration_request_v1(text,text,text,text[],text[],text,text,integer,integer)'::regprocedure) INTO d; EXECUTE replace(d,'with staff_policy as (','with staff_policy as ( -- unexpected source'); END $$;`)
      await expect(db.exec(after)).rejects.toThrow('staff_onboarding_auth_source_mismatch')
    } finally { await db.close() }
  }, 20_000)
})
