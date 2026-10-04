// masterplan: DB-06, AT-DB-06
import { describe, expect, it } from 'vitest'
import { evaluateBillingGate } from '@/lib/billing/billingGate'

const value = {
  id: 'v1', company_id: 'c1', customer_id: 'cust1', metering_point_id: 'mp1',
  period_start: '2026-06-01T00:00:00+02:00', period_end: '2026-06-01T00:15:00+02:00',
  quantity_kwh: '1.5', unit: 'kWh', direction: 'consumption', quality_status: null, product_code: '8716867000030',
  source_metering_value_id: 'raw1', source_message_id: 'msg1', revision_status: 'current', revision_number: 1,
  billing_source_basis: { version: 1, qualified: true, normalizedValueId: 'v1', sourceMessageId: 'msg1', quantityKwh: '1.5', quantityType: '136', quality: null, qualityEstablished: true, productCode: '8716867000030' },
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
  it('cannot turn an omitted source row or a cached eligible flag into source authority', () => {
    for (const normalizedValue of [value, { ...value, billing_source_basis: undefined }]) {
      const result = evaluateBillingGate({ normalizedValue, supplyPeriod: supply, contract })
      expect(result.eligible).toBe(false)
      expect(result.reasons.map(reason => reason.code)).toContain('source_message_missing')
    }
  })
  it.each(['21', '56', '46', '113', '125'])('holds source nonapproved quality %s even when estimated values were requested', quality => {
    const result = evaluateBillingGate({ normalizedValue: { ...value, quality_status: quality, billing_source_basis: { ...value.billing_source_basis, quality } }, supplyPeriod: supply, contract, sourceMessage, allowEstimatedValues: true })
    expect(result.eligible).toBe(false)
    expect(result.reasons.map(reason => reason.code)).toContain('quality_not_final')
  })
  it('holds unknown quality and a quantity that lost its exact string', () => {
    const result = evaluateBillingGate({ normalizedValue: { ...value, quantity_kwh: 1.5, billing_source_basis: { ...value.billing_source_basis, qualityEstablished: false } }, supplyPeriod: supply, contract, sourceMessage })
    expect(result.reasons.map(reason => reason.code)).toEqual(expect.arrayContaining(['quality_not_established', 'quantity_invalid', 'source_basis_unqualified']))
  })
  it('preserves an exact quantity beyond the safe integer range', () => {
    const quantity = '9007199254740993.000000000000000001'
    expect(evaluateBillingGate({ normalizedValue: { ...value, quantity_kwh: quantity, billing_source_basis: { ...value.billing_source_basis, quantityKwh: quantity } }, supplyPeriod: supply, contract, sourceMessage }).eligible).toBe(true)
  })

  it('bills an ended supply period up to its end date, never an open-ended one', () => {
    const ended = { ...supply, status: 'ended', end_date: '2026-06-30' }
    expect(evaluateBillingGate({ normalizedValue: value, supplyPeriod: ended, supplyPeriodCandidateCount: 1, contract, contractCandidateCount: 1, sourceMessage }).status).toBe('eligible')
    const openEnded = evaluateBillingGate({ normalizedValue: value, supplyPeriod: { ...ended, end_date: null }, supplyPeriodCandidateCount: 1, contract, contractCandidateCount: 1, sourceMessage })
    expect(openEnded.reasons.map((item) => item.code)).toContain('supply_period_not_active')
  })
})
