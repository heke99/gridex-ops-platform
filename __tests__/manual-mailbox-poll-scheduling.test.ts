import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isDeepStrictEqual } from 'node:util'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  mailbox: {} as Row,
  mailboxes: [] as Row[],
  messages: [] as Row[],
  trace: [] as string[],
  connectedHosts: [] as string[],
  elapsed: 0,
  uidValidity: BigInt(1),
  flagFailures: 0,
  fetchFailures: 0,
  afterUnseen: undefined as (() => void) | undefined,
  beforeClaim: undefined as (() => void) | undefined,
  finishFailures: 0,
  generatorActive: false,
  ingest: vi.fn(),
  verify: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: { from: (table: string) => {
    if (table !== 'manual_communication_mailboxes') throw new Error(`Unexpected table: ${table}`)
    const filters: Array<(row: Row) => boolean> = []
    let patch: Row | undefined
    const query = {
      select() { return query },
      eq(key: string, value: unknown) {
        filters.push(row => typeof row[key] === 'object' && typeof value === 'string'
          ? isDeepStrictEqual(row[key], JSON.parse(value)) : row[key] === value)
        return query
      },
      is(key: string, value: unknown) { filters.push(row => (row[key] ?? null) === value); return query },
      not(key: string, _operator: string, value: unknown) { filters.push(row => row[key] !== value); return query },
      or(expression: string) {
        const cutoff = expression.split('locked_at.lt.')[1]
        filters.push(row => row.locked_at == null || String(row.locked_at) < cutoff)
        return query
      },
      update(value: Row) { patch = value; if (typeof value.locked_by === 'string') io.beforeClaim?.(); return query },
      async maybeSingle() {
        if (patch?.metadata && patch.locked_by === null && io.finishFailures > 0) {
          io.finishFailures--
          return { data: null, error: new Error('synthetic checkpoint database failure') }
        }
        const rows = run(); return { data: rows[0] ?? null, error: null }
      },
      then(resolve: (value: { data: Row[]; error: null }) => unknown) { return Promise.resolve({ data: run(), error: null }).then(resolve) },
    }
    function run() {
      const rows = (io.mailboxes.length ? io.mailboxes : [io.mailbox]).filter(row => filters.every(filter => filter(row)))
      if (patch) rows.forEach(row => Object.assign(row, patch))
      return rows.map(row => ({ ...row }))
    }
    return query
  } },
}))
vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/email/manualOperationsMailbox', () => ({ resolveManualMailboxSecret: () => 'synthetic-password' }))
vi.mock('@/lib/inbound-mail/manualSenderVerification', () => ({ verifyManualMailSender: io.verify }))
vi.mock('@/lib/inbound-mail/manualInboundIngestion', () => ({ ingestManualInboundEmail: io.ingest }))
vi.mock('imapflow', () => ({ ImapFlow: class {
  constructor(private options: { host: string }) {}
  get mailbox() { return { uidValidity: io.uidValidity, uidNext: Math.max(0, ...io.messages.map(message => Number(message.uid))) + 1 } }
  async connect() { io.trace.push('connect'); io.connectedHosts.push(this.options.host) }
  async getMailboxLock() { return { release() { io.trace.push('release') } } }
  async logout() { io.trace.push('logout') }
  async search(query: { seen?: boolean; uid?: string }, options: unknown) {
    expect(options).toEqual({ uid: true })
    io.trace.push('search')
    if (query.seen === false) {
      const result = io.messages.filter(message => message.seen !== true).map(message => message.uid)
      io.afterUnseen?.()
      return result
    }
    if (query.uid) {
      const [first, last] = query.uid.split(':')
      return io.messages.filter(message => Number(message.uid) >= Number(first) && (last === '*' || Number(message.uid) <= Number(last))).map(message => message.uid)
    }
    throw new Error(`Unexpected search: ${JSON.stringify(query)}`)
  }
  async fetchOne(uid: string, query: unknown, options: unknown) {
    expect(query).toEqual({ uid: true, envelope: true, source: true })
    expect(options).toEqual({ uid: true })
    io.trace.push(`fetch:${uid}:complete`)
    if (io.fetchFailures > 0) { io.fetchFailures--; throw new Error('synthetic fetch failure') }
    return io.messages.find(message => String(message.uid) === uid) ?? false
  }
  // Model the installed ImapFlow scheduler invariant: the consumer must resume
  // FETCH before any later IMAP command can complete. Real protocol is covered
  // separately; throwing here keeps this regression deterministic and bounded.
  async *fetch() {
    io.generatorActive = true
    try { for (const message of io.messages) yield message }
    finally { io.generatorActive = false }
  }
  async messageFlagsAdd(uid: number, flags: string[], options: unknown) {
    if (io.generatorActive) throw new Error('IMAP command queued behind active FETCH')
    if (io.flagFailures > 0) { io.flagFailures--; throw new Error('synthetic Seen failure') }
    expect(flags).toEqual(['\\Seen'])
    expect(options).toEqual({ uid: true })
    io.trace.push(`seen:${uid}`)
    const message = io.messages.find(message => message.uid === uid)
    if (message) message.seen = true
  }
} }))

