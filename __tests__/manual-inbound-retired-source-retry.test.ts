import { beforeEach, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>, seq: 0, retired: new Set<string>(),
  rpc: vi.fn(), correlation: vi.fn(), rpcError: null as { message: string } | null,
  rawInsertError: null as { code: string; message: string } | null,
  payload: undefined as unknown, messages: [] as Row[], flags: [] as Array<{ uid: number; flags: string[] }>,
  flagFailures: 0,
}))
function key(mailbox: string, provider: string) { return JSON.stringify([mailbox, provider]) }
class Query {
  private filters: Array<(row: Row) => boolean> = []
  private operation: 'read' | 'insert' | 'upsert' | 'update' = 'read'
  private patch: Row = {}
  private maximum = Infinity
  constructor(private table: string) {}
  select() { return this }
  order() { return this }
  limit(value: number) { this.maximum = value; return this }
  eq(column: string, value: unknown) { this.filters.push(row => row[column] === value); return this }
  is(column: string, value: unknown) { this.filters.push(row => (column.split(/->>?/).reduce<unknown>((cell, key) => cell && typeof cell === 'object' ? (cell as Row)[key] : undefined, row) ?? null) === value); return this }
  not(column: string, _operator: string, value: unknown) { this.filters.push(row => row[column] !== value); return this }
  or(value: string) {
    const cutoff = value.split('locked_at.lt.')[1]
    this.filters.push(row => row.locked_at == null || String(row.locked_at) < cutoff)
    return this
  }
  insert(values: Row) { this.operation = 'insert'; this.patch = values; return this }
  upsert(values: Row) { this.operation = 'upsert'; this.patch = values; return this }
  update(values: Row) { this.operation = 'update'; this.patch = values; return this }
  private run() {
    const table = io.tables[this.table]
    if (!table) throw new Error('Undeclared table: ' + this.table)
    if (this.table === 'manual_inbound_messages' && this.operation === 'insert' && io.rawInsertError) return { data: [], error: io.rawInsertError }
    let rows = table.filter(row => this.filters.every(filter => filter(row))).slice(0, this.maximum)
    if (this.operation === 'insert') {
      const row = { id: 'raw-' + ++io.seq, created_at: new Date().toISOString(), ...this.patch }
      table.push(row); rows = [row]
    } else if (this.operation === 'upsert') {
      const existing = table.find(row => row.idempotency_key === this.patch.idempotency_key)
      if (existing) Object.assign(existing, this.patch)
      else table.push({ ...this.patch })
    } else if (this.operation === 'update') rows.forEach(row => Object.assign(row, this.patch))
    return { data: rows.map(row => ({ ...row })), error: null }
  }
  maybeSingle() { const result = this.run(); return Promise.resolve({ ...result, data: result.data[0] ?? null }) }
  then(resolve: (result: unknown) => unknown, reject?: (error: unknown) => unknown) { return Promise.resolve().then(() => this.run()).then(resolve, reject) }
}
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => new Query(table), rpc: io.rpc } }))
vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/inbound-mail/manualInboundCorrelation', () => ({ resolveManualInboundCorrelation: io.correlation }))
vi.mock('@/lib/customer-operations/manualFacilityResponseParser', () => ({
  extractManualFacilityFields: () => ({}), scoreManualFacilityPayload: () => 0,
  applyManualFacilityResponse: vi.fn(),
}))
vi.mock('@/lib/email/manualOperationsMailbox', () => ({ resolveManualMailboxSecret: () => 'fixture-password' }))
vi.mock('imapflow', () => ({ ImapFlow: class {
  async connect() {}
  async getMailboxLock() { return { release() {} } }
  async logout() {}
  async *fetch() { for (const message of io.messages) yield message }
  async messageFlagsAdd(uid: number, flags: string[]) {
    if (io.flagFailures > 0) { io.flagFailures -= 1; throw new Error('transient_seen_failure') }
    io.flags.push({ uid, flags })
  }
} }))

import { ingestManualInboundEmail } from '@/lib/inbound-mail/manualInboundIngestion'
import { runManualInboundMailEngine } from '@/lib/inbound-mail/manualMailboxPoller'

