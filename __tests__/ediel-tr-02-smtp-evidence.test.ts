// masterplan: TR-02, AT-TR-02
import { createHash } from 'node:crypto'
import { beforeEach, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'

const io = vi.hoisted(() => ({ rpc: vi.fn(), providerCalls: 0, outcome: null as Error | null, response: '250 2.0.0 Ok: queued as OBSERVED-QUEUE' }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc } }))
vi.mock('@/lib/email/sendEdielEmail', () => ({ sendEdielEmail: async (_input: unknown, entry: { beforeProviderCall: (binding: Record<string, unknown>) => Promise<void> }) => {
  await entry.beforeProviderCall({ from: 'esco@example.invalid', to: 'dso@example.invalid', rfcMessageId: '<archived-mime@example.invalid>', mimeArchiveRef: 'synthetic-durable-archive', mimeSha256: 'b'.repeat(64), mimeLength: 123 })
  io.providerCalls++
  if (io.outcome) throw io.outcome
  return { accepted: ['dso@example.invalid'], rejected: [], messageId: '<provider-id@example.invalid>', response: io.response }
} }))
import { sendGenericFencedEdielEmail } from '@/lib/ediel/transport/outboundAttempt'
import { sendCorrectionFencedEmail } from '@/lib/ediel/sources/correctionOutboundDispatch'

// Real fences with finite private receipt ports; SQL persistence is exercised
// separately. These ports mint no archive/source/production authority.
beforeEach(() => {
  vi.clearAllMocks()
  io.providerCalls = 0
  io.outcome = null
  io.response = '250 2.0.0 Ok: queued as OBSERVED-QUEUE'
  io.rpc.mockImplementation(async (name: string, { p_input }: { p_input: { action: string; eventId?: string } }) => {
    if (name === 'gridex_ediel_transport_attempt_v1') return { error: null, data: p_input.action === 'observe' ? { classification: io.outcome ? 'unknown' : 'accepted', observedAt: '2026-10-04T12:00:00Z' } : { proceed: true } }
    if (name !== 'gridex_outbound_dispatch_v1') throw new Error('unexpected authority call')
    return { error: null, data: { scoped: true, proceed: true, eventId: p_input.action === 'witness' ? p_input.eventId : 'event-' + p_input.action,
      witnessed: p_input.action === 'witness', facts: { classification: io.outcome ? 'unknown' : 'accepted' }, observedAt: '2026-10-04T12:00:00Z', observationClock: 'database_provider_result_capture' } }
  })
})

for (const lane of ['generic', 'sealed_z08'] as const) {
  const context = { message: { id: 'own-original', company_id: 'own-company', environment: 'test', message_code: lane === 'generic' ? 'Z13' : 'Z08', raw_payload: 'UNCHANGED-SYNTHETIC-ORIGINAL', communication_route_id: 'own-route' } as EdielMessageRow,
    actorUserId: 'own-actor', mimeMode: 'attachment', payload: Buffer.from("UNB+ORIGINAL'"), encoding: 'latin1' }
  const send = () => (lane === 'generic' ? sendGenericFencedEdielEmail : sendCorrectionFencedEmail)({ to: 'dso@example.invalid', subject: 'Synthetic bounded transport' }, context)
  const observation = () => io.rpc.mock.calls.find(([, args]) => ['observe', 'result'].includes(args.p_input.action))![1].p_input
  const stableAttempt = () => {
    const prepare = io.rpc.mock.calls[0][1].p_input
    expect(prepare.binding).toMatchObject({ originalHash: createHash('sha256').update(context.message.raw_payload!).digest('hex'),
      payloadHash: createHash('sha256').update(context.payload).digest('hex'), payloadLength: context.payload.length, rfcMessageId: '<archived-mime@example.invalid>' })
    expect(io.rpc.mock.calls.every(([, args]) => args.p_input.attemptId === prepare.attemptId && args.p_input.messageId === context.message.id && args.p_input.companyId === context.message.company_id)).toBe(true)
    expect(prepare.attemptId).toMatch(/^[a-f0-9-]{36}$/)
  }

  it(`TR-02 ${lane} retains observed queue/status separately from MIME and provider identities`, async () => {
    expect(await send()).toMatchObject({ messageId: '<provider-id@example.invalid>' })
    expect(observation().result).toMatchObject({ response: io.response, smtpCode: 250, queueId: 'OBSERVED-QUEUE', messageId: '<provider-id@example.invalid>' })
    stableAttempt()
    expect(io.providerCalls).toBe(1)
  })

  it(`TR-02 ${lane} retains an explicit unknown queue instead of inventing a token`, async () => {
    io.response = '250 Message accepted'
    await send()
    expect(observation().result).toMatchObject({ response: io.response, smtpCode: 250, queueId: null })
    stableAttempt()
  })

  it(`TR-02 ${lane} retains an ambiguous queue as unknown without losing the exact response`, async () => {
    io.response = '250 queued as FIRST queued as SECOND'
    await send()
    expect(observation().result).toMatchObject({ response: io.response, smtpCode: 250, queueId: null })
    stableAttempt()
    expect(io.providerCalls).toBe(1)
  })

  it.each([450, 550])(`TR-02 ${lane} retains complete %i rejection evidence`, async smtpCode => {
    io.outcome = Object.assign(new Error('Synthetic explicit rejection'), { responseCode: smtpCode, response: `${smtpCode} 5.0.0 Exact provider rejection`, code: 'EMESSAGE', command: 'DATA' })
    await expect(send()).rejects.toMatchObject({ code: 'ediel_delivery_uncertain' })
    expect(observation().result).toMatchObject({ smtpCode, queueId: null, error: { responseCode: smtpCode, response: `${smtpCode} 5.0.0 Exact provider rejection`, code: 'EMESSAGE', command: 'DATA' } })
    stableAttempt()
    expect(io.providerCalls).toBe(1)
  })

  it(`TR-02 ${lane} preserves timeout as unknown and suppresses a second provider call`, async () => {
    io.outcome = Object.assign(new Error('Synthetic DATA timeout'), { code: 'ETIMEDOUT', command: 'DATA' })
    await expect(send()).rejects.toMatchObject({ code: 'ediel_delivery_uncertain' })
    expect(observation().result).toMatchObject({ smtpCode: null, queueId: null, error: { code: 'ETIMEDOUT', command: 'DATA', response: null } })
    stableAttempt()
    io.rpc.mockResolvedValue({ error: null, data: { scoped: true, proceed: false, classification: 'unknown' } })
    await expect(send()).rejects.toMatchObject({ code: 'ediel_delivery_uncertain' })
    expect(io.providerCalls).toBe(1)
    expect(io.rpc.mock.calls.some(([, args]) => args.p_input.action === 'release')).toBe(false)
  })
}
