import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { createState, cleanupSql } = require('../scripts/staff-api-synthetic-e2e.cjs')
const { buildStaffIntegrationAuthFixture } = require('../scripts/lib/staff-api-integration-auth-fixture.cjs')
const root = resolve(import.meta.dirname, '..')
const schema = readFileSync(resolve(root, 'supabase/schema.sql'), 'utf8')
const bootstrap = readFileSync(resolve(root, 'scripts/sql/gridex-supabase-compatible-bootstrap.sql'), 'utf8')
const invitationAccountMigration = readFileSync(resolve(root, 'supabase/migrations/20260519_company_invite_temp_password_sync.sql'), 'utf8')
const literal = (value: unknown) => `'${String(value).replaceAll("'", "''")}'`
function table(name: string): string {
  const match = new RegExp(`CREATE TABLE public\\.${name} \\([\\s\\S]+?\\n\\);`).exec(schema)
  if (!match) throw new Error(`Missing source fixture table ${name}`)
  return match[0]
}
const auth = /create table if not exists auth\.users \([\s\S]+?\n\);/.exec(bootstrap)?.[0]
const guard = /CREATE FUNCTION public\.guard_last_functioning_tenant_admin\(\)[\s\S]+?AS (\$\w*\$)[\s\S]+?\1;/.exec(schema)?.[0]
const accountColumns = ['company_memberships', 'company_invitations'].map(name => {
  // The old schema snapshot declarations precede these already-applied columns.
  const statement = new RegExp(`alter table if exists public\\.${name}\\n  add column[\\s\\S]+?;`).exec(invitationAccountMigration)?.[0]
  if (!statement) throw new Error(`Missing historical ${name} account columns`)
  return statement
})

