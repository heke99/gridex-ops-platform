import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sendOutboxItem } from '@/lib/ediel/outbox/sendOutboxItem'
import { SmtpDeliveryUncertainError } from '@/lib/ediel/transport/smtpOutcome'

const mocks = vi.hoisted(() => ({ send: vi.fn(), writes: [] as Array<Record<string, unknown>>, from: vi.fn(), get: vi.fn(), claimLost: false, lockedAt: null as string | null, filters: [] as Array<[string, unknown]> }))
vi.mock('@/lib/ediel/db', () => ({ getEdielMessageById: mocks.get }))
vi.mock('@/lib/ediel/transport/acceptedProjection', () => ({ readAcceptedEdielTransportProjection: vi.fn().mockResolvedValue(null) }))
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
    mocks.lockedAt = new Date().toISOString()
    mocks.get.mockResolvedValue({ id: 'message1', company_id: 'company1', environment: 'test', direction: 'outbound', status: 'prepared' })
    mocks.from.mockImplementation((table) => {
      let writing = false
      const item = { id: 'outbox1', company_id: 'company1', environment: 'test', ediel_message_id: 'message1', status: 'sending', locked_by: 'worker1', locked_at: mocks.lockedAt, current_send_attempt_id: 'attempt1' }
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
  it('returns the retained SMTP ID and persists claim-scoped uncertainty when acceptance bookkeeping throws', async () => {
    mocks.send.mockRejectedValue(new SmtpDeliveryUncertainError(new Error('DB unavailable'), '<smtp1@example.test>'))
    expect(await send()).toMatchObject({ status: 'delivery_uncertain', messageId: '<smtp1@example.test>' })
    expect(mocks.writes.at(-1)).toMatchObject({status:'delivery_uncertain',last_error:expect.stringContaining('DB unavailable'),locked_at:null,locked_by:null})
    expect(mocks.filters.at(-1)).toEqual(['current_send_attempt_id','attempt1'])
  })
  it.each(['expired','missing','invalid','future'] as const)('blocks an unswept %s claim before any provider or queue effect',async kind => {
    mocks.lockedAt = kind === 'missing' ? null : kind === 'invalid' ? 'not-a-clock' : new Date(Date.now() + (kind === 'future' ? 1 : -1) * 3600000).toISOString()
    mocks.send.mockResolvedValue({messageId:'<must-not-send>'})
    const result = await send()
    expect(mocks.send).not.toHaveBeenCalled()
    expect(result).toMatchObject({status:'blocked'})
    expect(mocks.writes).toEqual([])
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

describe('SmtpDeliveryUncertainError cause message', () => {
  it('keeps a plain Supabase error code/message but never its details or hint', () => {
    const error = new SmtpDeliveryUncertainError({ code: '23505', message: 'duplicate key value', details: 'Key (id)=(secret-row)', hint: 'private' }, '<m@x>')
    expect(error.message).toBe('23505: duplicate key value')
    expect(error.message).not.toMatch(/secret-row|private|object Object/)
    expect(new SmtpDeliveryUncertainError(new Error('plain')).message).toBe('plain')
    expect(new SmtpDeliveryUncertainError({ message: 'no code' }).message).toBe('no code')
  })
})
