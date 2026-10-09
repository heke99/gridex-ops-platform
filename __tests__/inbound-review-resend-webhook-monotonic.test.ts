// inbound-review: #1
// inbound-review: #2
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
type Failure = { table: string; op: 'select' | 'update' | 'insert'; error: { code?: string; message: string } }

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  failures: [] as Failure[],
  seq: 0,
}))

vi.mock('@/lib/supabase/service', () => {
  class Query {
    filters: ((row: Row) => boolean)[] = []
    op: 'select' | 'update' | 'insert' = 'select'
    patch: Row | null = null
    constructor(private table: string) {}
    select() { return this }
    order() { return this }
    limit() { return this }
    eq(column: string, value: unknown) { this.filters.push((row) => row[column] === value); return this }
    in(column: string, values: unknown[]) { this.filters.push((row) => values.includes(row[column])); return this }
    or(expression: string) {
      // Supports `col.is.null,col.in.(a,b)` used by the manual outbox guard.
      const match = /^(\w+)\.is\.null,\1\.in\.\(([^)]*)\)$/.exec(expression)
      if (!match) throw new Error(`unsupported or(): ${expression}`)
      const [, column, list] = match
      const values = list.split(',')
      this.filters.push((row) => row[column] == null || values.includes(String(row[column])))
      return this
    }
    update(patch: Row) { this.op = 'update'; this.patch = patch; return this }
    insert(row: Row) { this.op = 'insert'; this.patch = row; return this }
    private run(): { data: Row[]; error: Failure['error'] | null } {
      const failure = db.failures.find((entry) => entry.table === this.table && entry.op === this.op)
      if (failure) return { data: [], error: failure.error }
      const rows = (db.tables[this.table] ??= [])
      if (this.op === 'insert') {
        const row = { id: `row-${++db.seq}`, processed_at: null, ...this.patch }
        rows.push(row)
        return { data: [row], error: null }
      }
      const matched = rows.filter((row) => this.filters.every((filter) => filter(row)))
      if (this.op === 'update') for (const row of matched) Object.assign(row, this.patch)
      return { data: matched.map((row) => ({ ...row })), error: null }
    }
    maybeSingle() { const { data, error } = this.run(); return Promise.resolve({ data: data[0] ?? null, error }) }
    single() {
      const { data, error } = this.run()
      return Promise.resolve(error ? { data: null, error } : data[0] ? { data: data[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } })
    }
    then<T>(resolve: (value: { data: Row[]; error: Failure['error'] | null }) => T, reject?: (reason: unknown) => T) {
      return Promise.resolve(this.run()).then(resolve, reject)
    }
  }
  return { supabaseService: { from: (table: string) => new Query(table) } }
})
vi.mock('@/lib/email/emailDomainEvents', () => ({ emitCommunicationSentDomainEvents: async () => undefined }))

import {
  markCommunicationBounced,
  markCommunicationDelivered,
  markCommunicationSent,
} from '@/lib/email/communicationLogs'
import { processResendWebhookEvent, ResendWebhookProcessingError } from '@/lib/email/resendWebhookEvents'

const headers = (id: string) => ({ id, timestamp: '1', signature: 'v1,x' })
const event = (type: string, extra: Row = {}) => ({
  type,
  created_at: '2026-10-09T10:00:00.000Z',
  data: { email_id: 'msg-1', ...extra },
}) as never

beforeEach(() => {
  db.tables = {
    communication_logs: [{ id: 'log-1', company_id: 'co-1', provider: 'resend', provider_message_id: 'msg-1', status: 'sent', error_message: null }],
    communication_log_events: [],
    manual_email_outbox: [],
    grid_owner_information_requests: [],
  }
  db.failures = []
  db.seq = 0
})

