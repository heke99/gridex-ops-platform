// inbound-review: #5
// inbound-review: #6
// inbound-review: #7
// inbound-review: #8
// inbound-review: coordinator-5 (auto-reply classification)
import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  seq: 0,
  applyCalls: 0,
  applyFailures: 0,
  correlationCalls: 0,
  imapMessages: [] as Row[],
  seen: [] as number[],
  ingestError: null as Error | null,
}))

vi.mock('@/lib/supabase/service', () => {
  class Query {
    filters: ((row: Row) => boolean)[] = []
    op: 'select' | 'update' | 'insert' | 'upsert' = 'select'
    patch: Row | null = null
    constructor(private table: string) {}
    select() { return this }
    order() { return this }
    limit() { return this }
    not() { return this }
    or() { return this }
    ilike() { return this }
    eq(column: string, value: unknown) { this.filters.push((row) => row[column] === value); return this }
    update(patch: Row) { this.op = 'update'; this.patch = patch; return this }
    insert(row: Row) { this.op = 'insert'; this.patch = row; return this }
    upsert(row: Row) { this.op = 'upsert'; this.patch = row; return this }
    private run(): { data: Row[]; error: null } {
      const rows = (io.tables[this.table] ??= [])
      if (this.op === 'insert' || this.op === 'upsert') {
        const row = { id: `row-${++io.seq}`, created_at: new Date().toISOString(), ...this.patch }
        rows.push(row)
        return { data: [row], error: null }
      }
      const matched = rows.filter((row) => this.filters.every((filter) => filter(row)))
      if (this.op === 'update') for (const row of matched) Object.assign(row, this.patch)
      return { data: matched.map((row) => ({ ...row })), error: null }
    }
    maybeSingle() { const { data, error } = this.run(); return Promise.resolve({ data: data[0] ?? null, error }) }
    then<T>(resolve: (value: { data: Row[]; error: null }) => T, reject?: (reason: unknown) => T) {
      return Promise.resolve(this.run()).then(resolve, reject)
    }
  }
  return { supabaseService: { from: (table: string) => new Query(table) } }
})
vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/email/manualOperationsMailbox', () => ({ resolveManualMailboxSecret: () => 'pw' }))
vi.mock('@/lib/customer-operations/manualFacilityResponseParser', () => ({
  extractManualFacilityFields: () => ({ facility_id: '735999100000000001' }),
  scoreManualFacilityPayload: () => 0.9,
  applyManualFacilityResponse: async () => {
    io.applyCalls += 1
    if (io.applyFailures > 0) { io.applyFailures -= 1; throw new Error('deadlock detected') }
    return { outcome: 'applied' }
  },
}))
vi.mock('@/lib/inbound-mail/manualInboundCorrelation', () => ({
  resolveManualInboundCorrelation: async () => {
    io.correlationCalls += 1
    return {
      resolutionStatus: 'matched', companyId: 'co-1', requestId: 'req-1', customerId: 'cu-1', customerSiteId: 'site-1',
      meteringPointId: null, gridOwnerId: 'go-1', tenantResolutionMethod: 'case_reference', entityResolutionMethod: 'request',
      evidence: {}, businessProcess: 'facility_lookup', intent: 'facility_response', intentConfidence: 1,
      senderCredible: true, request: { id: 'req-1', request_type: 'facility_identifier_lookup' },
    }
  },
}))
vi.mock('imapflow', () => ({
  ImapFlow: class {
    async connect() {}
    async getMailboxLock() { return { release() {} } }
    async logout() {}
    async *fetch() { for (const message of io.imapMessages) yield message }
    async messageFlagsAdd(uid: number) { io.seen.push(uid) }
  },
}))

import { ingestManualInboundEmail } from '@/lib/inbound-mail/manualInboundIngestion'

const email = (extra: Row = {}) => ({
  mailbox: 'leverantorsbyte@gridex.se',
  fromEmail: 'kund@natagare.se',
  subject: 'Re: [GX-FIR-ABCDEF12] Anläggnings-ID',
  bodyText: 'Anläggnings-ID 735999100000000001',
  providerMessageId: '<m1@natagare.se>',
  ...extra,
})

beforeEach(() => {
  io.tables = { manual_inbound_messages: [], inbound_operation_events: [], manual_communication_mailboxes: [] }
  io.seq = 0
  io.applyCalls = 0
  io.applyFailures = 0
  io.correlationCalls = 0
  io.imapMessages = []
  io.seen = []
})

describe('#6 matched-but-not-applied mail is re-processed', () => {
  it('a throw in applyManualFacilityResponse is retried on the next ingest', async () => {
    io.applyFailures = 1
    await expect(ingestManualInboundEmail(email())).rejects.toThrow('deadlock detected')
    expect(io.tables.manual_inbound_messages[0]).toMatchObject({ resolution_status: 'matched', processing_state: 'matched' })

    const retried = await ingestManualInboundEmail(email())
    expect(io.applyCalls).toBe(2)
    expect(retried.processingState).toBe('applied')
    expect(io.tables.manual_inbound_messages).toHaveLength(1)
    expect(io.tables.manual_inbound_messages[0].processing_state).toBe('applied')

    // Terminal now: a further replay is idempotent and does not re-apply.
    await ingestManualInboundEmail(email())
    expect(io.applyCalls).toBe(2)
  })
})