const mailbox = 'manual@example.invalid'
const provider = '<retired-1@example.invalid>'
const email = (extra: Row = {}) => ({ mailbox, providerMessageId: provider, subject: 'fixture', bodyText: 'reply', ...extra })
function retireAndDeleteRaw() {
  const raw = io.tables.manual_inbound_messages[0]
  io.retired.add(key(String(raw.mailbox), String(raw.provider_message_id)))
  io.tables.manual_inbound_messages = []; io.tables.inbound_operation_events = []
}
function pollMessage(id: string, uid: number): Row {
  return { uid, envelope: { messageId: id, subject: 'fixture', from: [{ address: 'sender@example.invalid' }] },
    source: Buffer.from('Subject: fixture\r\nContent-Type: text/plain\r\n\r\nreply') }
}
beforeEach(() => {
  io.tables = { manual_inbound_messages: [], inbound_operation_events: [], manual_communication_mailboxes: [] }
  io.seq = 0; io.retired.clear(); io.rpcError = null; io.rawInsertError = null; io.payload = undefined; io.messages = []; io.flags = []; io.flagFailures = 0
  io.rpc.mockReset().mockImplementation(async (name: string, args: { p_mailbox: string; p_provider_id: string }) => {
    expect(name).toBe('gridex_manual_inbound_source_retired_v1')
    return { data: io.payload === undefined ? io.retired.has(key(args.p_mailbox, args.p_provider_id)) : io.payload, error: io.rpcError }
  })
  io.correlation.mockReset().mockResolvedValue({ resolutionStatus: 'unmatched', companyId: null, requestId: null,
    customerId: null, customerSiteId: null, meteringPointId: null, gridOwnerId: null,
    tenantResolutionMethod: null, entityResolutionMethod: null, evidence: {}, businessProcess: 'unknown',
    intent: 'unknown', intentConfidence: 0, senderCredible: false, request: null })
})

it('does not recreate a deleted provider source or its event when actual ingestion retries', async () => {
  await ingestManualInboundEmail(email({ mailbox: '  MANUAL@EXAMPLE.INVALID ', providerMessageId: ' ' + provider + ' ' }))
  expect(io.tables.manual_inbound_messages).toHaveLength(1)
  expect(io.tables.inbound_operation_events).toHaveLength(1)
  retireAndDeleteRaw()
  expect(await ingestManualInboundEmail(email())).toMatchObject({ inboundId: null, resolutionStatus: 'ignored', reason: 'retired_source', requestId: null, companyId: null })
  expect(io.tables.manual_inbound_messages).toEqual([])
  expect(io.tables.inbound_operation_events).toEqual([])
  expect(io.correlation).toHaveBeenCalledTimes(1)
  expect(io.rpc).toHaveBeenLastCalledWith('gridex_manual_inbound_source_retired_v1', { p_mailbox: mailbox, p_provider_id: provider })
})

it.each([
  { mailbox, providerMessageId: '<new-2@example.invalid>' },
  { mailbox: 'other@example.invalid', providerMessageId: provider },
  { mailbox, providerMessageId: '<Retired-1@example.invalid>' },
])('accepts a genuinely distinct mailbox/provider key %o', async distinct => {
  io.retired.add(key(mailbox, provider))
  const result = await ingestManualInboundEmail(email(distinct))
  expect(result).toMatchObject({ inboundId: expect.any(String), resolutionStatus: 'unmatched' })
  expect(io.tables.manual_inbound_messages).toHaveLength(1)
  expect(io.tables.inbound_operation_events).toHaveLength(1)
  expect(io.rpc).toHaveBeenCalledWith('gridex_manual_inbound_source_retired_v1', { p_mailbox: distinct.mailbox, p_provider_id: distinct.providerMessageId })
})

it('propagates a retirement lookup failure before persisting or correlating new mail', async () => {
  io.rpcError = { message: 'retirement_lookup_unavailable' }
  await expect(ingestManualInboundEmail(email())).rejects.toEqual(io.rpcError)
  expect(io.tables.manual_inbound_messages).toEqual([])
  expect(io.tables.inbound_operation_events).toEqual([])
  expect(io.correlation).not.toHaveBeenCalled()
})

it('propagates a thrown retirement transport failure before any raw or event write', async () => {
  io.rpc.mockRejectedValue(new Error('retirement_transport_unavailable'))
  await expect(ingestManualInboundEmail(email())).rejects.toThrow('retirement_transport_unavailable')
  expect(io.tables.manual_inbound_messages).toEqual([])
  expect(io.tables.inbound_operation_events).toEqual([])
})

