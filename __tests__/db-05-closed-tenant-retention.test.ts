// masterplan: DB-05, AT-DB-05, SC-070
// DB-05 on_failure "spara inte allt för alltid utan rättslig grund": after the canonical tenant close
// (canonical_transition_tenant_lifecycle -> status 'closed') an own-company retention actor must still be
// able to run the decided per-class workflow. Before 20261008160000 the three retention gates only admitted
// active/archived/pending_deletion, so a closed tenant's personal data could never be lawfully purged.
// Real schema snapshot (supabase/schema.sql) in PGlite plus the forward; not native PostgreSQL.
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const http = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: http.getUser }, rpc: http.rpc }) }))
import { requireRetentionCompanies } from '@/lib/ediel/retention/retentionHttp'

const CLOSED = '11111111-1111-1111-1111-111111111111'
const OTHER = '22222222-2222-2222-2222-222222222222'
const DISPOSABLE = '33333333-3333-3333-3333-333333333333'
const ACTOR = '44444444-4444-4444-4444-444444444444'
const OUTSIDER = '55555555-5555-5555-5555-555555555555'
const DENIED = '66666666-6666-6666-6666-666666666666'
const FORWARD = 'supabase/migrations/20261008160000_db05_closed_tenant_retention_scope.sql'
const GATES = [
  'gridex_ediel_retention.permission_v1(uuid,uuid,text)',
  'gridex_ediel_retention.record_permission_v1(uuid,uuid,text)',
  'public.ediel_current_retention_companies_v1()',
]
let db: PGlite
const before = new Map<string, string>()
let closedBefore: { grant: boolean; read: boolean; listed: string[] }

const one = async <T>(sql: string) => (await db.query(sql)).rows[0] as T
const prosrc = async (sig: string) => (await one<{ s: string }>(`select prosrc s from pg_proc where oid='${sig}'::regprocedure`)).s
const grant = (company: string, actor: string, key: string) =>
  one<{ ok: boolean }>(`select gridex_ediel_retention.permission_v1('${company}','${actor}','${key}') ok`).then((r) => r.ok)
const readScope = (company: string, actor: string) =>
  one<{ ok: boolean }>(`select gridex_ediel_retention.record_permission_v1('${company}','${actor}','__read_scope__') ok`).then((r) => r.ok)