describe('coordinator #5 auto-replies are ignored before anything is applied', () => {
  it.each([
    [{ 'auto-submitted': 'auto-replied' }],
    [{ precedence: 'auto_reply' }],
    [{ precedence: 'bulk' }],
    [{ 'x-autoreply': 'yes' }],
    [{ 'x-autorespond': 'Out of office' }],
    [{ 'content-type': 'multipart/report; report-type=delivery-status' }],
  ])('%o', async (headers) => {
    const result = await ingestManualInboundEmail(email({ subject: 'Autosvar: Re: [GX-FIR-ABCDEF12]', autoReplyHeaders: headers }))
    expect(result).toMatchObject({ resolutionStatus: 'ignored', processingState: 'ignored_auto_reply', requestId: null })
    expect(io.applyCalls).toBe(0)
    expect(io.correlationCalls).toBe(0)
    expect(io.tables.manual_inbound_messages[0]).toMatchObject({ resolution_status: 'ignored', processing_state: 'ignored', intent: 'auto_reply' })
  })

  it('Auto-Submitted: no is a human reply', async () => {
    const result = await ingestManualInboundEmail(email({ autoReplyHeaders: { 'auto-submitted': 'no' } }))
    expect(result.processingState).toBe('applied')
  })
})

describe('#7 poison messages are dead-lettered and Message-ID-less mail is deduplicated', () => {
  it('marks a repeatedly failing message Seen after the attempt limit and records it on the mailbox', async () => {
    process.env.MANUAL_INBOUND_MAX_ATTEMPTS_PER_MESSAGE = '2'
    io.tables.manual_communication_mailboxes = [{
      id: 'mb-1', company_id: null, environment: 'test', imap_host: 'imap.test', imap_username: 'u', from_email: 'leverantorsbyte@gridex.se',
      is_active: true, is_verified: true, metadata: {}, last_polled_at: null, locked_at: null,
    }]
    const source = Buffer.from('Subject: x\r\nContent-Type: text/plain\r\n\r\nbody')
    io.imapMessages = [{ uid: 7, envelope: { subject: 'x', from: [{ address: 'a@b.se' }] }, source }]
    io.applyFailures = 99
    const { runManualInboundMailEngine } = await import('@/lib/inbound-mail/manualMailboxPoller')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const first = await runManualInboundMailEngine()
    expect(first.deadLettered).toBe(0)
    expect(io.seen).toEqual([])
    io.tables.manual_communication_mailboxes[0].last_polled_at = null
    const second = await runManualInboundMailEngine()
    expect(second.deadLettered).toBe(1)
    expect(io.seen).toEqual([7])
    const attempts = (io.tables.manual_communication_mailboxes[0].metadata as Row).message_attempts as Record<string, Row>
    const [key] = Object.keys(attempts)
    expect(key).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(attempts[key]).toMatchObject({ attempts: 2, dead_lettered_at: expect.any(String) })
    // Message without Message-ID was stored once under the fallback key.
    expect(io.tables.manual_inbound_messages).toHaveLength(1)
    expect(io.tables.manual_inbound_messages[0].provider_message_id).toBe(key)
    errorSpy.mockRestore()
    delete process.env.MANUAL_INBOUND_MAX_ATTEMPTS_PER_MESSAGE
  })
})

describe('#5 manual inbound webhook status codes', () => {
  const secret = 'whsec-test'
  const signed = (body: string) => {
    const timestamp = Math.floor(Date.now() / 1000)
    const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
    return new Request('https://x.test/api/webhooks/manual-inbound', {
      method: 'POST',
      headers: { 'x-manual-inbound-timestamp': String(timestamp), 'x-gridex-signature': `sha256=${signature}` },
      body,
    })
  }

  it('422 for invalid JSON / validation, 503 for temporary processing errors, auto-reply headers forwarded', async () => {
    process.env.MANUAL_INBOUND_WEBHOOK_SECRET = secret
    const { POST } = await import('@/app/api/webhooks/manual-inbound/route')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect((await POST(signed('{not json') as never)).status).toBe(422)
    expect((await POST(signed(JSON.stringify({ mailbox: 'x@y.se' })) as never)).status).toBe(422)

    io.applyFailures = 1
    const body = JSON.stringify({ message_id: '<w1@n.se>', mailbox: 'leverantorsbyte@gridex.se', from: 'kund@natagare.se', subject: 'Re: [GX-FIR-ABCDEF12]' })
    const temporary = await POST(signed(body) as never)
    expect(temporary.status).toBe(503)

    const auto = JSON.stringify({ message_id: '<w2@n.se>', mailbox: 'leverantorsbyte@gridex.se', from: 'kund@natagare.se', subject: 'Autosvar', headers: { 'Auto-Submitted': 'auto-replied' } })
    const autoResponse = await POST(signed(auto) as never)
    expect(autoResponse.status).toBe(200)
    expect((await autoResponse.json()).result.processingState).toBe('ignored_auto_reply')
    errorSpy.mockRestore()
  })
})

describe('#8 inbound-mail cron returns codes only', () => {
  it('does not echo the raw error message', async () => {
    process.env.CRON_SECRET = 'cron-secret'
    vi.doMock('@/lib/inbound-mail/edielMailboxPoller', () => ({
      runInboundEdielMailEngine: async () => { throw new Error('relation "ediel_private_table" does not exist at host db.internal') },
    }))
    const { POST } = await import('@/app/api/internal/inbound-mail/cron/route')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { NextRequest } = await import('next/server')
    const response = await POST(new NextRequest('https://x.test/api/internal/inbound-mail/cron?environment=test', { headers: { authorization: 'Bearer cron-secret' } }))
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.code).toBe('inbound_mail_processing_failed')
    expect(body).not.toHaveProperty('message')
    expect(JSON.stringify(body)).not.toContain('ediel_private_table')
    errorSpy.mockRestore()
  })
})
