// ops-api-review: F15
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// F15 month cards plus the F79 access windows (owner decision 2026-10-22): both migrations are applied in
// order, so the month cards and the Mina sidor detail list run the real SQL functions.
const MIGRATIONS = ['20261009130000_portal_monthly_consumption_summary.sql', '20261022100500_customer_metering_access_windows.sql']
const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const CUSTOMER_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const CUSTOMER_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
// Previous occupant of POINT_1 in tenant A (F79 move-in scenario).
const CUSTOMER_C = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const POINT_1 = '11111111-1111-4111-8111-111111111111'
const POINT_2 = '22222222-2222-4222-8222-222222222222'
const Z14_MESSAGE = '33333333-3333-4333-8333-333333333333'
const PERMISSION_APPROVED = '44444444-4444-4444-8444-444444444444'
const PERMISSION_UNQUALIFIED = '55555555-5555-4555-8555-555555555555'

type RpcCall = { name: string; args: Record<string, unknown> }
const state = vi.hoisted(() => ({ db: null as unknown as { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }, rpcCalls: [] as RpcCall[] }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    // Bridges the real TypeScript callers to the real SQL functions in PGlite.
    rpc: (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args })
      if (name === 'gridex_customer_metering_values_v1') {
        // PostgREST builder over the SETOF result: the function applies tenant, customer, range, access
        // windows, its own order and p_limit; the caller's chained limit applies on top.
        let cap = Infinity
        const builder: Record<string, unknown> = {
          select: () => builder, order: () => builder,
          limit: (n: number) => { cap = n; return builder },
          then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => state.db.query(
            'select * from public.gridex_customer_metering_values_v1($1::uuid, $2::uuid[], $3::timestamptz, $4::timestamptz, $5::integer)',
            [args.p_company_id, args.p_customer_ids, args.p_period_start_from, args.p_period_start_before, args.p_limit],
          ).then((result) => ({ data: result.rows.slice(0, cap), error: null }), (error) => ({ data: null, error })).then(resolve, reject),
        }
        return builder
      }
      return (async () => {
        if (name !== 'gridex_portal_monthly_consumption_v1') throw new Error(`unexpected rpc ${name}`)
        try {
          const result = await state.db.query(
            'select * from public.gridex_portal_monthly_consumption_v1($1::uuid, $2::uuid[], $3::date, $4::date)',
            [args.p_company_id, args.p_customer_ids, args.p_from_month, args.p_to_month],
          )
          return { data: result.rows, error: null }
        } catch (error) {
          return { data: null, error }
        }
      })()
    },
    // Customer channels never read metering tables directly (F79).
    from: (table: string) => { throw new Error(`unexpected direct table read ${table}`) },
  },
}))

import { listPortalMeteringValues, listPortalMonthlyConsumption } from '@/lib/customer-portal/db'

let db: PGlite

async function exec(sql: string) {
  await db.exec(sql)
}

type Value = { company?: string; customer?: string; point?: string; start: Date; minutes?: number; kwh?: number; current?: boolean; revision?: string; direction?: string; permission?: string }
async function insert(values: Value[]) {
  const rows = values.map((v) => {
    const end = new Date(v.start.getTime() + (v.minutes ?? 60) * 60_000)
    return `('${v.company ?? TENANT_A}','${v.customer ?? CUSTOMER_A}','${v.point ?? POINT_1}',${v.kwh ?? 1},'${v.start.toISOString()}','${end.toISOString()}',${v.current ?? true},'${v.revision ?? 'current'}','${v.direction ?? 'consumption'}',${v.permission ? `'${v.permission}'` : 'null'})`
  })
  for (let i = 0; i < rows.length; i += 1000) {
    await exec(`insert into public.metering_values(company_id,customer_id,metering_point_id,value_kwh,period_start,period_end,is_current,revision_status,direction,permission_id) values ${rows.slice(i, i + 1000).join(',')}`)
  }
}

/** An established (or other-status) supply period; dates are Europe/Stockholm calendar days, end exclusive. */
async function supply(customer: string, point: string, startDate: string, endDate: string | null = null, status = 'active', company = TENANT_A) {
  await exec(`insert into public.customer_supply_periods(company_id,customer_id,metering_point_id,status,start_date,end_date)
    values ('${company}','${customer}','${point}','${status}','${startDate}',${endDate ? `'${endDate}'` : 'null'})`)
}

const detailCalls = () => state.rpcCalls.filter((call) => call.name === 'gridex_customer_metering_values_v1')

