// reality-defects: J1-14
// J1-14 (owner decision 39): the approval of a source-bound Z06 review produces its own APERAK in the same call, right
// after the durable native apply and before the case leaves review, queued for the next outbox tick. No reply is
// created before the approval, when the actor is denied or when the durable apply fails.
import { beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ caseRow: {} as Record<string, unknown>, source: {} as Record<string, unknown>, order: [] as string[],
  update: vi.fn(), apply: vi.fn(), acks: vi.fn(), final: vi.fn(), actor: vi.fn(), onboard: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: io.caseRow, error: null }) }) }) }) } }))
vi.mock('@/lib/supabase/tenantDb', () => ({ tenantDb: () => ({ from: () => ({ update: (payload: Record<string, unknown>) => {
  io.order.push('case_update'); io.update(payload)
  const query = { eq: () => query, select: () => query, maybeSingle: async () => ({ data: { ...io.caseRow, ...payload }, error: null }) }
  return query
} }) }) }))
vi.mock('@/lib/ediel/db', () => ({ getEdielMessageById: async () => io.source, createEdielMessageEvent: vi.fn(), linkEdielMessage: vi.fn() }))
vi.mock('@/lib/ediel/safeApplyReview', () => ({ approveSafeMasterdataChanges: io.apply }))
vi.mock('@/lib/ediel/flows/receivedProdatStructuralAcks', () => ({ createReceivedProdatStructuralAcks: io.acks }))
vi.mock('@/lib/ediel/core/receivedProdatFinalResponsePlan', () => ({ readReceivedProdatFinalResponsePlan: io.final }))
vi.mock('@/lib/ediel/services/authorization', () => ({ assertEdielTenantActor: io.actor }))
vi.mock('@/lib/customers/canonicalOnboarding', () => ({ canonicalIdempotencyKey: vi.fn(), onboardCustomerGraph: io.onboard }))
import { approveEdielInboundCase } from '@/lib/ediel/inboundCases'

const company = '00000000-0000-4000-8000-000000000001', source = '00000000-0000-4000-8000-000000000002', actor = '00000000-0000-4000-8000-000000000003'
beforeEach(() => {
  vi.clearAllMocks(); io.order = []
  io.caseRow = { id: 'CASE', company_id: company, ediel_message_id: source, status: 'pending_review', updated_at: '2026-10-28T09:02:00Z', review_decision: null, proposed_action: {} }
  io.source = { id: source, company_id: company, message_family: 'PRODAT', message_code: 'Z06', environment: 'test', raw_payload: 'EXACT-PHYSICAL-SOURCE' }
  io.actor.mockResolvedValue(undefined)
  io.apply.mockImplementation(async () => { io.order.push('durable_apply'); return { appliedCount: 1, skippedCount: 0 } })
  io.acks.mockImplementation(async () => { io.order.push('aperak'); return ['APERAK-1'] })
  io.final.mockResolvedValue({ plans: [{ objectLineIndices: [7] }], totalObjectCount: 1 })
})

it('an approval answers with the APERAK in the same call, after the durable apply and before the case leaves review', async () => {
  const result = await approveEdielInboundCase({ companyId: company, actorUserId: actor, caseId: 'CASE' })
  expect(io.order).toEqual(['durable_apply', 'aperak', 'case_update'])
  expect(io.acks).toHaveBeenCalledTimes(1)
  expect(io.acks).toHaveBeenCalledWith({ actorUserId: actor, companyId: company, sourceMessageId: source, objectLineIndices: undefined })
  expect(result.status).toBe('applied')
  expect(io.update).toHaveBeenCalledWith(expect.objectContaining({ review_decision: expect.objectContaining({ structuralApplication: expect.objectContaining({ ackIds: ['APERAK-1'] }) }) }))
})

it('no APERAK when the durable apply fails: the case stays reviewable and the deadline keeps running', async () => {
  io.apply.mockRejectedValue(new Error('native_apply_failed'))
  await expect(approveEdielInboundCase({ companyId: company, actorUserId: actor, caseId: 'CASE' })).rejects.toThrow('native_apply_failed')
  expect(io.acks).not.toHaveBeenCalled()
  expect(io.update).not.toHaveBeenCalled()
})

it('no APERAK for a denied actor or a foreign tenant', async () => {
  await expect(approveEdielInboundCase({ companyId: 'FOREIGN', actorUserId: actor, caseId: 'CASE' })).rejects.toThrow('TENANT_CONTEXT_MISMATCH')
  io.actor.mockRejectedValue(new Error('ediel_tenant_actor_forbidden'))
  await expect(approveEdielInboundCase({ companyId: company, actorUserId: actor, caseId: 'CASE' })).rejects.toThrow('ediel_tenant_actor_forbidden')
  expect(io.apply).not.toHaveBeenCalled()
  expect(io.acks).not.toHaveBeenCalled()
})
