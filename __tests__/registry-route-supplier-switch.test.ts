// FINDINGS F85: a grid owner's registry PRODAT route materializes every PRODAT scope the supplier sends to
// that grid owner (Z01 customer_masterdata and Z03 supplier_switch), so the route engine finds the grid owner's
// own supplier_switch route for Z03 instead of the go-live wizard's route without grid owner.
//
// Real code under test: migration 20261022120000 (readiness view and profile key) applied in PGlite over the
// view it replaces; the TypeScript materializer, the route decision engine and the bulk server action run
// against that database through a small PostgREST-shaped bridge; the SQL bulk function is the one from
// migration 20260622150000. Declared ports: the private registry source RPC, the dynamic receiver resolver,
// the route-profile production readiness evaluator and the platform-admin guard. Synthetic data only.
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
type Result = { data: unknown; error: { message: string; code?: string } | null }

const state = vi.hoisted(() => ({
  db: null as unknown as { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  redirects: [] as string[],
}))

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => { state.redirects.push(to); throw Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT' }) },
  unstable_rethrow: (error: unknown) => { if ((error as { digest?: string })?.digest === 'NEXT_REDIRECT') throw error },
}))
vi.mock('@/lib/admin/guards', () => ({ requirePlatformAdminActionAccess: async () => ({ userId: '99999999-9999-4999-8999-999999999999' }) }))
vi.mock('@/lib/ediel/routeProfileProductionReadiness', () => ({
  evaluateRouteProfileProductionReadiness: async ({ routeProfileId }: { routeProfileId: string }) => ({ routeProfileId, ready: true, blockers: [], warnings: [], evidence: {} }),
}))
vi.mock('@/lib/routes/dynamicReceiverResolver', () => ({
  // The customer's site resolves to the synthetic grid owner; the receiver has no registered subaddress.
  resolveDynamicReceiver: async () => ({
    status: 'resolved', receiverSource: 'selected_customer_site_grid_owner', dynamicReceiverStrategy: 'selected_customer_site_grid_owner',
    receiverEdielId: '16700', receiverSubAddress: null, receiverName: 'Synthetic Elnät AB', receiverEmail: null,
    gridOwnerId: '22222222-2222-4222-8222-222222222222', counterpartyId: null, issues: [], warnings: [], trace: [],
  }),
}))
vi.mock('@/lib/supabase/service', () => {
  const ident = (column: string) => {
    if (!/^[a-z_][a-z0-9_]*$/.test(column)) throw new Error(`bridge: unsupported column ${column}`)
    return `"${column}"`
  }
  const encode = (value: unknown) => (value !== null && typeof value === 'object' && !(value instanceof Date) ? JSON.stringify(value) : value)
  const failure = (error: unknown): Result => ({ data: null, error: { message: String((error as Error)?.message ?? error), code: (error as { code?: string })?.code } })
  function from(table: string) {
    const where: string[] = []
    const params: unknown[] = []
    const orders: string[] = []
    let limit: number | null = null
    let offset = 0
    let write: { kind: 'insert' | 'update'; values: Row } | null = null
    const p = (value: unknown) => { params.push(encode(value)); return `$${params.length}` }
    const clause = () => (where.length ? ` where ${where.join(' and ')}` : '')
    const run = async (): Promise<Result> => {
      try {
        let sql: string
        if (write?.kind === 'insert') {
          const columns = Object.keys(write.values)
          sql = `insert into public.${ident(table)} (${columns.map(ident).join(',')}) values (${columns.map(column => p(write!.values[column])).join(',')}) returning *`
        } else if (write?.kind === 'update') {
          const sets = Object.keys(write.values).map(column => `${ident(column)} = ${p(write!.values[column])}`)
          sql = `update public.${ident(table)} set ${sets.join(',')}${clause()} returning *`
        } else {
          sql = `select * from public.${ident(table)}${clause()}${orders.length ? ` order by ${orders.join(',')}` : ''}${limit === null ? '' : ` limit ${limit}`}${offset ? ` offset ${offset}` : ''}`
        }
        const result = await state.db.query(sql, params)
        return { data: result.rows, error: null }
      } catch (error) {
        return failure(error)
      }
    }
    const one = async (allowNone: boolean): Promise<Result> => {
      const result = await run()
      if (result.error) return result
      const rows = result.data as Row[]
      if (rows.length > 1 || (!allowNone && rows.length === 0)) return { data: null, error: { message: `bridge: ${rows.length} rows`, code: 'PGRST116' } }
      return { data: rows[0] ?? null, error: null }
    }
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => { where.push(`${ident(column)} = ${p(value)}`); return builder },
      is: (column: string, value: null) => { if (value !== null) throw new Error('bridge: is() supports null only'); where.push(`${ident(column)} is null`); return builder },
      not: (column: string, operator: string, value: null) => {
        if (operator !== 'is' || value !== null) throw new Error('bridge: not() supports is null only')
        where.push(`${ident(column)} is not null`); return builder
      },
      in: (column: string, values: unknown[]) => { where.push(`${ident(column)}::text = any(${p(values.map(String))}::text[])`); return builder },
      // The engine's tier filter: "company_id.is.null,company_id.eq.<uuid>".
      or: (filter: string) => {
        where.push(`(${filter.split(',').map((part) => {
          const [column, operator, ...rest] = part.split('.')
          if (operator === 'is' && rest.join('.') === 'null') return `${ident(column)} is null`
          if (operator === 'eq') return `${ident(column)}::text = ${p(rest.join('.'))}`
          throw new Error(`bridge: unsupported or() part ${part}`)
        }).join(' or ')})`)
        return builder
      },
      order: (column: string, options?: { ascending?: boolean }) => { orders.push(`${ident(column)} ${options?.ascending === false ? 'desc' : 'asc'}`); return builder },
      limit: (value: number) => { limit = value; return builder },
      range: (start: number, end: number) => { offset = start; limit = end - start + 1; return builder },
      insert: (values: Row) => { write = { kind: 'insert', values }; return builder },
      update: (values: Row) => { write = { kind: 'update', values }; return builder },
      single: () => one(false),
      maybeSingle: () => one(true),
      then: (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) => run().then(resolve, reject),
    }
    return builder
  }
  const rpc = async (name: string, args: Record<string, unknown>): Promise<Result> => {
    state.rpcCalls.push({ name, args })
    try {
      if (name === 'ediel_registry_route_source_v1') {
        // Declared port for the private current-source admission of an EL registry route.
        const route = (await state.db.query('select * from public.platform_actor_routes where id = $1', [args.p_route_id])).rows[0]
        if (!route) return { data: { status: 'held', routeId: args.p_route_id, reason: 'synthetic_route_missing' }, error: null }
        return { data: {
          status: 'source_qualified', routeId: route.id, actorId: route.actor_id, market: 'EL', sourceSha256: 'a'.repeat(64), sourceRecordSha256: 'b'.repeat(64),
          countryCode: 'SE', legalEdielId: route.party_id, roles: ['grid_owner'],
          wire: { actorId: route.actor_id, market: 'EL', family: route.message_family, environment: route.environment, subaddress: route.subaddress,
            applicationReference: route.application_reference, address: route.communication_address, transport: 'smtp', partyId: route.party_id, interchangePartyId: route.interchange_party_id },
        }, error: null }
      }
      if (name === 'gridex_materialize_company_operational_routes') {
        const result = await state.db.query(
          `select * from public.gridex_materialize_company_operational_routes(p_company_id => $1::uuid, p_environment => $2::text, p_message_family => $3::text,
             p_grid_owner_id => $4::uuid, p_platform_actor_route_id => $5::uuid, p_message_code => $6::text, p_dry_run => $7::boolean)`,
          [args.p_company_id, args.p_environment ?? null, args.p_message_family ?? null, args.p_grid_owner_id ?? null, args.p_platform_actor_route_id ?? null,
            args.p_message_code ?? null, args.p_dry_run ?? true])
        return { data: result.rows, error: null }
      }
      throw new Error(`bridge: unexpected rpc ${name}`)
    } catch (error) {
      return failure(error)
    }
  }
  return { supabaseService: { from, rpc } }
})

