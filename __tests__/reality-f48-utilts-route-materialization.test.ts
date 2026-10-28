// reality-defects: F48, F35
// F48 / F35 (reality J2-13), owner decision 43: a grid owner's registry UTILTS route could never be materialized for
// a company (no message code; utilts_application_reference_message_unsupported:missing), so no E73 could be sent.
// The route now materializes per message the supplier sends (E73), with field 311 from the verified UTILTS profile;
// E74, S07, E66 and ERR are refused, and the bulk action never lets the SQL function fabricate 23-DDQ-UTILTS.
//
// Real code under test: migration 20261028130000 applied in PGlite over the view it replaces (20260622090000, then
// 20261022121000); the TypeScript materializer and the bulk server action run against that database through a small
// PostgREST-shaped bridge (as in registry-route-supplier-switch.test.ts). Declared ports: the private registry source
// RPC, the route-profile production readiness evaluator and the platform-admin guard. Synthetic data only.
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

import { materializeCompanyGridOwnerRoute, materializePlatformActorRoute, registryRouteMessageCodes } from '@/lib/ediel/routeMaterializer'
import { bulkMaterializeOperationalRoutesAction } from '@/app/admin/ediel/route-readiness/actions'

const MIGRATION = 'supabase/migrations/20261028130000_f48_utilts_registry_route_e73_readiness.sql'
const PREDECESSOR = 'supabase/migrations/20261022121000_registry_routes_materialize_supplier_scopes.sql'
const PREVIOUS_VIEW = 'supabase/migrations/20260622090000_company_route_readiness_utilts_null_message_code_fix.sql'
const BULK_FUNCTION = 'supabase/migrations/20260622150000_ediel_route_ack_mode_fix_and_extended_materializer.sql'

const COMPANY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_COMPANY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ACTOR = '11111111-1111-4111-8111-111111111111'
const GRID_OWNER = '22222222-2222-4222-8222-222222222222'
const PRODAT_ROUTE = '33333333-3333-4333-8333-333333333333'
const UTILTS_ROUTE = '66666666-6666-4666-8666-666666666666'
const DECLARED_E66_ROUTE = '67777777-7777-4777-8777-777777777777'
const SENDER = '77777777-7777-4777-8777-777777777777'
const OTHER_SENDER = '88888888-8888-4888-8888-888888888888'
const ADMIN = '99999999-9999-4999-8999-999999999999'

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
  await db.exec(readFileSync(PREDECESSOR, 'utf8'))
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
    id, actor_id: ACTOR, registry_market: 'EL', message_family: 'UTILTS', application_reference: null, environment: 'production', subaddress: null,
    communication_type: 'SMTP', communication_address: 'utilts-16700@example.invalid', party_id: '16700', interchange_party_id: '16700',
    is_verified: true, auto_send_allowed: true, status: 'active',
    metadata: { subaddress_status: 'not_required_confirmed', blank_subaddress_requires_review: false }, ...overrides,
  }
  const columns = Object.keys(row)
  await db.query(`insert into public.platform_actor_routes (${columns.join(',')}) values (${columns.map((_, index) => `$${index + 1}`).join(',')})`,
    columns.map(column => (typeof row[column] === 'object' && row[column] !== null ? JSON.stringify(row[column]) : row[column])))
}

async function sender(id: string, companyId: string, applicationReference: string | null) {
  await db.query(`insert into public.ediel_actor_settings(id, company_id, environment, is_active, ediel_id, actor_role, market_roles,
    application_reference, production_send_lock_enabled, first_production_send_approved) values ($1, $2, 'production', true, $3, 'supplier', '["electricity_supplier"]', $4, true, true)`,
  [id, companyId, companyId === COMPANY ? '70001' : '70002', applicationReference])
}

const rows = async (sql: string, params: unknown[] = []) => (await db.query<Row>(sql, params)).rows
const readiness = (companyId = COMPANY) => rows(
  `select platform_actor_route_id, message_family, message_code, operational_route_ready, blocker_code, communication_route_id, ediel_route_profile_id
     from public.gridex_company_route_readiness_v where company_id = $1 and message_family = 'UTILTS' order by platform_actor_route_id, message_code`, [companyId])
const materialize = (messageCode: string | null, platformActorRouteId = UTILTS_ROUTE) => materializeCompanyGridOwnerRoute({
  companyId: COMPANY, gridOwnerId: GRID_OWNER, platformActorRouteId, messageFamily: 'UTILTS', messageCode, environment: 'production', actorUserId: ADMIN })
