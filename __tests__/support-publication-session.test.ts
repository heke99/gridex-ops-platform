import { beforeEach, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc } }))
const companyId = '10000000-0000-4000-8000-000000000001'
const customerId = '20000000-0000-4000-8000-000000000001'
const caseId = '30000000-0000-4000-8000-000000000001'
const userId = '40000000-0000-4000-8000-000000000001'
const sessionId = '50000000-0000-4000-8000-000000000001'
const input = { companyId, customerId, caseId, actorUserId: userId, actor: { kind: 'ops' as const, userId, sessionId }, title: 'Public title', body: 'Public summary', status: 'open' as const, expectedRevision: 0 }
beforeEach(() => io.rpc.mockReset())
it('requires a current session for an explicit publication instead of trusting an actor ID', async () => {
  const { publishCustomerCase } = await import('@/lib/customer-cases/publication')
  io.rpc.mockResolvedValue({ data: { id: '60000000-0000-4000-8000-000000000001', customer_case_id: caseId, customer_id: customerId, company_id: companyId, revision: 1, public_title: input.title, public_body: input.body, public_status: 'open', channel: 'ops', author_user_id: userId, published_at: '2026-09-30T12:00:00Z' }, error: null })
  const result = await publishCustomerCase(input)
  expect(result.author_user_id).toBe(userId)
  expect(io.rpc.mock.calls[0]).toEqual(['gridex_support_case_publication_v1', { p_context: { companyId, customerId, mode: 'ops', actorUserId: userId, sessionId, clientId: null, subject: null }, p_publication: { operation: 'publish', caseId, title: input.title, body: input.body, status: 'open', expectedRevision: 0, channel: 'ops' } }])
})
it('does not turn a missing or mismatched actual session into a publication', async () => {
  const { publishCustomerCase } = await import('@/lib/customer-cases/publication')
  for (const actor of [undefined, { ...input.actor, userId: caseId }, { kind: 'portal', userId, sessionId }]) {
    await expect(publishCustomerCase({ ...input, actor } as Parameters<typeof publishCustomerCase>[0])).rejects.toMatchObject({ code: 'support_actor_forbidden' })
  }
  expect(io.rpc).not.toHaveBeenCalled()
})
it('maps a revoked session to a controlled denial without publishing again through the old RPC', async () => {
  const { publishCustomerCase } = await import('@/lib/customer-cases/publication')
  io.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'support_actor_forbidden' } })
  await expect(publishCustomerCase(input)).rejects.toMatchObject({ code: 'support_actor_forbidden', status: 403 })
  expect(io.rpc).toHaveBeenCalledTimes(1)
})

it('publishes an explicitly authored phone summary with the real staff and phone channel', async () => {
  const { publishCustomerCase } = await import('@/lib/customer-cases/publication')
  io.rpc.mockResolvedValue({ data: { id: '60000000-0000-4000-8000-000000000001', company_id: companyId,
    customer_case_id: caseId, customer_id: customerId, revision: 1, public_title: input.title,
    public_body: input.body, public_status: 'open', channel: 'phone', author_user_id: userId,
    published_at: '2026-09-30T12:00:00Z' }, error: null })
  const result = await publishCustomerCase({ ...input, channel: 'phone' })
  expect(result.channel).toBe('phone')
  expect(result.author_user_id).toBe(userId)
  expect(io.rpc.mock.calls[0][1].p_publication.channel).toBe('phone')
})
