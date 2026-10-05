import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')
const { buildStaffExternalIdentityFixture } = createRequire(import.meta.url)('../scripts/lib/staff-external-identity-sql-fixture.cjs') as { buildStaffExternalIdentityFixture(root: string): string }
const forwardPath = 'supabase/migrations/20261005124901_tenant_staff_external_identity_bindings.sql'
const nativeRegression = () => fs.readFileSync('scripts/staff-external-identity-binding-regression.sql', 'utf8').replace(/^\\set.*$/gm, '')
  .replace(/^\\ir sql\/staff-native-role-catalog-fixture.sql$/m, fs.readFileSync('scripts/sql/staff-native-role-catalog-fixture.sql', 'utf8'))

it('executes external delivery, distinct tenant/central identities, canonical acceptance, fail-closed lifecycle, and no-login anchor guards', async () => {
  const db = new PGlite()
  try {
    await db.exec(buildStaffExternalIdentityFixture(root))
    await db.exec(fs.readFileSync(forwardPath, 'utf8'))
    await expect(db.exec(nativeRegression())).resolves.toBeDefined()
  } finally { await db.close() }
}, 30_000)

it('installs actual no-login guards as a nonsuper migration receiver with distinct managed Auth ownership and preserves Auth ACL/role state', async () => {
  const db = new PGlite()
  const catalog = () => db.query<{ state: unknown }>(`SELECT jsonb_build_object(
    'schema',(SELECT to_jsonb(n) FROM pg_namespace n WHERE nspname='auth'),
    'tables',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'owner',c.relowner,'acl',c.relacl) ORDER BY c.relname) FROM pg_class c WHERE c.relnamespace='auth'::regnamespace),
    'members',(SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member) FROM pg_auth_members m),
    'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY oid) FROM pg_roles r)) state`)
  try {
    await db.exec(buildStaffExternalIdentityFixture(root))
    await db.exec(`CREATE ROLE staff_migration_receiver NOLOGIN NOSUPERUSER CREATEROLE BYPASSRLS;
      CREATE ROLE supabase_auth_admin NOLOGIN NOSUPERUSER;
      ALTER SCHEMA auth OWNER TO supabase_auth_admin;
      ALTER SCHEMA public OWNER TO staff_migration_receiver;
      DO $$ DECLARE item record; BEGIN
        FOR item IN SELECT c.oid::regclass name FROM pg_class c WHERE c.relnamespace='auth'::regnamespace AND c.relkind IN('r','S') LOOP
          EXECUTE format('ALTER %s %s OWNER TO supabase_auth_admin',CASE WHEN (SELECT relkind FROM pg_class WHERE oid=item.name)='S' THEN 'SEQUENCE' ELSE 'TABLE' END,item.name);
        END LOOP;
        FOR item IN SELECT c.oid::regclass name FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='r' LOOP EXECUTE format('ALTER TABLE %s OWNER TO staff_migration_receiver',item.name); END LOOP;
        FOR item IN SELECT p.oid::regprocedure name FROM pg_proc p WHERE p.pronamespace='public'::regnamespace LOOP EXECUTE format('ALTER FUNCTION %s OWNER TO staff_migration_receiver',item.name); END LOOP;
      END $$;
      -- Existing receiver privileges are fixture input, never migration grants.
      GRANT USAGE ON SCHEMA auth,extensions TO staff_migration_receiver;
      GRANT SELECT,INSERT,UPDATE,REFERENCES,TRIGGER ON ALL TABLES IN SCHEMA auth TO staff_migration_receiver;
      GRANT USAGE ON ALL SEQUENCES IN SCHEMA auth TO staff_migration_receiver;
      GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO staff_migration_receiver;
      SET ROLE staff_migration_receiver;`)
    const before = (await catalog()).rows
    expect((await db.query<{ super: boolean; triggers: boolean }>(`SELECT rolsuper super,
      has_table_privilege(current_user,'auth.users','TRIGGER') AND has_table_privilege(current_user,'auth.sessions','TRIGGER') triggers
      FROM pg_roles WHERE rolname=current_user`)).rows[0]).toEqual({ super: false, triggers: true })
    await db.exec(fs.readFileSync(forwardPath, 'utf8'))
    expect((await catalog()).rows).toEqual(before)
    expect((await db.query<{ count: number }>(`SELECT count(*)::int count FROM pg_trigger WHERE NOT tgisinternal AND tgname IN('staff_anchor_no_login','staff_anchor_no_session','staff_anchor_no_refresh','staff_anchor_no_identity')`)).rows[0].count).toBe(4)
    await expect(db.exec(nativeRegression())).resolves.toBeDefined()
  } finally { await db.close() }
}, 30_000)

