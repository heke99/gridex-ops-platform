// reality-defects: (reality scenario H "the customer leaves", FINDINGS H1–H4)
// Billing around a received end of supply (PRODAT Z05). The periods and contracts below are exactly what the
// platform writes: the Z05 consumer (gridex_received_sources.apply_supply_before_legal_context_v1, plan 'end')
// sets end_date = permission_date_v1(DTM+93), market_end_at = permission_time_v1(DTM+93) (fixed +01:00) and
// status 'ending' (end in the future) or 'ended'; its trigger gridex_supply_end_followup_v1 terminates the
// contract at once (status 'terminated', termination_reason 'supply_end', ended_at = the end date).
// H2/H3 are fixed together with migration 20261022150000 (database gate); the boundaries stay strict.
import { describe, expect, it } from 'vitest'
import { evaluateBillingGate } from '@/lib/billing/billingGate'
import { evaluateBillingReadinessCore, type BillingReadinessInput } from '@/lib/billing/billingReadiness'
import { supplyPeriodEndExclusiveDate, supplyPeriodLastSuppliedDate } from '@/lib/billing/supplyPeriodEnd'

/** One quarter-hour starting at a Stockholm local time, as the UTILTS normaliser stores it. */
const quarter = (local: string, offset: '+01:00' | '+02:00') => {
  const start = new Date(`${local}${offset}`)
  return { period_start: start.toISOString(), period_end: new Date(start.getTime() + 900_000).toISOString() }
}
const basis = { version: 1, qualified: true, normalizedValueId: 'v1', sourceMessageId: 'msg1', quantityKwh: '0.25', quantityType: '136', quality: null, qualityEstablished: true, productCode: '8716867000030' }
const value = (period: { period_start: string; period_end: string }) => ({
  id: 'v1', company_id: 'c1', customer_id: 'cust-a', metering_point_id: 'mp1', ...period,
  quantity_kwh: '0.25', unit: 'kWh', direction: 'consumption', quality_status: null, product_code: '8716867000030',
  source_metering_value_id: 'raw1', source_message_id: 'msg1', revision_status: 'current', revision_number: 1, billing_source_basis: basis,
})
const sourceMessage = { id: 'msg1', company_id: 'c1', message_family: 'UTILTS', status: 'validated' }
const signed = { id: 'ct1', company_id: 'c1', customer_id: 'cust-a', metering_point_id: 'mp1', status: 'active', starts_at: '2026-09-01', ends_at: null }

/** Switch away on 1 November 2026: the grid owner's Z05 carries DTM+93:202611010000:203. */
const z05Period = (status: 'ending' | 'ended') => ({ id: 'sp-a', company_id: 'c1', customer_id: 'cust-a', metering_point_id: 'mp1', status,
  start_date: '2026-09-01', market_start_at: '2026-08-31T23:00:00+00:00', end_date: '2026-11-01', market_end_at: '2026-10-31T23:00:00+00:00' })
/** The contract after gridex_supply_end_followup_v1 (fires on 'ending' and 'ended'). */
const terminated = { ...signed, status: 'terminated', termination_reason: 'supply_end', ended_at: '2026-11-01T00:00:00+00:00' }

const gate = (input: { at: { period_start: string; period_end: string }; supply: Record<string, unknown>; contract: Record<string, unknown> }) =>
  evaluateBillingGate({ normalizedValue: value(input.at), supplyPeriod: input.supply, supplyPeriodCandidateCount: 1, contract: input.contract, contractCandidateCount: 1, sourceMessage })
const codes = (result: { reasons: Array<{ code: string }> }) => result.reasons.map(reason => reason.code)

