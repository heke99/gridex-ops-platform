import { describe, expect, it, vi } from 'vitest'
import { processInboundUtiltsMessage } from '@/lib/ediel/flows/utiltsDataRequest.part-2'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { observationHandoffMessage } from './helpers/utiltsObservationHandoff'

const io = vi.hoisted(() => ({ getMessage: vi.fn(), update: vi.fn(), event: vi.fn(), ack: vi.fn(), persist: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: vi.fn() } }))
vi.mock('@/lib/ediel/db', () => ({ getEdielMessageById: io.getMessage, updateEdielMessageStatus: io.update, createEdielMessageEvent: io.event, linkEdielMessage: vi.fn() }))
vi.mock('@/lib/ediel/flows/shared', () => ({ ensureActorUserId: (id: string) => id }))
vi.mock('@/lib/onboarding/inboundEdielLinking', () => ({ findActiveMeteringPermissionForUtiltsMessage: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/ediel/utilts/transactionPersistence', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(), persistUtiltsTransactionResults: io.persist,
}))
vi.mock('@/lib/ediel/flows/utiltsDataRequest.part-1', () => ({
  resolveUtiltsRuntimeTestCaseCode: vi.fn().mockResolvedValue(null),
  matchUtiltsTransactionsForTenant: vi.fn().mockResolvedValue([]),
  linkInboundUtiltsMessageCanonically: vi.fn().mockResolvedValue({}),
  allUtiltsTransactionMeteringPointsMatched: vi.fn().mockReturnValue(false),
  createUtiltsRuntimeAcks: io.ack,
  stringOrNull: (v: unknown) => typeof v === 'string' && v.trim() ? v.trim() : null,
  ensureJson: (v: unknown) => v && typeof v === 'object' ? v : {},
}))

// Runtime, both parsers, policy selection, validation and disposition builders
// are REAL. Only external I/O and business matching are synthetic. These prove
// actual persistence-call payloads, not a live database transaction or send.
describe('actual inbound processor forwards fresh observation diagnostics', () => {
  for (const date of ['2026-09-30', '2026-10-01']) for (const company of ['tenant-a', 'tenant-b']) {
    it(`persists raw-owned diagnostics for ${company} / ${date}`, async () => {
      io.getMessage.mockReset(); io.update.mockReset().mockResolvedValue(null)
      io.event.mockReset().mockResolvedValue(null); io.ack.mockReset().mockResolvedValue([])
      io.persist.mockReset().mockResolvedValue([])
      const source = { ...observationHandoffMessage(date, company), parsed_payload: {
        normalizedMeteringPayload: { utiltsObservedTransactions: [{ transactionId: 'WRONG-COMPANY' }] },
        utiltsRuntimeFacts: { utiltsObservedTransactions: [{ transactionId: 'STALE' }] },
      } }
      io.getMessage.mockResolvedValue(source)
      const policy = resolveCanonicalEdielPolicy({ family: 'UTILTS', messageCode: 'E66', direction: 'inbound', referenceDate: date, applicationReference: '23-DDQ-E66-S', mode: 'parse' })
      await processInboundUtiltsMessage({ actorUserId: 'operator', edielMessageId: source.id, canonicalPolicy: policy })
      expect(io.update).toHaveBeenCalled()
      for (const [call] of io.update.mock.calls) {
        expect(call.edielMessageId).toBe(source.id)
        const payload = call.parsedPayload
        expect(payload.utiltsRuntimeFacts.utiltsObservedTransactions, 'real runtime must reach status persistence').toBeInstanceOf(Array)
        const tx = payload.utiltsRuntimeFacts.utiltsObservedTransactions
        expect(tx.map((t: { transactionId: string }) => t.transactionId)).toEqual(['GRIDEX2607E66001'])
        expect(tx[0].observations[0].references.map((r: { qualifier: string; value: string }) => [r.qualifier, r.value])).toEqual([['AES', '101'], ['MG', 'M-GRIDEX-2607-01']])
        expect(payload.normalizedMeteringPayload.utiltsObservedTransactions).toBe(tx)
        expect(tx[0].observations[1].references).toHaveLength(1)
      }
      expect(io.persist).toHaveBeenCalledWith(expect.objectContaining({ companyId: company, sourceMessageId: source.id, environment: 'test' }))
      expect(io.event).toHaveBeenCalledOnce()
      expect(io.event.mock.calls[0][0].payload.normalizedMeteringPayload.utiltsObservedTransactions).toEqual(io.update.mock.calls[0][0].parsedPayload.utiltsRuntimeFacts.utiltsObservedTransactions)
      expect(io.ack.mock.calls[0][0].ackPlan.utiltsErrCodes.includes('E19')).toBe(date === '2026-09-30')
      expect(source.parsed_payload.utiltsRuntimeFacts.utiltsObservedTransactions[0].transactionId).toBe('STALE')
    })
  }
})
