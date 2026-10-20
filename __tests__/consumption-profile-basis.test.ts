import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, string | number | boolean | null>
const io = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  failures: {} as Record<string, { code: string; message: string }>,
  qualityWrites: [] as string[],
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/analytics/dataQuality', () => ({
  resolveManagedDataQualityIssue: async () => { io.qualityWrites.push('resolved') },
  upsertManagedDataQualityIssue: async () => { io.qualityWrites.push('opened') },
}))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('http://127.0.0.1:54321', 'synthetic-unit-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input, init) => {
          const url = new URL(input instanceof Request ? input.url : String(input))
          const table = url.pathname.split('/').at(-1)!
          if (io.failures[table]) return new Response(JSON.stringify(io.failures[table]), { status: 500 })
          if (table === 'gridex_forecast_metering_period_totals_v1') {
            if (io.failures.metering_values) return new Response(JSON.stringify(io.failures.metering_values), { status: 500 })
            const args = JSON.parse(input instanceof Request ? await input.clone().text() : String(init?.body ?? '{}')) as Record<string, string>
            const selected = (io.tables.metering_values ?? []).filter(row => row.company_id === args.p_company_id
              && row.metering_point_id === args.p_metering_point_id
              && String(row.period_start) >= args.p_period_start && String(row.period_start) < args.p_period_end)
            return new Response(JSON.stringify([{ total_kwh: selected.reduce((sum, row) => sum + Number(row.value_kwh ?? row.quantity_kwh ?? 0), 0), value_count: selected.length }]),
              { headers: { 'content-type': 'application/json' } })
          }
          let rows = [...(io.tables[table] ?? [])]
          function matches(row: Row, field: string, expression: string): boolean {
            const dot = expression.indexOf('.')
            const op = expression.slice(0, dot)
            const value = expression.slice(dot + 1)
            if (op === 'is' && value === 'null') return row[field] === null
            if (row[field] === null || row[field] === undefined) return false
            if (op === 'eq') return String(row[field]) === value
            if (op === 'gte') return String(row[field]) >= value
            if (op === 'lt') return String(row[field]) < value
            throw new Error('Unsupported synthetic profile read operator: ' + op)
          }
          for (const [field, value] of url.searchParams) {
            if (['select', 'order', 'limit'].includes(field)) continue
            if (field === 'or') {
              const alternatives = value.slice(1, -1).split(',')
              rows = rows.filter(row => alternatives.some(alternative => {
                const dot = alternative.indexOf('.')
                return matches(row, alternative.slice(0, dot), alternative.slice(dot + 1))
              }))
            } else rows = rows.filter(row => matches(row, field, value))
          }
          const order = url.searchParams.get('order')
          if (order) {
            const [field, direction, nullOrder] = order.split('.')
            // PostgreSQL DESC uses NULLS FIRST unless explicitly overridden.
            const nullFirst = nullOrder === 'nullsfirst' || (!nullOrder && direction === 'desc')
            rows.sort((a, b) => {
              if (a[field] === null) return b[field] === null ? 0 : nullFirst ? -1 : 1
              if (b[field] === null) return nullFirst ? 1 : -1
              return String(a[field]).localeCompare(String(b[field])) * (direction === 'desc' ? -1 : 1)
            })
          }
          const limit = url.searchParams.get('limit')
          if (limit) rows = rows.slice(0, Number(limit))
          return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json' } })
        },
      },
    }),
  }
})

import * as profiles from '@/lib/forecasting/consumptionProfiles'
import { calculateMeteringPointForecast } from '@/lib/forecasting/meteringPointForecast'

const company = '11111111-1111-4111-8111-111111111111'
const foreignCompany = '22222222-2222-4222-8222-222222222222'
const point = '33333333-3333-4333-8333-333333333333'
const uniformWeight = 8.333333333333334
function profile(id: string, companyId: string | null, changes: Partial<Row> = {}): Row {
  return {
    id, company_id: companyId, name: 'Synthetic profile', is_default: true,
    customer_type: null, heating_type: null, metering_method: null, ...changes,
  }
}
function weight(id: string, percent: number | string, month = 10): Row {
  return { id: 'weight-' + id + '-' + month, profile_id: id, month_number: month, weight_percent: percent }
}
function forecast() {
  return calculateMeteringPointForecast({ companyId: company, meteringPointId: point, periodStart: '2026-10-01', periodEnd: '2026-11-01' })
}
async function basis(profileId: string | null) {
  // The new internal typed resolver is deliberately asserted as behavior,
  // without requiring a missing export to break module/test collection in RED.
  const resolve = Reflect.get(profiles, 'getMonthlyWeightBasis') as (
    companyId: string, profileId: string | null, monthNumber: number,
  ) => Promise<Record<string, unknown>>
  expect(resolve).toBeTypeOf('function')
  return resolve(company, profileId, 10)
}

beforeEach(() => {
  io.failures = {}
  io.qualityWrites = []
  io.tables = {
    consumption_profiles: [], consumption_profile_month_weights: [], metering_values: [],
    metering_points: [{
      id: point, company_id: company, customer_id: null, site_id: null, grid_owner_id: null,
      bidding_zone_code: 'SE3', estimated_annual_consumption_kwh: 1200,
      consumption_profile_id: null, start_date: null, end_date: null, customer_sites: null,
    }],
  }
})

