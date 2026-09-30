import { createUtiltsFinalValidationIo, qualifyUtiltsFixtureSource } from './helpers/utiltsFinalValidationFixture'
import { energyHandoffMessage } from './helpers/utiltsObservationHandoff'
import { resolveCanonicalRuntimeDecisionWithRegistry } from '@/lib/ediel/core/runtimeDecision'
import * as utiltsRuntime from '@/lib/ediel/utiltsEngine'
import { describe, expect, it, vi } from 'vitest'
import { processInboundUtiltsMessage } from '@/lib/ediel/flows/utiltsDataRequest.part-2'

const mocks = vi.hoisted(() => ({ getMessage: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/ediel/db', () => ({ getEdielMessageById: mocks.getMessage }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: mocks.rpc } }))
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
    const source = qualifyUtiltsFixtureSource(energyHandoffMessage('2026-10-01'))
    mocks.rpc.mockImplementation(createUtiltsFinalValidationIo())
    const decision = await resolveCanonicalRuntimeDecisionWithRegistry(source)
    const policy = decision.policy!
    mocks.getMessage.mockResolvedValue(source)
    const actual = utiltsRuntime.runUtiltsRuntimeForMessage
    const runtime = vi.spyOn(utiltsRuntime, 'runUtiltsRuntimeForMessage')
      .mockImplementationOnce(actual).mockImplementationOnce(() => { throw new Error('test-stop-before-persistence') })
    try {
      await expect(processInboundUtiltsMessage({ actorUserId: 'operator', edielMessageId: source.id, canonicalPolicy: policy, canonicalDecision: decision })).rejects.toThrow('test-stop-before-persistence')
      expect(runtime).toHaveBeenCalledTimes(2)
      expect(runtime.mock.calls[0][1]?.canonicalPolicy).toBe(policy)
      expect(runtime.mock.calls[1][1]?.canonicalPolicy).toBe(policy)
    } finally { runtime.mockRestore() }
  })
})
