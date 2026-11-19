import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareAndQueueMeteringMethodChangeZ09 } from '@/lib/ediel/flows/prodatMeteringMethodChange'

type OutboundRequest = { id: string; company_id: string; source_type: string; source_id: string; request_type: string }
const io = vi.hoisted(() => ({
  source: vi.fn(), intent: vi.fn(), render: vi.fn(), request: vi.fn(), route: vi.fn(),
  rows: [] as OutboundRequest[],
  queries: [] as URLSearchParams[],
  lookupError: false,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabaseService: createClient('https://synthetic.example.test', 'fixture-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: readRequests },
  }) }
})
vi.mock('@/lib/cis/db', () => ({ createOutboundRequest: io.request }))
vi.mock('@/lib/ediel/core/kernel', () => ({ resolveCanonicalOutboundContext: io.route }))
vi.mock('@/lib/ediel/intent/intentEngine', () => ({ createEdielMessageIntent: io.intent }))
vi.mock('@/lib/ediel/intent/meteringMethodChangeGateway', () => ({ renderAndQueueMeteringMethodChange: io.render }))
vi.mock('@/lib/ediel/production/meteringMethodChangeSource', () => ({
  readMeteringMethodChangeSource: io.source,
  assertMeteringMethodChangeCanonicalRoute: vi.fn(),
}))

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const companyId = id(1)
const otherCompanyId = id(12)
const intentId = id(8)
const eventId = id(4)
const actorUserId = id(11)
const filterFields = ['company_id', 'source_type', 'source_id', 'request_type'] as const

async function readRequests(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(input instanceof Request ? input.url : String(input))
  expect(url.origin).toBe('https://synthetic.example.test')
  expect(url.pathname).toBe('/rest/v1/outbound_requests')
  expect(init?.method).toBe('GET')
  const query = url.searchParams
  io.queries.push(query)

  if (io.lookupError) return Response.json({ code: '42501', message: 'Synthetic lookup denied' }, { status: 403 })
  const predicates = filterFields.filter((field) => query.has(field))
  const matching = io.rows.filter((row) => predicates.every((field) => query.get(field) === `eq.${row[field]}`))
  const limit = Number(query.get('limit') ?? matching.length)
  return Response.json(matching.slice(0, limit).map((row) => ({ id: row.id })))
}

function outboundRequest(rowId: string, overrides: Partial<OutboundRequest> = {}): OutboundRequest {
  return {
    id: rowId, company_id: companyId, source_type: 'manual', source_id: intentId,
    request_type: 'customer_masterdata', ...overrides,
  }
}

function prepare(company = companyId) {
  return prepareAndQueueMeteringMethodChangeZ09({ companyId: company, eventId, actorUserId })
}

function expectLookup(company: string) {
  expect(io.queries).toHaveLength(1)
  expect(Object.fromEntries(io.queries[0])).toEqual({
    select: 'id', company_id: `eq.${company}`, source_type: 'eq.manual',
    source_id: `eq.${intentId}`, request_type: 'eq.customer_masterdata', limit: '2',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  io.rows = []
  io.queries = []
  io.lookupError = false
  io.route.mockResolvedValue({
    senderEdielId: '12345', receiverEdielId: '54321', environment: 'test',
    route: { id: id(2) }, routeRuntime: { route_profile_id: id(3) }, applicationReference: '23-DDQ-PRODAT',
  })
  io.source.mockImplementation(async (input: { companyId: string }) => ({
    status: 'authorized', companyId: input.companyId, environment: 'test', eventId,
    customerId: id(5), siteId: id(6), meteringPointId: id(7), pointId: '735123456789012345',
    gridArea: 'TES', legalReceiverId: '54321',
  }))
  io.intent.mockImplementation(async (input) => ({ ...input, id: intentId }))
  io.request.mockResolvedValue({ id: id(9) })
  io.render.mockResolvedValue({ status: 'queued', message: { id: id(10) } })
})

describe('metering-method change request lookup', () => {
  it('holds missing agreement evidence before creating an intent, request or draft', async () => {
    io.source.mockResolvedValue({ status: 'held', missing: ['authentic_customer_agreed_method_event'] })
    expect(await prepare()).toEqual({ status: 'held', missing: ['authentic_customer_agreed_method_event'] })
    expect(io.queries).toHaveLength(0)
    expect(io.intent).not.toHaveBeenCalled()
    expect(io.request).not.toHaveBeenCalled()
    expect(io.render).not.toHaveBeenCalled()
  })

  it('ignores other request types, source links and companies, then creates the request with the actual intent', async () => {
    io.rows = [
      outboundRequest(id(13), { company_id: otherCompanyId }),
      outboundRequest(id(14), { source_type: 'website' }),
      outboundRequest(id(15), { source_id: id(91) }),
      outboundRequest(id(16), { request_type: 'metering_values' }),
    ]
    await prepare()
    expectLookup(companyId)
    const intent = io.intent.mock.calls[0][0]
    expect(intent.interchangeReference).toMatch(/^[A-F0-9]{14}$/)
    expect(intent.transactionReference.length).toBeLessThanOrEqual(35)
    expect(intent.transactionReference).not.toBe(intent.interchangeReference)
    expect(intent).toMatchObject({ operationId: eventId, customerSiteId: id(6), meteringPointId: '735123456789012345' })
    expect(io.request).toHaveBeenCalledOnce()
    expect(io.request).toHaveBeenCalledWith(expect.objectContaining({
      sourceId: intentId, operationId: eventId, siteId: id(6), environment: 'test', meteringPointId: id(7),
    }))
    expect(io.render).toHaveBeenCalledWith(expect.objectContaining({
      intentId, outboundRequestId: id(9), eventId, actorUserId,
    }))
    expect(io.intent.mock.invocationCallOrder[0]).toBeLessThan(io.render.mock.invocationCallOrder[0])
  })

  it.each([[companyId, id(18)], [otherCompanyId, id(17)]])('reuses the one scoped request for company %s', async (company, requestId) => {
    io.rows = [outboundRequest(id(17), { company_id: otherCompanyId }), outboundRequest(id(18))]
    await prepare(company)
    expectLookup(company)
    expect(io.request).not.toHaveBeenCalled()
    expect(io.render).toHaveBeenCalledOnce()
    expect(io.render).toHaveBeenCalledWith(expect.objectContaining({ companyId: company, outboundRequestId: requestId, intentId }))
  })

  it('rejects multiple matching rows before creating a request or queuing a draft', async () => {
    io.rows = [outboundRequest(id(17), { company_id: otherCompanyId }), outboundRequest(id(18)), outboundRequest(id(19))]
    await expect(prepare()).rejects.toThrow('metering_method_change_outbound_request_ambiguous')
    expectLookup(companyId)
    expect(io.request).not.toHaveBeenCalled()
    expect(io.render).not.toHaveBeenCalled()
  })

  it('propagates the lookup error before creating a request or queuing a draft', async () => {
    io.lookupError = true
    await expect(prepare()).rejects.toMatchObject({ code: '42501' })
    expectLookup(companyId)
    expect(io.request).not.toHaveBeenCalled()
    expect(io.render).not.toHaveBeenCalled()
  })
})
