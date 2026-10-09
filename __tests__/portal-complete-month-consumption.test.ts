// ops-api-review: F15
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const MIGRATION = '20261009130000_portal_monthly_consumption_summary.sql'
const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const CUSTOMER_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const CUSTOMER_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const POINT_1 = '11111111-1111-4111-8111-111111111111'
const POINT_2 = '22222222-2222-4222-8222-222222222222'

const state = vi.hoisted(() => ({ db: null as unknown as { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }, detailRows: [] as Record<string, unknown>[] }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    // Bridges the real TypeScript caller to the real SQL function in PGlite.
    rpc: async (name: string, args: Record<string, unknown>) => {
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
    },
    from: () => {
      let cap = Infinity
      const builder: Record<string, unknown> = {
        select: () => builder, eq: () => builder, in: () => builder, order: () => builder,
        limit: (n: number) => { cap = n; return builder },
        then: (resolve: (value: unknown) => unknown) => resolve({ data: state.detailRows.slice(0, cap), error: null }),
      }
      return builder
    },
  },
}))

import { listPortalMeteringValues, listPortalMonthlyConsumption } from '@/lib/customer-portal/db'

let db: PGlite

async function exec(sql: string) {
  await db.exec(sql)
}

type Value = { company?: string; customer?: string; point?: string; start: Date; minutes?: number; kwh?: number; current?: boolean; revision?: string; direction?: string }
async function insert(values: Value[]) {
  const rows = values.map((v) => {
    const end = new Date(v.start.getTime() + (v.minutes ?? 60) * 60_000)
    return `('${v.company ?? TENANT_A}','${v.customer ?? CUSTOMER_A}','${v.point ?? POINT_1}',${v.kwh ?? 1},'${v.start.toISOString()}','${end.toISOString()}',${v.current ?? true},'${v.revision ?? 'current'}','${v.direction ?? 'consumption'}')`
  })
  for (let i = 0; i < rows.length; i += 1000) {
    await exec(`insert into public.metering_values(company_id,customer_id,metering_point_id,value_kwh,period_start,period_end,is_current,revision_status,direction) values ${rows.slice(i, i + 1000).join(',')}`)
  }
}

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
  return result.rows.map((row) => ({ ...row, total_kwh: Number(row.total_kwh), value_count: Number(row.value_count), covered_seconds: Number(row.covered_seconds), expected_seconds: Number(row.expected_seconds) }))
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
      revision_status text not null default 'current', direction text not null default 'consumption');
  `)
  await exec(readFileSync(`supabase/migrations/${MIGRATION}`, 'utf8'))
}, 60_000)

afterAll(async () => { await db?.close() })

beforeEach(async () => {
  await exec(`truncate public.metering_values; truncate public.customers;
    insert into public.customers values ('${CUSTOMER_A}','${TENANT_A}'),('${CUSTOMER_B}','${TENANT_B}');`)
  state.detailRows = []
})

describe('F15 complete-month portal consumption (native aggregation)', () => {
  it('744 hourly values of 1 kWh give 744 kWh even when the detail list is limited to 250/500 rows', async () => {
    const august = monthIntervals(2026, 8)
    expect(august).toHaveLength(744)
    await insert(august.map((start) => ({ start })))
    state.detailRows = august.map((start, i) => ({ id: String(i), value_kwh: 1, period_start: start.toISOString() }))
    const ctx = { companyId: TENANT_A, customerIds: [CUSTOMER_A] } as never

    expect(await listPortalMeteringValues(ctx, { limit: 250 })).toHaveLength(250)
    expect(await listPortalMeteringValues(ctx, { limit: 500 })).toHaveLength(500)
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