/** Every interval of a Europe/Stockholm calendar month, in UTC. */
function monthIntervals(year: number, month: number, minutes = 60): Date[] {
  const start = stockholmMidnight(year, month)
  const end = stockholmMidnight(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1)
  const out: Date[] = []
  for (let t = start.getTime(); t < end.getTime(); t += minutes * 60_000) out.push(new Date(t))
  return out
}
function stockholmMidnight(year: number, month: number): Date {
  // CET (+01) or CEST (+02) at the first of the month: probe both.
  for (const offset of [2, 1]) {
    const candidate = new Date(Date.UTC(year, month - 1, 1, -offset))
    const local = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', day: '2-digit', hourCycle: 'h23' }).format(candidate)
    if (local === '01 00') return candidate
  }
  throw new Error('no Stockholm midnight')
}

async function months(from: string, to: string, company = TENANT_A, customers = [CUSTOMER_A]) {
  const result = await db.query<Record<string, unknown>>(
    'select * from public.gridex_portal_monthly_consumption_v1($1::uuid,$2::uuid[],$3::date,$4::date)',
    [company, customers, from, to],
  )
  return result.rows.map((row) => ({ ...row, month_key: String(row.month_key), total_kwh: Number(row.total_kwh), value_count: Number(row.value_count), covered_seconds: Number(row.covered_seconds), expected_seconds: Number(row.expected_seconds) }))
}

