import { beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  mail: {} as Record<string, unknown>, requests: [] as Record<string, unknown>[], originals: [] as Record<string, unknown>[],
  writes: [] as Array<{table: string; value: Record<string, unknown>}>,
  mutation: vi.fn(), status: vi.fn(), ack: vi.fn(), heldOriginal: vi.fn(), review: vi.fn(),
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  rpc: async () => ({data: null, error: null}),
  from(table: string) {
    const predicates: Array<(row: Record<string, unknown>) => boolean> = []
    let maxRows = Infinity
    function data() {
      if (table === 'inbound_email_messages') return [io.mail]
      const source = table === 'outbound_requests' ? io.requests : table === 'ediel_messages' ? io.originals : []
      return source.filter(row => predicates.every(pass => pass(row))).slice(0, maxRows)
    }
    const query = {
      select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
      eq: vi.fn().mockImplementation(function (column: string, value: unknown) {
        predicates.push(row => row[column] === value); return query
      }),
      in: vi.fn().mockImplementation(function (column: string, values: string[]) {
        predicates.push(row => values.includes(String(row[column]))); return query
      }),
      not: vi.fn().mockImplementation(function (column: string, operator: string, value: string) {
        if (operator === 'in') predicates.push(row => !value.slice(1, -1).split(',').includes(String(row[column])))
        else predicates.push(row => row[column] !== value)
        return query
      }),
      or: vi.fn().mockImplementation(function (expression: string) {
        const conditions = expression.split(',').map(condition => condition.split('.eq.'))
        predicates.push(row => conditions.some(([column, value]) => row[column] === value)); return query
      }),
      limit: vi.fn().mockImplementation(function (limit: number) {
        maxRows = limit
        return query
      }),
      maybeSingle: async () => ({data: data()[0] ?? null, error: null}),
      then: (resolve: (value: unknown) => void) => Promise.resolve({data: data(), error: null, count: data().length}).then(resolve),
      insert: async (value: Record<string, unknown>) => { io.writes.push({table, value}); return {error: null} },
      update: vi.fn().mockReturnThis(),
    }
    return query
  },
}}))
vi.mock('@/lib/ediel/inbound/receptions', () => ({readUnattributedTechnicalIntake: async () => null, InboundReceptionHeldError: Error}))
vi.mock('@/lib/inbound-mail/inboundTenantResolver', () => ({resolveTenantForInboundEdiel: async () => ({status: 'resolved', companyId: 'tenant', shared: null})}))
vi.mock('@/lib/inbound-mail/inboundStatusUpdater', () => ({
  applySafeInboundStatusUpdate: io.mutation,
  createParseResult: async () => 'parsed-receipt',
  createInboundEdielMessage: io.heldOriginal,
  createUnresolvedInboundEdielMessage: vi.fn(),
  updateInboundEmailProcessingStatus: io.status,
}))
vi.mock('@/lib/inbound-mail/canonicalInboundAckStatusUpdater', () => ({applyCanonicalInboundAckStatusUpdate: io.ack}))
vi.mock('@/lib/inbound-mail/inboundTaskFactory', () => ({createInboundMailTask: io.review}))
vi.mock('@/lib/supabase/tenantDb', () => ({tenantDb: () => ({unscoped: () => ({from: () => ({
  update: () => ({eq: () => ({is: async () => ({error: null})})}),
  select: () => ({eq: () => ({maybeSingle: async () => ({data: {company_id: 'tenant'}, error: null})})}),
})})})}))

import { processInboundEmailMessage } from '@/lib/inbound-mail/edielInboundProcessor'

const response = "UNA:+.? 'UNB+UNOC:3+54321:14+12345:14+260927:1200+REPLY++23-DDQ-PRODAT'UNH+1+PRODAT:D:96B:UN:E2SE6A'BGM+Z04+COMMON+9'UNT+3+1'UNZ+1+REPLY'"
const ack = "UNA:+.? 'UNB+UNOC:3+54321:14+12345:14+260927:1200+I++23-DDQ-PRODAT'UNH+1+APERAK:D:96A:UN:E2SE6A'BGM+++27'RFF+ACW:COMMON'ERC+42::260'FTX+AAO++314::260+Synthetic document'UNT+6+1'UNZ+1+I'"
function request(id: string) { return {id, company_id: 'tenant', external_reference: 'COMMON', customer_id: `${id}-customer`} }
function original(id: string, environment: string, requestId: string) {
  return {id, company_id: 'tenant', environment, direction: 'outbound', message_family: 'PRODAT', external_reference: 'COMMON', bgm_reference: 'COMMON',
    sender_ediel_id: '12345', receiver_ediel_id: '54321', outbound_request_id: requestId}
}
function run() { return processInboundEmailMessage({inboundEmailMessageId: 'mail', actorUserId: 'actor'}) }
function matchAttempt() { return io.writes.filter(write => write.table === 'inbound_ediel_match_attempts')[0]?.value }

