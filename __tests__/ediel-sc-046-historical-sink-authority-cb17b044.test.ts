// masterplan: SC-046
// Finite consumer-authority controls. Synthetic RPC/storage ports; no native
// older-series classification, physical ACK or whole-contract acceptance.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bindingRpcRows, boundFixtureContract } from './helpers/utiltsBoundFixture'
import { validateUtiltsPersistenceResults, type UtiltsBoundPersistenceInput } from '@/lib/ediel/utilts/transactionPersistence'
import { createBoundUtiltsBilling, ingestBoundUtiltsMetering } from '@/lib/ediel/utilts/consumptionSinks'
import type { EdielMessageRow } from '@/lib/ediel/types'

const io = vi.hoisted(() => ({ meter: vi.fn(), bill: vi.fn(), readiness: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }))
vi.mock('@/lib/metering/normalizeMeteringValues', () => ({ normalizeAndStoreMeteringValue: io.meter }))
vi.mock('@/lib/billing/meterValueBillingMatcher', () => ({ updateMeterValueBillingReadiness: io.readiness }))
vi.mock('@/lib/cis/db', () => ({ ingestBillingUnderlay: io.bill }))

const message = { id: 'message-a', company_id: 'tenant-a', environment: 'test', message_code: 'E66' } as EdielMessageRow
function currentOutcome() {
  const input: UtiltsBoundPersistenceInput = {
    companyId: 'tenant-a', environment: 'test', sourceMessageId: message.id, messageCode: 'E66',
    rawPayload: 'synthetic-original', contracts: [boundFixtureContract('T1', 123)],
    transactions: [{ transactionId: 'T1', disposition: 'accepted', responseType: 'positive_aperak', issueCodes: [],
      seriesKind: 'actual', meteringPointId: 'point-a', externalMeteringPointId: 'external-a', gridAreaId: null,
      periodStart: null, periodEnd: null, registrationDate: null, latestUpdateDate: null,
      resolution: null, unit: 'KWH', reasonForTransaction: null, quantities: [] }],
  }
  // Existing external-return fixture supplies exactly the current contract and
  // source binding. Historical/current SQL classification is not mocked here.
  return validateUtiltsPersistenceResults(input, bindingRpcRows(input))
}
type Outcomes = ReturnType<typeof currentOutcome>
const metering = (boundOutcomes: Outcomes, source = message) =>
  ingestBoundUtiltsMetering({ actorUserId: 'actor', message: source, boundOutcomes })
const billing = (boundOutcomes: Outcomes, source = message) =>
  createBoundUtiltsBilling({ actorUserId: 'actor', message: source, boundOutcomes, existingBillingUnderlayId: null })
function forgedHistory(row: Outcomes[number]) {
  Object.assign(row, { versionState: 'late_older_history', seriesId: 'caller-selected-history' })
}
function expectNoSinkCalls() {
  expect(io.meter).not.toHaveBeenCalled()
  expect(io.bill).not.toHaveBeenCalled()
  expect(io.readiness).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  io.meter.mockResolvedValue({ status: 'stored', meteringValue: { id: 'meter-value' } })
  io.bill.mockResolvedValue({ id: 'underlay' })
  io.readiness.mockResolvedValue(undefined)
})

describe('SC046 historical exclusion cannot bypass current consumer authority', () => {
  it('retains ordinary current consumption in both actual sink adapters', async () => {
    const rows = currentOutcome()
    await expect(metering(rows)).resolves.toEqual([{ id: 'meter-value' }])
    await expect(billing(rows)).resolves.toEqual({ id: 'underlay' })
    expect(io.meter).toHaveBeenCalledWith(expect.objectContaining({ quantityKwh: 123, companyId: 'tenant-a', sourceMessageId: message.id }))
    expect(io.bill).toHaveBeenCalledWith(expect.objectContaining({ totalKwh: '123', expectedCompanyId: 'tenant-a', boundSourceMessageId: message.id }))
  })

  it('does not let a post-validation historical marker suppress authenticated current consumption', async () => {
    const rows = currentOutcome()
    forgedHistory(rows[0])
    rows[0].consumptionContract!.observations[0].quantity = 999
    await expect(metering(rows)).resolves.toEqual([{ id: 'meter-value' }])
    await expect(billing(rows)).resolves.toEqual({ id: 'underlay' })
    expect(io.meter).toHaveBeenCalledWith(expect.objectContaining({ quantityKwh: 123 }))
    expect(io.bill).toHaveBeenCalledWith(expect.objectContaining({ totalKwh: '123' }))
  })

  it.each(['metering', 'billing'] as const)('rejects a cloned result marked historical before %s', async sink => {
    const cloned = structuredClone(currentOutcome())
    forgedHistory(cloned[0])
    await expect((sink === 'metering' ? metering : billing)(cloned)).rejects.toThrow(/sink_unbound_outcome/)
    expectNoSinkCalls()
  })

  it.each(['metering', 'billing'] as const)('does not let historical metadata authorize another source at %s', async sink => {
    const rows = currentOutcome()
    forgedHistory(rows[0])
    await expect((sink === 'metering' ? metering : billing)(rows, { ...message, id: 'other-source' })).rejects.toThrow(/sink_unbound_outcome/)
    expectNoSinkCalls()
  })

  it.each([
    ['tenant', { company_id: 'tenant-b' }],
    ['environment', { environment: 'production' as const }],
    ['message code', { message_code: 'S01' }],
  ])('retains the %s guard even when the registered row claims historical status', async (_name, changed) => {
    const rows = currentOutcome()
    forgedHistory(rows[0])
    const source = { ...message, ...changed }
    await expect(metering(rows, source)).rejects.toThrow(/sink_source_scope/)
    await expect(billing(rows, source)).rejects.toThrow(/sink_source_scope/)
    expectNoSinkCalls()
  })
})