import {
  materializeCompanyGridOwnerRoute,
  materializePlatformActorRoute,
  registryRouteMessageCodes,
} from '@/lib/ediel/routeMaterializer'
import { decideCommunicationRoute } from '@/lib/routes/routeDecisionEngine'
import { bulkMaterializeOperationalRoutesAction } from '@/app/admin/ediel/route-readiness/actions'

const MIGRATION = 'supabase/migrations/20261022120000_registry_routes_materialize_supplier_scopes.sql'
const PREVIOUS_VIEW = 'supabase/migrations/20260622090000_company_route_readiness_utilts_null_message_code_fix.sql'
const BULK_FUNCTION = 'supabase/migrations/20260622150000_ediel_route_ack_mode_fix_and_extended_materializer.sql'

const COMPANY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_COMPANY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ACTOR = '11111111-1111-4111-8111-111111111111'
const GRID_OWNER = '22222222-2222-4222-8222-222222222222'
const PRODAT_ROUTE = '33333333-3333-4333-8333-333333333333'
const DGI_ROUTE = '44444444-4444-4444-8444-444444444444'
const EXPLICIT_ROUTE = '55555555-5555-4555-8555-555555555555'
const UTILTS_ROUTE = '66666666-6666-4666-8666-666666666666'
const SENDER = '77777777-7777-4777-8777-777777777777'
const OTHER_SENDER = '88888888-8888-4888-8888-888888888888'
const ADMIN = '99999999-9999-4999-8999-999999999999'
const CUSTOMER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const OUTBOUND = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

