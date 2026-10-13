// Finite PostgreSQL behavior model: real historical context SQL and whole
// forward SQL -> real Admin API guard -> real invoice dispute route. Only
// auth transport, unrelated tenant operation policy and provider IO are ports.
// This does not qualify a live catalog, backend RLS/locks, GEN or native proof.
import { existsSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { requireAdminApiAccess } from '@/lib/admin/apiGuards'
import { POST } from '@/app/api/internal/invoices/[id]/dispute/route'

const io = vi.hoisted(() => ({ server: vi.fn(), from: vi.fn(), scope: vi.fn(), provider: vi.fn(), dispute: vi.fn(), event: vi.fn(), cookie: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: io.server }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from } }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: io.cookie }) }))
vi.mock('@/lib/tenant/scope', () => ({ assertUserCanOperateCompany: io.scope,
  requireOperationalCompanyId: (actor: string) => io.scope(actor, null), assertTenantUserCanReadCompany: io.scope }))
vi.mock('@/lib/integrations/billing/capway/client', () => ({ createCapwayApticClient: io.provider }))
vi.mock('@/lib/events/domainEvents', () => ({ emitDomainEvent: io.event }))

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const own = { actor: id(1), company: id(2), foreign: id(3), role: id(4), read: id(5), write: id(6), invoice: id(7) }
const forwardPath = 'supabase/migrations/20261013023000_admin_context_current_permission_deny.sql'
const forward = () => existsSync(forwardPath) ? readFileSync(forwardPath, 'utf8') : ''
const historical = readFileSync('supabase/migrations/20260810193450_canonical_access_provisioning_runtime_v1.sql', 'utf8')
const remediation = readFileSync('supabase/migrations/20260810224500_canonical_review_remediation_v1.sql', 'utf8')
const scopedEngine = readFileSync('supabase/migrations/20260902091000_company_scoped_permission_engine.sql', 'utf8')
const schema = readFileSync('supabase/schema.sql', 'utf8')
function definition(sql: string, name: string) {
  const start = new RegExp(`create(?: or replace)? function public\\.${name}\\(`, 'i').exec(sql)?.index
  if (start === undefined) throw new Error(`actual_sql_function_missing:${name}`)
  const block = sql.slice(start)
  const delimiter = /\bas\s+(\$[^$]*\$)/i.exec(block)
  if (!delimiter) throw new Error(`actual_sql_body_missing:${name}`)
  const end = block.indexOf(`${delimiter[1]};`, delimiter.index + delimiter[0].length)
  if (end < 0) throw new Error(`actual_sql_body_unterminated:${name}`)
  return block.slice(0, end + delimiter[1].length + 1)
}
const oldDefinition = definition(historical, 'canonical_authenticated_tenant_context')
const renameStart = remediation.indexOf('alter function public.canonical_authenticated_tenant_context(uuid)')
const renameEnd = remediation.indexOf('create function public.canonical_authenticated_tenant_context(', renameStart)
const rename = remediation.slice(renameStart, renameEnd)
let db: PGlite
let originalMetadata: unknown
let installedMetadata: unknown
let authUser: string | null
let selected: string | null
let sdkError: boolean
let invoice: Record<string, unknown>

