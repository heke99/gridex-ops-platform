import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc } }))

describe('shared support command', () => {
  const input = {
    companyId: '10000000-0000-4000-8000-000000000001',
    customerId: '20000000-0000-4000-8000-000000000001',
    actor: { kind: 'ops' as const, userId: '30000000-0000-4000-8000-000000000001', sessionId: '40000000-0000-4000-8000-000000000001' },
    operation: 'create' as const,
    expectedRevision: 0,
    idempotencyKey: 'support-create-key',
    payload: { title: 'Help with invoice', body: 'Please explain this invoice.' },
  }
  beforeEach(() => io.rpc.mockReset())

  it('delegates one atomic command without publishing OPS text', async () => {
    const { executeSupportCommand } = await import('@/lib/customer-operations/supportCommand')
    io.rpc.mockResolvedValue({ data: { companyId: input.companyId, customerId: input.customerId, caseId: '50000000-0000-4000-8000-000000000001', revision: 1, status: 'open', replayed: false }, error: null })
    const result = await executeSupportCommand(input)
    expect(result.revision).toBe(1)
    expect(io.rpc).toHaveBeenCalledWith('gridex_support_case_command_v1', { p_command: expect.objectContaining({ operation: 'create', mode: 'ops', channel: 'ops', actorUserId: input.actor.userId, sessionId: input.actor.sessionId }) })
    expect(io.rpc.mock.calls[0][1].p_command.payload).toEqual(input.payload)
  })

  it.each([
    { ...input, payload: { title: 'Help', body: 'Question', verified: true } },
    { ...input, actor: { ...input.actor, verified: true } },
    { ...input, expectedRevision: -1 },
    { ...input, operation: 'customer_message', caseId: '50000000-0000-4000-8000-000000000001', payload: { body: 'Question', status: 'closed' } },
    { ...input, actor: { kind: 'portal', userId: input.actor.userId, sessionId: input.actor.sessionId }, operation: 'internal_note', caseId: '50000000-0000-4000-8000-000000000001', payload: { body: 'Internal' } },
    { ...input, actor: { kind: 'portal', userId: input.actor.userId, sessionId: input.actor.sessionId }, interactionChannel: 'phone' },
    { ...input, operation: 'customer_message', caseId: '50000000-0000-4000-8000-000000000001', interactionChannel: 'phone', payload: { body: 'Publish phone draft' } },
  ])('rejects unknown fields, self asserted verification and unauthorized operation before RPC', async (candidate) => {
    const { executeSupportCommand } = await import('@/lib/customer-operations/supportCommand')
    await expect(executeSupportCommand(candidate as Parameters<typeof executeSupportCommand>[0])).rejects.toMatchObject({ code: 'invalid_support_command', status: 422 })
    expect(io.rpc).not.toHaveBeenCalled()
  })

  it('preserves optional OPS graph identifiers and classifies phone contact without a caller verification flag', async () => {
    const { executeSupportCommand } = await import('@/lib/customer-operations/supportCommand')
    io.rpc.mockResolvedValue({ data: { companyId: input.companyId, customerId: input.customerId, caseId: '50000000-0000-4000-8000-000000000001', revision: 1, status: 'open', replayed: false }, error: null })
    await executeSupportCommand({ ...input, siteId: '70000000-0000-4000-8000-000000000001', meteringPointId: '80000000-0000-4000-8000-000000000001', interactionChannel: 'phone' })
    expect(io.rpc.mock.calls[0][1].p_command).toMatchObject({ mode: 'ops', channel: 'phone', siteId: '70000000-0000-4000-8000-000000000001', meteringPointId: '80000000-0000-4000-8000-000000000001' })
    expect(io.rpc.mock.calls[0][1].p_command).not.toHaveProperty('verified')
    expect(io.rpc.mock.calls[0][1].p_command).not.toHaveProperty('callerVerification')
  })

  it('fails closed on mismatched persisted result and maps revision conflicts', async () => {
    const { executeSupportCommand } = await import('@/lib/customer-operations/supportCommand')
    io.rpc.mockResolvedValueOnce({ data: { companyId: input.companyId, customerId: 'other', caseId: '50000000-0000-4000-8000-000000000001', revision: 1, status: 'open', replayed: false }, error: null })
    await expect(executeSupportCommand(input)).rejects.toMatchObject({ code: 'support_result_invalid', status: 503 })
    io.rpc.mockResolvedValueOnce({ data: null, error: { message: 'support_revision_conflict' } })
    await expect(executeSupportCommand(input)).rejects.toMatchObject({ code: 'support_revision_conflict', status: 409 })
  })

  it('preserves a legacy half-completed creation key as a review conflict', async () => {
    const { executeSupportCommand } = await import('@/lib/customer-operations/supportCommand')
    const { supportFormError } = await import('@/lib/customer-cases/formState')
    io.rpc.mockResolvedValueOnce({ data: null, error: { message: 'support_legacy_idempotency_requires_review' } })
    await expect(executeSupportCommand(input)).rejects.toMatchObject({ code: 'support_legacy_idempotency_requires_review', status: 409 })
    expect(supportFormError({ code: 'support_legacy_idempotency_requires_review' })).toMatchObject({ ok: false, conflict: true })
    expect(io.rpc).toHaveBeenCalledTimes(1)
  })
})

it('rejects a committed reply with a missing message identity instead of returning a misleading successful response', async () => {
  const { executeSupportCommand } = await import('@/lib/customer-operations/supportCommand')
  const companyId = '10000000-0000-4000-8000-000000000001', customerId = '20000000-0000-4000-8000-000000000001', caseId = '50000000-0000-4000-8000-000000000001'
  io.rpc.mockResolvedValue({ data: { companyId, customerId, caseId, revision: 2, status: 'open', replayed: false }, error: null })
  await expect(executeSupportCommand({ companyId, customerId, caseId, actor: { kind: 'api', clientId: '30000000-0000-4000-8000-000000000001', subject: 'verified-subject' }, operation: 'customer_message', expectedRevision: 1, idempotencyKey: 'support-reply-result', payload: { body: 'Reply' } })).rejects.toMatchObject({ code: 'support_result_invalid', status: 503 })
})
