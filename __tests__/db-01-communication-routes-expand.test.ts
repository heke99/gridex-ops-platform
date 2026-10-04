// masterplan: DB-01
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const schema = readFileSync('supabase/schema.sql', 'utf8')
const migration = readFileSync('supabase/migrations/20261004180000_db01_communication_routes_expand.sql', 'utf8')
  .replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '')
const extract = (start: string, end: string) => {
  const first = schema.indexOf(start)
  const last = schema.indexOf(end, first)
  if (first < 0 || last < 0) throw new Error(`Missing captured SQL: ${start}`)
  return schema.slice(first, last + end.length)
}
const company = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const tenantUser = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const adminUser = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const added = ['market_actor_id', 'ediel_party_id', 'message_type', 'business_code', 'subaddress', 'requires_subaddress',
  'qualifier', 'interchange_party_id', 'transport_security_mode', 'receiver_certificate_id', 'verification_status',
  'valid_from', 'valid_to', 'source_table', 'source_row_id']
let db: PGlite

const asUser = async <T>(user: string, sql: string) => {
  await db.exec(`SELECT set_config('test.uid','${user}',false); SET ROLE authenticated;`)
  try { return (await db.query<T>(sql)).rows } finally { await db.exec(`RESET ROLE; SELECT set_config('test.uid','',false);`) }
}

beforeAll(async () => {
  db = new PGlite()
  // Helper predicates are stubs keyed on a session GUC; the table, trigger,
  // captured RLS policies and the forward migration are the real artifacts.
  await db.exec(`CREATE ROLE authenticated; CREATE TYPE public.ediel_environment_type AS ENUM ('test','production','agt');
    CREATE TABLE public.platform_market_actors(id uuid PRIMARY KEY); CREATE TABLE public.ediel_parties(id uuid PRIMARY KEY);
    CREATE TABLE public.ediel_certificates(id uuid PRIMARY KEY);
    CREATE FUNCTION public.gridex_user_is_platform_admin() RETURNS boolean LANGUAGE sql STABLE AS $$SELECT current_setting('test.uid',true)='${adminUser}'$$;
    CREATE FUNCTION public.gridex_is_current_session_allowed() RETURNS boolean LANGUAGE sql STABLE AS $$SELECT true$$;
    CREATE FUNCTION public.gridex_user_company_ids() RETURNS SETOF uuid LANGUAGE sql STABLE AS $$SELECT '${company}'::uuid WHERE current_setting('test.uid',true)='${tenantUser}'$$;
    CREATE FUNCTION public.gridex_can_read_company(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT $1 IN (SELECT public.gridex_user_company_ids())$$;
    CREATE FUNCTION public.gridex_can_write_company(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT $1 IN (SELECT public.gridex_user_company_ids())$$;`)
  await db.exec(extract('CREATE TABLE public.communication_routes (', '\n);'))
  await db.exec('ALTER TABLE public.communication_routes ADD PRIMARY KEY (id)')
  await db.exec(extract('CREATE FUNCTION public.gridex_require_tenant_owned_ediel_route()', 'end; $$;'))
  await db.exec(extract('CREATE TRIGGER communication_routes_tenant_owned_ediel_trg', ';'))
  const policies = schema.match(/^CREATE POLICY [^\n]* ON public\.communication_routes [^\n]*;$/gm) ?? []
  expect(policies.length).toBe(7)
  await db.exec(`ALTER TABLE public.communication_routes ENABLE ROW LEVEL SECURITY;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.communication_routes TO authenticated; ${policies.join('\n')}`)
  // Pre-existing row inserted before the migration.
  await db.exec(`INSERT INTO public.communication_routes(company_id, route_name, route_scope) VALUES ('${company}', 'legacy', 'supplier_switch')`)
  await db.exec(migration)
}, 180_000)
afterAll(async () => { await db?.close() })

describe('DB-01 PR1 expand: communication_routes', () => {
  it('adds every expand column as nullable', async () => {
    const rows = (await db.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='communication_routes'`)).rows
    for (const column of added) expect(rows.find((r) => r.column_name === column)?.is_nullable, column).toBe('YES')
  })

  it('keeps existing rows and legacy-shaped inserts working unchanged', async () => {
    await db.exec(`INSERT INTO public.communication_routes(company_id, route_name, route_scope, environment_type)
      VALUES ('${company}', 'legacy-ack', 'ediel_ack', 'test')`)
    const rows = (await db.query<{ n: number }>(`SELECT count(*)::int n FROM public.communication_routes WHERE company_id='${company}' AND source_table IS NULL`)).rows
    expect(rows[0].n).toBe(2)
    await expect(db.exec(`INSERT INTO public.communication_routes(company_id, route_name, route_scope) VALUES ('${company}', 'bad', 'unknown_scope')`)).rejects.toThrow(/route_scope_check/)
  })

  it('never shows a company_id NULL platform route to a tenant role, only to platform admin', async () => {
    await db.exec(`INSERT INTO public.communication_routes(company_id, route_name, route_scope, route_type, is_active, verification_status, source_table, source_row_id)
      VALUES (NULL, 'platform', 'platform_actor', 'platform_registry', true, 'needs_review', 'platform_actor_routes', gen_random_uuid())`)
    const tenantRows = await asUser<{ route_name: string }>(tenantUser, 'SELECT route_name FROM public.communication_routes ORDER BY route_name')
    expect(tenantRows.map((r) => r.route_name)).toEqual(['legacy', 'legacy-ack'])
    expect(await asUser(tenantUser, 'SELECT 1 FROM public.communication_routes WHERE company_id IS NULL')).toHaveLength(0)
    await asUser(tenantUser, `UPDATE public.communication_routes SET notes='x' WHERE company_id IS NULL`)
    expect((await db.query<{ notes: string | null }>('SELECT notes FROM public.communication_routes WHERE company_id IS NULL')).rows[0].notes).toBeNull()
    await expect(asUser(tenantUser, `INSERT INTO public.communication_routes(company_id, route_name, route_scope, route_type) VALUES (NULL, 'tenant-forged', 'platform_actor', 'platform_registry')`)).rejects.toThrow(/row-level security/)
    const adminRows = await asUser<{ route_name: string }>(adminUser, 'SELECT route_name FROM public.communication_routes WHERE company_id IS NULL')
    expect(adminRows.map((r) => r.route_name)).toEqual(['platform'])
  })

  it('rejects a duplicate (source_table, source_row_id) link with 23505', async () => {
    const source = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    const insert = `INSERT INTO public.communication_routes(company_id, route_name, route_scope, route_type, source_table, source_row_id)
      VALUES (NULL, 'link', 'platform_actor', 'platform_registry', 'ediel_party_addresses', '${source}')`
    await db.exec(insert)
    await expect(db.exec(insert)).rejects.toMatchObject({ code: '23505' })
    // Unlinked rows (source_row_id NULL) are not constrained by the link index.
    await db.exec(`INSERT INTO public.communication_routes(company_id, route_name, route_scope, source_table) VALUES ('${company}', 'u1', 'supplier_switch', 'ediel_party_addresses'), ('${company}', 'u2', 'supplier_switch', 'ediel_party_addresses')`)
  })

  it('constrains the new enumerations', async () => {
    await expect(db.exec(`INSERT INTO public.communication_routes(company_id, route_name, verification_status) VALUES ('${company}', 'v', 'bogus')`)).rejects.toThrow(/verification_status_chk/)
    await expect(db.exec(`INSERT INTO public.communication_routes(company_id, route_name, transport_security_mode) VALUES ('${company}', 't', 'bogus')`)).rejects.toThrow(/transport_security_mode_chk/)
  })
})