async function metadata(pg: PGlite) {
  const result = await pg.query(`select oid,proowner,proacl,proargtypes::text,proargnames,pronargdefaults,
    pg_get_expr(proargdefaults,0) defaults,prorettype::regtype::text,provolatile,prosecdef,proconfig,
    proisstrict,proleakproof,proparallel,procost,prorows,
    obj_description(oid,'pg_proc') comment
    from pg_proc where oid='public.canonical_authenticated_tenant_context_v1_scoped(uuid)'::regprocedure`)
  return result.rows[0]
}
async function fixture(installForward = true) {
  const pg = new PGlite()
  await pg.exec(`
    create schema auth; create role anon; create role authenticated; create role service_role;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table auth.users(id uuid primary key,email text,deleted_at timestamptz,banned_until timestamptz,email_confirmed_at timestamptz);
    create table public.user_profiles(id uuid primary key,user_status text);
    create table public.companies(id uuid primary key,name text,slug text,org_number text,status text,lifecycle_status text,lifecycle_state_version int,is_active boolean);
    create table public.company_memberships(id uuid default gen_random_uuid(),user_id uuid,company_id uuid,membership_role text,status text,is_active boolean,created_at timestamptz default now());
    create table public.roles(id uuid primary key,key text,name text,is_active boolean);
    create table public.user_roles(user_id uuid,company_id uuid,role_id uuid,role text,status text,is_active boolean);
    create table public.permissions(id uuid primary key,key text,name text,is_active boolean);
    create table public.role_permissions(role_id uuid,permission_id uuid,effect text);
    create table public.admin_users(user_id uuid,role text,is_active boolean);
    create table public.user_permissions(user_id uuid,company_id uuid,permission_id uuid,permission_key text,is_active boolean,status text,effect text);
    create table public.user_permission_overrides(user_id uuid,company_id uuid,permission_key text,effect text,is_active boolean,valid_from timestamptz,valid_to timestamptz);
    -- Unrelated lifecycle-policy projection is a declared finite source port.
    create function public.canonical_tenant_operation_decision(uuid,text) returns table(allowed boolean,reason text)
      language sql as $$select c.status='active','declared_operation_policy' from public.companies c where c.id=$1$$;
  `)
  for (const name of ['gridex_normalize_platform_role', 'canonical_actor_is_platform_admin', 'gridex_get_user_permissions_in_company', 'gridex_actor_has_company_permission'])
    await pg.exec(definition(schema, name))
  await pg.exec(oldDefinition)
  await pg.exec(rename)
  await pg.exec(definition(scopedEngine, 'canonical_authenticated_tenant_context'))
  await pg.exec(`revoke all on function public.canonical_authenticated_tenant_context(uuid) from public;
    grant execute on function public.canonical_authenticated_tenant_context(uuid) to authenticated,service_role;
    comment on function public.canonical_authenticated_tenant_context_v1_scoped(uuid) is 'retained private scoped context';`)
  const before = await metadata(pg)
  if (installForward && forward()) await pg.exec(forward())
  return { pg, before, after: await metadata(pg) }
}
async function context(company: string | null = selected) {
  return (await db.query<{ context: Record<string, unknown> }>('select public.canonical_authenticated_tenant_context($1::uuid) context', [company])).rows[0].context
}
async function actorPermission(permission = 'billing.write') {
  return (await db.query<{ permitted: boolean }>('select public.gridex_actor_has_company_permission($1,$2,$3) permitted', [own.actor, own.company, permission])).rows[0].permitted
}
function invoicePort(table: string) {
  if (table !== 'invoice_export_items') throw new Error(`undeclared_invoice_sdk_table:${table}`)
  const filters: Array<[string, unknown]> = []
  let update: Record<string, unknown> | undefined
  const reply = (single: boolean) => {
    const matches = filters.every(([key, value]) => key === 'status_payload' && typeof value === 'string'
      ? JSON.stringify(invoice[key]) === value : invoice[key] === value)
    if (matches && update) Object.assign(invoice, structuredClone(update))
    return { data: matches ? single ? structuredClone(invoice) : [structuredClone(invoice)] : single ? null : [], error: null }
  }
  const q = { select: () => q, eq: (key: string, value: unknown) => { filters.push([key, value]); return q },
    is: (key: string, value: unknown) => { filters.push([key, value]); return q },
    update: (value: Record<string, unknown>) => { update = value; return q },
    single: async () => reply(true), maybeSingle: async () => reply(true),
    then: (resolve: (value: ReturnType<typeof reply>) => unknown) => Promise.resolve(reply(false)).then(resolve) }
  return q
}
const dispute = (company = own.company) => POST(new Request('http://localhost/api/internal/invoices/declared/dispute', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ companyId: company, reason: 'Synthetic test' }),
}), { params: Promise.resolve({ id: own.invoice }) })
async function deny(table: 'direct' | 'override', company: string | null, options: { active?: boolean; status?: string; from?: string; to?: string; byId?: boolean; effect?: string } = {}) {
  if (table === 'direct') await db.query(`insert into public.user_permissions values ($1,$2,$3,$4,$5,$6,$7)`,
    [own.actor, company, options.byId ? own.write : null, options.byId ? '' : 'billing.write', options.active ?? true, options.status ?? 'active', options.effect ?? 'deny'])
  else await db.query(`insert into public.user_permission_overrides values ($1,$2,'billing.write',$3,$4,$5::timestamptz,$6::timestamptz)`,
    [own.actor, company, options.effect ?? 'deny', options.active ?? true, options.from ?? null, options.to ?? null])
}
async function deniedWithoutEffects(status = 403) {
  const before = structuredClone(invoice)
  const response = await dispute()
  expect({ status: response.status, providerClients: io.provider.mock.calls.length,
    providerRequests: io.dispute.mock.calls.length, serviceReadsAndWrites: io.from.mock.calls.length,
    events: io.event.mock.calls.length, invoice }).toEqual({ status, providerClients: 0,
    providerRequests: 0, serviceReadsAndWrites: 0, events: 0, invoice: before })
}