const writes = () => rows(`select (select count(*)::int from public.communication_routes) as routes, (select count(*)::int from public.ediel_route_profiles) as profiles,
  (select count(*)::int from public.company_market_party_routes) as party_routes`)

beforeEach(async () => {
  state.rpcCalls.length = 0
  state.redirects.length = 0
  await db.exec(`truncate ${TABLES.map(table => `public.${table}`).join(', ')}`)
  await registryRoute(UTILTS_ROUTE)
  // The sender's tenant-wide label is the PRODAT one (as for every supplier in the world); its UTILTS profile is E66-S.
  await sender(SENDER, COMPANY, '23-DDQ-E66-S')
  await sender(OTHER_SENDER, OTHER_COMPANY, '23-DDQ-PRODAT')
})

describe('readiness view after migration 20261028130000', () => {
  it('keeps the column list, security_invoker, grants and dependent views; the predecessor guard refuses a second run', async () => {
    expect(await viewColumns()).toEqual(before.columns)
    expect(await viewOptions()).toEqual(before.options)
    expect(before.options.reloptions).toEqual(['security_invoker=true'])
    expect(await rows('select routes_without_operational_route::int as n from public.synthetic_route_health_v')).toEqual([{ n: 2 }])
    await expect(db.exec(readFileSync(MIGRATION, 'utf8'))).rejects.toThrow('f48_utilts_readiness_predecessor_required')
    await db.exec('rollback')
  })

  it('a registry UTILTS route yields its E73 row (as the TypeScript projection), PRODAT rows are unchanged', async () => {
    await registryRoute(PRODAT_ROUTE, { message_family: 'PRODAT', communication_address: 'prodat-16700@example.invalid' })
    await registryRoute(DECLARED_E66_ROUTE, { communication_address: 'declared-16700@example.invalid', metadata: { message_code: 'E66' } })
    const view = await rows(`select platform_actor_route_id, message_family, message_code from public.gridex_company_route_readiness_v
      where company_id = $1 order by platform_actor_route_id, message_code`, [COMPANY])
    expect(view.map(row => [row.platform_actor_route_id, row.message_family, row.message_code])).toEqual([
      [PRODAT_ROUTE, 'PRODAT', 'Z01'], [PRODAT_ROUTE, 'PRODAT', 'Z03'], [UTILTS_ROUTE, 'UTILTS', 'E73'], [DECLARED_E66_ROUTE, 'UTILTS', 'E66'],
    ])
    expect(registryRouteMessageCodes({ metadata: {}, application_reference: null }, 'UTILTS')).toEqual(['E73'])
  })
})

