// Real historical scoped context + whole 2030 forward + whole new projection
// forward -> actual Admin API guard. Only auth/cookie transport and the unrelated
// lifecycle decision are finite ports. No live/native/RLS or route-201 credit.
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { requireAdminApiAccess } from '@/lib/admin/apiGuards'

const io = vi.hoisted(() => ({ server: vi.fn(), cookie: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: io.server }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: io.cookie }) }))
vi.mock('@/lib/tenant/scope', () => ({
  assertUserCanOperateCompany: () => { throw new Error('undeclared operational-company port') },
  assertTenantUserCanReadCompany: () => { throw new Error('undeclared history-company port') },
  requireOperationalCompanyId: () => { throw new Error('undeclared fallback-company port') },
}))

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const own = { actor: id(1), company: id(2), foreign: id(3), role: id(4), read: id(5), write: id(6) }
const currentPath = 'supabase/migrations/20261014004020_admin_api_current_context_projection.sql'
const migration = () => readFileSync(currentPath, 'utf8')
const prior = readFileSync('supabase/migrations/20261013023000_admin_context_current_permission_deny.sql', 'utf8')
const historical = readFileSync('supabase/migrations/20260810193450_canonical_access_provisioning_runtime_v1.sql', 'utf8')
const remediation = readFileSync('supabase/migrations/20260810224500_canonical_review_remediation_v1.sql', 'utf8')
const scopedEngine = readFileSync('supabase/migrations/20260902091000_company_scoped_permission_engine.sql', 'utf8')
const schema = readFileSync('supabase/schema.sql', 'utf8')
const signature = 'public.canonical_authenticated_tenant_context_v1_scoped(uuid)'
const wrapper = 'public.canonical_authenticated_tenant_context(uuid)'

function definition(sql: string, name: string) {
  const start = new RegExp(`create(?: or replace)? function public\\.${name}\\(`, 'i').exec(sql)?.index
  if (start === undefined) throw new Error(`actual SQL function missing: ${name}`)
  const block = sql.slice(start)
  const delimiter = /\bas\s+(\$[^$]*\$)/i.exec(block)
  if (!delimiter) throw new Error(`actual SQL body missing: ${name}`)
  const end = block.indexOf(`${delimiter[1]};`, delimiter.index + delimiter[0].length)
  if (end < 0) throw new Error(`actual SQL body unterminated: ${name}`)
  return block.slice(0, end + delimiter[1].length + 1)
}

let db: PGlite
let beforePrivate: Record<string, unknown>
let beforeWrapper: Record<string, unknown>
let selected: string | null
let sdkError: boolean

async function metadata(target: string) {
  return (await db.query<Record<string, unknown>>(`select to_jsonb(p)-'prosrc'-'provolatile' attributes,
    md5(p.prosrc) source_md5, p.provolatile volatility, obj_description(p.oid,'pg_proc') comment,
    (select coalesce(jsonb_agg(to_jsonb(d) order by d.refclassid,d.refobjid,d.refobjsubid,d.deptype),'[]'::jsonb)
      from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid) dependencies
    from pg_proc p where p.oid=$1::regprocedure`, [target])).rows[0]
}

async function context(company: string | null = selected) {
  return (await db.query<{ context: Record<string, unknown> }>(
    'select public.canonical_authenticated_tenant_context($1::uuid) context', [company],
  )).rows[0].context
}

async function directDeny(company: string | null, options: { byId?: boolean; active?: boolean; status?: string; actor?: string; effect?: string } = {}) {
  await db.query('insert into public.user_permissions values ($1,$2,$3,$4,$5,$6,$7)',
    [options.actor ?? own.actor, company, options.byId ? own.write : null,
      options.byId ? '' : 'billing_underlay.export', options.active ?? true, options.status ?? 'active', options.effect ?? 'deny'])
}

async function overrideDeny(company: string | null, options: { active?: boolean; from?: string; to?: string } = {}) {
  await db.query("insert into public.user_permission_overrides values ($1,$2,'billing_underlay.export','deny',$3,$4::timestamptz,$5::timestamptz)",
    [own.actor, company, options.active ?? true, options.from ?? null, options.to ?? null])
}

async function expectDenied(status = 403) {
  const result = await requireAdminApiAccess(['billing_underlay.export'])
  expect(result.guard).toBeUndefined()
  expect(result.response?.status).toBe(status)
  expect(await result.response?.json()).toEqual({ error: status === 503 ? 'Kunde inte verifiera behörighet' : 'Saknar behörighet' })
}

