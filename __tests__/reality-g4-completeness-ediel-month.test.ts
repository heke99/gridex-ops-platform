// reality-defects: G-4
// Billing completeness (evaluateMeteringCompletenessForMonth) called without explicit windows measured every point
// against the Swedish civil month. For an Ediel supply the billed month is the Ediel month (00:00 +0100 on the 1st,
// FINDINGS F108 / ENV-08): October 2026 = 2 976 quarter-hours (744 h), while the civil October has 745 h, so a
// complete Ediel October reported metering_gap "1 h saknas" (reality G7). A manual supply keeps the civil month (M7).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type Row } from './helpers/supabaseMock'

const state: { tables: Record<string, Row[]> } = { tables: {} }

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from(table: string) {
      return createFakeSupabase({ tables: state.tables }).client.from(table)
    },
  },
}))

import { evaluateMeteringCompletenessForMonth } from '@/lib/metering/validation'
import { edielMonthBounds } from '@/lib/billing/billingMonth'
import { stockholmMonthBounds } from '@/lib/time/stockholm'

const COMPANY = 'company-g4'
const QUARTER = 900_000

function quarters(start: string, end: string, point = 'mp-1'): Row[] {
  const rows: Row[] = []
  for (let ms = Date.parse(start); ms < Date.parse(end); ms += QUARTER) {
    rows.push({ id: `v-${point}-${ms}`, company_id: COMPANY, metering_point_id: point, period_start: new Date(ms).toISOString(), period_end: new Date(ms + QUARTER).toISOString(), quantity_kwh: '0.25', quality_status: 'final' })
  }
  return rows
}

function edielSupply(point: string, startDate: string, marketStart: string): Row {
  return { id: `sp-${point}`, company_id: COMPANY, metering_point_id: point, status: 'active', start_date: startDate, end_date: null, actual_start_date: startDate, actual_end_date: null, market_start_at: marketStart, market_end_at: null }
}

function manualSupply(point: string, startDate: string): Row {
  return { id: `sp-${point}`, company_id: COMPANY, metering_point_id: point, status: 'active', start_date: startDate, end_date: null, actual_start_date: startDate, actual_end_date: null, market_start_at: null, market_end_at: null }
}

const evaluate = (month: string, point = 'mp-1') =>
  evaluateMeteringCompletenessForMonth({ companyId: COMPANY, billingMonth: month, meteringPoints: [{ meteringPointId: point, requiredResolution: 'quarter_hour' }] })

beforeEach(() => { state.tables = {} })