beforeAll(async () => { const value = await fixture(); db = value.pg; originalMetadata = value.before; installedMetadata = value.after }, 30_000)
afterAll(async () => { await db.close() })
beforeEach(async () => {
  vi.clearAllMocks(); authUser = own.actor; selected = own.company; sdkError = false
  await db.exec('begin')
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [own.actor])
  await db.query(`insert into auth.users values ($1,'synthetic@example.invalid',null,null,now())`, [own.actor])
  await db.query(`insert into public.user_profiles values ($1,'active')`, [own.actor])
  await db.query(`insert into public.companies values ($1,'Own company','own','synthetic-own','active','active',1,true),($2,'Foreign company','foreign','synthetic-foreign','active','active',1,true)`, [own.company, own.foreign])
  await db.query(`insert into public.company_memberships(user_id,company_id,membership_role,status,is_active) values ($1,$2,'owner','active',true)`, [own.actor, own.company])
  await db.query(`insert into public.roles values ($1,'finance','finance',true)`, [own.role])
  await db.query(`insert into public.user_roles values ($1,$2,$3,'finance','active',true)`, [own.actor, own.company, own.role])
  await db.query(`insert into public.permissions values ($1,'billing.read','billing.read',true),($2,'billing.write','billing.write',true)`, [own.read, own.write])
  await db.query(`insert into public.role_permissions values ($1,$2,'allow'),($1,$3,'allow')`, [own.role, own.read, own.write])
  invoice = { id: own.invoice, company_id: own.company, provider_invoice_guid: 'synthetic-provider-guid', environment: 'test',
    provider_status: 'exported', status_payload: { retained: 'existing receipt' }, updated_at: '2026-10-13T00:00:00Z' }
  io.cookie.mockImplementation(() => selected ? { value: selected } : undefined)
  io.server.mockImplementation(async () => ({ auth: { getUser: async () => ({ data: { user: authUser ? { id: authUser, email: 'synthetic@example.invalid' } : null }, error: null }) },
    rpc: async (name: string, args: { p_selected_company_id: string | null }) => {
      if (name !== 'canonical_authenticated_tenant_context') throw new Error(`undeclared_admin_rpc:${name}`)
      return sdkError ? { data: null, error: { code: '57014' } } : { data: await context(args.p_selected_company_id), error: null }
    } }))
  io.from.mockImplementation(invoicePort)
  io.scope.mockImplementation(async (actor: string, company: string | null) => {
    const target = company ?? String((await context()).selected_company_id ?? '')
    const result = await db.query(`select c.id from public.companies c where c.id=$1 and c.status in('active','onboarding') and
      (public.canonical_actor_is_platform_admin($2) or exists(select from public.company_memberships m where m.company_id=c.id and m.user_id=$2 and m.status='active' and m.is_active))`, [target, actor])
    if (!result.rows.length) throw new Error('Company lifecycle or membership refuses operation')
    return target
  })
  io.dispute.mockResolvedValue({ synthetic: 'provider response' }); io.provider.mockResolvedValue({ dispute: io.dispute }); io.event.mockResolvedValue(undefined)
})
afterEach(async () => { await db.exec('rollback'); vi.restoreAllMocks() })

it.each([['direct', 'company'], ['direct', 'global'], ['direct-id', 'company'], ['override', 'company'], ['override', 'global'], ['override-window', 'company'], ['override-window', 'global'], ['catalog', 'company']] as const)(
  'current %s/%s DENY removes role ALLOW before actual API/provider effects', async (kind, scope) => {
    if (kind === 'catalog') await db.query('update public.permissions set is_active=false where id=$1', [own.write])
    else await deny(kind.startsWith('override') ? 'override' : 'direct', scope === 'global' ? null : own.company, {
      byId: kind === 'direct-id', from: kind === 'override-window' ? '2000-01-01T00:00:00Z' : undefined,
      to: kind === 'override-window' ? '2099-01-01T00:00:00Z' : undefined })
    expect(await actorPermission()).toBe(false)
    await deniedWithoutEffects()
    expect((await context()).permissions).toEqual(['billing.read'])
  })