beforeEach(() => {
  vi.clearAllMocks()
  io.mail = {id: 'mail', company_id: 'tenant', environment: 'test', ediel_mailboxes: {id: 'mailbox', company_id: 'tenant', environment: 'test'}, raw_email: null, raw_edifact_payload: response, body_text: response}
  io.requests = [request('test-request'), request('production-request')]
  io.originals = [original('test-original', 'test', 'test-request'), original('production-original', 'production', 'production-request')]
  io.writes = []
  io.heldOriginal.mockResolvedValue('held-original')
  io.ack.mockResolvedValue({status: 'processed', matchStatus: 'matched'})
})

it('uses only the legitimate test original when the same document reference exists in both environments', async () => {
  await expect(run()).resolves.toMatchObject({status: 'processed'})
  expect(io.mutation).toHaveBeenCalledWith(expect.objectContaining({outboundMatch: expect.objectContaining({entityId: 'test-request'})}))
  expect(matchAttempt()).toMatchObject({match_status: 'matched', matched_entity_id: 'test-request', candidates: [request('test-request')]})
})

it('keeps the physical reply in manual review and reports no foreign candidate when only a production original exists', async () => {
  io.requests.shift(); io.originals.shift()
  await expect(run()).resolves.toMatchObject({status: 'manual_review'})
  expect(io.mutation).not.toHaveBeenCalled()
  expect(matchAttempt()).toMatchObject({match_status: 'missing', matched_entity_id: null, candidates: []})
})

it('keeps a legitimate test ACK selectable and still passes it through the transport party owner', async () => {
  io.mail.raw_edifact_payload = ack; io.mail.body_text = ack
  await run()
  expect(io.ack).toHaveBeenCalledWith(expect.objectContaining({outboundMessageId: 'test-original', outboundMatch: expect.objectContaining({entityId: 'test-request'})}))
})

it('holds data with no qualified environment without choosing an original or producing a match attempt', async () => {
  io.mail.environment = null; io.mail.ediel_mailboxes = null
  await expect(run()).resolves.toMatchObject({status: 'manual_review'})
  expect(io.mutation).not.toHaveBeenCalled()
  expect(io.heldOriginal).not.toHaveBeenCalled()
  expect(matchAttempt()).toBeUndefined()
  expect(io.status).toHaveBeenCalledWith(expect.objectContaining({matchStatus: 'inbound_original_environment_unverified'}))
})

it('does not update a shared request whose originals span both environments', async () => {
  io.requests = [request('shared-request')]
  io.originals = [original('test-original', 'test', 'shared-request'), original('production-original', 'production', 'shared-request')]
  await expect(run()).resolves.toMatchObject({status: 'manual_review'})
  expect(io.mutation).not.toHaveBeenCalled()
  expect(matchAttempt()).toMatchObject({match_status: 'missing', matched_entity_id: null, candidates: []})
})

it('preserves a legacy request without a retained original for manual matching', async () => {
  io.requests = [request('unscoped-historical-request')]; io.originals = []
  await expect(run()).resolves.toMatchObject({status: 'manual_review'})
  expect(io.mutation).not.toHaveBeenCalled()
  expect(io.heldOriginal).toHaveBeenCalled()
  expect(matchAttempt()).toMatchObject({match_status: 'missing', matched_entity_id: null, candidates: []})
})

it('keeps a mailbox conflicting with the stored environment at the source review boundary', async () => {
  io.mail.environment = 'production'
  await expect(run()).resolves.toMatchObject({status: 'manual_review'})
  expect(io.mutation).not.toHaveBeenCalled()
  expect(io.heldOriginal).not.toHaveBeenCalled()
  expect(matchAttempt()).toBeUndefined()
  expect(io.status).toHaveBeenCalledWith(expect.objectContaining({matchStatus: 'inbound_original_environment_unverified'}))
})
