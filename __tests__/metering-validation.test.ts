import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type Row } from './helpers/supabaseMock'

const state: {
  maxRows: number
  tables: Record<string, Row[]>
  errorsByTable: Record<string, { code?: string; message?: string }>
} = { maxRows: Infinity, tables: {}, errorsByTable: {} }

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from(table: string) {
      const rows = (state.tables[table] ?? []).map((row, index) => ({
        id: String(index + 1).padStart(8, '0'),
        ...row,
      }))
      const fake = createFakeSupabase({ tables: { ...state.tables, [table]: rows }, errorsByTable: state.errorsByTable })
      const query = fake.client.from(table)
      const limit = query.limit.bind(query)
      query.limit = count => limit(Math.min(count, state.maxRows))
      return query
    },
  },
}))

import { evaluateMeteringCompletenessForMonth } from '@/lib/metering/validation'
import { stockholmMonthBounds } from '@/lib/time/stockholm'

// May 2026 in Europe/Stockholm is CEST (UTC+2). Billing completeness must
// therefore follow local Swedish month boundaries, not UTC calendar midnight.
const MONTH = '2026-05'
const { start: MONTH_START, end: MONTH_END } = stockholmMonthBounds(MONTH)

function value(overrides: Partial<Row> = {}): Row {
  return {
    company_id: 'company-1',
    metering_point_id: 'mp-1',
    period_start: MONTH_START,
    period_end: MONTH_END,
    quantity_kwh: 1000,
    quality_status: 'final',
    ...overrides,
  }
}

beforeEach(() => {
  state.maxRows = Infinity
  state.tables = { normalized_metering_values: [] }
  state.errorsByTable = {}
})

describe('evaluateMeteringCompletenessForMonth', () => {
  it('reports complete when a single value covers the whole Swedish billing month', async () => {
    state.tables.normalized_metering_values = [value()]

    const result = await evaluateMeteringCompletenessForMonth({
      companyId: 'company-1',
      billingMonth: MONTH,
      meteringPoints: [{ meteringPointId: 'mp-1', expectedKwh: 1000 }],
    })

    expect(result.status).toBe('complete')
    expect(result.issues).toHaveLength(0)
  })

  it('blocks when a metering point has no values at all', async () => {
    const result = await evaluateMeteringCompletenessForMonth({
      companyId: 'company-1',
      billingMonth: MONTH,
      meteringPoints: [{ meteringPointId: 'mp-1' }],
    })

    expect(result.status).toBe('no_data')
    expect(result.issues.some((issue) => issue.code === 'metering_values_missing' && issue.severity === 'blocked')).toBe(true)
  })

  it('blocks on coverage gaps', async () => {
    state.tables.normalized_metering_values = [
      value({ period_end: '2026-05-20T00:00:00.000Z' }),
    ]

    const result = await evaluateMeteringCompletenessForMonth({
      companyId: 'company-1',
      billingMonth: MONTH,
      meteringPoints: [{ meteringPointId: 'mp-1' }],
    })

    expect(result.status).toBe('incomplete')
    const gap = result.issues.find((issue) => issue.code === 'metering_gap')
    expect(gap?.severity).toBe('blocked')
    expect(gap?.meteringPointId).toBe('mp-1')
  })

  it('blocks on overlapping (duplicate) values that would double-bill', async () => {
    state.tables.normalized_metering_values = [
      value({ period_start: MONTH_START, period_end: '2026-05-20T00:00:00.000Z' }),
      value({ period_start: '2026-05-10T00:00:00.000Z', period_end: MONTH_END }),
    ]

    const result = await evaluateMeteringCompletenessForMonth({
      companyId: 'company-1',
      billingMonth: MONTH,
      meteringPoints: [{ meteringPointId: 'mp-1' }],
    })

    expect(result.issues.some((issue) => issue.code === 'metering_overlap' && issue.severity === 'blocked')).toBe(true)
  })

  it('blocks estimated values for final invoicing by default', async () => {
    state.tables.normalized_metering_values = [value({ quality_status: 'estimated' })]

    const result = await evaluateMeteringCompletenessForMonth({
      companyId: 'company-1',
      billingMonth: MONTH,
      meteringPoints: [{ meteringPointId: 'mp-1' }],
    })

    expect(result.status).toBe('estimated_only')
    expect(result.estimatedValueCount).toBe(1)
    expect(result.issues.some((issue) => issue.code === 'metering_estimated' && issue.severity === 'blocked')).toBe(true)
  })

  it('downgrades estimated values to warnings when the company policy allows it', async () => {
    state.tables.normalized_metering_values = [value({ quality_status: 'preliminary' })]

    const result = await evaluateMeteringCompletenessForMonth({
      companyId: 'company-1',
      billingMonth: MONTH,
      meteringPoints: [{ meteringPointId: 'mp-1' }],
      allowEstimatedValues: true,
    })

    expect(result.status).toBe('complete')
    expect(result.issues.some((issue) => issue.code === 'metering_estimated' && issue.severity === 'warning')).toBe(true)
  })

  it('warns when the value sum deviates from the underlay total', async () => {
    state.tables.normalized_metering_values = [value({ quantity_kwh: 900 })]

    const result = await evaluateMeteringCompletenessForMonth({
      companyId: 'company-1',
      billingMonth: MONTH,
      meteringPoints: [{ meteringPointId: 'mp-1', expectedKwh: 1000 }],
    })

    const mismatch = result.issues.find((issue) => issue.code === 'metering_total_mismatch')
    expect(mismatch?.severity).toBe('warning')
    expect(result.status).toBe('complete')
  })

  it('returns no_data without issues when there are no metering points to validate', async () => {
    const result = await evaluateMeteringCompletenessForMonth({
      companyId: 'company-1',
      billingMonth: MONTH,
      meteringPoints: [],
    })

    expect(result.status).toBe('no_data')
    expect(result.issues).toHaveLength(0)
  })

  it('degrades to a warning (not silent pass) when the table is missing', async () => {
    state.errorsByTable.normalized_metering_values = { code: '42P01', message: 'relation does not exist' }

    const result = await evaluateMeteringCompletenessForMonth({
      companyId: 'company-1',
      billingMonth: MONTH,
      meteringPoints: [{ meteringPointId: 'mp-1' }],
    })

    expect(result.status).toBe('no_data')
    expect(result.issues.some((issue) => issue.code === 'metering_values_missing' && issue.severity === 'warning')).toBe(true)
  })

  it('rejects malformed billing months', async () => {
    await expect(
      evaluateMeteringCompletenessForMonth({
        companyId: 'company-1',
        billingMonth: 'maj 2026',
        meteringPoints: [{ meteringPointId: 'mp-1' }],
      })
    ).rejects.toThrow(/YYYY-MM/)
  })

  it('blocks a monthly total when the contract needs hourly values', async () => {
    state.tables.normalized_metering_values = [value()]

    const result = await evaluateMeteringCompletenessForMonth({
      companyId: 'company-1',
      billingMonth: MONTH,
      meteringPoints: [{ meteringPointId: 'mp-1', requiredResolution: 'hour' }],
    })

    expect(result.status).toBe('incomplete')
    expect(result.issues.map((issue) => issue.code)).toContain('metering_resolution_insufficient')
  })

  it('accepts a monthly total for a monthly contract', async () => {
    state.tables.normalized_metering_values = [value()]

    const result = await evaluateMeteringCompletenessForMonth({
      companyId: 'company-1',
      billingMonth: MONTH,
      meteringPoints: [{ meteringPointId: 'mp-1', requiredResolution: 'month' }],
    })

    expect(result.status).toBe('complete')
  })

  it('blocks when the meter cannot deliver the contract resolution', async () => {
    state.tables.normalized_metering_values = [value()]

    const result = await evaluateMeteringCompletenessForMonth({
      companyId: 'company-1',
      billingMonth: MONTH,
      meteringPoints: [{ meteringPointId: 'mp-1', requiredResolution: 'quarter_hour', meterCannotDeliver: true }],
    })

    expect(result.issues.map((issue) => issue.code)).toContain('metering_point_resolution_mismatch')
  })
})


