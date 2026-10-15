// IMAP pollers must not issue a command while an imapflow fetch() iterator is
// open: imapflow 2.2.1 documents "You can not run any IMAP commands in this
// loop otherwise you will end up in a deadloop", and a real IMAPS server times
// the socket out. The fake below enforces that contract instead of answering
// every command immediately, which is how the earlier mocks missed it.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  imapMessages: [] as Row[],
  seen: [] as number[],
  violations: [] as string[],
  ingestFailures: new Set<string>(),
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
vi.mock('imapflow', () => ({
  ImapFlow: class {
    fetching = false
    async connect() {}
    async getMailboxLock() { return { release() {} } }
    async logout() {}
    async *fetch() {
      this.fetching = true
      try { for (const message of io.imapMessages) yield message } finally { this.fetching = false }
    }
    async messageFlagsAdd(uid: number) {
      if (this.fetching) { io.violations.push(`messageFlagsAdd(${uid}) during fetch`); throw new Error('Socket timeout') }
      io.seen.push(uid)
    }
  },
}))

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
})

describe('manual mailbox poller against the imapflow fetch contract', () => {
  it('ingests every unseen message and flags them Seen only after the fetch loop', async () => {
    io.imapMessages = [message(11, 'one'), message(12, 'two'), message(13, 'three')]
    const { runManualInboundMailEngine } = await import('@/lib/inbound-mail/manualMailboxPoller')
    const result = await runManualInboundMailEngine()
    expect(io.violations).toEqual([])
    expect(result.errors).toEqual([])
    expect(result.ingested).toBe(3)
    expect(io.seen).toEqual([11, 12, 13])
  })

  it('leaves a failed message unseen for the next poll while flagging the others', async () => {
    io.imapMessages = [message(21, 'ok-1'), message(22, 'fails'), message(23, 'ok-2')]
    io.ingestFailures.add('fails')
    const { runManualInboundMailEngine } = await import('@/lib/inbound-mail/manualMailboxPoller')
    const result = await runManualInboundMailEngine()
    expect(io.violations).toEqual([])
    expect(result.ingested).toBe(2)
    expect(io.seen).toEqual([21, 23])
  })
})