async function expectMigrationRefusal(change: string) {
  await db.exec(change)
  const privateState = await metadata(signature), wrapperState = await metadata(wrapper)
  await db.exec('savepoint refused_forward')
  await expect(db.exec(migration())).rejects.toMatchObject({ code: '55000' })
  await db.exec('rollback to savepoint refused_forward; release savepoint refused_forward')
  expect(await metadata(signature)).toEqual(privateState)
  expect(await metadata(wrapper)).toEqual(wrapperState)
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create schema auth; create role anon; create role authenticated; create role service_role;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table auth.users(id uuid primary key,email varchar(255),deleted_at timestamptz,banned_until timestamptz,email_confirmed_at timestamptz);
    create table public.user_profiles(id uuid primary key,user_status text);
    create table public.companies(id uuid primary key,name text,slug text,org_number text,status text,lifecycle_status text,lifecycle_state_version bigint,is_active boolean);
    create table public.company_memberships(id uuid default gen_random_uuid(),user_id uuid,company_id uuid,membership_role text,status text,is_active boolean,created_at timestamptz default now());
    create table public.roles(id uuid primary key,key text,name text,is_active boolean);
    create table public.user_roles(user_id uuid,company_id uuid,role_id uuid,role text,status text,is_active boolean);
    create table public.permissions(id uuid primary key,key text,name text,is_active boolean);
    create table public.role_permissions(role_id uuid,permission_id uuid,effect text);
    create table public.admin_users(user_id uuid,role text,is_active boolean);
    create table public.user_permissions(user_id uuid,company_id uuid,permission_id uuid,permission_key text,is_active boolean,status text,effect text);
    create table public.user_permission_overrides(user_id uuid,company_id uuid,permission_key text,effect text,is_active boolean,valid_from timestamptz,valid_to timestamptz);
    -- The operation policy is not changed by this migration; declare only its
    -- real output ABI instead of duplicating the independent lifecycle engine.
    create function public.canonical_tenant_operation_decision(uuid,text)
      returns table(allowed boolean,reason_code text,company_status text,capability_status text,production_status text,state_version bigint)
      language sql as $$select c.status='active','declared_operation_policy',c.status,'active','test',1::bigint from public.companies c where c.id=$1$$;
  `)
  for (const name of ['gridex_normalize_platform_role', 'canonical_actor_is_platform_admin']) await db.exec(definition(schema, name))
  await db.exec(definition(historical, 'canonical_authenticated_tenant_context'))
  const start = remediation.indexOf('alter function public.canonical_authenticated_tenant_context(uuid)')
  const end = remediation.indexOf('create function public.canonical_authenticated_tenant_context(', start)
  await db.exec(remediation.slice(start, end))
  await db.exec(definition(scopedEngine, 'canonical_authenticated_tenant_context'))
  await db.exec(`revoke all on function public.canonical_authenticated_tenant_context(uuid) from public;
    grant execute on function public.canonical_authenticated_tenant_context(uuid) to authenticated,service_role;
    comment on function public.canonical_authenticated_tenant_context_v1_scoped(uuid) is 'retained private context comment';`)
  await db.exec(prior)
  beforePrivate = await metadata(signature); beforeWrapper = await metadata(wrapper)
  expect(beforePrivate).toMatchObject({ source_md5: '20800ecdbc19c53dd48b5bd8f3376bc1', volatility: 's' })
  await db.exec(migration())
}, 30_000)

afterAll(async () => { await db.close() })
afterEach(async () => { await db.exec('rollback') })
beforeEach(async () => {
  vi.clearAllMocks(); selected = own.company; sdkError = false
  await db.exec('begin')
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [own.actor])
  await db.query("insert into auth.users values ($1,'synthetic@example.invalid',null,null,now())", [own.actor])
  await db.query("insert into public.user_profiles values ($1,'active')", [own.actor])
  await db.query("insert into public.companies values ($1,'Own','own','synthetic-own','active','active',1,true),($2,'Foreign','foreign','synthetic-foreign','active','active',1,true)", [own.company, own.foreign])
  await db.query("insert into public.company_memberships(user_id,company_id,membership_role,status,is_active) values ($1,$2,'owner','active',true)", [own.actor, own.company])
  await db.query("insert into public.roles values ($1,'finance','finance',true)", [own.role])
  await db.query("insert into public.user_roles values ($1,$2,$3,'finance','active',true)", [own.actor, own.company, own.role])
  await db.query("insert into public.permissions values ($1,'billing_underlay.read','read',true),($2,'billing_underlay.export','export',true)", [own.read, own.write])
  await db.query("insert into public.role_permissions values ($1,$2,'allow'),($1,$3,'allow')", [own.role, own.read, own.write])
  io.cookie.mockImplementation(() => selected ? { value: selected } : undefined)
  io.server.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: own.actor, email: 'synthetic@example.invalid' } }, error: null }) },
    rpc: async (name: string, args: { p_selected_company_id: string | null }) => {
      if (name !== 'canonical_authenticated_tenant_context' || Object.keys(args).join() !== 'p_selected_company_id') throw new Error('undeclared context transport')
      return sdkError ? { data: null, error: { message: 'declared read failure' } } : { data: await context(args.p_selected_company_id), error: null }
    } })
})

it('2030 without the new forward reproduces the real API 503 instead of allowing an unverifiable catalog', async () => {
  await db.exec(definition(prior, 'canonical_authenticated_tenant_context_v1_scoped'))
  expect((await context()).permissions).toEqual(['billing_underlay.export', 'billing_underlay.read'])
  expect((await context()).active_permission_keys).toBeUndefined()
  await expectDenied(503)
})

it('the full forward exposes the real active catalog and current empty DENY set to the actual API guard', async () => {
  expect(await context()).toMatchObject({ authorized: true, selected_company_id: own.company,
    active_permission_keys: ['billing_underlay.export', 'billing_underlay.read'], denied_permissions: [] })
  const result = await requireAdminApiAccess({ allOf: ['billing_underlay.read', 'billing_underlay.export'] })
  expect(result.response).toBeUndefined()
  expect(result.guard).toMatchObject({ userId: own.actor, companyId: own.company, isPlatformAdmin: false })
})

it('identity, memberships, selected company, role grants and lifecycle projections remain equal to the historical context', async () => {
  const current = await context()
  delete current.active_permission_keys; delete current.denied_permissions
  await db.exec(definition(prior, 'canonical_authenticated_tenant_context_v1_scoped'))
  expect(await context()).toEqual(current)
})

it.each([null, own.company])('current direct DENY at scope %s outranks the existing role ALLOW', async (company) => {
  await directDeny(company)
  expect(await context()).toMatchObject({ permissions: ['billing_underlay.read'], denied_permissions: ['billing_underlay.export'] })
  await expectDenied()
})

it('legacy permission-ID DENY is projected without requiring a duplicated permission key', async () => {
  await directDeny(own.company, { byId: true })
  expect((await context()).denied_permissions).toEqual(['billing_underlay.export'])
  await expectDenied()
})

it.each([null, own.company])('a currently valid override DENY at scope %s blocks the actual guard', async (company) => {
  await overrideDeny(company)
  await expectDenied()
})

it.each([
  { company: own.foreign }, { company: own.company, options: { active: false } },
  { company: own.company, options: { status: 'removed' } }, { company: own.company, options: { actor: id(99) } },
])('unrelated or inactive direct DENY does not revoke this selected company: %j', async ({ company, options }) => {
  await directDeny(company, options)
  expect((await context()).denied_permissions).toEqual([])
  expect((await requireAdminApiAccess(['billing_underlay.export'])).guard?.companyId).toBe(own.company)
})

it.each([
  { company: own.foreign }, { company: own.company, options: { active: false } },
  { company: own.company, options: { from: '2099-01-01T00:00:00Z' } },
  { company: own.company, options: { to: '2000-01-01T00:00:00Z' } },
])('unrelated, inactive, future or expired overrides remain excluded: %j', async ({ company, options }) => {
  await overrideDeny(company, options)
  expect((await context()).denied_permissions).toEqual([])
  expect((await requireAdminApiAccess(['billing_underlay.export'])).guard?.companyId).toBe(own.company)
})

it('override expiry uses the current clock while the same transaction remains open', async () => {
  await db.query("insert into public.user_permission_overrides values ($1,$2,'billing_underlay.export','deny',true,null,clock_timestamp()+interval '1 hour')", [own.actor, own.company])
  await expectDenied()
  await db.exec('update public.user_permission_overrides set valid_to=clock_timestamp()')
  expect((await context()).denied_permissions).toEqual([])
  expect((await requireAdminApiAccess(['billing_underlay.export'])).guard?.companyId).toBe(own.company)
})

it('ban expiry uses the current clock instead of the beginning of the open transaction', async () => {
  await db.query("update auth.users set banned_until=clock_timestamp()+interval '1 hour' where id=$1", [own.actor])
  expect(await context()).toEqual({ authorized: false, reason_code: 'identity_not_active' })
  await db.query('update auth.users set banned_until=clock_timestamp() where id=$1', [own.actor])
  expect((await context()).authorized).toBe(true)
  expect((await requireAdminApiAccess(['billing_underlay.export'])).guard?.companyId).toBe(own.company)
})

it('inactive catalog keys cannot authorize ordinary or platform API actors', async () => {
  await db.query('update public.permissions set is_active=false where id=$1', [own.write])
  expect((await context()).active_permission_keys).toEqual(['billing_underlay.read'])
  await expectDenied()
  await db.query("insert into public.admin_users values ($1,'super_admin',true)", [own.actor])
  await expectDenied()
})

it('platform implicit authority still obeys current explicit DENY at the selected company', async () => {
  await db.query("insert into public.admin_users values ($1,'super_admin',true)", [own.actor])
  expect((await requireAdminApiAccess(['billing_underlay.export'])).guard?.isPlatformAdmin).toBe(true)
  await directDeny(own.company)
  await expectDenied()
})

it('platform null selection retains global DENY and never includes a different company DENY', async () => {
  await db.query("insert into public.admin_users values ($1,'super_admin',true)", [own.actor])
  selected = null
  await directDeny(own.foreign)
  expect((await context()).selected_company_id).toBeNull()
  expect((await context()).denied_permissions).toEqual([])
  expect((await requireAdminApiAccess(['billing_underlay.export'])).guard).toMatchObject({ isPlatformAdmin: true, companyId: null })
  await directDeny(null)
  await expectDenied()
})

it('an explicit foreign target cannot borrow the selected company permissions', async () => {
  const result = await requireAdminApiAccess(['billing_underlay.export'], { companyId: own.foreign })
  expect(result.guard).toBeUndefined()
  expect(result.response?.status).toBe(403)
  expect((await context(own.foreign)).selected_company_id).toBeNull()
})

it('permission-read errors retain the actual API 503 refusal', async () => {
  sdkError = true
  await expectDenied(503)
})

it('paused-company history retains its readable context and separate lifecycle refusal', async () => {
  await db.query("update public.companies set status='paused',lifecycle_status='paused' where id=$1", [own.company])
  const current = await context()
  expect(current).toMatchObject({ company: { id: own.company, status: 'paused', lifecycle_status: 'paused' } })
  expect(current.operation_policy).toMatchObject({ 'email.send': { allowed: false } })
  expect((await requireAdminApiAccess(['billing_underlay.read'])).guard?.companyId).toBe(own.company)
})

it('the exact deployed body changes only the intended volatility and preserves all identity/security/dependencies', async () => {
  expect(await metadata(signature)).toEqual({ ...beforePrivate, source_md5: 'd205c4e8ba1989b27b4df6b1b76af631', volatility: 'v' })
  expect(await metadata(wrapper)).toEqual(beforeWrapper)
})

it('an exact replay retains every private and wrapper catalog field', async () => {
  const a = await metadata(signature), b = await metadata(wrapper)
  await db.exec(migration())
  expect(await metadata(signature)).toEqual(a)
  expect(await metadata(wrapper)).toEqual(b)
})

it('an unknown private function body is refused before any replacement', async () => {
  const current = (await db.query<{ definition: string }>('select pg_get_functiondef($1::regprocedure) definition', [signature])).rows[0].definition
  await expectMigrationRefusal(current.replace('declare\n', 'declare\n  -- unreviewed source\n'))
})

it.each([
  `alter function ${signature} security invoker`, `alter function ${signature} stable`,
  `alter function ${signature} set search_path=public`, `grant execute on function ${signature} to service_role`,
])('unknown security metadata is refused: %s', async (change) => { await expectMigrationRefusal(change) })

it('missing DENY expiry storage is refused without installing an incomplete projection', async () => {
  await expectMigrationRefusal('alter table public.user_permission_overrides drop column valid_to')
})

it('a changed DENY storage type is refused before replacing the function', async () => {
  await expectMigrationRefusal('alter table public.user_permission_overrides alter column valid_to type text')
})

it('non-string identity email storage is refused while the GoTrue varchar contract remains accepted', async () => {
  await expectMigrationRefusal('alter table auth.users alter column email type integer using null')
})

it('a changed wrapper source is refused rather than overwritten', async () => {
  const current = (await db.query<{ definition: string }>('select pg_get_functiondef($1::regprocedure) definition', [wrapper])).rows[0].definition
  await expectMigrationRefusal(current.replace('begin\n', 'begin\n  -- unreviewed wrapper\n'))
})
