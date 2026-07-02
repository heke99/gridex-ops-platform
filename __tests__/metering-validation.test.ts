import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type Row } from './helpers/supabaseMock'

const state: {
  tables: Record<string, Row[]>
  errorsByTable: Record<string, { code?: string; message?: string }>
} = { tables: {}, errorsByTable: {} }

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from(table: string) {
      const fake = createFakeSupabase({ tables: state.tables, errorsByTable: state.errorsByTable })
      return fake.client.from(table)
    },
  },
}))

import { evaluateMeteringCompletenessForMonth } from '@/lib/metering/validation'

// May 2026: 31 days.
const MONTH = '2026-05'
const MONTH_START = '2026-05-01T00:00:00.000Z'
const MONTH_END = '2026-06-01T00:00:00.000Z'

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
  state.tables = { normalized_metering_values: [] }
  state.errorsByTable = {}
})

describe('evaluateMeteringCompletenessForMonth', () => {
  it('reports complete when a single value covers the whole month', async () => {
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
})