import { runManualInboundMailEngine } from '@/lib/inbound-mail/manualMailboxPoller'

const now = new Date('2026-10-18T12:10:00.000Z')
function message(uid: number): Row {
  return { uid, envelope: { messageId: `<synthetic-${uid}@example.test>`, subject: `Reply ${uid}`,
    from: [{ address: 'counterparty@example.test' }], to: [{ address: 'manual@example.test' }] },
  source: Buffer.from(`From: counterparty@example.test\r\nSubject: Reply ${uid}\r\nContent-Type: text/plain\r\n\r\nReply ${uid}`) }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
  vi.spyOn(performance, 'now').mockImplementation(() => io.elapsed)
  io.mailbox = { id: 'mailbox-1', company_id: null, environment: 'production', is_active: true, is_verified: true,
    imap_host: 'imap.example.test', imap_username: 'manual@example.test', from_email: 'manual@example.test',
    last_polled_at: null, poll_interval_minutes: 5, locked_at: null, metadata: {} }
  io.mailboxes = []; io.messages = []; io.trace = []; io.connectedHosts = []; io.generatorActive = false; io.elapsed = 0; io.uidValidity = BigInt(1)
  io.flagFailures = 0; io.fetchFailures = 0; io.afterUnseen = undefined
  io.beforeClaim = undefined; io.finishFailures = 0
  io.ingest.mockReset().mockResolvedValue({ resolutionStatus: 'matched' })
  io.verify.mockReset().mockResolvedValue({ status: 'unverified' })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete process.env.MANUAL_INBOUND_MESSAGE_LIMIT_PER_MAILBOX
  delete process.env.MANUAL_INBOUND_MAX_ATTEMPTS_PER_MESSAGE
})

describe('manual inbox run budget', () => {
  it('finishes the current ingestion and releases the lease before deferring remaining slow mail', async () => {
    await bootstrap()
    io.messages = Array.from({ length: 25 }, (_, index) => ({ ...message(index + 1), seen: true }))
    io.ingest.mockImplementation(async () => { io.elapsed += 15_000; return { resolutionStatus: 'matched' } })
    const result = await runManualInboundMailEngine()
    expect(result).toMatchObject({ polled: 1, fetched: 10, ingested: 10, errors: [] })
    expect(io.trace.filter(entry => entry.startsWith('seen:'))).toHaveLength(10)
    expect(io.trace.slice(-2)).toEqual(['release', 'logout'])
    expect(io.mailbox).toMatchObject({ locked_at: null, locked_by: null })
    expect(io.trace).not.toContain('fetch:11:complete')
    io.elapsed = 0; io.mailbox.last_polled_at = null
    expect(await runManualInboundMailEngine()).toMatchObject({ fetched: 10, ingested: 10, errors: [] })
    io.elapsed = 0; io.mailbox.last_polled_at = null
    expect(await runManualInboundMailEngine()).toMatchObject({ fetched: 5, ingested: 5, errors: [] })
    expect(io.ingest.mock.calls.map(([email]) => email.providerMessageId)).toEqual(
      Array.from({ length: 25 }, (_, index) => `<synthetic-${index + 1}@example.test>`))
  })

  it('does not claim a later mailbox after the engine budget is spent', async () => {
    io.mailboxes = [io.mailbox, { ...io.mailbox, id: 'mailbox-2', imap_host: 'second.example.test' }]
    io.messages = [message(1)]
    io.ingest.mockImplementation(async () => { io.elapsed += 150_000; return { resolutionStatus: 'matched' } })
    expect(await runManualInboundMailEngine()).toMatchObject({ polled: 1, fetched: 1 })
    expect(io.connectedHosts).toEqual(['imap.example.test'])
    expect(io.mailboxes[1].last_polled_at).toBeNull()
    expect(io.mailboxes.every(mailbox => mailbox.locked_at === null)).toBe(true)
  })

  it('polls the oldest mailbox first so one full budget cannot repeatedly starve it', async () => {
    io.mailbox.last_polled_at = '2026-10-18T12:00:00.000Z'
    io.mailboxes = [io.mailbox, { ...io.mailbox, id: 'mailbox-2', imap_host: 'older.example.test', last_polled_at: null }]
    io.messages = [message(1)]
    io.ingest.mockImplementation(async () => { io.elapsed += 150_000; return { resolutionStatus: 'matched' } })
    expect(await runManualInboundMailEngine()).toMatchObject({ polled: 1, fetched: 1 })
    expect(io.connectedHosts).toEqual(['older.example.test'])
    expect(io.mailbox.last_polled_at).toBe('2026-10-18T12:00:00.000Z')
  })
})

