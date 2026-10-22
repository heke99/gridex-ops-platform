// reality-defects: J3-03, J3-04 (inbound Ediel robustness: a mail that cannot be stored)
//
// Production path: runInboundEdielMailEngine -> pollEdielMailbox -> storeMailboxFetchMessage -> storeInboundEmail,
// with a fake imapflow that follows the real client's contract (UNSEEN fetch in UID order, \Seen via
// messageFlagsAdd after the fetch loop) and an in-memory PostgREST that refuses U+0000 in text exactly like
// PostgreSQL does (22P05 "unsupported Unicode escape sequence", verified on the local database with
// json_populate_record over inbound_email_messages/inbound_email_attachments).
//   J3-03 a binary/UTF-16 part decodes to NUL characters: the decoded body failed the whole mail insert; a binary
//         attachment made the attachment batch insert fail and every attachment row (also the EDIFACT one) was
//         dropped with only a console warning.
//   J3-04 a mail whose storage fails is never flagged \Seen: every later poll fetches it again, first, with no
//         record but a poll-run error string. Unbounded, and 25 such mails starve every newer mail.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  imap: [] as Array<{ uid: number; seen: boolean; source: Buffer; messageId: string | null; subject: string }>,
  nextId: 1,
}))

vi.mock('@/lib/supabase/service', () => {
  const hasNul = (value: unknown): boolean => typeof value === 'string' ? value.includes('\u0000')
    : Array.isArray(value) ? value.some(hasNul) : value && typeof value === 'object' ? Object.values(value).some(hasNul) : false
  class Query {
    filters: Array<(row: Row) => boolean> = []
    op: 'select' | 'insert' | 'update' = 'select'
    patch: Row | Row[] | null = null
    limitTo = Infinity
    constructor(private table: string) {}
    select() { return this }
    order() { return this }
    not() { return this }
    or() { return this } // lock predicates: the fake has one worker
    limit(n: number) { this.limitTo = n; return this }
    eq(column: string, value: unknown) {
      this.filters.push(row => column === 'metadata' ? JSON.stringify(row.metadata ?? {}) === value : row[column] === value)
      return this
    }
    in(column: string, values: unknown[]) { this.filters.push(row => values.includes(row[column])); return this }
    is(column: string, value: unknown) { this.filters.push(row => (row[column] ?? null) === value); return this }
    insert(patch: Row | Row[]) { this.op = 'insert'; this.patch = patch; return this }
    update(patch: Row) { this.op = 'update'; this.patch = patch; return this }
    run(): { data: Row[] | null; error: Record<string, unknown> | null } {
      const rows = (io.tables[this.table] ??= [])
      if (this.op === 'insert') {
        const list = Array.isArray(this.patch) ? this.patch : [this.patch!]
        if (hasNul(list)) return { data: null, error: { code: '22P05', message: 'unsupported Unicode escape sequence', details: '\\u0000 cannot be converted to text.' } }
        const inserted = list.map(row => ({ id: `${this.table}-${io.nextId++}`, ...row }))
        rows.push(...inserted)
        return { data: inserted, error: null }
      }
      const matched = rows.filter(row => this.filters.every(filter => filter(row))).slice(0, this.limitTo)
      if (this.op === 'update') {
        if (hasNul(this.patch)) return { data: null, error: { code: '22P05', message: 'unsupported Unicode escape sequence' } }
        for (const row of matched) Object.assign(row, this.patch)
      }
      return { data: matched.map(row => ({ ...row })), error: null }
    }
    maybeSingle() { const { data, error } = this.run(); return Promise.resolve({ data: data?.[0] ?? null, error }) }
    single() { const { data, error } = this.run(); return Promise.resolve({ data: data?.[0] ?? null, error }) }
    then<T>(resolve: (value: unknown) => T, reject?: (reason: unknown) => T) { return Promise.resolve(this.run()).then(resolve, reject) }
  }
  return { supabaseService: { from: (table: string) => new Query(table), rpc: async () => ({ data: null, error: { message: 'not in fake' } }) } }
})
vi.mock('@/lib/ediel/transport/smime', () => ({
  unpackInboundSmimeIfNeeded: async () => ({ detected: false, decryptedText: null, matchedCompanyId: null, securityStatus: 'not_encrypted', encryptedPayloadRef: null, validationError: null }),
}))
vi.mock('imapflow', async () => {
  const { EventEmitter } = await import('node:events')
  return { ImapFlow: class extends EventEmitter {
    async connect() {}
    async getMailboxLock() { return { release() {} } }
    async logout() {}
    async *fetch(query: { seen?: boolean }) {
      for (const message of [...io.imap].sort((a, b) => a.uid - b.uid)) {
        if (query.seen === false && message.seen) continue
        yield { uid: message.uid, source: message.source, internalDate: new Date('2026-10-22T08:00:00Z'),
          envelope: { messageId: message.messageId, subject: message.subject, from: [{ address: 'natagare@example.invalid' }], to: [{ address: 'gridex-ediel@example.invalid' }] } }
      }
    }
    async messageFlagsAdd(uid: number) { const message = io.imap.find(m => m.uid === uid); if (message) message.seen = true }
  } }
})

