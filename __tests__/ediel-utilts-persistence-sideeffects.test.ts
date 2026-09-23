import { beforeEach, describe, expect, it, vi } from 'vitest'
import { maybeIngestMeteringValue, maybeCreateBillingUnderlay } from '@/lib/ediel/flows/utiltsDataRequest.part-1'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { GridOwnerDataRequestRow } from '@/lib/cis/types'

const io = vi.hoisted(() => ({ meter: vi.fn(), bill: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }))
vi.mock('@/lib/ediel/db', () => ({ createEdielMessageEvent: vi.fn() }))
vi.mock('@/lib/cis/db', () => ({ ingestBillingUnderlay: io.bill }))
vi.mock('@/lib/metering/normalizeMeteringValues', () => ({ normalizeAndStoreMeteringValue: io.meter }))
vi.mock('@/lib/billing/meterValueBillingMatcher', () => ({ updateMeterValueBillingReadiness: vi.fn() }))
vi.mock('@/lib/ediel/matching', () => ({
  matchMeteringPointIdByIdentifier: vi.fn().mockResolvedValue('point-a'),
  matchSiteAndCustomerForMeteringPoint: vi.fn().mockResolvedValue({ customerId: 'customer-a', siteId: 'site-a', gridOwnerId: 'owner-a' }),
}))
const message = { id: 'message-a', company_id: 'tenant-a', environment: 'test', message_code: 'E66', created_at: '2026-09-01T00:00:00Z' } as EdielMessageRow
const decision = (transactionId: string, disposition = 'accepted') => ({ transactionId, disposition, responseType: disposition === 'accepted' ? 'positive_aperak' : disposition === 'internal_review' ? 'none' : 'utilts_err', issueCodes: [] })
const persisted = (transactionId: string, disposition = 'accepted', persistenceStatus = 'persisted') => ({ ...decision(transactionId, disposition), persistenceStatus })
const transaction = (transactionId: string | null, value: number) => ({ transactionId, meterPointId: 'external-a', quantities: [{ value }], deliveryPeriodStart: '2026-08-01T00:00:00Z', deliveryPeriodEnd: '2026-09-01T00:00:00Z' })
function payload(): Record<string, unknown> {
  return { engine: 'utilts_runtime', quantity: 999, transactions: [transaction('T1', 123)], utiltsTransactionDispositions: [decision('T1')], utiltsTransactionPersistenceResults: [persisted('T1')] }
}
async function consume(normalizedPayload: Record<string, unknown>) {
  const common = { actorUserId: 'actor', customerId: 'customer-a', siteId: 'site-a', meteringPointId: 'point-a', gridOwnerId: 'owner-a', message, normalizedPayload }
  const meters = await maybeIngestMeteringValue({ ...common, dataRequestId: 'request-a' })
  const bill = await maybeCreateBillingUnderlay({ ...common, dataRequest: { id: 'request-a', request_scope: 'billing_underlay', response_payload: {} } as GridOwnerDataRequestRow })
  return { meters, bill }
}
beforeEach(() => {
  vi.clearAllMocks()
  io.meter.mockImplementation(async () => ({ status: 'stored', meteringValue: { id: 'meter-value' } }))
  io.bill.mockResolvedValue({ id: 'underlay' })
})
describe('real UTILTS quantity sinks require durable transaction acceptance', () => {
  it('preserves accepted persisted quantities and tenant attribution', async () => {
    await consume(payload())
    expect(io.meter).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'tenant-a', customerId: 'customer-a', meteringPointId: 'point-a', quantityKwh: 123, sourceTransactionReference: 'T1' }))
    expect(io.bill).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'customer-a', meteringPointId: 'point-a', totalKwh: 123 }))
  })
  for (const state of ['failed', 'held', 'rejected', 'missing decisions', 'missing persistence', 'empty decisions', 'empty persistence', 'duplicate decisions', 'duplicate persistence', 'duplicate transactions', 'contradictory persistence']) {
    it(`excludes ${state} from both sinks without restoring aggregate quantity`, async () => {
      const p = payload()
      if (state === 'failed') p.utiltsTransactionPersistenceResults = [persisted('T1', 'processability_rejected', 'failed')]
      if (state === 'held') { p.utiltsTransactionDispositions = [decision('T1', 'internal_review')]; p.utiltsTransactionPersistenceResults = [persisted('T1', 'internal_review', 'not_applicable')] }
      if (state === 'rejected') p.utiltsTransactionDispositions = [decision('T1', 'processability_rejected')]
      if (state === 'missing decisions') delete p.utiltsTransactionDispositions
      if (state === 'missing persistence') delete p.utiltsTransactionPersistenceResults
      if (state === 'empty decisions') p.utiltsTransactionDispositions = []
      if (state === 'empty persistence') p.utiltsTransactionPersistenceResults = []
      if (state === 'duplicate decisions') p.utiltsTransactionDispositions = [decision('T1'), decision('T1')]
      if (state === 'duplicate persistence') p.utiltsTransactionPersistenceResults = [persisted('T1'), persisted('T1')]
      if (state === 'duplicate transactions') p.transactions = [transaction('T1', 123), transaction('T1', 456)]
      if (state === 'contradictory persistence') p.utiltsTransactionPersistenceResults = [persisted('T1', 'processability_rejected')]
      expect(await consume(p)).toEqual({ meters: [], bill: null })
      expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled()
    })
  }
  for (const excluded of ['processability_rejected', 'internal_review']) {
    it(`keeps accepted siblings alongside ${excluded}`, async () => {
      const p = payload()
      p.transactions = [transaction('T1', 123), transaction('T2', 7)]
      p.utiltsTransactionDispositions = [decision('T1', excluded), decision('T2')]
      p.utiltsTransactionPersistenceResults = [persisted('T1', excluded, excluded === 'internal_review' ? 'not_applicable' : 'failed'), persisted('T2')]
      await consume(p)
      expect(io.meter).toHaveBeenCalledTimes(1)
      expect(io.meter).toHaveBeenCalledWith(expect.objectContaining({ quantityKwh: 7, sourceTransactionReference: 'T2' }))
      expect(io.bill).toHaveBeenCalledWith(expect.objectContaining({ totalKwh: 7 }))
    })
  }
  for (const fallback of [{ quantity: 999 }, { values: [{ quantity: 999, transactionReference: 'T1' }] }]) {
    it(`does not treat unowned fallback as persisted transaction quantities: ${JSON.stringify(fallback)}`, async () => {
      const p = { ...payload(), transactions: [{ transactionId: 'T1', quantities: [] }], ...fallback }
      expect(await consume(p)).toEqual({ meters: [], bill: null })
      expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled()
    })
  }
  it('runtime markers without either decision array still fail closed', async () => {
    const p = payload(); delete p.utiltsTransactionDispositions; delete p.utiltsTransactionPersistenceResults
    expect(await consume(p)).toEqual({ meters: [], bill: null })
  })
  it('does not grant write authority to payloads with no runtime contract', async () => {
    expect(await consume({ quantity: 123, periodStart: '2026-08-01', periodEnd: '2026-09-01' })).toEqual({ meters: [], bill: null })
  })
  it('uses the same synthetic transaction identity as persistence and matching', async () => {
    const p = payload(); p.transactions = [transaction(null, 123)]
    p.utiltsTransactionDispositions = [decision('transaction-1')]; p.utiltsTransactionPersistenceResults = [persisted('transaction-1')]
    await consume(p)
    expect(io.meter).toHaveBeenCalledWith(expect.objectContaining({ sourceTransactionReference: 'transaction-1', quantityKwh: 123 }))
    expect(io.bill).toHaveBeenCalledWith(expect.objectContaining({ totalKwh: 123 }))
  })
})
