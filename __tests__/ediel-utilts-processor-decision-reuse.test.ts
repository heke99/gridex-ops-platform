import { describe, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { processInboundUtiltsMessage } from '@/lib/ediel/flows/utiltsDataRequest.part-2'

const mocks = vi.hoisted(() => ({ getMessage: vi.fn(), runtime: vi.fn() }))
vi.mock('@/lib/ediel/db', () => ({ getEdielMessageById: mocks.getMessage }))
vi.mock('@/lib/ediel/utiltsEngine', () => ({ runUtiltsRuntimeForMessage: mocks.runtime }))
vi.mock('@/lib/ediel/flows/shared', () => ({ ensureActorUserId: (id: string) => id }))
vi.mock('@/lib/onboarding/inboundEdielLinking', () => ({ findActiveMeteringPermissionForUtiltsMessage: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/ediel/matching', () => ({ matchMeteringPointIdByIdentifier: vi.fn().mockResolvedValue(null), matchSiteAndCustomerForMeteringPoint: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/ediel/flows/utiltsDataRequest.part-1', async original => ({
  ...await original<Record<string, unknown>>(),
  resolveUtiltsRuntimeTestCaseCode: vi.fn().mockResolvedValue(null),
  matchUtiltsTransactionsForTenant: vi.fn().mockResolvedValue([]),
  linkInboundUtiltsMessageCanonically: vi.fn().mockResolvedValue({}),
  allUtiltsTransactionMeteringPointsMatched: vi.fn().mockReturnValue(false),
}))

describe('UTILTS metering processor retained decision', () => {
  it('uses the same selected policy before and after tenant object matching', async () => {
    const policy = resolveCanonicalEdielPolicy({ family: 'UTILTS', messageCode: 'E66', direction: 'inbound', referenceDate: '2026-09-30', applicationReference: '23-DDQ-E66-S', mode: 'parse' })
    const source = { id: 'source', company_id: 'tenant-a', message_family: 'UTILTS', message_code: 'E66', message_received_at: '2026-10-01T12:00:00Z' } as EdielMessageRow
    mocks.getMessage.mockResolvedValue(source)
    mocks.runtime.mockReturnValueOnce({ facts: { transactions: [] }, normalizedPayload: {} }).mockImplementationOnce(() => { throw new Error('test-stop-before-persistence') })
    await expect(processInboundUtiltsMessage({ actorUserId: 'operator', edielMessageId: source.id, canonicalPolicy: policy })).rejects.toThrow('test-stop-before-persistence')
    expect(mocks.runtime).toHaveBeenCalledTimes(2)
    expect(mocks.runtime.mock.calls[0][1].canonicalPolicy).toBe(policy)
    expect(mocks.runtime.mock.calls[1][1].canonicalPolicy).toBe(policy)
  })
})