async function bootstrap(messages: Row[] = []) {
  io.messages = messages
  await runManualInboundMailEngine()
  io.mailbox.last_polled_at = null
  io.trace = []; io.ingest.mockClear(); io.verify.mockClear()
}

describe('manual inbox durable future UID scan', () => {
  it('skips historically Seen mail at bootstrap and reads new mail even when already marked Seen', async () => {
    await bootstrap([{ ...message(10), seen: true }, message(11)])
    io.messages.push({ ...message(12), seen: true })
    expect(await runManualInboundMailEngine()).toMatchObject({ fetched: 1, ingested: 1, errors: [] })
    expect(io.ingest.mock.calls.map(([email]) => email.providerMessageId)).toEqual(['<synthetic-12@example.test>'])
    expect(io.trace).not.toContain('fetch:10:complete')
  })

  it('searches new UID coverage after UNSEEN so Seen arrivals between searches are retained', async () => {
    await bootstrap()
    io.afterUnseen = () => { io.messages.push({ ...message(10), seen: true }, message(11)); io.afterUnseen = undefined }
    expect(await runManualInboundMailEngine()).toMatchObject({ fetched: 2, ingested: 2, errors: [] })
    expect(io.ingest.mock.calls.map(([email]) => email.providerMessageId)).toEqual(['<synthetic-10@example.test>', '<synthetic-11@example.test>'])
  })

  it('resets UID coverage after UIDVALIDITY changes without treating old Seen history as new', async () => {
    await bootstrap([message(100)])
    io.uidValidity = BigInt(2)
    io.messages = [{ ...message(1), seen: true }, message(2)]
    expect(await runManualInboundMailEngine()).toMatchObject({ fetched: 1, ingested: 1, errors: [] })
    expect(io.ingest.mock.calls[0][0].providerMessageId).toBe('<synthetic-2@example.test>')
    io.mailbox.last_polled_at = null
    io.messages.push({ ...message(3), seen: true })
    io.ingest.mockClear()
    await runManualInboundMailEngine()
    expect(io.ingest.mock.calls.map(([email]) => email.providerMessageId)).toContain('<synthetic-3@example.test>')
  })

  it('does not advance past a retryable future failure or process later mail first', async () => {
    await bootstrap()
    io.messages = [{ ...message(10), seen: true }, { ...message(11), seen: true }]
    io.ingest.mockRejectedValueOnce(new Error('synthetic database failure'))
    expect(await runManualInboundMailEngine()).toMatchObject({ fetched: 1, ingested: 0, deadLettered: 0 })
    expect(io.trace).not.toContain('fetch:11:complete')
    io.mailbox.last_polled_at = null
    expect(await runManualInboundMailEngine()).toMatchObject({ fetched: 2, ingested: 2, errors: [] })
    expect(io.trace).toContain('seen:10')
  })

  it('retains attempted legacy unread failure UIDs even if an operator marks them Seen', async () => {
    io.messages = [message(10), { ...message(11), seen: true }]
    io.ingest.mockRejectedValueOnce(new Error('synthetic legacy database failure'))
    await runManualInboundMailEngine()
    io.messages[0].seen = true
    io.mailbox.last_polled_at = null
    expect(await runManualInboundMailEngine()).toMatchObject({ fetched: 1, ingested: 1, errors: [] })
    expect(io.ingest.mock.calls.at(-1)?.[0].providerMessageId).toBe('<synthetic-10@example.test>')
  })

  it('retains separate legacy retry UIDs when two envelopes reuse one Message-ID', async () => {
    io.messages = [10, 11].map(uid => {
      const row = message(uid)
      return { ...row, envelope: { ...(row.envelope as Row), messageId: '<shared@example.test>' } }
    })
    io.messages.push({ ...message(12), seen: true })
    io.ingest.mockRejectedValueOnce(new Error('first legacy failure')).mockRejectedValueOnce(new Error('second legacy failure'))
    await runManualInboundMailEngine()
    io.messages[0].seen = true; io.messages[1].seen = true
    io.mailbox.last_polled_at = null
    io.ingest.mockClear()
    expect(await runManualInboundMailEngine()).toMatchObject({ fetched: 2, ingested: 2, errors: [] })
    expect(io.ingest.mock.calls.map(([email]) => email.bodyText)).toEqual(['Reply 10', 'Reply 11'])
  })

  it('retains a failed raw fetch UID without an available Message-ID', async () => {
    io.messages = [message(10)]
    io.fetchFailures = 1
    await runManualInboundMailEngine()
    io.messages[0].seen = true
    io.mailbox.last_polled_at = null
    expect(await runManualInboundMailEngine()).toMatchObject({ fetched: 1, ingested: 1, errors: [] })
  })

  it('retries a failed Seen update after committed ingestion and eventually dead-letters a repeated failure', async () => {
    await bootstrap()
    io.messages = [{ ...message(10), seen: true }]
    process.env.MANUAL_INBOUND_MAX_ATTEMPTS_PER_MESSAGE = '2'
    io.flagFailures = 2
    expect(await runManualInboundMailEngine()).toMatchObject({ ingested: 1, deadLettered: 0 })
    io.mailbox.last_polled_at = null
    expect(await runManualInboundMailEngine()).toMatchObject({ ingested: 1, deadLettered: 1 })
    expect(io.trace).toContain('seen:10')
  })

  it('does not overwrite checkpoint metadata or release a replacement worker lease', async () => {
    io.messages = [message(10)]
    io.ingest.mockImplementation(async () => {
      io.mailbox.locked_by = 'replacement-worker'
      io.mailbox.metadata = { foreign: 'must survive' }
      return { resolutionStatus: 'matched' }
    })
    const result = await runManualInboundMailEngine()
    expect(result.errors).toEqual([expect.stringMatching(/manual_mailbox.*(claim|state|ownership)/)])
    expect(io.mailbox).toMatchObject({ locked_by: 'replacement-worker', metadata: { foreign: 'must survive' } })
  })

  it('reports a checkpoint DB failure while retaining its lease and still polls another mailbox', async () => {
    io.mailboxes = [io.mailbox, { ...io.mailbox, id: 'mailbox-2', imap_host: 'second.example.test' }]
    io.messages = [message(10)]
    io.finishFailures = 1
    const result = await runManualInboundMailEngine()
    expect(result.polled).toBe(2)
    expect(result.errors).toEqual([expect.stringContaining('synthetic checkpoint database failure')])
    expect(io.mailbox.locked_by).toEqual(expect.stringContaining('manual-inbound:'))
    expect(io.mailboxes[1].locked_by).toBeNull()
    expect(io.mailbox.metadata).toEqual({})
    expect(io.mailbox.last_successful_poll_at).toBeUndefined()
  })

  it('never hides a first-attempt legacy dead-letter when its checkpoint flush fails', async () => {
    io.messages = [message(10)]
    process.env.MANUAL_INBOUND_MAX_ATTEMPTS_PER_MESSAGE = '1'
    io.ingest.mockRejectedValueOnce(new Error('synthetic first legacy failure'))
    io.finishFailures = 1
    const result = await runManualInboundMailEngine()
    expect(result.deadLettered).toBe(1)
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('synthetic checkpoint database failure')]))
    expect(io.trace).not.toContain('seen:10')
    expect(io.messages[0].seen).not.toBe(true)
    expect(io.mailbox.metadata).toEqual({})
    vi.setSystemTime(new Date(now.getTime() + 31 * 60_000))
    expect(await runManualInboundMailEngine()).toMatchObject({ fetched: 1, ingested: 1, errors: [] })
  })

  it('keeps durable terminal evidence when its later best-effort Seen update fails', async () => {
    io.messages = [message(10)]
    process.env.MANUAL_INBOUND_MAX_ATTEMPTS_PER_MESSAGE = '1'
    io.ingest.mockRejectedValueOnce(new Error('synthetic terminal failure'))
    io.flagFailures = 1
    expect(await runManualInboundMailEngine()).toMatchObject({ deadLettered: 1 })
    expect(io.messages[0].seen).not.toBe(true)
    const metadata = structuredClone(io.mailbox.metadata)
    io.mailbox.last_polled_at = null
    expect(await runManualInboundMailEngine()).toMatchObject({ fetched: 0, ingested: 0, errors: [] })
    expect(io.mailbox.metadata).toEqual(metadata)
  })

  it('does not start optional terminal flags after the soft budget is exhausted', async () => {
    io.messages = [message(10)]
    process.env.MANUAL_INBOUND_MAX_ATTEMPTS_PER_MESSAGE = '1'
    io.ingest.mockImplementation(async () => { io.elapsed = 150_000; throw new Error('synthetic terminal failure') })
    expect(await runManualInboundMailEngine()).toMatchObject({ deadLettered: 1 })
    expect(io.trace).not.toContain('seen:10')
    expect(io.mailbox).toMatchObject({ locked_at: null, locked_by: null })
    io.elapsed = 0; io.mailbox.last_polled_at = null
    expect(await runManualInboundMailEngine()).toMatchObject({ fetched: 0, ingested: 0 })
  })

  it('clamps an oversized configured raw-fetch batch to one hundred messages', async () => {
    process.env.MANUAL_INBOUND_MESSAGE_LIMIT_PER_MAILBOX = '10000'
    io.messages = Array.from({ length: 150 }, (_, index) => message(index + 1))
    expect(await runManualInboundMailEngine()).toMatchObject({ fetched: 100, ingested: 100, errors: [] })
    expect(io.verify).toHaveBeenCalledTimes(100)
    expect(io.trace).not.toContain('fetch:101:complete')
  })

  it('does not fabricate UID coverage when the selected mailbox lacks a valid epoch', async () => {
    io.messages = [message(10)]
    io.uidValidity = BigInt(0)
    const result = await runManualInboundMailEngine()
    expect(result).toMatchObject({ fetched: 0, ingested: 0 })
    expect(result.errors).toEqual([expect.stringContaining('manual_mailbox_uid_snapshot_missing')])
    expect(io.mailbox.metadata).not.toHaveProperty('manual_imap_scan')
  })

  it('refreshes the claimed mailbox configuration and preserves fresh metadata', async () => {
    io.messages = [message(10)]
    io.beforeClaim = () => {
      io.beforeClaim = undefined
      io.mailbox.imap_host = 'fresh.example.test'
      io.mailbox.company_id = 'fresh-company'
      io.mailbox.metadata = { operator_note: 'preserve' }
    }
    expect(await runManualInboundMailEngine()).toMatchObject({ ingested: 1, errors: [] })
    expect(io.connectedHosts).toEqual(['fresh.example.test'])
    expect(io.ingest.mock.calls[0][0].mailboxCompanyId).toBe('fresh-company')
    expect(io.mailbox.metadata).toMatchObject({ operator_note: 'preserve' })
  })

  it.each(['is_active', 'is_verified'])('does not claim a mailbox whose %s was revoked after listing', async field => {
    io.beforeClaim = () => { io.beforeClaim = undefined; io.mailbox[field] = false }
    expect(await runManualInboundMailEngine()).toMatchObject({ polled: 0, skipped: 1 })
    expect(io.connectedHosts).toEqual([])
  })

  it('does not reclaim a mailbox another worker already polled since the listing', async () => {
    io.beforeClaim = () => { io.beforeClaim = undefined; io.mailbox.last_polled_at = now.toISOString() }
    expect(await runManualInboundMailEngine()).toMatchObject({ polled: 0, skipped: 1 })
    expect(io.connectedHosts).toEqual([])
  })

  it.each([
    ['imap_host', 'new.example.test'], ['imap_port', 1993], ['imap_username', 'other@example.test'],
    ['imap_folder', 'OTHER'], ['environment', 'test'], ['company_id', 'different-company'],
  ])('resets UID namespace when %s changes', async (field, value) => {
    await bootstrap([message(100)])
    io.mailbox[field as string] = value
    io.messages = [{ ...message(1), seen: true }, message(2)]
    expect(await runManualInboundMailEngine()).toMatchObject({ fetched: 1, ingested: 1, errors: [] })
    expect(io.ingest.mock.calls[0][0].bodyText).toBe('Reply 2')
    io.mailbox.last_polled_at = null
    io.messages.push({ ...message(3), seen: true })
    io.ingest.mockClear()
    await runManualInboundMailEngine()
    expect(io.ingest.mock.calls.map(([email]) => email.bodyText)).toContain('Reply 3')
  })

  it('keeps the UID namespace across password-reference rotation for the same account', async () => {
    await bootstrap()
    io.mailbox.imap_secret_reference = 'env:ROTATED_SYNTHETIC_PASSWORD'
    io.messages = [{ ...message(10), seen: true }]
    expect(await runManualInboundMailEngine()).toMatchObject({ fetched: 1, ingested: 1, errors: [] })
  })
})