it('acknowledges only the exact concurrent retirement insert guard after a nonretired lookup', async () => {
  io.rawInsertError = { code: '23514', message: 'manual_inbound_source_retired' }
  expect(await ingestManualInboundEmail(email())).toMatchObject({ inboundId: null, resolutionStatus: 'ignored', reason: 'retired_source' })
  expect(io.tables.manual_inbound_messages).toEqual([])
  expect(io.tables.inbound_operation_events).toEqual([])
  expect(io.correlation).not.toHaveBeenCalled()
})

it.each([
  { code: '23514', message: 'some_other_constraint' },
  { code: '23503', message: 'manual_inbound_source_retired' },
])('keeps a different insert error as a failure: %o', async error => {
  io.rawInsertError = error
  await expect(ingestManualInboundEmail(email())).rejects.toEqual(error)
  expect(io.tables.manual_inbound_messages).toEqual([])
  expect(io.tables.inbound_operation_events).toEqual([])
})

it.each([null, 'false', {}, []].map(payload => ({ payload })))('fails closed for a malformed retirement lookup result $payload', async ({ payload }) => {
  io.payload = payload
  await expect(ingestManualInboundEmail(email())).rejects.toThrow()
  expect(io.tables.manual_inbound_messages).toEqual([])
  expect(io.tables.inbound_operation_events).toEqual([])
  expect(io.correlation).not.toHaveBeenCalled()
})

it.each([null, undefined, '   '])('preserves normal missing-provider handling for %j', async providerMessageId => {
  expect(await ingestManualInboundEmail(email({ providerMessageId }))).toMatchObject({ inboundId: expect.any(String), resolutionStatus: 'unmatched' })
  expect(io.rpc).not.toHaveBeenCalled()
  expect(io.tables.manual_inbound_messages[0].provider_message_id).toBeNull()
})

it('acknowledges a retired unseen retry through the actual poller and continues with new mail', async () => {
  io.tables.manual_communication_mailboxes = [{ id: 'mailbox-1', from_email: mailbox, company_id: null,
    environment: 'test', is_active: true, is_verified: true, imap_host: 'imap.example.invalid',
    imap_username: 'fixture', metadata: {}, locked_at: null, last_polled_at: null }]
  io.messages = [pollMessage(provider, 7)]; io.flagFailures = 1
  const first = await runManualInboundMailEngine()
  expect(first.errors).toEqual([expect.stringContaining('transient_seen_failure')])
  expect(io.flags).toEqual([])
  retireAndDeleteRaw()
  io.tables.manual_communication_mailboxes[0].last_polled_at = null
  io.messages = [pollMessage(provider, 7), pollMessage('<new-2@example.invalid>', 8)]
  const retry = await runManualInboundMailEngine()
  expect(retry).toMatchObject({ fetched: 2, ingested: 2, ignored: 1, unmatched: 1, errors: [] })
  expect(io.tables.manual_inbound_messages).toHaveLength(1)
  expect(io.tables.manual_inbound_messages[0].provider_message_id).toBe('<new-2@example.invalid>')
  expect(io.tables.inbound_operation_events).toHaveLength(1)
  expect(io.flags).toEqual([{ uid: 7, flags: ['\\Seen'] }, { uid: 8, flags: ['\\Seen'] }])
  expect(io.correlation).toHaveBeenCalledTimes(2)
})

it('keeps a retirement lookup failure unseen and does not acknowledge unknown source state', async () => {
  io.tables.manual_communication_mailboxes = [{ id: 'mailbox-1', from_email: mailbox, company_id: null,
    environment: 'test', is_active: true, is_verified: true, imap_host: 'imap.example.invalid',
    imap_username: 'fixture', metadata: {}, locked_at: null, last_polled_at: null }]
  io.messages = [pollMessage(provider, 7)]; io.rpcError = { message: 'retirement_lookup_unavailable' }
  const result = await runManualInboundMailEngine()
  expect(result).toMatchObject({ ingested: 0, ignored: 0 })
  expect(result.errors).toHaveLength(1)
  expect(result.errors[0]).toContain('ingest mailbox-1:')
  expect(io.rpc).toHaveBeenCalledExactlyOnceWith('gridex_manual_inbound_source_retired_v1', { p_mailbox: mailbox, p_provider_id: provider })
  expect(io.flags).toEqual([])
  expect(io.tables.manual_inbound_messages).toEqual([])
  expect(io.tables.inbound_operation_events).toEqual([])
})