describe('G-4 billing completeness uses the billing frame of the supply', () => {
  it('DST October 2026: a complete Ediel month (2 976 quarter-hours, 744 h) is complete for an Ediel supply', async () => {
    const ediel = edielMonthBounds('2026-10')
    expect(ediel).toEqual({ start: '2026-09-30T23:00:00.000Z', end: '2026-10-31T23:00:00.000Z' })
    state.tables = { normalized_metering_values: quarters(ediel.start, ediel.end), customer_supply_periods: [edielSupply('mp-1', '2026-09-01', '2026-08-31T23:00:00Z')] }
    const result = await evaluate('2026-10')
    expect(result.issues).toEqual([])
    expect(result).toMatchObject({ status: 'complete', valueCount: 2976 })
  })

  it('DST October 2026: a real one-hour gap inside the Ediel month still blocks', async () => {
    const ediel = edielMonthBounds('2026-10')
    const values = quarters(ediel.start, ediel.end).filter(row => !(String(row.period_start) >= '2026-10-25T00:00' && String(row.period_start) < '2026-10-25T01:00'))
    state.tables = { normalized_metering_values: values, customer_supply_periods: [edielSupply('mp-1', '2026-09-01', '2026-08-31T23:00:00Z')] }
    const result = await evaluate('2026-10')
    expect(result.status).toBe('incomplete')
    expect(result.issues.find(issue => issue.code === 'metering_gap')?.details).toMatchObject({ missing_hours: 1 })
  })

  it('DST October 2026: a manual supply keeps the civil month (745 h); Ediel-framed values lack its first hour', async () => {
    const civil = stockholmMonthBounds('2026-10')
    expect((Date.parse(civil.end) - Date.parse(civil.start)) / 3_600_000).toBe(745)
    const ediel = edielMonthBounds('2026-10')
    state.tables = { normalized_metering_values: quarters(ediel.start, ediel.end), customer_supply_periods: [manualSupply('mp-1', '2026-09-01')] }
    const gap = await evaluate('2026-10')
    expect(gap.issues.find(issue => issue.code === 'metering_gap')?.details).toMatchObject({ missing_hours: 1 })
    state.tables = { normalized_metering_values: quarters(civil.start, civil.end), customer_supply_periods: [manualSupply('mp-1', '2026-09-01')] }
    const full = await evaluate('2026-10')
    expect(full).toMatchObject({ status: 'complete', valueCount: 2980 })
  })

  it('a point without a billed supply period keeps the whole civil month (unchanged)', async () => {
    const ediel = edielMonthBounds('2026-10')
    state.tables = { normalized_metering_values: quarters(ediel.start, ediel.end) }
    const result = await evaluate('2026-10')
    expect(result.issues.map(issue => issue.code)).toContain('metering_gap')
  })

  it('DST March 2027: civil 743 h, Ediel 744 h; the Ediel supply needs the hour after civil month end', async () => {
    const civil = stockholmMonthBounds('2027-03')
    const ediel = edielMonthBounds('2027-03')
    expect((Date.parse(civil.end) - Date.parse(civil.start)) / 3_600_000).toBe(743)
    expect((Date.parse(ediel.end) - Date.parse(ediel.start)) / 3_600_000).toBe(744)
    const supply = [edielSupply('mp-1', '2026-09-01', '2026-08-31T23:00:00Z')]
    state.tables = { normalized_metering_values: quarters(ediel.start, ediel.end), customer_supply_periods: supply }
    expect(await evaluate('2027-03')).toMatchObject({ status: 'complete', valueCount: 2976 })
    // Only the civil month delivered: the last Ediel hour (22:00Z-23:00Z on 31 March) is missing.
    state.tables = { normalized_metering_values: quarters(civil.start, civil.end), customer_supply_periods: supply }
    const short = await evaluate('2027-03')
    expect(short.issues.find(issue => issue.code === 'metering_gap')?.details).toMatchObject({ missing_hours: 1 })
    // A manual supply bills the civil March of 743 h.
    state.tables = { normalized_metering_values: quarters(civil.start, civil.end), customer_supply_periods: [manualSupply('mp-1', '2026-09-01')] }
    expect(await evaluate('2027-03')).toMatchObject({ status: 'complete', valueCount: 2972 })
  })

  it('normal month November 2026: civil and Ediel month coincide (720 h)', async () => {
    const civil = stockholmMonthBounds('2026-11')
    expect(edielMonthBounds('2026-11')).toEqual({ start: civil.start, end: civil.end })
    for (const period of [edielSupply('mp-1', '2026-09-01', '2026-08-31T23:00:00Z'), manualSupply('mp-1', '2026-09-01')]) {
      state.tables = { normalized_metering_values: quarters(civil.start, civil.end), customer_supply_periods: [period] }
      expect(await evaluate('2026-11')).toMatchObject({ status: 'complete', valueCount: 2880 })
    }
  })

  it('explicit windows still decide over the supply periods', async () => {
    const ediel = edielMonthBounds('2026-10')
    state.tables = { normalized_metering_values: quarters(ediel.start, '2026-10-15T22:00:00.000Z'), customer_supply_periods: [edielSupply('mp-1', '2026-09-01', '2026-08-31T23:00:00Z')] }
    const result = await evaluateMeteringCompletenessForMonth({ companyId: COMPANY, billingMonth: '2026-10',
      meteringPoints: [{ meteringPointId: 'mp-1', windows: [{ start: ediel.start, end: '2026-10-15T22:00:00.000Z' }] }] })
    expect(result.issues.filter(issue => issue.severity === 'blocked')).toEqual([])
  })
})