describe('manual inbox bounded IMAP commands', () => {
  it('finishes each FETCH before ingestion and Seen, then reaches the next message', async () => {
    io.messages = [message(11), message(12)]
    io.ingest.mockImplementation(async (email: { providerMessageId: string }) => {
      io.trace.push(`ingest:${email.providerMessageId}`)
      return { resolutionStatus: 'matched' }
    })
    const result = await runManualInboundMailEngine({ environment: 'production' })
    expect(result).toMatchObject({ fetched: 2, ingested: 2, errors: [] })
    expect(io.trace).toEqual(['connect', 'search', 'search', 'fetch:11:complete', 'ingest:<synthetic-11@example.test>',
      'seen:11', 'fetch:12:complete', 'ingest:<synthetic-12@example.test>', 'seen:12', 'release', 'logout'])
    expect(io.verify.mock.calls.map(([source]) => source)).toEqual(io.messages.map(row => row.source))
  })

  it('limits raw-source fetches to the configured batch while retaining the original sources', async () => {
    process.env.MANUAL_INBOUND_MESSAGE_LIMIT_PER_MAILBOX = '2'
    io.messages = [message(11), message(12), message(13)]
    const result = await runManualInboundMailEngine()
    expect(result).toMatchObject({ fetched: 2, ingested: 2, errors: [] })
    expect(io.trace.filter(entry => entry.startsWith('fetch:'))).toEqual(['fetch:11:complete', 'fetch:12:complete'])
    expect(io.verify).toHaveBeenCalledTimes(2)
    expect(io.ingest.mock.calls.map(([email]) => email.bodyText)).toEqual(['Reply 11', 'Reply 12'])
  })

  it('marks a dead-letter only after the per-message FETCH command has completed', async () => {
    process.env.MANUAL_INBOUND_MAX_ATTEMPTS_PER_MESSAGE = '1'
    io.messages = [message(11)]
    io.ingest.mockRejectedValue(new Error('synthetic database unavailable'))
    expect(await runManualInboundMailEngine()).toMatchObject({ fetched: 1, ingested: 0, deadLettered: 1 })
    expect(io.trace).toContain('seen:11')
    expect(io.mailbox.locked_at).toBeNull()
  })
})

