import { describe, expect, it } from 'vitest'
import { evaluateBillingUnderlayReadiness, findMeterValuesForUnderlay } from '@/lib/cis/billingReadiness'
import type { BillingUnderlayRow, MeteringValueRow } from '@/lib/cis/types'

const junePeriod = ['2026-06-30T21:45:00Z', '2026-06-30T22:00:00Z'] as const
const julyPeriod = ['2026-06-30T22:00:00Z', '2026-06-30T22:15:00Z'] as const
const winterPeriod = ['2025-12-31T23:00:00Z', '2025-12-31T23:15:00Z'] as const

function meter(id: string, period: readonly [string, string], overrides: Partial<MeteringValueRow> = {}): MeteringValueRow {
  return {
    id, company_id: 'tenant', customer_id: 'customer', site_id: 'site', metering_point_id: 'meter',
    source_request_id: 'request', grid_owner_id: 'grid-owner', reading_type: 'consumption', value_kwh: 1,
    quality_code: 'measured', read_at: period[1], period_start: period[0], period_end: period[1],
    source_system: 'ediel_utilts', raw_payload: {}, created_at: period[1], created_by: null, ...overrides,
  }
}

function underlay(year: number, month: number, payload: Record<string, unknown>): BillingUnderlayRow {
  return {
    id: 'underlay', company_id: 'tenant', customer_id: 'customer', site_id: 'site', metering_point_id: 'meter',
    source_request_id: 'request', grid_owner_id: 'grid-owner', underlay_year: year, underlay_month: month,
    status: 'received', total_kwh: 1, total_sek_ex_vat: null, currency: 'SEK', source_system: 'ediel_utilts',
    payload, received_at: null, validated_at: null, exported_at: null, failure_reason: null,
    created_at: julyPeriod[1], updated_at: julyPeriod[1], created_by: null, updated_by: null,
  }
}

function projection(year: number, month: number, period: readonly [string, string]) {
  return {
    version: 'stockholm-observation-month-v1',
    timeZone: 'Europe/Stockholm',
    year,
    month,
    observationPeriods: [period],
  }
}

const legacyScope = {
  e73BillingScope: { contributors: [['E66', 0], ['E66', 1]] },
  consumptionContracts: [{
    transactionId: 'E66',
    observations: [junePeriod, julyPeriod].map(([periodStart, periodEnd]) => ({ periodStart, periodEnd })),
  }],
}

describe('Stockholm E66 underlay evidence in ordinary CIS review', () => {
  it('displays only the exact contribution for each month in a multi-month E73 response', () => {
    const june = underlay(2026, 6, { ...legacyScope, billingCalendar: projection(2026, 6, junePeriod) })
    const july = underlay(2026, 7, { e73BillingScope: legacyScope.e73BillingScope, billingCalendar: projection(2026, 7, julyPeriod) })
    const meters = [
      meter('closing June', junePeriod), meter('opening July', julyPeriod),
      meter('wrong request', julyPeriod, { source_request_id: 'another-request' }),
      meter('wrong company', junePeriod, { company_id: 'another-company' }),
    ]
    expect(findMeterValuesForUnderlay(june, meters).map(row => row.id)).toEqual(['closing June'])
    expect(findMeterValuesForUnderlay(july, meters).map(row => row.id)).toEqual(['opening July'])
  })

  it('retains the opening January quarter and gives a clear reason before generic partner export', () => {
    const january = underlay(2026, 1, { billingCalendar: projection(2026, 1, winterPeriod) })
    const result = evaluateBillingUnderlayReadiness({ underlay: january, meterValues: [meter('January', winterPeriod)] })
    expect(result.matchedMeterValueCount).toBe(1)
    expect(result.isExportable).toBe(false)
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'ediel_qualified_month_underlay_required' }))
  })

  it('rejects a projected interval that crosses the exclusive Swedish month end', () => {
    const crossed = [junePeriod[0], julyPeriod[1]] as const
    const june = underlay(2026, 6, { billingCalendar: projection(2026, 6, crossed) })
    const result = evaluateBillingUnderlayReadiness({ underlay: june, meterValues: [meter('ambiguous', crossed)] })
    expect(result.matchedMeterValueCount).toBe(0)
    expect(result.isExportable).toBe(false)
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'ediel_source_scope_invalid' }))
  })

  it('keeps older underlays on the existing saved E73 scope', () => {
    const original = underlay(2026, 6, legacyScope)
    const result = evaluateBillingUnderlayReadiness({
      underlay: original,
      meterValues: [meter('closing June', junePeriod), meter('opening July', julyPeriod)],
    })
    expect(result.matchedMeterValueCount).toBe(2)
    expect(result.issues).not.toContainEqual(expect.objectContaining({ code: 'ediel_qualified_month_underlay_required' }))
  })
})
