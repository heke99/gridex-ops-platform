import { beforeEach, expect, it, vi } from 'vitest'
import { parseInboundEmailContent } from '@/lib/inbound-mail/edielEmailParser'
import { createInboundEdielMessage, applySafeInboundStatusUpdate } from '@/lib/inbound-mail/inboundStatusUpdater'
import { processInboundEmailMessage } from '@/lib/inbound-mail/edielInboundProcessor'
import type { InboundEntityMatch } from '@/lib/inbound-mail/inboundMatcher'

// Only external database/matching/task boundaries are substituted. Parser,
// message writer, status updater and processor are the actual public modules.
const io = vi.hoisted(() => ({
  from: vi.fn(), tenant: vi.fn(), outbound: vi.fn(), metering: vi.fn(), task: vi.fn(),
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from } }))
vi.mock('@/lib/inbound-mail/inboundTenantResolver', () => ({ resolveTenantForInboundEdiel: io.tenant }))
vi.mock('@/lib/inbound-mail/inboundMatcher', () => ({ matchOutboundRequestForInbound: io.outbound, matchMeteringPointForInbound: io.metering }))
vi.mock('@/lib/inbound-mail/inboundTaskFactory', () => ({ createInboundMailTask: io.task }))

type Call = { table: string; operation: string; payload?: Record<string, unknown>; filters: Array<[string, unknown]> }
const calls: Call[] = []
const source = "UNB+UNOC:3+27700:ZZ+21660:ZZ+260921:1200+SRC1'UNH+1+PRODAT:D:96A:UN:E2SE6A'BGM+Z01+DOC1+9'UNT+3+1'UNZ+1+SRC1'"
const conflict = { code: '23514', message: 'immutable_ediel_payload_cannot_change' }
let writeError: { code: string; message: string } | null
let existingId: string | null
let environment: string
function missing(): InboundEntityMatch {
  return { status: 'missing', entityType: null, entityId: null, confidence: 0, reasons: [], candidates: [] }
}
function matched(): InboundEntityMatch {
  return { ...missing(), status: 'matched', entityType: 'outbound_request', entityId: 'request-1', candidates: [{ id: 'request-1' }] }
}
function parsed() {
  const result = parseInboundEmailContent({ attachmentText: source })
  if (!result) throw new Error('Expected the real parser to parse the fixture')
  return result
}
function messageInput() {
  return { companyId: 'company-a', environment, inboundEmailMessageId: 'email-1', parsed: parsed() }
}
function query(table: string) {
  const call: Call = { table, operation: 'select', filters: [] }
  calls.push(call)
  const result = () => {
    if (table === 'ediel_messages') {
      if (call.operation === 'select') return { data: existingId ? { id: existingId } : null, error: null }
      return { data: writeError ? null : { id: existingId ?? 'source-new' }, error: writeError }
    }
    if (table === 'inbound_email_messages' && call.operation === 'select') {
      return { data: { id: 'email-1', company_id: 'company-a', raw_edifact_payload: source,
        ediel_mailboxes: { id: 'mailbox-1', environment } }, error: null }
    }
    if (table === 'inbound_email_attachments') return { data: [], error: null }
    return { data: { id: 'diagnostic-1' }, error: null }
  }
  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => { call.filters.push([column, value]); return builder },
    order: () => builder, limit: () => builder,
    insert: (payload: Record<string, unknown>) => { call.operation = 'insert'; call.payload = payload; return builder },
    update: (payload: Record<string, unknown>) => { call.operation = 'update'; call.payload = payload; return builder },
    maybeSingle: () => Promise.resolve(result()),
    then: <T, U>(resolve: (value: ReturnType<typeof result>) => T | PromiseLike<T>, reject?: (reason: unknown) => U | PromiseLike<U>) => Promise.resolve(result()).then(resolve, reject),
  }
  return builder
}
const writes = (table: string) => calls.filter(call => call.table === table && call.operation !== 'select')
function noBusinessSuccess() {
  expect(writes('ediel_message_events')).toHaveLength(0)
  expect(writes('outbound_requests')).toHaveLength(0)
  expect(writes('metering_values')).toHaveLength(0)
  expect(writes('inbound_email_messages')).toHaveLength(0)
  expect(io.task).not.toHaveBeenCalled()
}
beforeEach(() => {
  vi.clearAllMocks(); calls.length = 0; existingId = 'source-old'; writeError = null; environment = 'test'
  io.from.mockImplementation(query)
  io.tenant.mockResolvedValue({ status: 'resolved', companyId: 'company-a', reasons: [], candidates: [], shared: null })
  io.outbound.mockResolvedValue(matched()); io.metering.mockResolvedValue(missing())
  io.task.mockResolvedValue(null)
})
it.each(['test', 'production'])('preserves an exact-byte duplicate writer update in %s', async env => {
  environment = env
  await expect(createInboundEdielMessage(messageInput())).resolves.toBe('source-old')
  expect(writes('ediel_messages')).toHaveLength(1)
  expect(writes('ediel_messages')[0]).toMatchObject({ operation: 'update', payload: { raw_payload: source, environment: env, company_id: 'company-a' } })
  expect(writes('ediel_messages')[0].payload).not.toHaveProperty('immutable_payload_hash')
  expect(writes('ediel_message_events')).toHaveLength(1)
})
it('preserves fresh insert and database-owned hash generation', async () => {
  existingId = null
  await expect(createInboundEdielMessage(messageInput())).resolves.toBe('source-new')
  expect(writes('ediel_messages')[0]).toMatchObject({ operation: 'insert', payload: { raw_payload: source } })
  expect(writes('ediel_messages')[0].payload).not.toHaveProperty('immutable_payload_hash')
})
it('does not adopt the existing ID after the physical immutable-source rejection', async () => {
  writeError = conflict
  await expect(createInboundEdielMessage(messageInput())).rejects.toThrow('INBOUND_PRODAT_SOURCE_CONFLICT')
  expect(writes('ediel_messages')).toHaveLength(1)
  noBusinessSuccess()
})
it.each(['test', 'production'])('carries the trusted environment through safe status updates in %s', async env => {
  environment = env
  const input = { ...messageInput(), outboundMatch: matched(), meteringPointMatch: missing() }
  await applySafeInboundStatusUpdate(input)
  expect(writes('ediel_messages')[0].payload?.environment).toBe(env)
  expect(writes('outbound_requests')).toHaveLength(1)
})
it('stops the actual safe updater before business writes on source conflict', async () => {
  writeError = conflict
  const input = { ...messageInput(), outboundMatch: matched(), meteringPointMatch: missing() }
  await expect(applySafeInboundStatusUpdate(input)).rejects.toThrow('INBOUND_PRODAT_SOURCE_CONFLICT')
  noBusinessSuccess()
})
it.each(['matched', 'missing'] as const)('stops the actual %s processor branch before final email/business success', async status => {
  writeError = conflict; io.outbound.mockResolvedValue(status === 'matched' ? matched() : missing())
  await expect(processInboundEmailMessage({ inboundEmailMessageId: 'email-1' })).rejects.toThrow('INBOUND_PRODAT_SOURCE_CONFLICT')
  // The parser diagnostic can exist; business/event/processed success cannot.
  expect(writes('ediel_messages')).toHaveLength(1)
  noBusinessSuccess()
})
it.each(['test', 'production'])('keeps successful matched processing and its mailbox environment in %s', async env => {
  environment = env
  await expect(processInboundEmailMessage({ inboundEmailMessageId: 'email-1' })).resolves.toMatchObject({ status: 'processed', companyId: 'company-a' })
  expect(writes('ediel_messages')[0].payload?.environment).toBe(env)
  expect(writes('outbound_requests')).toHaveLength(1)
  expect(writes('inbound_email_messages')[0].payload?.processing_status).toBe('processed')
})
it('preserves the unmatched ordinary manual-review path', async () => {
  io.outbound.mockResolvedValue(missing())
  await expect(processInboundEmailMessage({ inboundEmailMessageId: 'email-1' })).resolves.toMatchObject({ status: 'manual_review' })
  expect(writes('ediel_message_events')).toHaveLength(1)
  expect(writes('outbound_requests')).toHaveLength(0)
  expect(io.task).toHaveBeenCalledTimes(1)
})
it.each([
  { code: '23514', message: 'other_constraint' },
  { code: '42501', message: 'immutable_ediel_payload_cannot_change' },
])('does not reclassify unrelated database error $code/$message', async error => {
  writeError = error
  await expect(createInboundEdielMessage(messageInput())).resolves.toBeNull()
  expect(writes('ediel_message_events')).toHaveLength(0)
})
it('does not reclassify another message family as a PRODAT source conflict', async () => {
  writeError = conflict
  const input = messageInput(); input.parsed.messageFamily = 'APERAK'
  await expect(createInboundEdielMessage(input)).resolves.toBeNull()
  expect(writes('ediel_message_events')).toHaveLength(0)
})