it('retains every legacy function metadata/ACL field and changes only the declared canonical email and two guard statements', async () => {
  const db = new PGlite()
  const functions = ['canonical_accept_tenant_invitation', 'gridex_staff_assert_write_actor_v1', 'gridex_assert_staff_command_v1', 'authenticate_integration_request_v1']
  const capture = () => db.query<{ proname: string; body: string; metadata: unknown }>(
    "SELECT proname,prosrc body,to_jsonb(p)-'prosrc' metadata FROM pg_proc p WHERE pronamespace='public'::regnamespace AND proname=ANY($1::text[]) ORDER BY proname", [functions])
  try {
    await db.exec(buildStaffExternalIdentityFixture(root))
    const before = (await capture()).rows
    await db.exec(fs.readFileSync(forwardPath, 'utf8'))
    const after = (await capture()).rows
    expect(after.map(row => [row.proname, row.metadata])).toEqual(before.map(row => [row.proname, row.metadata]))
    const restored = after.map(row => ({ ...row, body: row.body
      .replace('select coalesce(lower(u.email),public.gridex_staff_anchor_invitation_email_v1(v_invitation.id,v_invitation.company_id,u.id)),', 'select lower(u.email),')
      .replace('  PERFORM public.gridex_staff_assert_external_actor_v1(p_company_id,p_actor_user_id,p_api_client_id);\n', '')
      .replace('    PERFORM public.gridex_staff_assert_external_actor_v1(v_company_id,v_actor_user_id,v_client_id);\n', '')
      .replace("\n        when p_route='/api/v1/staff-onboarding/identity/resolve' then array['staff_users.read']::text[]", '') }))
    expect(restored).toEqual(before)
  } finally { await db.close() }
}, 30_000)

for (const [signature, error] of [
  ['canonical_accept_tenant_invitation(jsonb)', 'staff_external_canonical_predecessor_mismatch'],
  ['gridex_staff_assert_write_actor_v1(uuid,uuid,uuid,text)', 'staff_external_write_guard_predecessor_mismatch'],
  ['gridex_assert_staff_command_v1(jsonb,boolean)', 'staff_external_write_guard_predecessor_mismatch'],
  ['authenticate_integration_request_v1(text,text,text,text[],text[],text,text,integer,integer)', 'staff_identity_auth_source_mismatch'],
] as const) {
  it(`refuses an unexpected ${signature} body atomically before deploying the new authority`, async () => {
    const db = new PGlite()
    try {
      await db.exec(buildStaffExternalIdentityFixture(root))
      await db.exec(`DO $$ DECLARE d text; b text; BEGIN SELECT pg_get_functiondef($1::regprocedure),prosrc INTO d,b FROM pg_proc WHERE oid=$1::regprocedure; EXECUTE replace(d,b,chr(10)||b); END $$;`.replaceAll('$1', `'public.${signature}'`))
      const before = (await db.query("SELECT to_jsonb(p) metadata FROM pg_proc p WHERE oid=$1::regprocedure", [`public.${signature}`])).rows
      await expect(db.exec(`BEGIN;\n${fs.readFileSync(forwardPath, 'utf8')}\nCOMMIT;`)).rejects.toThrow(error)
      await db.exec('ROLLBACK')
      expect((await db.query("SELECT to_jsonb(p) metadata FROM pg_proc p WHERE oid=$1::regprocedure", [`public.${signature}`])).rows).toEqual(before)
      expect((await db.query<{ relation: string | null }>("SELECT to_regclass('public.tenant_staff_identity_bindings') relation")).rows[0].relation).toBeNull()
    } finally { await db.close() }
  }, 30_000)
}