const listedFor = async (actor: string) => {
  await db.exec(`select set_config('request.jwt.claim.sub','${actor}',false)`)
  return (await one<{ r: Array<{ companyId: string; status: string }> }>('select public.ediel_current_retention_companies_v1() r')).r
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create role supabase_admin; create role authenticator;
    create schema if not exists auth; create table auth.users(id uuid primary key, deleted_at timestamptz, banned_until timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create schema if not exists extensions; create schema if not exists storage;`)
  for (const e of ['pgcrypto', 'btree_gist', 'citext', 'pg_trgm', 'uuid-ossp']) { try { await db.exec(`create extension if not exists "${e}"`) } catch { /* not bundled */ } }
  await db.exec(`create or replace function extensions.gen_random_uuid() returns uuid language sql as 'select pg_catalog.gen_random_uuid()';
    create or replace function extensions.digest(bytea,text) returns bytea language sql immutable as 'select pg_catalog.sha256($1)';
    create or replace function extensions.digest(text,text) returns bytea language sql immutable as 'select pg_catalog.sha256(convert_to($1,''UTF8''))';`)
  const src = readFileSync('supabase/schema.sql', 'utf8').replace(/^\\(un)?restrict.*$/gm, '').replace(/^CREATE SCHEMA public;$/m, '').replace(/extensions\.geometry\([^)]*\)/g, 'bytea')
  for (const chunk of src.split(/\n(?=--\n-- Name: )/)) { try { await db.exec(chunk) } catch { /* PostGIS/extension objects */ } }
  for (const sig of GATES) before.set(sig, await prosrc(sig))
  for (const t of ['companies', 'company_memberships', 'user_profiles', 'permissions', 'user_permissions']) await db.exec(`alter table public.${t} disable trigger user`)
  await db.exec(`insert into public.companies(id,name,status) values ('${CLOSED}','Synthetic closed','closed'),('${OTHER}','Synthetic other','active'),('${DISPOSABLE}','Synthetic disposable','deleted_test_only');
    insert into auth.users(id) values ('${ACTOR}'),('${OUTSIDER}'),('${DENIED}');
    insert into public.user_profiles(id,user_status) values ('${ACTOR}','active'),('${OUTSIDER}','active'),('${DENIED}','active');
    insert into public.company_memberships(company_id,user_id,status,is_active,accepted_at) values
      ('${CLOSED}','${ACTOR}','active',true,now()),('${DISPOSABLE}','${ACTOR}','active',true,now()),('${OTHER}','${OUTSIDER}','active',true,now()),('${CLOSED}','${DENIED}','active',true,now());
    insert into public.permissions(key,name,category,is_active) values ('ediel.retention.customer_fields','Retention customer fields','ediel',true),('ediel.retention.read','Retention read','ediel',true)
      on conflict (key) do nothing;
    insert into public.user_permissions(user_id,company_id,permission_key,effect,status,is_active)
      select u, c, k, 'allow', 'active', true from (values ('${ACTOR}'::uuid,'${CLOSED}'::uuid),('${ACTOR}','${DISPOSABLE}'),('${OUTSIDER}','${CLOSED}'),('${DENIED}','${CLOSED}')) g(u,c)
      cross join (values ('ediel.retention.customer_fields'),('ediel.retention.read')) p(k);
    insert into public.user_permissions(user_id,company_id,permission_key,effect,status,is_active) values ('${DENIED}','${CLOSED}','ediel.retention.customer_fields','deny','active',true);`)
  closedBefore = { grant: await grant(CLOSED, ACTOR, 'ediel.retention.customer_fields'), read: await readScope(CLOSED, ACTOR), listed: (await listedFor(ACTOR)).map((r) => r.companyId) }
  await db.exec(readFileSync(FORWARD, 'utf8'))
}, 280_000)

describe('DB-05 closed tenant keeps a lawful per-class retention path', () => {
  it('admits the own-company class actor on a canonically closed tenant', async () => {
    expect(await grant(CLOSED, ACTOR, 'ediel.retention.customer_fields')).toBe(true)
    expect(await readScope(CLOSED, ACTOR)).toBe(true)
  })

  it('lists the closed tenant in the actor’s retention workspace with its real status', async () => {
    expect(await listedFor(ACTOR)).toContainEqual(expect.objectContaining({ companyId: CLOSED, status: 'closed' }))
  })

  it('still refuses a disposable deleted_test_only tenant', async () => {
    expect(await grant(DISPOSABLE, ACTOR, 'ediel.retention.customer_fields')).toBe(false)
    expect(await readScope(DISPOSABLE, ACTOR)).toBe(false)
    expect((await listedFor(ACTOR)).map((r) => r.companyId)).not.toContain(DISPOSABLE)
  })

  it('refuses a wrong-tenant actor even with a grant row naming the closed company', async () => {
    expect(await grant(CLOSED, OUTSIDER, 'ediel.retention.customer_fields')).toBe(false)
    expect(await readScope(CLOSED, OUTSIDER)).toBe(false)
    expect((await listedFor(OUTSIDER)).map((r) => r.companyId)).not.toContain(CLOSED)
  })

  it('keeps an explicit deny effective on the closed tenant', async () => {
    expect(await grant(CLOSED, DENIED, 'ediel.retention.customer_fields')).toBe(false)
  })

  it('was refused on the installed schema before the forward (the defect this fixes)', () => {
    expect(closedBefore).toEqual({ grant: false, read: false, listed: [] })
  })

  it('changes only the tenant-status admission list in each gate', async () => {
    for (const sig of GATES) {
      const old = before.get(sig)!
      expect(old).toMatch(/status IN\('active','archived','pending_deletion'\)/)
      expect(await prosrc(sig)).toBe(old.replace("status IN('active','archived','pending_deletion')", "status IN('active','archived','pending_deletion','closed')"))
    }
  })
})

describe('DB-05 retention workspace HTTP consumer', () => {
  const row = (status: string) => ({ companyId: CLOSED, name: 'Synthetic closed', status, permissions: ['ediel.retention.read'] })
  it('accepts the closed tenant the native list now returns, instead of failing the whole workspace', async () => {
    http.getUser.mockResolvedValue({ data: { user: { id: ACTOR } }, error: null })
    http.rpc.mockResolvedValue({ data: [row('closed')], error: null })
    expect((await requireRetentionCompanies()).companies).toEqual([row('closed')])
  })
  it('still rejects a status the native gates never admit', async () => {
    http.getUser.mockResolvedValue({ data: { user: { id: ACTOR } }, error: null })
    http.rpc.mockResolvedValue({ data: [row('deleted_test_only')], error: null })
    await expect(requireRetentionCompanies()).rejects.toBeDefined()
  })
})