describe('supply period end semantics (H1)', () => {
  it('a received 00:00 market end is exclusive; a manual end date is the last supplied day', () => {
    expect(supplyPeriodEndExclusiveDate(z05Period('ended'))).toBe('2026-11-01')
    expect(supplyPeriodLastSuppliedDate(z05Period('ended'))).toBe('2026-10-31')
    // Summer: 00:00 in Ediel normal time is 01:00 CEST, still the start of the end date.
    expect(supplyPeriodEndExclusiveDate({ end_date: '2026-09-01', market_end_at: '2026-08-31T23:00:00Z' })).toBe('2026-09-01')
    // gridex_end_customer_supply_v1: end_date = actual_end_date = last supplied day, no market instant.
    expect(supplyPeriodEndExclusiveDate({ end_date: '2026-10-15', actual_end_date: '2026-10-15' })).toBe('2026-10-16')
    // An end during the day keeps that day as supplied.
    expect(supplyPeriodEndExclusiveDate({ end_date: '2026-10-22', market_end_at: '2026-10-22T12:30:00Z' })).toBe('2026-10-23')
    expect(supplyPeriodEndExclusiveDate({ end_date: null })).toBeNull()
  })

  it('H1: a value on the first day after a Z05 end is never billable on the ended period', () => {
    const result = gate({ at: quarter('2026-11-01T00:00:00', '+01:00'), supply: z05Period('ended'), contract: signed })
    expect(codes(result)).toContain('supply_period_does_not_cover_value')
    expect(result.eligible).toBe(false)
  })

  it('H1: the last quarter before the Z05 end stays inside the period', () => {
    const result = gate({ at: quarter('2026-10-31T23:45:00', '+01:00'), supply: z05Period('ended'), contract: signed })
    expect(codes(result)).not.toContain('supply_period_does_not_cover_value')
  })

  it('H4: the last quarter-hour of the last supplied day is billable; a manual end keeps its end date as the last day', () => {
    const manual = { ...z05Period('ended'), end_date: '2026-10-31', market_end_at: null }
    expect(codes(gate({ at: quarter('2026-10-31T23:45:00', '+01:00'), supply: manual, contract: signed }))).not.toContain('supply_period_does_not_cover_value')
    expect(codes(gate({ at: quarter('2026-11-01T00:00:00', '+01:00'), supply: manual, contract: signed }))).toContain('supply_period_does_not_cover_value')
  })
})

