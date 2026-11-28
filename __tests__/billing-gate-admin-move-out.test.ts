import { describe, expect, it } from 'vitest'
import { evaluateBillingGate } from '@/lib/billing/billingGate'

const id = (value: number) => `10000000-0000-4000-8000-${String(value).padStart(12, '0')}`
const company = id(2)
const customer = id(6)
const site = id(7)
const point = id(8)
const agreement = id(9)
const period = id(10)
const switchSource = id(32)
const meterSource = id(41)
const raw = id(42)
const normalized = id(43)
const close = id(44)
const closeDate = '2026-11-28'
const closeRecordedAt = '2026-11-25T15:23:45.123456+00:00'
const cutoffAt = '2026-11-28T23:00:00+00:00'
const marketStart = '2026-11-26T23:00:00+00:00'
const sharedScope = { company_id: company, customer_id: customer, metering_point_id: point }
const marketBasis = {
  qualified: true, activated: true, companyId: company, customerId: customer, meteringPointId: point,
  siteId: site, periodId: period, currentSourceMessageId: switchSource, initialSourceMessageId: switchSource,
  sourceMessageId: switchSource, marketStateVersion: 1, marketStartAt: marketStart, marketEndAt: null,
}
const administrativeProof = { contractId: agreement, eventId: close, effectiveDate: closeDate, cutoffAt, recordedAt: closeRecordedAt }
const commonSnapshot = {
  status: 'eligible', contract_id: agreement, supply_period_id: period, company_id: company, metering_point_id: point,
  source_metering_value_id: raw, normalized_metering_value_id: normalized, source_message_id: meterSource,
  period_start: '2026-11-28T22:45:00Z', period_end: '2026-11-28T23:00:00Z', revision_number: 1,
  supply_source_basis: marketBasis,
}
const normalizedValue = {
  ...sharedScope, id: normalized, supply_period_id: period, period_start: commonSnapshot.period_start, period_end: commonSnapshot.period_end,
  source_metering_value_id: raw, source_message_id: meterSource,
  quantity_kwh: '1.5', direction: 'consumption', unit: 'kWh', product_code: '8716867000030', quality_status: null,
  revision_status: 'current', revision_number: 1, billing_status: 'billable', billing_gate_status: 'eligible',
  billing_source_basis: { version: 1, qualified: true, normalizedValueId: normalized, sourceMessageId: meterSource,
    quantityKwh: '1.5', quantityType: '136', productCode: '8716867000030', quality: null, qualityEstablished: true },
}
const sourceMessage = { id: meterSource, company_id: company, message_family: 'UTILTS', status: 'validated' }
const supplyPeriod = {
  ...sharedScope, id: period, status: 'active', source: 'ediel_qualified_source', source_process: 'supplier_switch_confirmation',
  contract_id: agreement, customer_contract_id: agreement, source_message_id: switchSource, source_end_message_id: null,
  start_date: '2026-11-27', actual_end_date: null, end_date: closeDate, market_start_at: marketStart, market_end_at: null,
  market_state_version: 1, metadata: { planned_end_source: 'customer_lifecycle_close', planned_end_reason: 'move_out',
    planned_end_recorded_at: closeRecordedAt },
}
const contract = { ...sharedScope, id: agreement, status: 'terminated', termination_reason: 'move_out',
  site_id: site, customer_site_id: site, starts_at: '2026-11-27', ends_at: closeDate, ended_at: '2026-11-28T00:00:00+00:00' }
const exactSnapshot = commonSnapshot
const proposal = { normalizedValue, sourceMessage, supplyPeriod, contract, qualifyTerminatedSupplyOnWrite: true }
const readInput = { ...proposal, normalizedValue: { ...normalizedValue, billing_gate_snapshot: exactSnapshot, billing_administrative_close_basis: administrativeProof }, qualifyTerminatedSupplyOnWrite: false }

function deny(input: Parameters<typeof evaluateBillingGate>[0]) {
  expect(evaluateBillingGate(input).eligible).toBe(false)
}