// The actual committed native guard has the same source hash observed in the
// live catalog. PGlite is a focused diagnostic, never native production proof.
it('revokes synthetic access without removing the last functioning administrator while preserving the native guard', async () => {
  if (!auth || !guard) throw new Error('Missing authentic native account guard fixture')
  const s = createState()
  const sql = cleanupSql(s)
  const db = new PGlite()
  try {
    await db.exec(buildStaffIntegrationAuthFixture(root))
    await db.exec(['CREATE SCHEMA auth;', auth,
      ...['user_profiles', 'company_memberships', 'user_roles', 'user_permissions', 'company_invitations', 'tenant_customer_identity_providers'].map(table),
      ...accountColumns,
      "ALTER TABLE public.tenant_customer_identity_providers ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'customer';",
      guard,
      'CREATE CONSTRAINT TRIGGER company_memberships_last_functioning_admin_guard AFTER DELETE OR UPDATE ON public.company_memberships DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION public.guard_last_functioning_tenant_admin();',
    ].join('\n'))
    const sourceHash = await db.query<{ hash: string }>("SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') hash FROM pg_proc WHERE oid='public.guard_last_functioning_tenant_admin()'::regprocedure")
    expect(sourceHash.rows[0].hash).toBe('7d4f481101fc475ac079763566f03bc04c6520ceeb9c68456d5bba6dcbc09ede')
    for (const [company, actor] of [[s.companyA, s.users.admin], [s.companyB, s.users.foreign]]) {
      const email = `staff-e2e-${s.runId}-${actor === s.users.admin ? 'admin' : 'foreign'}@example.invalid`
      await db.exec(`
        INSERT INTO public.companies(id,name,status,metadata) VALUES(${literal(company)},'Synthetic cleanup fixture','active',${literal(JSON.stringify({ run_id: s.runId, synthetic_staff_api_e2e: true }))});
        INSERT INTO auth.users(id,email,email_confirmed_at,raw_app_meta_data) VALUES(${literal(actor)},${literal(email)},now(),${literal(JSON.stringify({ run_id: s.runId }))});
        INSERT INTO public.user_profiles(id,email,user_status) VALUES(${literal(actor)},${literal(email)},'active');
        INSERT INTO public.company_memberships(company_id,user_id,membership_role,role_key,status,is_active,accepted_at) VALUES(${literal(company)},${literal(actor)},'company_admin','company_admin','active',true,now());
        INSERT INTO public.user_roles(company_id,user_id,role,status,is_active) VALUES(${literal(company)},${literal(actor)},'company_admin','active',true);
      `)
    }
    await db.exec(`INSERT INTO public.tenant_customer_identity_providers(id,company_id,purpose,kind,display_name,issuer,audience,public_jwk,enforcement) VALUES(${literal(s.provider)},${literal(s.companyA)},'staff','tenant_key','Synthetic cleanup fixture',${literal(s.issuer)},${literal(s.audience)},${literal(JSON.stringify(s.publicJwk))},'enforce');`)
    for (const key of Object.values(s.keys) as Array<{ id: string; prefix: string }>) {
      await db.exec(`INSERT INTO public.integration_api_clients(id,company_id,name,key_prefix,secret_hash,metadata) VALUES(${literal(key.id)},${literal(s.companyA)},'Synthetic cleanup fixture',${literal(key.prefix)},${literal('a'.repeat(64))},${literal(JSON.stringify({ run_id: s.runId }))});`)
    }
    // Fixture inserts produce eligible confirmed administrators. Attempting to
    // deactivate them directly still fails with the original native rule.
    await expect(db.exec(`UPDATE public.company_memberships SET status='disabled',is_active=false WHERE company_id=${literal(s.companyA)};`)).rejects.toThrow('last_functioning_admin_cannot_be_removed_or_downgraded')
    const accountRevocation = /UPDATE public\.user_profiles[\s\S]+?;\nUPDATE auth\.users[\s\S]+?;\n/.exec(sql)?.[0]
    if (!accountRevocation) throw new Error('Missing exact account revocation statements')
    const oldOrder = sql.replace(accountRevocation, '').replace('UPDATE public.user_roles', `${accountRevocation}UPDATE public.user_roles`)
    await expect(db.exec(oldOrder)).rejects.toThrow('last_functioning_admin_cannot_be_removed_or_downgraded')
    await db.exec('ROLLBACK;')
    expect((await db.query<{ count: number }>("SELECT count(*)::integer count FROM public.integration_api_clients WHERE revoked_at IS NULL")).rows[0].count).toBe(3)
    expect((await db.query<{ count: number }>('SELECT count(*)::integer count FROM public.tenant_customer_identity_providers WHERE is_active')).rows[0].count).toBe(1)
    await expect(db.exec(sql)).resolves.toBeDefined()
    expect(sql.indexOf('UPDATE public.user_profiles')).toBeLessThan(sql.indexOf('UPDATE public.company_memberships'))
    expect(sql.indexOf('UPDATE auth.users')).toBeLessThan(sql.indexOf('UPDATE public.company_memberships'))
    expect((await db.query<{ count: number }>('SELECT count(*)::integer count FROM public.company_memberships WHERE is_active')).rows[0].count).toBe(0)
    expect((await db.query<{ count: number }>("SELECT count(*)::integer count FROM public.integration_api_clients WHERE status='revoked' AND revoked_at IS NOT NULL")).rows[0].count).toBe(3)
    expect((await db.query<{ count: number }>('SELECT count(*)::integer count FROM public.tenant_customer_identity_providers WHERE is_active')).rows[0].count).toBe(0)
    expect((await db.query<{ count: number }>('SELECT count(*)::integer count FROM auth.users WHERE banned_until>now()')).rows[0].count).toBe(2)
    expect((await db.query<{ enabled: string }>("SELECT tgenabled enabled FROM pg_trigger WHERE tgname='company_memberships_last_functioning_admin_guard'")).rows[0].enabled).toBe('O')
  } finally { await db.close() }
}, 20_000)