describe('manual inbox configured polling interval', () => {
  it('allows ordinary cron jitter of less than ten seconds around the due time', async () => {
    io.mailbox.last_polled_at = new Date(now.getTime() - 5 * 60_000 + 9_000).toISOString()
    expect(await runManualInboundMailEngine()).toMatchObject({ polled: 1, skipped: 0, errors: [] })
  })

  it('does not poll more than ten seconds before the configured interval', async () => {
    io.mailbox.last_polled_at = new Date(now.getTime() - 5 * 60_000 + 10_001).toISOString()
    expect(await runManualInboundMailEngine()).toMatchObject({ polled: 0, skipped: 1 })
    expect(io.trace).toEqual([])
  })

  it('uses a nondefault mailbox interval when applying the same bounded jitter tolerance', async () => {
    io.mailbox.poll_interval_minutes = 2
    io.mailbox.last_polled_at = new Date(now.getTime() - 2 * 60_000 + 5_000).toISOString()
    expect(await runManualInboundMailEngine()).toMatchObject({ polled: 1, skipped: 0 })
  })

  it('does not relax a live mailbox claim even when the poll is due', async () => {
    io.mailbox.locked_at = now.toISOString()
    expect(await runManualInboundMailEngine()).toMatchObject({ polled: 0, skipped: 1 })
    expect(io.trace).toEqual([])
  })
})