describe('the remaining supply after a Z05 arrives (H2, H3)', () => {
  // The Z05 for a 1 November switch arrives in October; the period is 'ending' until 1 November and the
  // grid owner keeps sending the October days. Each value is gated once, at reception.
  it('H2: an October value of an "ending" period is billable', () => {
    const result = gate({ at: quarter('2026-10-20T12:00:00', '+02:00'), supply: z05Period('ending'), contract: signed })
    expect(codes(result)).not.toContain('supply_period_not_active')
  })

  it('H3: the contract ended by this very supply end still carries its last supplied days', () => {
    const result = gate({ at: quarter('2026-10-31T23:45:00', '+01:00'), supply: z05Period('ended'), contract: terminated })
    expect(codes(result)).not.toContain('contract_not_active')
  })

  it('H2/H3 boundaries: nothing after the end, no other termination, no ending period without an end date', () => {
    expect(codes(gate({ at: quarter('2026-11-01T00:00:00', '+01:00'), supply: z05Period('ending'), contract: terminated }))).toContain('supply_period_does_not_cover_value')
    expect(codes(gate({ at: quarter('2026-10-20T12:00:00', '+02:00'), supply: z05Period('ended'), contract: { ...terminated, termination_reason: 'customer_request' } }))).toContain('contract_not_active')
    // H3d D8 (owner decision B1): a contract may end AFTER its supply end (notice period) and still carries the supplied
    // days; a contract ended BEFORE the period's end date stays refused.
    expect(codes(gate({ at: quarter('2026-10-20T12:00:00', '+02:00'), supply: z05Period('ended'), contract: { ...terminated, ended_at: '2026-10-25T00:00:00+00:00' } }))).toContain('contract_not_active')
    expect(codes(gate({ at: quarter('2026-10-20T12:00:00', '+02:00'), supply: z05Period('ended'), contract: { ...terminated, ended_at: '2026-12-01T00:00:00+00:00' } }))).not.toContain('contract_not_active')
    expect(codes(gate({ at: quarter('2026-10-20T12:00:00', '+02:00'), supply: z05Period('ended'), contract: { ...signed, status: 'cancelled' } }))).toContain('contract_not_active')
    expect(codes(gate({ at: quarter('2026-10-20T12:00:00', '+02:00'), supply: { ...z05Period('ending'), end_date: null }, contract: signed }))).toContain('supply_period_not_active')
    expect(codes(gate({ at: quarter('2026-10-20T12:00:00', '+02:00'), supply: { ...z05Period('ended'), status: 'cancelled' }, contract: signed }))).toContain('supply_period_not_active')
  })

  const readiness = (overrides: Partial<BillingReadinessInput>): BillingReadinessInput => ({
    companyId: 'c1', customerId: 'cust-a',
    customer: { id: 'cust-a', full_name: 'E2E Avflyttad', email: 'e2e-avflyttad@example.invalid' },
    contract: { id: 'ct1', company_id: 'c1', customer_id: 'cust-a', status: 'active', customer_site_id: 'site-1', contract_price_snapshot_id: 'snap-1', vat_rate: 25,
      invoice_recipient: 'E2E Avflyttad', invoice_email: 'e2e-avflyttad@example.invalid' },
    issuer: { legalName: 'E2E Elhandel AB', orgNumber: '556000-0000' },
    site: { id: 'site-1', company_id: 'c1', customer_id: 'cust-a' },
    meteringPoint: { id: 'mp1', company_id: 'c1', customer_id: 'cust-a', site_id: 'site-1', meter_point_id: '735999000000000001' },
    supplyPeriods: [{ ...z05Period('ended'), contract_id: 'ct1' }],
    billingPeriod: { start: '2026-10-01', end: '2026-10-31' },
    priceArea: 'SE3', meterValues: { present: true, missingCount: 0 }, paymentTerms: { dueDays: 30 },
    paymentProvider: { provider: 'capway_aptic', status: 'active' },
    ...overrides,
  })

  it('control: the final month is billable while the contract is still active', () => {
    expect(evaluateBillingReadinessCore(readiness({})).blockers).toEqual([])
  })

  it('H3: the final invoice (October) is prepared after the switch away', () => {
    const result = evaluateBillingReadinessCore(readiness({ contract: { ...readiness({}).contract!, status: 'terminated', termination_reason: 'supply_end', ended_at: '2026-11-01T00:00:00+00:00' } as BillingReadinessInput['contract'] }))
    expect(result.blockers.map(blocker => blocker.code)).not.toContain('contract_not_approved')
  })

  it('H3 boundary: a contract terminated for another reason never makes the final month billable', () => {
    const result = evaluateBillingReadinessCore(readiness({ contract: { ...readiness({}).contract!, status: 'terminated', termination_reason: 'customer_request', ended_at: '2026-11-01T00:00:00+00:00' } as BillingReadinessInput['contract'] }))
    expect(result.blockers.map(blocker => blocker.code)).toContain('contract_not_approved')
  })

  it('H1: the month after the Z05 end has no supply in readiness', () => {
    const result = evaluateBillingReadinessCore(readiness({ billingPeriod: { start: '2026-11-01', end: '2026-11-30' } }))
    expect(result.blockers.map(blocker => blocker.code)).toContain('delivery_not_started')
  })

  it('H2: September is still billable after the Z05 arrived in October', () => {
    const result = evaluateBillingReadinessCore(readiness({ supplyPeriods: [{ ...z05Period('ending'), contract_id: 'ct1' }], billingPeriod: { start: '2026-09-01', end: '2026-09-30' } }))
    expect(result.blockers.map(blocker => blocker.code)).not.toContain('delivery_not_started')
  })
})