describe('P07 administratively bounded consumption after canonical move-out', () => {
  it.each(['active', 'confirmed_by_grid_owner'])('passes the exact last interval provisionally to native for %s', status => {
    const gate = evaluateBillingGate({ ...proposal, supplyPeriod: { ...supplyPeriod, status } })
    expect(gate.eligible).toBe(true)
    expect(gate.reasons).toEqual([])
    expect(gate.snapshot).not.toHaveProperty('administrative_close_basis')
    expect(gate.snapshot).not.toHaveProperty('billing_administrative_close_basis')
  })

  it('accepts exactly matching native-backed readback at the inclusive final day boundary', () => {
    expect(evaluateBillingGate(readInput).eligible).toBe(true)
  })

  it('rejects an old eligible snapshot and ordinary read with only the provisional facts', () => {
    deny({ ...readInput, normalizedValue: { ...normalizedValue, billing_gate_snapshot: commonSnapshot } })
    deny({ ...proposal, qualifyTerminatedSupplyOnWrite: false })
  })

  it('ignores administrative descriptors from normalized row JSON without the native read projection', () => {
    deny({ ...readInput, normalizedValue: { ...normalizedValue, billing_gate_snapshot: {
      ...commonSnapshot, administrative_close_basis: administrativeProof,
      billing_administrative_close_basis: administrativeProof,
    } } })
  })

  it.each([
    ['eventId', ''], ['contractId', id(98)], ['effectiveDate', '2026-11-27'],
    ['cutoffAt', '2026-11-28T22:59:59.999999+00:00'], ['cutoffAt', '2026-11-28'],
    ['recordedAt', '2026-11-25T15:23:45.123457+00:00'],
  ])('rejects malformed or stale native move-out proof %s', (field, value) => {
    deny({ ...readInput, normalizedValue: { ...readInput.normalizedValue,
      billing_administrative_close_basis: { ...administrativeProof, [field]: value },
    } })
  })

  it.each([
    ['qualified', false], ['activated', false], ['companyId', id(90)], ['customerId', id(90)],
    ['meteringPointId', id(90)], ['siteId', id(90)], ['periodId', id(90)], ['marketStateVersion', 2],
    ['currentSourceMessageId', id(90)], ['initialSourceMessageId', id(90)], ['sourceMessageId', id(90)],
    ['marketStartAt', '2026-11-26T23:00:00.000001Z'], ['marketEndAt', 'unusable'],
  ])('rejects persisted supply basis with mismatched %s', (field, value) => {
    deny({ ...readInput, normalizedValue: { ...readInput.normalizedValue, billing_gate_snapshot: {
      ...exactSnapshot, supply_source_basis: { ...marketBasis, [field]: value },
    } } })
  })

  it.each(['source_metering_value_id', 'normalized_metering_value_id', 'source_message_id', 'supply_period_id', 'company_id', 'metering_point_id'])('rejects a copied snapshot with different %s', field => {
    deny({ ...readInput, normalizedValue: { ...readInput.normalizedValue, billing_gate_snapshot: { ...exactSnapshot, [field]: id(90) } } })
  })

  it('keeps the persisted interval, revision and billable classification bound to the same native source', () => {
    deny({ ...readInput, normalizedValue: { ...readInput.normalizedValue, billing_gate_status: 'blocked' } })
    for (const previous of [
      { revision_number: 2 }, { period_start: '2026-11-28T22:45:00.000001Z' },
      { period_end: '2026-11-28T22:59:59.999999Z' },
    ]) deny({ ...readInput, normalizedValue: { ...readInput.normalizedValue,
      billing_gate_snapshot: { ...exactSnapshot, ...previous } } })
  })

  it('holds the very next interval, any interval crossing the recorded boundary, and earlier actual market cutoff', () => {
    for (const value of [
      { ...normalizedValue, period_end: '2026-11-28T23:00:00.000001Z' },
      { ...normalizedValue, period_start: '2026-11-28T23:00:00Z', period_end: '2026-11-28T23:15:00Z' },
    ]) deny({ ...proposal, normalizedValue: value })
    deny({ ...proposal, supplyPeriod: { ...supplyPeriod, market_end_at: '2026-11-28T22:59:59.999999Z' } })
  })

  it('does not provisionally qualify termination, missing admin metadata, unknown source or cancelled period', () => {
    for (const changed of [
      { ...supplyPeriod, metadata: { ...supplyPeriod.metadata, planned_end_reason: 'terminate' } },
      { ...supplyPeriod, metadata: null },
      { ...supplyPeriod, source: 'unknown' },
      { ...supplyPeriod, source_end_message_id: id(90) },
      { ...supplyPeriod, actual_end_date: closeDate },
      { ...supplyPeriod, status: 'cancelled' },
    ]) deny({ ...proposal, supplyPeriod: changed })
  })

  it('keeps production, negative quantity, unqualified E66 and superseded normalized rows outside the new path', () => {
    deny({ ...proposal, normalizedValue: { ...normalizedValue, direction: 'production' } })
    deny({ ...proposal, normalizedValue: { ...normalizedValue, quantity_kwh: '-1.5',
      billing_source_basis: { ...normalizedValue.billing_source_basis, quantityKwh: '-1.5' } } })
    deny({ ...readInput, normalizedValue: { ...readInput.normalizedValue,
      billing_source_basis: { ...normalizedValue.billing_source_basis, qualified: false } } })
    deny({ ...readInput, normalizedValue: { ...readInput.normalizedValue, revision_status: 'replaced' } })
  })

  it('retains existing eligible exact Z05 ending and rejects its stale source', () => {
    const end = id(45)
    const ended = { ...supplyPeriod, status: 'ended', source_end_message_id: end, actual_end_date: closeDate,
      market_end_at: cutoffAt, market_state_version: 2, metadata: {} }
    const endedContract = { ...contract, termination_reason: 'supply_end' }
    const oldSnapshot = { ...commonSnapshot, supply_source_basis: { ...marketBasis, currentSourceMessageId: end,
      sourceMessageId: end, marketEndAt: cutoffAt, marketStateVersion: 2 } }
    const legacy = { ...readInput, normalizedValue: { ...normalizedValue, billing_gate_snapshot: oldSnapshot },
      supplyPeriod: ended, contract: endedContract }
    expect(evaluateBillingGate(legacy).eligible).toBe(true)
    deny({ ...legacy, supplyPeriod: { ...ended, market_state_version: 3 } })
  })
})