describe('materialization of the supplier UTILTS route (E73)', () => {
  it('materializes E73 for the tenant with the verified E66 profile reference, confirmed by the readiness view, idempotently', async () => {
    const first = await materialize('E73')
    expect(first, JSON.stringify(first)).toMatchObject({ status: 'materialized', reasonCode: null, messageFamily: 'UTILTS', messageCode: 'E73' })
    const [profile] = await rows(`select p.message_family, p.message_code, p.application_reference, p.ack_mode, p.sender_ediel_id, p.receiver_ediel_id, c.route_scope,
      c.supported_message_codes, c.grid_owner_id from public.ediel_route_profiles p join public.communication_routes c on c.id = p.communication_route_id where p.company_id = $1`, [COMPANY])
    expect(profile).toEqual({ message_family: 'UTILTS', message_code: 'E73', application_reference: '23-DDQ-E66-S', ack_mode: 'contrl_and_aperak',
      sender_ediel_id: '70001', receiver_ediel_id: '16700', route_scope: 'meter_values', supported_message_codes: ['E73'], grid_owner_id: GRID_OWNER })
    expect((await readiness()).map(row => [row.message_code, row.operational_route_ready, row.blocker_code])).toEqual([['E73', true, null]])
    expect((await readiness(OTHER_COMPANY)).every(row => row.operational_route_ready === false)).toBe(true)
    const again = await materialize('E73')
    expect(again).toMatchObject({ status: 'materialized', communicationRouteId: first.communicationRouteId, edielRouteProfileId: first.edielRouteProfileId })
    expect(await writes()).toEqual([{ routes: 1, profiles: 1, party_routes: 1 }])
  })

  it('the registry default (no code) is E73, and a PRODAT label of the sender is not taken as the UTILTS reference', async () => {
    await db.query(`update public.ediel_actor_settings set application_reference = '23-DDQ-PRODAT' where id = $1`, [SENDER])
    const result = await materialize(null)
    expect(result, JSON.stringify(result)).toMatchObject({ status: 'materialized', messageCode: 'E73' })
    expect(await rows(`select message_code, application_reference from public.ediel_route_profiles where company_id = $1`, [COMPANY]))
      .toEqual([{ message_code: 'E73', application_reference: null }])
  })

  it('a registry route reference wins and is validated: an E73 or E74-target value fails closed without a profile', async () => {
    await db.query(`update public.platform_actor_routes set application_reference = '23-DDQ-E31-S' where id = $1`, [UTILTS_ROUTE])
    await db.query(`update public.ediel_actor_settings set application_reference = null where id = $1`, [SENDER])
    const result = await materialize('E73')
    expect(result).toMatchObject({ status: 'blocked', reasonCode: 'ediel_route_profile_insert_failed' })
    expect(result.technicalMessage).toMatch(/utilts_request_application_reference_target_invalid:E73:23-DDQ-E31-S/)
    expect(await rows('select count(*)::int as n from public.ediel_route_profiles')).toEqual([{ n: 0 }])
  })

  it.each(['E74', 'S07', 'E66', 'ERR', 'S06'])('refuses %s, which the supplier never sends on a grid-owner UTILTS route, before any write', async code => {
    const result = await materialize(code)
    expect(result).toMatchObject({ status: 'blocked', reasonCode: 'platform_route_message_code_not_materializable', communicationRouteId: null })
    expect(await writes()).toEqual([{ routes: 0, profiles: 0, party_routes: 0 }])
  })

  it('a registry route declaring E66 is never materialized by the platform-wide materializer', async () => {
    await registryRoute(DECLARED_E66_ROUTE, { communication_address: 'declared-16700@example.invalid', metadata: { message_code: 'E66' } })
    const results = await materializePlatformActorRoute({ platformActorRouteId: DECLARED_E66_ROUTE, actorUserId: ADMIN })
    expect(results.map(result => [result.messageCode, result.status, result.reasonCode])).toEqual([
      ['E66', 'blocked', 'platform_route_message_code_not_materializable'], ['E66', 'blocked', 'platform_route_message_code_not_materializable'],
    ])
    expect(await writes()).toEqual([{ routes: 0, profiles: 0, party_routes: 0 }])
  })
})

describe('bulk materialization action', () => {
  const run = async (mode: 'apply' | 'dry_run') => {
    const data = new FormData()
    data.set('companyId', COMPANY)
    data.set('environment', 'production')
    data.set('messageFamily', 'UTILTS')
    data.set('mode', mode)
    await expect(bulkMaterializeOperationalRoutesAction(data)).rejects.toThrow('NEXT_REDIRECT')
    return new URL(state.redirects.at(-1)!, 'http://local').searchParams.get('code')
  }
  const sqlBulkCalls = () => state.rpcCalls.filter(call => call.name === 'gridex_materialize_company_operational_routes')

  it('materializes the E73 row through the TypeScript materializer; the SQL function never fabricates 23-DDQ-UTILTS', async () => {
    expect(await run('apply')).toBe('bulk_materialized_and_repaired')
    expect(sqlBulkCalls()).toEqual([])
    expect(await rows(`select message_code, application_reference from public.ediel_route_profiles where company_id = $1`, [COMPANY]))
      .toEqual([{ message_code: 'E73', application_reference: '23-DDQ-E66-S' }])
    expect((await readiness()).map(row => [row.message_code, row.operational_route_ready])).toEqual([['E73', true]])
  })

  it('why UTILTS bypasses the SQL function: it would write the fabricated reference 23-DDQ-UTILTS', async () => {
    await db.query(`update public.ediel_actor_settings set application_reference = null where id = $1`, [SENDER])
    await db.query(`select * from public.gridex_materialize_company_operational_routes($1::uuid, 'production', 'UTILTS', null, null, 'E73', false)`, [COMPANY])
    expect(await rows(`select application_reference from public.ediel_route_profiles where company_id = $1`, [COMPANY])).toEqual([{ application_reference: '23-DDQ-UTILTS' }])
  })
})
