// After connect, imapflow reports a lost or timed-out socket as an 'error'
// event outside the caller's stack; without a listener Node throws it as an
// uncaughtException and the whole cron process dies. The fetch-command
// contract itself is covered against the real client in
// manual-mailbox-imap-protocol.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  imapMessages: [] as Row[],
  seen: [] as number[],
  violations: [] as string[],
  ingestFailures: new Set<string>(),
  socketErrorDuringFetch: false,
}))

vi.mock('@/lib/supabase/service', () => {
  class Query {
    filters: ((row: Row) => boolean)[] = []
    op: 'select' | 'update' = 'select'
    patch: Row | null = null
    constructor(private table: string) {}
    select() { return this }
    not() { return this }
    or() { return this }
    is() { return this }
    order() { return this }
    limit() { return this }
    eq(column: string, value: unknown) { this.filters.push(row => row[column] === value); return this }
    update(patch: Row) { this.op = 'update'; this.patch = patch; return this }
    private run() {
      const rows = (io.tables[this.table] ??= [])
      const matched = rows.filter(row => this.filters.every(filter => filter(row)))
      if (this.op === 'update') for (const row of matched) Object.assign(row, this.patch)
      return { data: matched.map(row => ({ ...row })), error: null }
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
vi.mock('@/lib/inbound-mail/manualInboundIngestion', () => ({
  ingestManualInboundEmail: async (email: { subject?: string | null }) => {
    if (io.ingestFailures.has(String(email.subject))) throw new Error('transient ingest failure')
    return { resolutionStatus: 'unmatched', processingState: 'stored' }
  },
}))
vi.mock('imapflow', async () => {
  const { EventEmitter } = await import('node:events')
  return { ImapFlow: class extends EventEmitter {
    get mailbox() { return { uidValidity: BigInt(1), uidNext: Math.max(0, ...io.imapMessages.map(m => Number(m.uid))) + 1 } }
    async connect() {}
    async getMailboxLock() { return { release() {} } }
    async logout() {}
    async search() { return io.imapMessages.map(m => Number(m.uid)) }
    async fetchOne(uid: string) {
      if (io.socketErrorDuringFetch) {
        // Like imapflow after connect: the socket timer emits 'error' outside the
        // caller's stack (Node throws it as uncaughtException without a listener)
        // and the in-flight command is rejected.
        await new Promise(resolve => setTimeout(resolve, 0))
        if (this.listenerCount('error') === 0) io.violations.push('error event without listener')
        else this.emit('error', new Error('Socket timeout'))
        throw new Error('Connection not available')
      }
      return io.imapMessages.find(m => String(m.uid) === uid) ?? null
    }
    async messageFlagsAdd(uid: number) { io.seen.push(uid) }
  } }
})

const message = (uid: number, subject: string) => ({
  uid, envelope: { subject, messageId: `<m${uid}@example.invalid>`, from: [{ address: 'natagare@example.invalid' }] },
  source: Buffer.from(`Subject: ${subject}\r\nMessage-ID: <m${uid}@example.invalid>\r\nContent-Type: text/plain\r\n\r\nbody`),
})

beforeEach(() => {
  io.tables = { manual_communication_mailboxes: [{
    id: 'mb-1', company_id: null, environment: 'test', imap_host: 'imap.example.invalid', imap_username: 'u', from_email: 'ops@example.invalid',
    is_active: true, is_verified: true, metadata: {}, last_polled_at: null, locked_at: null,
  }] }
  io.imapMessages = []
  io.seen = []
  io.violations = []
  io.ingestFailures = new Set()
  io.socketErrorDuringFetch = false
})

describe('manual mailbox poller and IMAP connection errors', () => {
  it('records an IMAP socket error on the mailbox instead of leaving it unhandled', async () => {
    io.imapMessages = [message(31, 'one')]
    io.socketErrorDuringFetch = true
    const { runManualInboundMailEngine } = await import('@/lib/inbound-mail/manualMailboxPoller')
    const result = await runManualInboundMailEngine()
    expect(io.violations).toEqual([])
    expect(result.ingested).toBe(0)
    expect(result.errors.join(' ')).toContain('Connection not available')
  })
})