beforeAll(async () => {
  db = new PGlite()
  state.db = db as unknown as typeof state.db
  await exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.customers(id uuid primary key, company_id uuid not null);
    create table public.metering_values(
      id uuid primary key default gen_random_uuid(), company_id uuid, customer_id uuid, metering_point_id uuid,
      value_kwh numeric, period_start timestamptz, period_end timestamptz, is_current boolean not null default true,
      revision_status text not null default 'current', direction text not null default 'consumption',
      read_at timestamptz, permission_id uuid);
    create table public.normalized_metering_values(
      id uuid primary key default gen_random_uuid(), company_id uuid, customer_id uuid, customer_site_id uuid,
      facility_id text, metering_point_id uuid, period_start timestamptz, period_end timestamptz);
    create table public.metering_points(id uuid primary key, company_id uuid not null);
    create table public.customer_supply_periods(
      id uuid primary key default gen_random_uuid(), company_id uuid not null, customer_id uuid not null,
      metering_point_id uuid not null, status text not null, market_start_at timestamptz, market_end_at timestamptz,
      actual_start_date date, start_date date, actual_end_date date, end_date date);
    create table public.ediel_messages(id uuid primary key, company_id uuid, direction text, message_family text, message_code text);
    create table public.metering_permissions(
      id uuid primary key default gen_random_uuid(), company_id uuid, customer_id uuid, metering_point_id uuid, status text,
      inbound_z14_message_id uuid, source_z14_message_id uuid, approved_start_at timestamptz, approved_start_date date,
      approved_end_at timestamptz, approved_end_date date);
  `)
  for (const migration of MIGRATIONS) await exec(readFileSync(`supabase/migrations/${migration}`, 'utf8'))
}, 60_000)

afterAll(async () => { await db?.close() })

beforeEach(async () => {
  await exec(`truncate public.metering_values; truncate public.customers; truncate public.metering_points;
    truncate public.customer_supply_periods; truncate public.metering_permissions; truncate public.ediel_messages;
    insert into public.customers values ('${CUSTOMER_A}','${TENANT_A}'),('${CUSTOMER_B}','${TENANT_B}'),('${CUSTOMER_C}','${TENANT_A}');
    insert into public.metering_points values ('${POINT_1}','${TENANT_A}'),('${POINT_2}','${TENANT_A}');`)
  // Default fixture: customer A has an established, open supply period on both points since 2026-01-01, so
  // every F15 value below lies inside the customer's own access window (F79).
  await supply(CUSTOMER_A, POINT_1, '2026-01-01')
  await supply(CUSTOMER_A, POINT_2, '2026-01-01')
  state.rpcCalls = []
})

describe('F15 complete-month portal consumption (native aggregation)', () => {
  it('744 hourly values of 1 kWh give 744 kWh even when the detail list is limited to 250/500 rows', async () => {
    const august = monthIntervals(2026, 8)
    expect(august).toHaveLength(744)
    await insert(august.map((start) => ({ start })))
    const ctx = { companyId: TENANT_A, customerIds: [CUSTOMER_A] } as never

    expect(await listPortalMeteringValues(ctx, { limit: 250 })).toHaveLength(250)
    expect(await listPortalMeteringValues(ctx, { limit: 500 })).toHaveLength(500)
    // One bounded read per detail list, through the tenant/customer-scoped access function.
    expect(detailCalls().map((call) => call.args)).toEqual([250, 500].map((limit) => ({
      p_company_id: TENANT_A, p_customer_ids: [CUSTOMER_A], p_period_start_from: null, p_period_start_before: null, p_limit: limit,
    })))
    const cards = await listPortalMonthlyConsumption(ctx, { now: new Date('2026-08-20T12:00:00Z'), months: 3 })
    expect(cards).toEqual([{ monthKey: '2026-08', label: '2026-08', totalKwh: 744, valueCount: 744, complete: true }])
  })

  it('uses Europe/Stockholm month bounds (UTC 22:00 on the last day belongs to the next month)', async () => {
    await insert([{ start: new Date('2026-07-31T22:30:00Z'), kwh: 5 }, { start: new Date('2026-07-31T21:00:00Z'), kwh: 7 }])
    const rows = await months('2026-07-01', '2026-08-01')
    expect(rows.map((r) => [r.month_key, r.total_kwh])).toEqual([['2026-08', 5], ['2026-07', 7]])
  })

  it('DST: October has 745 hours, March 743; a full month is complete, a missing hour is not', async () => {
    const october = monthIntervals(2026, 10)
    const march = monthIntervals(2026, 3)
    expect(october).toHaveLength(745)
    expect(march).toHaveLength(743)
    await insert([...october.map((start) => ({ start })), ...march.slice(1).map((start) => ({ start }))])
    const rows = await months('2026-03-01', '2026-10-01')
    const oct = rows.find((r) => r.month_key === '2026-10')!
    const mar = rows.find((r) => r.month_key === '2026-03')!
    expect(oct).toMatchObject({ total_kwh: 745, value_count: 745, is_complete: true, expected_seconds: 745 * 3600 })
    expect(mar).toMatchObject({ total_kwh: 742, value_count: 742, is_complete: false, expected_seconds: 743 * 3600 })
  })

  it('quarter-hour values sum to the full month and report completeness', async () => {
    const quarters = monthIntervals(2026, 8, 15)
    expect(quarters).toHaveLength(2976)
    await insert(quarters.map((start) => ({ start, minutes: 15, kwh: 0.25 })))
    const [row] = await months('2026-08-01', '2026-08-01')
    expect(row).toMatchObject({ month_key: '2026-08', total_kwh: 744, value_count: 2976, is_complete: true })
  })

  it('missing intervals are summed honestly and marked incomplete; coverage is per metering point', async () => {
    const august = monthIntervals(2026, 8)
    await insert([...august.slice(10).map((start) => ({ start })), ...august.map((start) => ({ start, point: POINT_2, kwh: 2 }))])
    const [row] = await months('2026-08-01', '2026-08-01')
    expect(row).toMatchObject({ total_kwh: 734 + 1488, value_count: 734 + 744, metering_point_count: 2, is_complete: false, expected_seconds: 2 * 744 * 3600 })
  })

  it('corrections count once: replaced/void/superseded revisions are excluded', async () => {
    const august = monthIntervals(2026, 8)
    await insert([
      ...august.map((start) => ({ start })),
      { start: august[0], kwh: 100, current: false, revision: 'replaced' },
      { start: august[1], kwh: 100, current: true, revision: 'void' },
      { start: august[2], kwh: 100, current: false, revision: 'current' },
      { start: august[3], kwh: 100, current: true, revision: 'superseded' },
    ])
    const [row] = await months('2026-08-01', '2026-08-01')
    expect(row).toMatchObject({ total_kwh: 744, value_count: 744, is_complete: true })
  })

  it('only gross consumption is summed; production and net series are not mixed in', async () => {
    const start = monthIntervals(2026, 8)[0]
    await insert([{ start, kwh: 3 }, { start, kwh: 50, direction: 'production' }, { start, kwh: 40, direction: 'net_consumption' }, { start, kwh: 30, direction: 'net_production' }])
    const [row] = await months('2026-08-01', '2026-08-01')
    expect(row).toMatchObject({ total_kwh: 3, value_count: 1 })
  })

  it('other tenants are isolated and a foreign customer id is rejected inside the function', async () => {
    const start = monthIntervals(2026, 8)[0]
    await insert([{ start, kwh: 3 }, { start, kwh: 99, company: TENANT_B }, { start, kwh: 77, company: TENANT_B, customer: CUSTOMER_B }])
    expect((await months('2026-08-01', '2026-08-01')).map((r) => r.total_kwh)).toEqual([3])
    await expect(months('2026-08-01', '2026-08-01', TENANT_A, [CUSTOMER_A, CUSTOMER_B])).rejects.toThrow(/portal_consumption_customer_scope_invalid/)
    await expect(months('2026-08-01', '2026-08-01', TENANT_B, [CUSTOMER_A])).rejects.toThrow(/portal_consumption_customer_scope_invalid/)
    await expect(months('2026-08-01', '2026-08-01', TENANT_A, [])).rejects.toThrow(/portal_consumption_scope_invalid/)
    await expect(months('2026-08-01', '2023-01-01')).rejects.toThrow(/portal_consumption_period_invalid/)
    await expect(months('2020-01-01', '2026-08-01')).rejects.toThrow(/portal_consumption_period_invalid/)
  })

  it('is SECURITY DEFINER with a fixed search_path and executable only by service_role', async () => {
    const meta = await db.query<{ prosecdef: boolean; proconfig: string[] }>(
      `select prosecdef, proconfig from pg_proc where proname = 'gridex_portal_monthly_consumption_v1'`,
    )
    expect(meta.rows[0].prosecdef).toBe(true)
    expect(meta.rows[0].proconfig).toEqual(['search_path=pg_catalog, public'])
    const signature = 'public.gridex_portal_monthly_consumption_v1(uuid,uuid[],date,date)'
    const grants = await db.query<Record<string, boolean>>(
      `select has_function_privilege('anon','${signature}','execute') anon,
              has_function_privilege('authenticated','${signature}','execute') authenticated,
              has_function_privilege('service_role','${signature}','execute') service_role`,
    )
    expect(grants.rows[0]).toEqual({ anon: false, authenticated: false, service_role: true })
  })

  it('the TS caller surfaces scope errors instead of returning a partial sum', async () => {
    const ctx = { companyId: TENANT_A, customerIds: [CUSTOMER_B] } as never
    await expect(listPortalMonthlyConsumption(ctx, { now: new Date('2026-08-20T12:00:00Z') })).rejects.toBeTruthy()
    expect(await listPortalMonthlyConsumption({ companyId: TENANT_A, customerIds: [] } as never)).toEqual([])
  })
})

describe('F79 Mina sidor shows only values inside the customer\'s own access windows', () => {
  const ctx = { companyId: TENANT_A, customerIds: [CUSTOMER_A] } as never
  const now = new Date('2026-08-20T12:00:00Z')
  const startsOf = (rows: Array<{ period_start: unknown }>) => rows.map((row) => new Date(String(row.period_start)).getTime())

  beforeEach(async () => { await exec('truncate public.customer_supply_periods') })

  it('move-in: values of the customer before the confirmed start and the previous occupant are hidden; the customer\'s part of the month is complete', async () => {
    const august = monthIntervals(2026, 8)
    const moveIn = new Date('2026-08-14T22:00:00Z') // 2026-08-15 00:00 Europe/Stockholm
    await supply(CUSTOMER_C, POINT_1, '2026-01-01', '2026-08-15', 'ended')
    await supply(CUSTOMER_A, POINT_1, '2026-08-15')
    // The whole month is stored on customer A (e.g. imported before the move-in was known) plus the previous
    // occupant's own first half on the same point.
    await insert([
      ...august.map((start) => ({ start })),
      ...august.filter((start) => start < moveIn).map((start) => ({ start, customer: CUSTOMER_C, kwh: 5 })),
    ])
    const own = august.filter((start) => start >= moveIn)
    expect(own).toHaveLength(17 * 24)

    const detail = await listPortalMeteringValues(ctx, { limit: 1000 })
    expect(detail).toHaveLength(own.length)
    expect(Math.min(...startsOf(detail))).toBe(moveIn.getTime())
    expect(detail.every((row) => (row as { customer_id: unknown }).customer_id === CUSTOMER_A)).toBe(true)
    expect(await listPortalMonthlyConsumption(ctx, { now, months: 1 })).toEqual([{ monthKey: '2026-08', label: '2026-08', totalKwh: own.length, valueCount: own.length, complete: true }])
  })

  it('an ended period keeps the customer\'s own history only; a straddling value and unconfirmed periods open nothing', async () => {
    const august = monthIntervals(2026, 8)
    const end = new Date('2026-08-09T22:00:00Z') // 2026-08-10 00:00 Europe/Stockholm, exclusive
    await supply(CUSTOMER_A, POINT_1, '2026-01-01', '2026-08-10', 'ended')
    await supply(CUSTOMER_A, POINT_1, '2026-08-10', null, 'cancelled')
    await supply(CUSTOMER_A, POINT_2, '2026-01-01', null, 'requested')
    await insert([
      ...august.map((start) => ({ start })),
      { start: new Date('2026-08-09T21:30:00Z'), kwh: 50 }, // starts inside, ends after the period end
      ...august.map((start) => ({ start, point: POINT_2, kwh: 9 })),
    ])
    const inside = august.filter((start) => start < end)
    expect(inside).toHaveLength(9 * 24)

    const detail = await listPortalMeteringValues(ctx, { limit: 1000 })
    expect(detail).toHaveLength(inside.length)
    expect(Math.max(...startsOf(detail))).toBe(end.getTime() - 3_600_000)
    expect(detail.every((row) => (row as { metering_point_id: unknown }).metering_point_id === POINT_1)).toBe(true)
    expect(await listPortalMonthlyConsumption(ctx, { now, months: 1 })).toEqual([{ monthKey: '2026-08', label: '2026-08', totalKwh: inside.length, valueCount: inside.length, complete: true }])
  })

  it('history before supply is visible only when bound to a qualified Z14-approved metering permission', async () => {
    await supply(CUSTOMER_A, POINT_1, '2026-08-15')
    await exec(`insert into public.ediel_messages values ('${Z14_MESSAGE}','${TENANT_A}','inbound','PRODAT','Z14');
      insert into public.metering_permissions(id,company_id,customer_id,metering_point_id,status,inbound_z14_message_id,source_z14_message_id,approved_start_date,approved_end_date) values
        ('${PERMISSION_APPROVED}','${TENANT_A}','${CUSTOMER_A}','${POINT_1}','active','${Z14_MESSAGE}','${Z14_MESSAGE}','2026-08-01','2026-08-15'),
        ('${PERMISSION_UNQUALIFIED}','${TENANT_A}','${CUSTOMER_A}','${POINT_1}','requested',null,null,'2026-08-01','2026-08-15');`)
    const start = new Date('2026-08-01T22:00:00Z') // 2026-08-02 00:00 Europe/Stockholm, before the supply start
    await insert([
      { start, kwh: 2, permission: PERMISSION_APPROVED },
      { start, kwh: 3 },
      { start, kwh: 4, permission: PERMISSION_UNQUALIFIED },
      { start: new Date('2026-08-15T10:00:00Z'), kwh: 6 },
    ])
    const detail = await listPortalMeteringValues(ctx, { limit: 1000 })
    expect(detail.map((row) => Number((row as { value_kwh: unknown }).value_kwh)).sort()).toEqual([2, 6])
  })

  it('the access functions are SECURITY DEFINER with a fixed search_path and executable only by service_role', async () => {
    for (const [name, signature] of [
      ['gridex_customer_metering_access_windows_v1', 'public.gridex_customer_metering_access_windows_v1(uuid,uuid[])'],
      ['gridex_customer_metering_values_v1', 'public.gridex_customer_metering_values_v1(uuid,uuid[],timestamptz,timestamptz,integer)'],
      ['gridex_customer_normalized_metering_values_v1', 'public.gridex_customer_normalized_metering_values_v1(uuid,uuid[],uuid,text,timestamptz,timestamptz,timestamptz,timestamptz,uuid,integer)'],
    ]) {
      const meta = await db.query<{ prosecdef: boolean; proconfig: string[] }>(`select prosecdef, proconfig from pg_proc where proname = '${name}'`)
      expect(meta.rows).toHaveLength(1)
      expect(meta.rows[0].prosecdef).toBe(true)
      expect(meta.rows[0].proconfig).toEqual(['search_path=pg_catalog, public'])
      const grants = await db.query<Record<string, boolean>>(
        `select has_function_privilege('anon','${signature}','execute') anon,
                has_function_privilege('authenticated','${signature}','execute') authenticated,
                has_function_privilege('service_role','${signature}','execute') service_role`,
      )
      expect(grants.rows[0]).toEqual({ anon: false, authenticated: false, service_role: true })
    }
  })

  it('the detail reader rejects a customer outside the tenant instead of returning rows', async () => {
    await insert([{ start: monthIntervals(2026, 8)[0] }])
    await expect(listPortalMeteringValues({ companyId: TENANT_A, customerIds: [CUSTOMER_A, CUSTOMER_B] } as never, { limit: 10 })).rejects.toBeTruthy()
  })
})
