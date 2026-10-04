import { createUtiltsFinalValidationIo, qualifyUtiltsFixtureSource, UTILTS_FIXTURE_ACTOR } from './helpers/utiltsCurrentOwnerFixture'
import { energyHandoffMessage } from './helpers/utiltsObservationHandoff'
import { resolveCanonicalRuntimeDecisionWithRegistry } from '@/lib/ediel/core/runtimeDecision'
import * as utiltsRuntime from '@/lib/ediel/utiltsEngine'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { processInboundUtiltsMessage } from '@/lib/ediel/flows/utiltsDataRequest.part-2'
import { linkInboundUtiltsMessageCanonically, matchUtiltsTransactionsForTenant } from '@/lib/ediel/flows/utiltsDataRequest.part-1'
import type { CanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'

const mocks = vi.hoisted(() => ({ getMessage: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/ediel/db', () => ({ getEdielMessageById: mocks.getMessage }))
vi.mock('@/lib/supabase/service', async () => {
  const { currentUtiltsActorQuery } = await import('./helpers/utiltsCurrentOwnerFixture')
  return { supabaseService: { rpc: mocks.rpc, from: currentUtiltsActorQuery } }
})
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

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.useRealTimers())

// masterplan: GOV-06, AT-GOV-06
describe('UTILTS metering processor retained decision', () => {
  it('uses the same selected policy before and after tenant object matching', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2030-01-01T12:00:00Z'))
    const source = qualifyUtiltsFixtureSource(energyHandoffMessage('2026-10-01'))
    mocks.rpc.mockImplementation(createUtiltsFinalValidationIo())
    const decision = await resolveCanonicalRuntimeDecisionWithRegistry(source, { replayAt: '2027-01-15T10:00:00Z' })
    const policy = decision.policy!
    expect(policy.referenceDate).toBe('2026-10-01')
    expect(policy.timeAnchors).toMatchObject({ documentDate: '2026-10-01', businessEffectiveDate: '2026-10-01',
      admissionAt: '2026-10-01T20:00:00.000Z', replayAt: '2027-01-15T10:00:00.000Z',
      measurementPeriods: [{ qualifier: '324', value: '202607010000202607010015', format: '719', originalOffset: '+0200' }] })
    mocks.getMessage.mockResolvedValue(source)
    const actual = utiltsRuntime.runUtiltsRuntimeForMessage
    const runtime = vi.spyOn(utiltsRuntime, 'runUtiltsRuntimeForMessage')
      .mockImplementationOnce(actual).mockImplementationOnce(() => { throw new Error('test-stop-before-persistence') })
    try {
      await expect(processInboundUtiltsMessage({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: source.id, canonicalPolicy: policy, canonicalDecision: decision })).rejects.toThrow('test-stop-before-persistence')
      expect(runtime).toHaveBeenCalledTimes(2)
      expect(runtime.mock.calls[0][1]?.canonicalPolicy).toBe(policy)
      expect(runtime.mock.calls[1][1]?.canonicalPolicy).toBe(policy)
    } finally { runtime.mockRestore() }
  })

  it.each([
    ['reference date', (policy: CanonicalEdielPolicy) => ({ ...policy, referenceDate: '2026-09-30' })],
    ['admission calendar date', (policy: CanonicalEdielPolicy) => ({ ...policy, timeAnchors: { ...policy.timeAnchors!, admissionDate: '2026-09-30' } })],
    ['invalid admission instant', (policy: CanonicalEdielPolicy) => ({ ...policy, timeAnchors: { ...policy.timeAnchors!, admissionAt: 'invalid' } })],
    ['invalid replay instant', (policy: CanonicalEdielPolicy) => ({ ...policy, timeAnchors: { ...policy.timeAnchors!, replayAt: 'invalid' } })],
    ['document date', (policy: CanonicalEdielPolicy) => ({ ...policy, timeAnchors: { ...policy.timeAnchors!, documentDate: '2026-09-30' } })],
    ['business date', (policy: CanonicalEdielPolicy) => ({ ...policy, timeAnchors: { ...policy.timeAnchors!, businessEffectiveDate: '2026-09-30' } })],
    ['delivery period', (policy: CanonicalEdielPolicy) => ({ ...policy, timeAnchors: { ...policy.timeAnchors!, measurementPeriods: [] } })],
    ['local ingress instant', (policy: CanonicalEdielPolicy) => ({ ...policy, timeAnchors: { ...policy.timeAnchors!, localIngressAt: '2026-09-30T20:00:00.000Z' } })],
  ] as const)('denies an incoherent local %s before matching or linking', async (_label, alter) => {
    const source = qualifyUtiltsFixtureSource(energyHandoffMessage('2026-10-01'))
    mocks.rpc.mockImplementation(createUtiltsFinalValidationIo())
    const initial = await resolveCanonicalRuntimeDecisionWithRegistry(source)
    const policy = alter(initial.policy!)
    const decision = { ...initial, policy }
    mocks.getMessage.mockResolvedValue(source)
    const priorRpcCount = mocks.rpc.mock.calls.length
    const failure = await processInboundUtiltsMessage({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: source.id,
      canonicalPolicy: policy, canonicalDecision: decision }).catch(error => error as Error)
    expect.soft(failure).toBeInstanceOf(Error)
    expect.soft((failure as Error).message).toBe('utilts_runtime_policy_time_context_mismatch')
    expect.soft(matchUtiltsTransactionsForTenant).not.toHaveBeenCalled()
    expect.soft(linkInboundUtiltsMessageCanonically).not.toHaveBeenCalled()
    expect.soft(mocks.rpc.mock.calls.slice(priorRpcCount).map(([name]) => name)).toEqual(['gridex_actor_has_company_permission'])
    expect(decision.responsePlan.some(item => item.family === 'UTILTS_ERR' || item.family === 'APERAK' && item.outcome === 'negative')).toBe(false)
  })
})