describe('#1 communication log status is monotonic', () => {
  it('a late sent never downgrades bounced or clears its error', async () => {
    await markCommunicationBounced('log-1', 'mailbox full', '2026-10-09T10:00:00Z')
    const after = await markCommunicationSent('log-1', 'msg-1')
    expect(after.status).toBe('bounced')
    expect(after.error_message).toBe('mailbox full')
    expect(db.tables.communication_logs[0]).toMatchObject({ status: 'bounced', error_message: 'mailbox full' })
  })

  it('delivered is not downgraded by a later sent, and a terminal state is not left by delivered', async () => {
    await markCommunicationDelivered('log-1', '2026-10-09T10:00:00Z')
    expect((await markCommunicationSent('log-1', 'msg-1')).status).toBe('delivered')
    await markCommunicationBounced('log-1', 'bounce', '2026-10-09T10:01:00Z')
    const row = await markCommunicationDelivered('log-1', '2026-10-09T10:02:00Z')
    expect(row).toMatchObject({ status: 'bounced', error_message: 'bounce' })
  })

  it('webhook replay order bounced -> sent keeps bounced', async () => {
    await processResendWebhookEvent(event('email.bounced', { bounce: { message: 'no such user' } }), headers('evt-b'))
    await processResendWebhookEvent(event('email.sent'), headers('evt-s'))
    expect(db.tables.communication_logs[0]).toMatchObject({ status: 'bounced', error_message: 'no such user' })
  })

  it('manual outbox: delivered is not downgraded to delivery_delayed and bounced keeps its error', async () => {
    db.tables.manual_email_outbox = [{ id: 'out-1', company_id: 'co-1', request_id: null, status: 'sent', delivery_status: 'sent', provider_message_id: 'msg-1' }]
    db.tables.communication_logs = []
    await processResendWebhookEvent(event('email.delivered'), headers('e1'))
    await processResendWebhookEvent(event('email.delivery_delayed'), headers('e2'))
    expect(db.tables.manual_email_outbox[0].delivery_status).toBe('delivered')
    await processResendWebhookEvent(event('email.bounced', { bounce: { message: 'gone' } }), headers('e3'))
    await processResendWebhookEvent(event('email.sent'), headers('e4'))
    await processResendWebhookEvent(event('email.delivered'), headers('e5'))
    expect(db.tables.manual_email_outbox[0]).toMatchObject({ delivery_status: 'bounced', last_error: 'gone' })
  })
})

describe('#2 webhook processing failures are retried, never lost', () => {
  it('a lookup failure throws (5xx) instead of storing an unlinked event', async () => {
    db.failures.push({ table: 'communication_logs', op: 'select', error: { code: '57014', message: 'canceling statement due to statement timeout' } })
    await expect(processResendWebhookEvent(event('email.delivered'), headers('evt-1'))).rejects.toMatchObject({
      name: 'ResendWebhookProcessingError',
      stage: 'communication_log_lookup_failed',
    })
    expect(db.tables.communication_log_events).toHaveLength(0)
  })

  it('a status-write failure throws and the retry re-processes the stored event', async () => {
    db.failures.push({ table: 'communication_logs', op: 'update', error: { code: '40001', message: 'serialization failure' } })
    const failed = await processResendWebhookEvent(event('email.delivered'), headers('evt-2')).catch((error) => error)
    expect(failed).toBeInstanceOf(ResendWebhookProcessingError)
    expect(failed.stage).toBe('communication_status_failed')
    expect(db.tables.communication_log_events).toHaveLength(1)
    expect(db.tables.communication_log_events[0].processed_at).toBeNull()

    db.failures = []
    const retried = await processResendWebhookEvent(event('email.delivered'), headers('evt-2'))
    expect(retried.duplicate).toBe(false)
    expect(db.tables.communication_logs[0].status).toBe('delivered')
    expect(db.tables.communication_log_events).toHaveLength(1)
    expect(db.tables.communication_log_events[0].processed_at).toEqual(expect.any(String))

    const replay = await processResendWebhookEvent(event('email.delivered'), headers('evt-2'))
    expect(replay.duplicate).toBe(true)
  })

  it('the success body carries no raw database error text', async () => {
    const result = await processResendWebhookEvent(event('email.delivered'), headers('evt-3'))
    expect(result).not.toHaveProperty('processingWarning')
    expect(JSON.stringify(result)).not.toMatch(/serialization|timeout/)
  })

  it('the route answers 500 with a stage code only', async () => {
    process.env.RESEND_WEBHOOK_SECRET = 'whsec_dGVzdA=='
    vi.resetModules()
    vi.doMock('@/lib/email/resendWebhookEvents', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/email/resendWebhookEvents')>()
      return {
        ...actual,
        verifyResendWebhook: () => event('email.delivered'),
        processResendWebhookEvent: async () => {
          throw new actual.ResendWebhookProcessingError('communication_log_lookup_failed', new Error('relation secret_table timeout'))
        },
      }
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { POST } = await import('@/app/api/webhooks/resend/route')
    const request = new Request('https://x.test/api/webhooks/resend', {
      method: 'POST',
      headers: { 'webhook-id': 'evt-9', 'webhook-timestamp': '1', 'webhook-signature': 'v1,x' },
      body: '{}',
    })
    const response = await POST(request as never)
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toMatchObject({ ok: false, code: 'event_processing_failed', stage: 'communication_log_lookup_failed' })
    expect(JSON.stringify(body)).not.toContain('secret_table')
    errorSpy.mockRestore()
    vi.doUnmock('@/lib/email/resendWebhookEvents')
  })
})