import { pollEdielMailbox } from '@/lib/inbound-mail/edielMailboxPoller'

const MAILBOX = { id: 'mb-shared', company_id: null, mailbox_name: 'Gridex shared test Ediel', email_address: 'gridex-ediel@example.invalid',
  imap_host: 'imap.example.invalid', imap_port: 993, smtp_host: null, smtp_port: null, username: 'gridex-ediel@example.invalid',
  secret_reference: 'env:J3_TEST_IMAP_PASS', environment: 'test', is_active: true, poll_interval_minutes: 5, last_polled_at: null,
  last_successful_poll_at: null, last_error: null, locked_at: null, locked_by: null, metadata: { scope: 'platform_shared' },
  created_at: '2026-10-22T00:00:00Z', updated_at: '2026-10-22T00:00:00Z' }

const EDIFACT = ["UNA:+.? '", "UNB+UNOC:3+80001:ZZ+70001:ZZ+260902:0600+J3REF0001++23-DDQ-E66-T++++1'", "UNH+1+UTILTS:D:02B:UN:E5SE5A'",
  "BGM+E66::260+MJ3REF0001+9+AB'", "UNT+2+1'", "UNZ+1+J3REF0001'"].join('\r\n')

function mail(uid: number, subject: string, body: { contentType: string; encoding?: string; content: string }) {
  const headers = [`From: natagare@example.invalid`, `To: gridex-ediel@example.invalid`, `Subject: ${subject}`, `Message-ID: <j3-${uid}@example.invalid>`,
    `MIME-Version: 1.0`, `Content-Type: ${body.contentType}`, ...(body.encoding ? [`Content-Transfer-Encoding: ${body.encoding}`] : [])]
  return { uid, seen: false, subject, messageId: `<j3-${uid}@example.invalid>`, source: Buffer.from(`${headers.join('\r\n')}\r\n\r\n${body.content}\r\n`, 'latin1') }
}
const plainEdifact = (uid: number) => mail(uid, `E66 ${uid}`, { contentType: 'text/plain; charset=us-ascii', content: EDIFACT })
/** UTF-16 is a wrong encoding for EDIFACT; decoded it carries a NUL after every character. */
const utf16Edifact = (uid: number) => mail(uid, `E66 UTF-16 ${uid}`, { contentType: 'application/edifact', encoding: 'base64', content: Buffer.from(EDIFACT, 'utf16le').toString('base64') })
/** A plaintext AI list in the shared mailbox cannot be stored without a tenant (AI/BI personal-data gate). */
const plaintextAiList = (uid: number) => mail(uid, `AI-lista ${uid}`, { contentType: 'text/plain; charset=utf-8', content: 'AI;not;a;valid;header' })

const poll = (maxMessages = 25) => pollEdielMailbox({ mailbox: { ...MAILBOX, metadata: (io.tables.ediel_mailboxes[0].metadata ?? {}) as Row } as never,
  actorUserId: null, workerId: 'j3-worker', maxMessages })
const mails = () => io.tables.inbound_email_messages ?? []

beforeEach(() => {
  process.env.J3_TEST_IMAP_PASS = 'local-only'
  delete process.env.EDIEL_INBOUND_MAX_STORE_ATTEMPTS
  io.tables = { ediel_mailboxes: [{ ...MAILBOX, metadata: { ...MAILBOX.metadata } }], inbound_email_messages: [], inbound_email_attachments: [], inbound_processing_jobs: [] }
  io.imap = []
  io.nextId = 1
})

