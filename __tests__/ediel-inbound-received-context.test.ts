import { beforeEach, expect, it, vi } from 'vitest'
import { parseInboundEmailContent } from '@/lib/inbound-mail/edielEmailParser'
import { createInboundEdielMessage } from '@/lib/inbound-mail/inboundStatusUpdater'
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
let writeError: { code: string; message: string } | null
let existingId: string | null
let environment: string
let existingEnvironment: string | null
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
      if (call.operation === 'select') {
        const environmentFilter = call.filters.find(([column]) => column === 'environment')
        const compatible = !environmentFilter || environmentFilter[1] === existingEnvironment
        return { data: existingId && compatible ? { id: existingId } : null, error: null }
      }
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
    single: () => Promise.resolve(result()),
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
  vi.clearAllMocks(); calls.length = 0; existingId = 'source-old'; writeError = null; environment = 'test'; existingEnvironment = null
  io.from.mockImplementation(query)
  io.tenant.mockResolvedValue({ status: 'resolved', companyId: 'company-a', reasons: [], candidates: [], shared: null })
  io.outbound.mockResolvedValue(matched()); io.metering.mockResolvedValue(missing())
  io.task.mockResolvedValue(null)
})

// Independent public-writer contract: a retry is not a new receipt.
it.each(['test', 'production'])('does not send a new received timestamp on a PRODAT retry in %s', async env => {
  environment = env
  await expect(createInboundEdielMessage(messageInput())).resolves.toBe('source-old')
  const update = writes('ediel_messages')[0]
  expect(update.operation).toBe('update')
  expect(update.payload).not.toHaveProperty('message_received_at')
  expect(update.payload).not.toHaveProperty('execution_context_snapshot')
  expect(update.payload).toMatchObject({ company_id: 'company-a', environment: env, raw_payload: source })
  expect(update.payload?.parsed_at).toEqual(expect.any(String))
  expect(update.payload?.updated_at).toEqual(expect.any(String))
})
it.each(['test', 'production'])('does not fabricate a receipt during the historical other-environment fallback into %s', async env => {
  environment = env; existingEnvironment = env === 'test' ? 'production' : 'test'
  await expect(createInboundEdielMessage({ ...messageInput(), inboundEmailMessageId: '' })).resolves.toBe('source-old')
  expect(writes('ediel_messages')[0].payload).not.toHaveProperty('message_received_at')
  expect(writes('ediel_messages')[0]).toMatchObject({ filters: [['id', 'source-old']], payload: { environment: env } })
})
it('assigns a timestamp only for a fresh PRODAT insertion, never an application-owned receive snapshot', async () => {
  existingId = null
  await expect(createInboundEdielMessage(messageInput())).resolves.toBe('source-new')
  const insert = writes('ediel_messages')[0]
  expect(insert.operation).toBe('insert')
  expect(insert.payload?.message_received_at).toEqual(expect.any(String))
  expect(Number.isFinite(Date.parse(insert.payload?.message_received_at as string))).toBe(true)
  expect(insert.payload).not.toHaveProperty('execution_context_snapshot')
})
it.each(['APERAK', 'CONTRL'] as const)('does not change the existing %s timestamp contract', async family => {
  const input = messageInput(); input.parsed.messageFamily = family
  await expect(createInboundEdielMessage(input)).resolves.toBe('source-old')
  expect(writes('ediel_messages')[0].payload?.message_received_at).toEqual(expect.any(String))
})
it.each(['matched', 'missing'] as const)('preserves the original PRODAT receipt through the actual %s email processor', async status => {
  io.outbound.mockResolvedValue(status === 'matched' ? matched() : missing())
  await expect(processInboundEmailMessage({ inboundEmailMessageId: 'email-1' })).resolves.toMatchObject({ status: status === 'matched' ? 'processed' : 'manual_review' })
  expect(writes('ediel_messages')).toHaveLength(1)
  expect(writes('ediel_messages')[0].payload).not.toHaveProperty('message_received_at')
})
it.each([
  'immutable_ediel_received_context_cannot_change',
  'immutable_ediel_receipt_time_cannot_change',
  'received_ediel_context_cannot_be_backfilled',
])('retains physical %s rejection before any success writes in the real email processor', async message => {
  writeError = { code: '23514', message }
  const attempt = processInboundEmailMessage({ inboundEmailMessageId: 'email-1' })
  await expect(attempt).rejects.toThrow('INBOUND_PRODAT_SOURCE_CONFLICT')
  await expect(attempt).rejects.toMatchObject({ cause: writeError })
  noBusinessSuccess()
})
it.each([
  { code: '42501', message: 'immutable_ediel_receipt_time_cannot_change' },
  { code: '23514', message: 'other: immutable_ediel_received_context_cannot_change' },
  { code: '23514', message: 'received_ediel_context_cannot_be_backfilled suffix' },
])('does not overclassify unrelated receipt errors $code/$message', async error => {
  writeError = error
  await expect(createInboundEdielMessage(messageInput())).resolves.toBeNull()
  expect(writes('ediel_message_events')).toHaveLength(0)
})