describe('real monthly profile numeric wrapper', () => {
  it.each([0, '0'])('preserves configured weight %j rather than inventing uniform consumption', async value => {
    io.tables.consumption_profiles = [profile('configured', company, { is_default: false })]
    io.tables.consumption_profile_month_weights = [weight('configured', value)]
    expect(await profiles.getMonthlyWeightPercent(company, 'configured', 10)).toBe(0)
  })
  it('selects the relevant tenant generic default before a global generic default', async () => {
    io.tables.consumption_profiles = [profile('tenant', company), profile('global', null)]
    io.tables.consumption_profile_month_weights = [weight('tenant', 5), weight('global', 20)]
    expect(await profiles.getMonthlyWeightPercent(company, null, 10)).toBe(5)
  })
  it.each([company, null])('refuses two competing relevant defaults in the same scope %j', async scope => {
    io.tables.consumption_profiles = [profile('one', scope), profile('two', scope)]
    io.tables.consumption_profile_month_weights = [weight('one', 5), weight('two', 20)]
    await expect(profiles.getMonthlyWeightPercent(company, null, 10)).rejects.toMatchObject({ code: 'CONSUMPTION_PROFILE_DEFAULT_AMBIGUOUS' })
  })
  it('does not use a category-specific default when the actual category is unknown', async () => {
    io.tables.consumption_profiles = [profile('special', company, { customer_type: 'business' })]
    io.tables.consumption_profile_month_weights = [weight('special', 45)]
    expect(await profiles.getMonthlyWeightPercent(company, null, 10)).toBe(uniformWeight)
  })
  it('uses the genuine global generic default when tenant defaults are unrelated', async () => {
    io.tables.consumption_profiles = [profile('special', company, { heating_type: 'electric' }), profile('generic', null)]
    io.tables.consumption_profile_month_weights = [weight('special', 45), weight('generic', 3)]
    expect(await profiles.getMonthlyWeightPercent(company, null, 10)).toBe(3)
  })
  it('refuses an explicitly configured foreign profile', async () => {
    io.tables.consumption_profiles = [profile('foreign', foreignCompany, { is_default: false })]
    io.tables.consumption_profile_month_weights = [weight('foreign', 70)]
    await expect(profiles.getMonthlyWeightPercent(company, 'foreign', 10)).rejects.toMatchObject({ code: 'CONSUMPTION_PROFILE_SCOPE_MISMATCH' })
  })
  it('keeps an explicitly selected genuine global non-default profile usable', async () => {
    io.tables.consumption_profiles = [profile('selected-global', null, { is_default: false })]
    io.tables.consumption_profile_month_weights = [weight('selected-global', 6)]
    expect(await profiles.getMonthlyWeightPercent(company, 'selected-global', 10)).toBe(6)
  })
  it.each(['42501', '42P01', 'PGRST202', '08006'])('propagates default-profile read failure %s', async code => {
    io.failures.consumption_profiles = { code, message: 'Synthetic profile source unavailable' }
    await expect(profiles.getMonthlyWeightPercent(company, null, 10)).rejects.toMatchObject({ code })
  })
  it.each(['42501', '42P01', 'PGRST202', '08006'])('propagates month-weight read failure %s', async code => {
    io.tables.consumption_profiles = [profile('selected', company)]
    io.failures.consumption_profile_month_weights = { code, message: 'Could not find synthetic weight table in schema cache' }
    await expect(profiles.getMonthlyWeightPercent(company, 'selected', 10)).rejects.toMatchObject({ code })
  })
  it('preserves declared numerical fallback for legitimate profile/month absence', async () => {
    expect(await profiles.getMonthlyWeightPercent(company, null, 10)).toBe(uniformWeight)
    io.tables.consumption_profiles = [profile('selected', company)]
    expect(await profiles.getMonthlyWeightPercent(company, 'selected', 10)).toBe(uniformWeight)
  })
})

describe('typed basis and actual annual-estimate consumer', () => {
  it('labels missing profile provenance separately from configured complete zero', async () => {
    expect(await basis(null)).toMatchObject({ kind: 'missing', reason: 'profile_missing', weightPercent: uniformWeight })
    io.tables.consumption_profiles = [profile('selected', company, { is_default: false })]
    io.tables.consumption_profile_month_weights = [weight('selected', 0)]
    expect(await basis('selected')).toMatchObject({ kind: 'configured', profileId: 'selected', weightPercent: 0 })
  })
  it('labels a legitimate missing monthly weight without claiming configured data', async () => {
    io.tables.consumption_profiles = [profile('selected', company, { is_default: false })]
    expect(await basis('selected')).toMatchObject({ kind: 'missing', reason: 'month_weight_missing', profileId: 'selected', weightPercent: uniformWeight })
  })
  it('labels competing generic defaults ambiguous rather than a numeric fallback', async () => {
    io.tables.consumption_profiles = [profile('one', company), profile('two', company)]
    expect(await basis(null)).toMatchObject({ kind: 'ambiguous', scope: 'company' })
  })
  it('labels unavailable default source separately from legitimate missing data', async () => {
    io.failures.consumption_profiles = { code: '42501', message: 'Synthetic denied source' }
    expect(await basis(null)).toMatchObject({ kind: 'unavailable' })
  })
  it('uses complete configured zero in the actual annual-estimate calculation', async () => {
    io.tables.metering_points[0].consumption_profile_id = 'selected'
    io.tables.consumption_profiles = [profile('selected', company, { is_default: false })]
    io.tables.consumption_profile_month_weights = [weight('selected', 0)]
    expect(await forecast()).toMatchObject({ forecastKwh: 0, method: 'annual_estimate' })
  })
  it.each(['42501', '42P01', 'PGRST202'])('does not resolve missing-basis evidence after a failed profile read %s', async code => {
    io.failures.consumption_profiles = { code, message: 'Synthetic unavailable profile' }
    await expect(forecast()).rejects.toMatchObject({ code })
    expect(io.qualityWrites).toEqual([])
  })
})