it('a legitimate role ALLOW reaches actual provider and persists its receipt once', async () => {
  expect(await actorPermission()).toBe(true)
  expect((await context()).permissions).toEqual(['billing.read', 'billing.write'])
  expect((await dispute()).status).toBe(200)
  expect(io.dispute).toHaveBeenCalledTimes(1)
  expect(invoice.provider_status).toBe('disputed')
  expect(invoice.status_payload).toMatchObject({ dispute: { synthetic: 'provider response' } })
  expect(io.event).toHaveBeenCalledTimes(1)
})

it.each(['foreign', 'inactive', 'removed', 'expired', 'future'] as const)('a %s direct/override DENY cannot remove an unrelated current role grant', async kind => {
  await deny('direct', kind === 'foreign' ? own.foreign : own.company, { active: kind !== 'inactive', status: kind === 'removed' ? 'removed' : 'active', effect: kind === 'expired' || kind === 'future' ? 'allow' : 'deny' })
  await deny('override', kind === 'foreign' ? own.foreign : own.company, { active: kind !== 'inactive' && kind !== 'removed',
    to: kind === 'expired' ? '2000-01-01T00:00:00Z' : undefined, from: kind === 'future' ? '2099-01-01T00:00:00Z' : undefined })
  expect(await actorPermission()).toBe(true)
  expect((await dispute()).status).toBe(200); expect(io.dispute).toHaveBeenCalledTimes(1)
})

it('DENY wins over competing direct ALLOW without granting a new direct permission', async () => {
  await deny('direct', null, { effect: 'allow' }); await deny('override', own.company)
  await db.query(`insert into public.permissions values ($1,'documents.write','documents.write',true)`, [id(20)])
  await db.query(`insert into public.user_permissions values ($1,$2,$3,'documents.write',true,'active','allow')`, [own.actor, own.company, id(20)])
  expect((await context()).permissions).toEqual(['billing.read'])
  await deniedWithoutEffects()
})

it('allOf and anyOf consume deny-filtered real SQL permissions independently', async () => {
  await deny('direct', own.company)
  expect((await requireAdminApiAccess({ allOf: ['billing.read', 'billing.write'] })).response?.status).toBe(403)
  expect((await requireAdminApiAccess({ anyOf: ['billing.write', 'documents.write'] })).response?.status).toBe(403)
  expect((await requireAdminApiAccess({ anyOf: ['billing.read', 'billing.write'] })).guard?.companyId).toBe(own.company)
  await deniedWithoutEffects()
})

it.each(['profile', 'banned', 'deleted', 'unconfirmed', 'membership', 'role', 'foreign-company', 'different-user', 'unauthenticated'] as const)(
  'preserves existing %s refusal before provider or persistence', async kind => {
    if (kind === 'profile') await db.exec("update public.user_profiles set user_status='inactive'")
    if (kind === 'banned') await db.exec("update auth.users set banned_until='2099-01-01'")
    if (kind === 'deleted') await db.exec('update auth.users set deleted_at=now()')
    if (kind === 'unconfirmed') await db.exec('update auth.users set email_confirmed_at=null')
    if (kind === 'membership') await db.exec("update public.company_memberships set status='inactive'")
    if (kind === 'role') await db.exec("update public.user_roles set status='removed'")
    if (kind === 'foreign-company') selected = own.foreign
    if (kind === 'different-user') authUser = id(50)
    if (kind === 'unauthenticated') authUser = null
    await deniedWithoutEffects(kind === 'unauthenticated' ? 401 : 403)
  })

it('a failed SDK context read fails closed before effects', async () => {
  sdkError = true; vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  await deniedWithoutEffects(503)
})