let db: PGlite
const viewColumns = () => db.query<{ attname: string; type: string }>(
  `select attname, format_type(atttypid, atttypmod) as type from pg_attribute
    where attrelid = 'public.gridex_company_route_readiness_v'::regclass and attnum > 0 and not attisdropped order by attnum`).then(result => result.rows)
const viewOptions = () => db.query<{ reloptions: string[] | null; acl: string | null }>(
  `select reloptions, relacl::text as acl from pg_class where oid = 'public.gridex_company_route_readiness_v'::regclass`).then(result => result.rows[0])
let before: { columns: Awaited<ReturnType<typeof viewColumns>>; options: Awaited<ReturnType<typeof viewOptions>> }

const TABLES = ['platform_actor_routes', 'ediel_actor_settings', 'communication_routes', 'ediel_route_profiles', 'company_market_party_routes',
  'outbound_requests', 'customer_info_requests', 'grid_owner_data_requests', 'audit_logs']

beforeAll(async () => {
  db = new PGlite()
  state.db = db as unknown as typeof state.db
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create type public.ediel_environment_type as enum ('production', 'agt_test', 'test');
    create table public.platform_market_actors(id uuid primary key, name text, status text, match_status text);
    create table public.grid_owners(id uuid primary key, company_id uuid, name text, ediel_id text, platform_market_actor_id uuid, is_active boolean default true);
    create table public.platform_actor_routes(id uuid primary key, actor_id uuid not null, registry_market text, message_family text not null,
      application_reference text, environment text not null, subaddress text, communication_type text, communication_address text, party_id text,
      interchange_party_id text, is_verified boolean, auto_send_allowed boolean, status text, metadata jsonb not null default '{}');
    create table public.ediel_actor_settings(id uuid primary key, company_id uuid, environment text, is_active boolean, ediel_id text, actor_ediel_id text,
      role text, actor_role text, market_roles jsonb, sender_subaddress text, sender_subaddress_prodat text, sender_subaddress_utilts text,
      sender_sub_address text, application_reference text, default_application_reference text, production_send_lock_enabled boolean,
      first_production_send_approved boolean, metadata jsonb not null default '{}');
    create table public.communication_routes(id uuid primary key default gen_random_uuid(), company_id uuid, route_name text, is_active boolean,
      route_scope text check (route_scope in ('supplier_switch','customer_masterdata','meter_values','metering_values','billing_underlay','metering_access','ediel_ack')),
      route_type text, route_group text, grid_owner_id uuid, target_system text, endpoint text, target_email text, auth_config jsonb,
      supported_payload_version text, supported_message_families jsonb, supported_message_codes jsonb, environment_type text, market_party_role text,
      counterparty_ediel_id text, notes text, created_by uuid, updated_by uuid, created_at timestamptz default now(), updated_at timestamptz default now());
    create unique index communication_routes_platform_actor_route_uidx on public.communication_routes(company_id, ((auth_config->>'platform_actor_route_id')), route_scope)
      where auth_config ? 'platform_actor_route_id';
    create table public.ediel_route_profiles(id uuid primary key default gen_random_uuid(), company_id uuid, communication_route_id uuid, environment text,
      environment_type text, route_name text, route_type text, payload_format text, message_standard text, ack_mode text, default_test_flag integer,
      default_timezone integer, sender_ediel_id text, own_ediel_id text, sender_sub_address text, sender_subaddress text, own_subaddress text,
      receiver_ediel_id text, counterparty_ediel_id text, receiver_sub_address text, receiver_subaddress text, counterparty_subaddress text,
      receiver_name text, application_reference text, message_family text, message_code text, business_code text, default_message_version text,
      mailbox text, mailbox_id uuid, transport_profile_id uuid, transport_mode text, encryption_mode text, transport_type text, ack_policy text,
      is_active boolean, is_enabled boolean, is_test_route boolean, is_production_route boolean, is_production_ready boolean, production_mode text,
      actor_setting_id uuid, route_version integer, receiver_certificate_id uuid, security_policy_status text, metadata jsonb not null default '{}',
      created_by uuid, updated_by uuid, created_at timestamptz default now(), updated_at timestamptz default now());
    -- The key this migration replaces (20260619200000).
    create unique index ediel_route_profiles_platform_actor_route_uidx on public.ediel_route_profiles(company_id, ((metadata->>'platform_actor_route_id')),
      environment, coalesce(message_family, '')) where metadata ? 'platform_actor_route_id';
    create table public.company_market_party_routes(id uuid primary key default gen_random_uuid(), company_id uuid, market_party_id uuid,
      message_family text, message_code text, environment text, platform_actor_route_id uuid, communication_route_id uuid, route_profile_id uuid,
      active boolean, metadata jsonb not null default '{}', created_by uuid, created_at timestamptz default now(), updated_at timestamptz default now());
    create unique index company_market_party_routes_active_route_uidx on public.company_market_party_routes(company_id, market_party_id, message_family,
      coalesce(environment, 'test'), coalesce(message_code, ''), coalesce(platform_actor_route_id::text, '')) where active = true;
    create table public.outbound_requests(id uuid primary key, company_id uuid, customer_id uuid, site_id uuid, grid_owner_id uuid, request_type text,
      communication_route_id uuid, ediel_route_profile_id uuid, channel_type text, route_decision_payload jsonb, payload jsonb, failure_reason text,
      status text, operation_id uuid, created_at timestamptz default now(), updated_at timestamptz default now());
    create table public.customer_info_requests(id uuid primary key, company_id uuid, customer_id uuid, site_id uuid, grid_owner_id uuid, status text,
      blocker_code text, blocker_reason text, route_resolution_status text, route_resolution_reason text, next_required_action text,
      grid_owner_data_request_id uuid, outbound_request_id uuid, updated_at timestamptz);
    create table public.grid_owner_data_requests(id uuid primary key, company_id uuid, customer_id uuid, grid_owner_id uuid, request_scope text,
      created_at timestamptz default now(), updated_at timestamptz default now());
    create table public.grid_owner_access_agreements(id uuid primary key, company_id uuid, grid_owner_id uuid, agreement_scope text, status text,
      updated_at timestamptz default now());
    create table public.audit_logs(id uuid primary key default gen_random_uuid(), company_id uuid, actor_user_id uuid, entity_type text, entity_id text,
      action text, metadata jsonb, created_at timestamptz default now());
  `)
  // The view as it stands before this migration, hardened like 20260709162000, with a dependent view.
  await db.exec(readFileSync(PREVIOUS_VIEW, 'utf8'))
  await db.exec(`
    alter view public.gridex_company_route_readiness_v set (security_invoker = true);
    revoke all on public.gridex_company_route_readiness_v from public, anon, authenticated;
    grant select on public.gridex_company_route_readiness_v to service_role;
    create view public.synthetic_route_health_v with (security_invoker = true) as
      select count(*) as routes_without_operational_route from public.gridex_company_route_readiness_v where platform_route_ready and not operational_route_ready;
  `)
  const bulk = readFileSync(BULK_FUNCTION, 'utf8')
  const start = bulk.indexOf('create or replace function public.gridex_materialize_company_operational_routes(')
  await db.exec(bulk.slice(start, bulk.indexOf('\n$$;', start) + 4))
  before = { columns: await viewColumns(), options: await viewOptions() }
  await db.exec(readFileSync(MIGRATION, 'utf8'))
  await db.exec(`
    insert into public.platform_market_actors values ('${ACTOR}', 'Synthetic Elnät AB', 'active', 'verified');
    insert into public.grid_owners values ('${GRID_OWNER}', null, 'Synthetic Elnät AB', '16700', '${ACTOR}', true);
  `)
})

afterAll(async () => {
  await db?.close()
})

async function registryRoute(id: string, overrides: Row = {}) {
  const row: Row = {
    id, actor_id: ACTOR, registry_market: 'EL', message_family: 'PRODAT', application_reference: null, environment: 'production', subaddress: null,
    communication_type: 'SMTP', communication_address: 'prodat-16700@example.invalid', party_id: '16700', interchange_party_id: '16700',
    is_verified: true, auto_send_allowed: true, status: 'active',
    metadata: { subaddress_status: 'not_required_confirmed', blank_subaddress_requires_review: false }, ...overrides,
  }
  const columns = Object.keys(row)
  await db.query(`insert into public.platform_actor_routes (${columns.join(',')}) values (${columns.map((_, index) => `$${index + 1}`).join(',')})`,
    columns.map(column => (typeof row[column] === 'object' && row[column] !== null ? JSON.stringify(row[column]) : row[column])))
}

async function sender(id: string, companyId: string) {
  await db.query(`insert into public.ediel_actor_settings(id, company_id, environment, is_active, ediel_id, actor_role, market_roles,
    production_send_lock_enabled, first_production_send_approved) values ($1, $2, 'production', true, $3, 'supplier', '["electricity_supplier"]', true, true)`,
  [id, companyId, companyId === COMPANY ? '70001' : '70002'])
}

const rows = async (sql: string, params: unknown[] = []) => (await db.query<Row>(sql, params)).rows
const readiness = (companyId = COMPANY) => rows(
  `select platform_actor_route_id, message_family, message_code, operational_route_ready, blocker_code, communication_route_id, ediel_route_profile_id
     from public.gridex_company_route_readiness_v where company_id = $1 order by platform_actor_route_id, message_family, message_code`, [companyId])

beforeEach(async () => {
  state.rpcCalls.length = 0
  state.redirects.length = 0
  await db.exec(`truncate ${TABLES.map(table => `public.${table}`).join(', ')}`)
  await registryRoute(PRODAT_ROUTE)
  await sender(SENDER, COMPANY)
  await sender(OTHER_SENDER, OTHER_COMPANY)
})

describe('readiness view after migration 20261022120000', () => {
  it('keeps the column list, security_invoker, grants and dependent views of the view it replaces', async () => {
    expect(await viewColumns()).toEqual(before.columns)
    expect(before.columns).toHaveLength(20)
    const after = await viewOptions()
    expect(after).toEqual(before.options)
    expect(after.reloptions).toEqual(['security_invoker=true'])
    expect(after.acl).not.toMatch(/anon|authenticated/)
    expect(await rows('select routes_without_operational_route::int as n from public.synthetic_route_health_v')).toEqual([{ n: 4 }])
  })

  it('a registry PRODAT route yields one row per supplier scope; a DGI route, an explicit code and UTILTS keep one row', async () => {
    await registryRoute(DGI_ROUTE, { application_reference: '23-DGI-PRODAT', communication_address: 'dgi-16700@example.invalid' })
    await registryRoute(EXPLICIT_ROUTE, { communication_address: 'explicit-16700@example.invalid', metadata: { message_code: 'Z01' } })
    await registryRoute(UTILTS_ROUTE, { message_family: 'UTILTS', communication_address: 'utilts-16700@example.invalid' })
    const view = await readiness()
    expect(view.map(row => [row.platform_actor_route_id, row.message_family, row.message_code, row.blocker_code])).toEqual([
      [PRODAT_ROUTE, 'PRODAT', 'Z01', 'platform_route_exists_but_not_materialized'],
      [PRODAT_ROUTE, 'PRODAT', 'Z03', 'platform_route_exists_but_not_materialized'],
      [DGI_ROUTE, 'PRODAT', 'Z01', 'platform_route_exists_but_not_materialized'],
      [EXPLICIT_ROUTE, 'PRODAT', 'Z01', 'platform_route_exists_but_not_materialized'],
      [UTILTS_ROUTE, 'UTILTS', null, 'platform_route_exists_but_not_materialized'],
    ])
    // The TypeScript projection offers exactly the codes the view offers.
    const routes = await rows('select * from public.platform_actor_routes order by id')
    expect(routes.map(route => registryRouteMessageCodes(route as never, String(route.message_family)))).toEqual([['Z01', 'Z03'], ['Z01'], ['Z01'], [null]])
  })

  it('the profile key admits the Z01 and the Z03 profile of one registry route and still rejects a duplicate', async () => {
    const insert = (code: string) => db.query(`insert into public.ediel_route_profiles(company_id, environment, message_family, message_code, metadata)
      values ($1, 'production', 'PRODAT', $2, $3)`, [COMPANY, code, JSON.stringify({ platform_actor_route_id: PRODAT_ROUTE })])
    await insert('Z01')
    await insert('Z03')
    await expect(insert('Z03')).rejects.toMatchObject({ code: '23505' })
  })
})

describe('registry materialization of the supplier scopes', () => {
  it('materializes Z01 customer_masterdata and Z03 supplier_switch per tenant with the fixed grid-owner receiver; a re-run creates nothing new', async () => {
    const first = await materializePlatformActorRoute({ platformActorRouteId: PRODAT_ROUTE, actorUserId: ADMIN })
    expect(first.map(result => [result.companyId, result.messageCode, result.status]).sort()).toEqual([
      [COMPANY, 'Z01', 'materialized'], [COMPANY, 'Z03', 'materialized'], [OTHER_COMPANY, 'Z01', 'materialized'], [OTHER_COMPANY, 'Z03', 'materialized'],
    ])
    const routes = await rows(`select company_id, route_scope, grid_owner_id, route_type, target_system, endpoint, counterparty_ediel_id, supported_message_codes,
      auth_config->>'platform_actor_route_id' as par from public.communication_routes where company_id = $1 order by route_scope`, [COMPANY])
    expect(routes).toEqual([
      { company_id: COMPANY, route_scope: 'customer_masterdata', grid_owner_id: GRID_OWNER, route_type: 'ediel_partner', target_system: 'production_ediel',
        endpoint: 'prodat-16700@example.invalid', counterparty_ediel_id: '16700', supported_message_codes: ['Z01'], par: PRODAT_ROUTE },
      { company_id: COMPANY, route_scope: 'supplier_switch', grid_owner_id: GRID_OWNER, route_type: 'ediel_partner', target_system: 'production_ediel',
        endpoint: 'prodat-16700@example.invalid', counterparty_ediel_id: '16700', supported_message_codes: ['Z03'], par: PRODAT_ROUTE },
    ])
    const profiles = await rows(`select p.message_code, c.route_scope, p.application_reference, p.receiver_ediel_id, p.receiver_sub_address, p.sender_ediel_id,
      p.ack_mode, p.metadata->>'receiver_subaddress_status' as subaddress_status, p.metadata->>'blank_subaddress_requires_review' as blank_review
      from public.ediel_route_profiles p join public.communication_routes c on c.id = p.communication_route_id where p.company_id = $1 order by p.message_code`, [COMPANY])
    expect(profiles).toEqual([
      { message_code: 'Z01', route_scope: 'customer_masterdata', application_reference: '23-DDQ-PRODAT', receiver_ediel_id: '16700', receiver_sub_address: null,
        sender_ediel_id: '70001', ack_mode: 'contrl_only', subaddress_status: 'not_required_confirmed', blank_review: 'false' },
      { message_code: 'Z03', route_scope: 'supplier_switch', application_reference: '23-DDQ-PRODAT', receiver_ediel_id: '16700', receiver_sub_address: null,
        sender_ediel_id: '70001', ack_mode: 'contrl_and_aperak', subaddress_status: 'not_required_confirmed', blank_review: 'false' },
    ])
    // Each tenant's routes carry its own sender only.
    expect(await rows(`select distinct sender_ediel_id from public.ediel_route_profiles where company_id = $1`, [OTHER_COMPANY])).toEqual([{ sender_ediel_id: '70002' }])
    expect((await readiness()).map(row => [row.message_code, row.operational_route_ready, row.blocker_code])).toEqual([['Z01', true, null], ['Z03', true, null]])

    const counts = () => rows(`select (select count(*)::int from public.communication_routes) as routes, (select count(*)::int from public.ediel_route_profiles) as profiles,
      (select count(*)::int from public.company_market_party_routes) as party_routes`)
    const ids = () => rows('select id from public.communication_routes union all select id from public.ediel_route_profiles union all select id from public.company_market_party_routes order by 1')
    const [countsBefore, idsBefore] = [await counts(), await ids()]
    expect(countsBefore).toEqual([{ routes: 4, profiles: 4, party_routes: 4 }])
    const second = await materializePlatformActorRoute({ platformActorRouteId: PRODAT_ROUTE, actorUserId: ADMIN })
    expect(second.map(result => result.status)).toEqual(['materialized', 'materialized', 'materialized', 'materialized'])
    expect(await counts()).toEqual(countsBefore)
    expect(await ids()).toEqual(idsBefore)
  })

  it('materializes the Z03 card alone, confirmed by the readiness view, idempotently and only for that tenant', async () => {
    const input = { companyId: COMPANY, gridOwnerId: GRID_OWNER, platformActorRouteId: PRODAT_ROUTE, messageFamily: 'PRODAT', messageCode: 'Z03', environment: 'production', actorUserId: ADMIN }
    const first = await materializeCompanyGridOwnerRoute(input)
    expect(first).toMatchObject({ status: 'materialized', reasonCode: null, messageCode: 'Z03' })
    const view = await readiness()
    expect(view.map(row => [row.message_code, row.operational_route_ready])).toEqual([['Z01', false], ['Z03', true]])
    expect(view[1]).toMatchObject({ communication_route_id: first.communicationRouteId, ediel_route_profile_id: first.edielRouteProfileId })
    expect((await readiness(OTHER_COMPANY)).every(row => row.operational_route_ready === false)).toBe(true)
    const again = await materializeCompanyGridOwnerRoute(input)
    expect(again).toMatchObject({ status: 'materialized', communicationRouteId: first.communicationRouteId, edielRouteProfileId: first.edielRouteProfileId,
      companyMarketPartyRouteId: first.companyMarketPartyRouteId })
    expect(await rows('select count(*)::int as n from public.communication_routes')).toEqual([{ n: 1 }])
  })

  it.each(['Z09', 'Z04', 'Z13'])('refuses %s, which is not a supplier scope of the registry route, before any write', async code => {
    const result = await materializeCompanyGridOwnerRoute({ companyId: COMPANY, gridOwnerId: GRID_OWNER, platformActorRouteId: PRODAT_ROUTE,
      messageFamily: 'PRODAT', messageCode: code, environment: 'production', actorUserId: ADMIN })
    expect(result).toMatchObject({ status: 'blocked', reasonCode: 'platform_route_message_code_not_materializable', communicationRouteId: null })
    expect(await rows('select count(*)::int as n from public.communication_routes')).toEqual([{ n: 0 }])
  })

  it('a route that declares 23-DGI-PRODAT offers no Z03', async () => {
    expect(registryRouteMessageCodes({ metadata: {}, application_reference: '23-DGI-PRODAT' }, 'PRODAT')).toEqual(['Z01'])
    expect(registryRouteMessageCodes({ metadata: {}, application_reference: '23-ddq-prodat' }, 'PRODAT')).toEqual(['Z01', 'Z03'])
    expect(registryRouteMessageCodes({ metadata: {}, application_reference: null }, 'UTILTS')).toEqual([null])
  })
})

describe('route engine over registry-materialized routes', () => {
  const wizardRoute = '0000000a-0000-4000-8000-00000000000a'
  const decide = (businessProcess: 'supplier_switch' | 'customer_masterdata' | 'metering_access', messageCode: string) => decideCommunicationRoute({
    companyId: COMPANY, customerId: CUSTOMER, gridOwnerId: GRID_OWNER, businessProcess, messageFamily: 'PRODAT', messageCode, environment: 'production',
  } as never)
  const codes = (decision: Awaited<ReturnType<typeof decide>>) => decision.blockingReasons.map(issue => issue.code)

  beforeEach(async () => {
    // The go-live wizard's dynamic supplier_switch route: no grid owner, no receiver, shadow mode.
    await db.query(`insert into public.communication_routes(id, company_id, route_name, is_active, route_scope, route_type, grid_owner_id, target_system, updated_at)
      values ($1, $2, 'Wizard PRODAT production', true, 'supplier_switch', 'ediel_partner', null, 'production_ediel', now() + interval '1 day')`, [wizardRoute, COMPANY])
    await db.query(`insert into public.ediel_route_profiles(company_id, communication_route_id, environment, is_active, is_enabled, message_family,
      application_reference, receiver_ediel_id, production_mode) values ($1, $2, 'production', true, true, 'PRODAT', '23-DDQ-PRODAT', null, 'shadow')`, [COMPANY, wizardRoute])
  })

  it('selects the grid owner supplier_switch route for Z03 over the wizard route once the registry route is materialized', async () => {
    await materializeCompanyGridOwnerRoute({ companyId: COMPANY, gridOwnerId: GRID_OWNER, platformActorRouteId: PRODAT_ROUTE, messageCode: 'Z01', environment: 'production' })
    const fallback = await decide('supplier_switch', 'Z03')
    expect(fallback).toMatchObject({ routeScope: 'supplier_switch', communicationRouteId: wizardRoute })
    expect(codes(fallback)).toContain('missing_receiver_subaddress')

    const z03 = await materializeCompanyGridOwnerRoute({ companyId: COMPANY, gridOwnerId: GRID_OWNER, platformActorRouteId: PRODAT_ROUTE, messageCode: 'Z03', environment: 'production' })
    const decision = await decide('supplier_switch', 'Z03')
    expect(decision).toMatchObject({ routeScope: 'supplier_switch', communicationRouteId: z03.communicationRouteId, edielRouteProfileId: z03.edielRouteProfileId,
      receiverEdielId: '16700', senderEdielId: '70001', applicationReference: '23-DDQ-PRODAT', messageCode: 'Z03' })
    expect(codes(decision)).not.toEqual(expect.arrayContaining(['missing_receiver_subaddress']))
    for (const code of ['missing_route', 'ambiguous_route', 'route_profile_missing', 'missing_receiver_ediel_id', 'missing_sender_ediel_id', 'production_send_locked']) {
      expect(codes(decision)).not.toContain(code)
    }
  })

  it('leaves the scope guards unchanged: Z01 keeps the customer_masterdata route and metering access never takes supplier_switch', async () => {
    await materializePlatformActorRoute({ platformActorRouteId: PRODAT_ROUTE, actorUserId: ADMIN })
    const [z01Route] = await rows(`select id from public.communication_routes where company_id = $1 and route_scope = 'customer_masterdata'`, [COMPANY])
    const z01 = await decide('customer_masterdata', 'Z01')
    expect(z01).toMatchObject({ routeScope: 'customer_masterdata', communicationRouteId: z01Route.id, messageCode: 'Z01' })
    const misrouted = await decide('metering_access', 'Z03')
    expect(misrouted.routeScope).toBe('supplier_switch')
    expect(codes(misrouted)).toContain('z13_wrong_route_scope')
    const z13 = await decide('metering_access', 'Z13')
    expect(z13).toMatchObject({ routeScope: 'metering_access', communicationRouteId: null })
    expect(codes(z13)).toContain('missing_route')
  })
})

describe('bulk materialization action', () => {
  const form = (mode: 'apply' | 'dry_run') => {
    const data = new FormData()
    data.set('companyId', COMPANY)
    data.set('environment', 'production')
    data.set('mode', mode)
    return data
  }
  const run = async (mode: 'apply' | 'dry_run') => {
    await expect(bulkMaterializeOperationalRoutesAction(form(mode))).rejects.toThrow('NEXT_REDIRECT')
    return new URL(state.redirects.at(-1)!, 'http://local').searchParams.get('code')
  }
  const bulkCalls = () => state.rpcCalls.filter(call => call.name === 'gridex_materialize_company_operational_routes').map(call => [call.args.p_message_family, call.args.p_message_code, call.args.p_dry_run])
  const nullRouteZ01Request = () => db.query(`insert into public.outbound_requests(id, company_id, customer_id, grid_owner_id, request_type, communication_route_id, status, route_decision_payload)
    values ($1, $2, $3, $4, 'customer_masterdata', null, 'prepared', '{"message_code":"Z01"}')`, [OUTBOUND, COMPANY, CUSTOMER, GRID_OWNER])

  it('dry-run lists the Z01 row through the SQL function and the Z03 row through the scoped materializer without writes', async () => {
    expect(await run('dry_run')).toBe('bulk_dry_run_completed')
    expect(bulkCalls()).toEqual([['PRODAT', 'Z01', true]])
    expect(await rows('select count(*)::int as n from public.communication_routes')).toEqual([{ n: 0 }])
    const [audit] = await rows(`select metadata from public.audit_logs where action = 'route_readiness.bulk_materialize_dry_run'`)
    expect(audit.metadata).toMatchObject({ rowCount: 2, dryRunCount: 2, materializedCount: 0 })
  })

  it('apply materializes Z01 in SQL and Z03 per scope; the SQL function never receives a Z03 row', async () => {
    await nullRouteZ01Request()
    expect(await run('apply')).toBe('bulk_materialized_and_repaired')
    expect(bulkCalls()).toEqual([['PRODAT', 'Z01', false]])
    expect((await readiness()).map(row => [row.message_code, row.operational_route_ready])).toEqual([['Z01', true], ['Z03', true]])
    const [z01Route] = await rows(`select id from public.communication_routes where company_id = $1 and route_scope = 'customer_masterdata'`, [COMPANY])
    expect(await rows('select communication_route_id, route_decision_payload->>\'message_code\' as code from public.outbound_requests')).toEqual([{ communication_route_id: z01Route.id, code: 'Z01' }])
  })

  it('apply after a per-card Z01 materialization leaves the stranded Z01 request alone', async () => {
    await materializeCompanyGridOwnerRoute({ companyId: COMPANY, gridOwnerId: GRID_OWNER, platformActorRouteId: PRODAT_ROUTE, messageCode: 'Z01', environment: 'production' })
    await nullRouteZ01Request()
    expect(await run('apply')).toBe('bulk_materialized_and_repaired')
    expect(bulkCalls()).toEqual([])
    expect(await rows('select communication_route_id, route_decision_payload->>\'message_code\' as code from public.outbound_requests')).toEqual([{ communication_route_id: null, code: 'Z01' }])
  })

  it('why Z03 bypasses the SQL function: it would re-point a Z01 request to the supplier_switch route', async () => {
    await materializeCompanyGridOwnerRoute({ companyId: COMPANY, gridOwnerId: GRID_OWNER, platformActorRouteId: PRODAT_ROUTE, messageCode: 'Z01', environment: 'production' })
    await nullRouteZ01Request()
    const result = await db.query<Row>(`select result_status, communication_route_id from public.gridex_materialize_company_operational_routes($1::uuid, 'production', 'PRODAT', null, null, 'Z03', false)`, [COMPANY])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].result_status).toBe('materialized')
    const [switchRoute] = await rows(`select id from public.communication_routes where company_id = $1 and route_scope = 'supplier_switch'`, [COMPANY])
    expect(await rows('select communication_route_id, route_decision_payload->>\'message_code\' as code from public.outbound_requests')).toEqual([{ communication_route_id: switchRoute.id, code: 'Z03' }])
  })
})