it('reads all quarter-hour intervals even below the requested PostgREST page size', async () => {
  state.maxRows = 713
  const start = Date.parse(MONTH_START)
  const quarter = 15 * 60_000
  const count = (Date.parse(MONTH_END) - start) / quarter
  state.tables.normalized_metering_values = Array.from({ length: count }, (_, index) => value({
    period_start: new Date(start + index * quarter).toISOString(),
    period_end: new Date(start + (index + 1) * quarter).toISOString(),
    quantity_kwh: 0.25,
  }))

  const result = await evaluateMeteringCompletenessForMonth({
    companyId: 'company-1',
    billingMonth: MONTH,
    meteringPoints: [{ meteringPointId: 'mp-1', expectedKwh: count * 0.25 }],
  })

  expect(result).toMatchObject({ status: 'complete', valueCount: count, issues: [] })
})

it('compares each split price-period total with its own values on the same point', async () => {
  const boundary = '2026-05-15T00:00:00.000Z'
  state.tables.normalized_metering_values = [
    value({ period_end: boundary, quantity_kwh: 20 }),
    value({ period_start: boundary, quantity_kwh: 30 }),
  ]

  const result = await evaluateMeteringCompletenessForMonth({
    companyId: 'company-1',
    billingMonth: MONTH,
    meteringPoints: [
      { meteringPointId: 'mp-1', expectedKwh: 20, expectedPeriod: { start: MONTH_START, end: boundary } },
      { meteringPointId: 'mp-1', expectedKwh: 32, expectedPeriod: { start: boundary, end: MONTH_END } },
    ],
  })

  expect(result.status).toBe('complete')
  expect(result.issues).toHaveLength(1)
  expect(result.issues[0]).toMatchObject({
    code: 'metering_total_mismatch', details: { actual_kwh: 30, expected_kwh: 32 },
  })
})

it('does not attribute a single quantity spanning an exact period boundary', async () => {
  state.tables.normalized_metering_values = [value()]
  const result = await evaluateMeteringCompletenessForMonth({
    companyId: 'company-1',
    billingMonth: MONTH,
    meteringPoints: [{ meteringPointId: 'mp-1', expectedKwh: 500, expectedPeriod: { start: MONTH_START, end: '2026-05-15T00:00:00.000Z' } }],
  })
  expect(result.status).toBe('complete')
  expect(result.issues).toEqual([])
})
