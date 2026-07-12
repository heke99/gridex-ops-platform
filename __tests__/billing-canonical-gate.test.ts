import { describe, expect, it } from 'vitest'
import { evaluateBillingGate } from '@/lib/billing/billingGate'

const value = {
  id: 'v1', company_id: 'c1', customer_id: 'cust1', metering_point_id: 'mp1',
  period_start: '2026-06-01T00:00:00+02:00', period_end: '2026-06-01T00:15:00+02:00',
  quantity_kwh: 1.5, unit: 'kWh', direction: 'consumption', quality_status: 'measured',
  source_metering_value_id: 'raw1', source_message_id: 'msg1', revision_status: 'current', revision_number: 1,
}
const supply = { id: 'sp1', company_id: 'c1', customer_id: 'cust1', metering_point_id: 'mp1', status: 'active', start_date: '2026-01-01', end_date: null }
const contract = { id: 'ct1', company_id: 'c1', customer_id: 'cust1', metering_point_id: 'mp1', status: 'active', starts_at: '2026-01-01', ends_at: null }
const sourceMessage = { id: 'msg1', company_id: 'c1', message_family: 'UTILTS', status: 'validated' }

describe('canonical billing gate', () => {
  it('allows only complete, current and business-covered lineage', () => {
    const result = evaluateBillingGate({ normalizedValue: value, supplyPeriod: supply, supplyPeriodCandidateCount: 1, contract, contractCandidateCount: 1, sourceMessage })
    expect(result.status).toBe('eligible')
    expect(result.reasons).toEqual([])
    expect(result.snapshot).toMatchObject({ source_message_id: 'msg1', supply_period_id: 'sp1', contract_id: 'ct1' })
  })

  it('blocks Z04C-like missing supply and incomplete Ediel lineage', () => {
    const result = evaluateBillingGate({ normalizedValue: { ...value, source_message_id: null }, supplyPeriod: null, supplyPeriodCandidateCount: 0, contract: null, contractCandidateCount: 0, sourceMessage: null })
    expect(result.eligible).toBe(false)
    expect(result.reasons.map((item) => item.code)).toEqual(expect.arrayContaining(['source_message_missing', 'supply_period_missing', 'contract_missing']))
  })
})