it('retains default company selection and full historical paused context without operational filtering', async () => {
  selected = null
  await db.exec("update public.companies set status='paused',lifecycle_status='paused',is_active=false where slug='own'")
  await deny('direct', own.company)
  const result = await context()
  expect(result).toMatchObject({ authorized: true, selected_company_id: own.company, is_platform_admin: false,
    roles: ['finance'], permissions: ['billing.read'], company: { id: own.company, status: 'paused', lifecycle_status: 'paused', lifecycle_state_version: 1 } })
  expect((await requireAdminApiAccess(['billing.read'])).guard?.companyId).toBe(own.company)
  expect(await actorPermission('billing.read')).toBe(false)
  await deniedWithoutEffects()
})

it('preserves the existing explicit platform Admin API bypass policy', async () => {
  await db.query("insert into public.admin_users values ($1,'super_admin',true)", [own.actor])
  await deny('direct', own.company)
  expect(await actorPermission()).toBe(false)
  expect((await context()).permissions).toEqual(['billing.read'])
  expect((await requireAdminApiAccess(['billing.write'])).guard?.isPlatformAdmin).toBe(true)
  expect((await dispute()).status).toBe(200); expect(io.dispute).toHaveBeenCalledTimes(1)
})

it('inverse old source restores the bad grant while every other context field remains identical', async () => {
  await deny('direct', own.company)
  const corrected = await context()
  expect(corrected.permissions).toEqual(['billing.read'])
  await db.exec(oldDefinition.replace('public.canonical_authenticated_tenant_context(', 'public.canonical_authenticated_tenant_context_v1_scoped('))
  const original = await context()
  expect(original.permissions).toEqual(['billing.read', 'billing.write'])
  delete corrected.permissions; delete original.permissions
  expect(corrected).toEqual(original)
})

it('replacing the existing function preserves its OID, owner, ACL, default and security attributes', () => {
  expect(installedMetadata).toEqual(originalMetadata)
})

it('replays the whole guarded forward without changing function identity or granting privileges', async () => {
  const f = await fixture()
  try { await f.pg.exec(forward()); expect(await metadata(f.pg)).toEqual(f.after) }
  finally { await f.pg.close() }
}, 30_000)

it('unknown existing source is refused by whole forward before rewriting the function', async () => {
  const f = await fixture(false)
  try {
    const current = (await f.pg.query<{ definition: string }>("select pg_get_functiondef('public.canonical_authenticated_tenant_context_v1_scoped(uuid)'::regprocedure) definition")).rows[0].definition
    const altered = current.replace('declare\n', 'declare\n  -- unreviewed current source\n')
    await f.pg.exec(altered)
    await expect(f.pg.exec(forward())).rejects.toMatchObject({ code: '55000' })
    await f.pg.exec('rollback')
    const after = (await f.pg.query<{ definition: string }>("select pg_get_functiondef('public.canonical_authenticated_tenant_context_v1_scoped(uuid)'::regprocedure) definition")).rows[0].definition
    expect(after).toBe(altered)
    expect(await metadata(f.pg)).toEqual(f.before)
  } finally { await f.pg.close() }
}, 30_000)

it('missing DENY storage refuses the whole forward instead of installing a partial permission filter', async () => {
  const f = await fixture(false)
  try {
    const before = (await f.pg.query<{ source: string }>("select prosrc source from pg_proc where oid='public.canonical_authenticated_tenant_context_v1_scoped(uuid)'::regprocedure")).rows[0].source
    await f.pg.exec('alter table public.user_permission_overrides drop column valid_to')
    await expect(f.pg.exec(forward())).rejects.toMatchObject({ code: '55000' })
    await f.pg.exec('rollback')
    const after = (await f.pg.query<{ source: string }>("select prosrc source from pg_proc where oid='public.canonical_authenticated_tenant_context_v1_scoped(uuid)'::regprocedure")).rows[0].source
    expect(after).toBe(before)
    expect(await metadata(f.pg)).toEqual(f.before)
  } finally { await f.pg.close() }
}, 30_000)

it('a changed security attribute refuses the forward instead of broadening a different current function', async () => {
  const f = await fixture(false)
  try {
    await f.pg.exec('alter function public.canonical_authenticated_tenant_context_v1_scoped(uuid) security invoker')
    const changed = await metadata(f.pg)
    await expect(f.pg.exec(forward())).rejects.toMatchObject({ code: '55000' })
    await f.pg.exec('rollback')
    expect(await metadata(f.pg)).toEqual(changed)
  } finally { await f.pg.close() }
}, 30_000)