describe('J3-03 decoded NUL characters', () => {
  it('stores a single-part UTF-16 EDIFACT mail (visible, with a job) instead of failing the insert', async () => {
    io.imap = [utf16Edifact(1)]
    const result = await poll()
    expect(result.errors).toEqual([])
    expect(result.stored).toBe(1)
    expect(mails()).toHaveLength(1)
    expect(String(mails()[0].body_text)).not.toContain('\u0000')
    expect(mails()[0].raw_message_sha256).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/))
    expect(io.tables.inbound_processing_jobs).toHaveLength(1)
    expect(io.imap[0].seen).toBe(true)
  })

  it('keeps every attachment row when one attachment is binary', async () => {
    const boundary = 'j3-boundary'
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x55, 0x4e, 0x5a]).toString('base64')
    io.imap = [mail(2, 'E66 med zip', { contentType: `multipart/mixed; boundary="${boundary}"`, content: [
      `--${boundary}`, 'Content-Type: text/plain', '', 'Ediel',
      `--${boundary}`, 'Content-Type: application/edifact; name="E66.edi"', 'Content-Disposition: attachment; filename="E66.edi"', '', EDIFACT,
      `--${boundary}`, 'Content-Type: application/zip; name="extra.zip"', 'Content-Disposition: attachment; filename="extra.zip"', 'Content-Transfer-Encoding: base64', '', zip,
      `--${boundary}--`].join('\r\n') })]
    const result = await poll()
    expect(result.stored).toBe(1)
    expect(io.tables.inbound_email_attachments.map(row => row.filename).sort()).toEqual(['E66.edi', 'extra.zip'])
  })
})

describe('J3-04 a mail that can never be stored', () => {
  it('is retried a bounded number of times, then quarantined as a visible failed mail and flagged \\Seen', async () => {
    io.imap = [plaintextAiList(10)]
    const runs = []
    for (let run = 0; run < 4; run += 1) runs.push(await poll())
    expect(runs.map(r => r.errors.length > 0)).toEqual([true, true, true, false])
    expect(runs.map(r => r.deadLettered)).toEqual([0, 0, 1, 0])
    expect(io.imap[0].seen).toBe(true)
    expect(mails()).toEqual([expect.objectContaining({ processing_status: 'failed', match_status: 'storage_dead_lettered', raw_email: null,
      subject: 'AI-lista 10', internet_message_id: '<j3-10@example.invalid>', error_message: expect.stringContaining('3 försök') })])
    // No job: nothing is processed from the quarantined mail.
    expect(io.tables.inbound_processing_jobs).toEqual([])
    // The counter lives on the mailbox and is not reset by the quarantine.
    expect(io.tables.ediel_mailboxes[0].metadata).toMatchObject({ scope: 'platform_shared',
      ediel_store_attempts: { 'mid:<j3-10@example.invalid>': expect.objectContaining({ attempts: 3, dead_lettered_at: expect.any(String) }) } })
  })

  it('does not starve newer mail behind a full poll budget of unstorable mail', async () => {
    io.imap = [...Array.from({ length: 25 }, (_, i) => plaintextAiList(100 + i)), plainEdifact(500)]
    for (let run = 0; run < 3; run += 1) await poll()
    const fourth = await poll()
    expect(fourth.stored).toBe(1)
    expect(mails().filter(row => row.subject === 'E66 500')).toHaveLength(1)
    expect(mails().filter(row => row.match_status === 'storage_dead_lettered')).toHaveLength(25)
  })

  it('forgets the counter of a mail that is stored on a later attempt', async () => {
    io.imap = [utf16Edifact(20)]
    io.tables.ediel_mailboxes[0].metadata = { scope: 'platform_shared', ediel_store_attempts: { 'mid:<j3-20@example.invalid>': { attempts: 2, last_attempt_at: '2026-10-22T07:00:00Z', last_error: 'transient' } } }
    const result = await poll()
    expect(result.stored).toBe(1)
    expect(io.tables.ediel_mailboxes[0].metadata).toEqual({ scope: 'platform_shared', ediel_store_attempts: {} })
  })
})
