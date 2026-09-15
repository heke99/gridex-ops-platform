import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sendOutboxItem } from '@/lib/ediel/outbox/sendOutboxItem'
import { SmtpDeliveryUncertainError } from '@/lib/ediel/transport/smtpOutcome'

const mocks = vi.hoisted(() => ({ send: vi.fn(), writes: [] as Array<Record<string, unknown>>, from: vi.fn(), get: vi.fn(), claimLost: false, filters: [] as Array<[string, unknown]> }))
vi.mock('@/lib/ediel/db', () => ({ getEdielMessageById: mocks.get }))
vi.mock('@/lib/ediel/transport', () => ({ sendEdielMessageViaSmtp: mocks.send }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: mocks.from } }))
vi.mock('@/lib/ediel/outbox/readinessGuard', () => ({ getEdielOutboundReadinessBlocker: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/ediel/outbox/routeContract', () => ({ evaluateEdielRouteContract: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock('@/lib/ediel/outbox/projectSentSources', () => ({ projectSentEdielSourceState: vi.fn() }))
vi.mock('@/lib/tenant/operationPolicy', () => ({ getTenantOperationDecision: vi.fn().mockResolvedValue({ allowed: true }) }))

describe('SMTP uncertainty at the outbox boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.writes.length = 0
    mocks.filters.length = 0
    mocks.claimLost = false
    mocks.get.mockResolvedValue({ id: 'message1', company_id: 'company1', status: 'prepared' })
    mocks.from.mockImplementation((table) => {
      let writing = false
      const item = { id: 'outbox1', company_id: 'company1', environment: 'test', ediel_message_id: 'message1', status: 'sending', locked_by: 'worker1', current_send_attempt_id: 'attempt1' }
      const result = () => ({ data: table === 'ediel_send_locks' ? [] : writing ? mocks.claimLost && mocks.writes.at(-1)?.status === 'delivery_uncertain' ? null : { id: 'outbox1' } : item, error: null })
      return { select: vi.fn().mockReturnThis(), eq: vi.fn(function(this: unknown, key, value) { mocks.filters.push([key, value]); return this }), limit: vi.fn().mockReturnThis(),
        update: vi.fn(function(this: unknown, payload) { writing = true; mocks.writes.push(payload); return this }),
        maybeSingle: vi.fn(() => Promise.resolve(result())), then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve) }
    })
  })
  const send = () => sendOutboxItem({ actorUserId: 'actor1', outboxItemId: 'outbox1', alreadyClaimed: true, workerId: 'worker1', sendAttemptId: 'attempt1' })
  it.each([
    { code: 'ECONNECTION', command: 'CONN' },
    { code: 'ETIMEDOUT', command: 'CONN' },
    { code: 'ESOCKET', command: 'DATA' },
  ])('keeps ambiguous SMTP error %j for transport reconciliation', async (fields) => {
    mocks.send.mockRejectedValue(Object.assign(new Error('Connection lost'), fields))
    expect((await send()).status).toBe('delivery_uncertain')
    expect(mocks.writes.at(-1)?.status).toBe('delivery_uncertain')
  })
  it.each([
    { code: 'EMESSAGE', command: 'DATA', responseCode: 550 },
    { code: 'EENVELOPE', command: 'RCPT TO', responseCode: 450 },
    { code: 'EAUTH', command: 'AUTH PLAIN', responseCode: 535 },
    { code: 'EDNS', command: 'CONN' },
    { code: 'ESOCKET', command: 'CONN', syscall: 'connect' },
  ])('retains definite pre-submission/rejected error %j as failed', async (fields) => {
    mocks.send.mockRejectedValue(Object.assign(new Error('Not submitted'), fields))
    expect((await send()).status).toBe('failed')
  })
  it('retains an ordinary preflight failure as failed', async () => {
    mocks.send.mockRejectedValue(new Error('Certificate not usable'))
    expect((await send()).status).toBe('failed')
  })
  it('keeps the SMTP message ID when acceptance bookkeeping throws', async () => {
    mocks.send.mockRejectedValue(new SmtpDeliveryUncertainError(new Error('DB unavailable'), '<smtp1@example.test>'))
    expect(await send()).toMatchObject({ status: 'delivery_uncertain', messageId: '<smtp1@example.test>' })
    expect(mocks.writes.at(-1)?.smtp_message_id).toBe('<smtp1@example.test>')
  })
  it('fails closed if the attempt fence rejects the uncertain-state write', async () => {
    mocks.claimLost = true
    mocks.send.mockRejectedValue(new SmtpDeliveryUncertainError(new Error('DB unavailable'), '<smtp1@example.test>'))
    const result = await send()
    expect(result).toMatchObject({ status: 'delivery_uncertain', messageId: '<smtp1@example.test>' })
    expect(result.error).toContain('delivery_uncertain_persistence_failed: ediel_outbox_claim_lost_before_status_update')
    expect(mocks.filters.at(-1)).toEqual(['current_send_attempt_id', 'attempt1'])
  })
})
