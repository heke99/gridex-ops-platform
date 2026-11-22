import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/v1/website/quote/validate/route'

const ports = vi.hoisted(() => ({
  authorize: vi.fn(),
  log: vi.fn(),
  offer: vi.fn(),
  from: vi.fn(),
  application: vi.fn(),
  quote: vi.fn(),
}))

vi.mock('@/lib/integrations/apiAuth', () => ({
  requireIntegrationApiAccess: ports.authorize,
  logIntegrationApiRequest: ports.log,
  currentIntegrationApiResponseContext: () => null,
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: ports.from } }))
vi.mock('@/lib/website/publicContracts', () => ({ resolvePublicContractOffer: ports.offer }))
vi.mock('@/lib/pricing/websiteQuotes', async (original) => ({
  ...await original<typeof import('@/lib/pricing/websiteQuotes')>(),
  validateWebsiteQuote: ports.quote,
}))

const companyId = 'test-company'
const client = { id: 'test-client', company_id: companyId }
const payload = {
  quote_reference: 'quote_test',
  offer_reference: 'offer_test',
  customer_type: 'private',
  resolution_id: 'resolution_test',
  annual_consumption_kwh: 12000,
  start_date: '2026-12-01',
  price_option_reference: 'canonical_test',
  invoice_delivery_method: 'email',
  selected_component_references: ['component_test'],
  site_count: 1,
  application_number: 'application_test',
}

function request(body: Record<string, unknown>) {
  return new NextRequest('https://gridex.test/api/v1/website/quote/validate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function expectNoBusinessReads() {
  expect(ports.offer).not.toHaveBeenCalled()
  expect(ports.from).not.toHaveBeenCalled()
  expect(ports.quote).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.resetAllMocks()
  ports.authorize.mockResolvedValue({ ok: true, client, context: { companyId } })
  ports.offer.mockResolvedValue({ offer_reference: payload.offer_reference })
  ports.application.mockResolvedValue({ data: { id: 'internal-application' }, error: null })
  ports.from.mockImplementation(() => {
    const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: ports.application }
    query.select.mockReturnValue(query)
    query.eq.mockReturnValue(query)
    return query
  })
  ports.quote.mockResolvedValue({
    quote_reference: payload.quote_reference,
    offer_reference: payload.offer_reference,
    quote_snapshot: {},
    status: 'active',
    valid_until: '2026-12-01T00:00:00.000Z',
  })
})

describe('mounted website quote assertion format (API-103)', () => {
  it.each([
    { name: 'null', value: null },
    { name: 'a scalar string', value: 'component_test' },
    { name: 'a non-string element', value: [17] },
    { name: 'a blank element', value: ['  '] },
  ])('rejects $name before reading the offer, application or quote', async ({ value }) => {
    const response = await POST(request({ ...payload, selected_component_references: value }))
    expect(response.status).toBe(400)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = await response.json()
    expect(body).toMatchObject({
      error: {
        code: 'invalid_quote_assertion',
        field: 'selected_component_references',
        message: 'selected_component_references måste vara en lista med stabila referenser.',
        retryable: false,
      },
      request_id: expect.any(String),
      correlation_id: response.headers.get('x-request-id'),
    })
    expect(body.request_id).toBe(response.headers.get('x-request-id'))
    expect(ports.log).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 400,
      errorCode: 'invalid_quote_assertion',
      metadata: expect.objectContaining({ request_id: body.request_id }),
    }))
    expectNoBusinessReads()
  })

  it.each([
    { fields: { unexpected: 'test' }, code: 'unknown_field', field: 'unexpected' },
    { fields: { site_count: undefined }, code: 'missing_field', field: 'site_count' },
    { fields: { customer_type: 'unknown' }, code: 'invalid_customer_type', field: 'customer_type' },
  ])('preserves $code precedence', async ({ fields, code, field }) => {
    const response = await POST(request({ ...payload, ...fields, selected_component_references: null }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code, field } })
    expectNoBusinessReads()
  })

  it('preserves authentication precedence and quote scope', async () => {
    ports.authorize.mockResolvedValue({ ok: false, status: 401, errorCode: 'unauthorized', error: 'Unauthorized.' })
    const input = request({ ...payload, selected_component_references: null })
    const response = await POST(input)
    expect(response.status).toBe(401)
    expect(ports.authorize).toHaveBeenCalledWith(input, ['website_quotes.validate'])
    expectNoBusinessReads()
  })

  it('preserves legacy input normalization and tenant-bound application flow', async () => {
    const response = await POST(request({
      ...payload,
      customer_type: ' company ',
      annual_consumption_kwh: '12000,5',
      site_count: '2',
      selected_component_references: [' component_test '],
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { valid: true, quote_reference: payload.quote_reference } })
    expect(ports.offer).toHaveBeenCalledWith({ client, offerReference: payload.offer_reference, customerType: 'business' })
    expect(ports.from).toHaveBeenCalledWith('website_customer_applications')
    const query = ports.from.mock.results[0].value
    expect(query.eq).toHaveBeenNthCalledWith(1, 'company_id', companyId)
    expect(query.eq).toHaveBeenNthCalledWith(2, 'application_number', payload.application_number)
    expect(ports.quote).toHaveBeenCalledWith(expect.objectContaining({
      client,
      applicationId: 'internal-application',
      annualConsumptionKwh: 12000.5,
      siteCount: 2,
      selectedComponentReferences: ['component_test'],
    }))
  })

  it('preserves an empty component list and skips the optional application read', async () => {
    const response = await POST(request({ ...payload, selected_component_references: [], application_number: undefined }))
    expect(response.status).toBe(200)
    expect(ports.from).not.toHaveBeenCalled()
    expect(ports.quote).toHaveBeenCalledWith(expect.objectContaining({
      applicationId: null,
      annualConsumptionKwh: 12000,
      siteCount: 1,
      selectedComponentReferences: [],
    }))
  })

  it('keeps the offer-not-found result for a well-formed request', async () => {
    ports.offer.mockResolvedValue(null)
    const response = await POST(request(payload))
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: { code: 'offer_not_found', field: 'offer_reference' } })
    expect(ports.from).not.toHaveBeenCalled()
    expect(ports.quote).not.toHaveBeenCalled()
  })

  it('keeps the application-not-found result for a well-formed request', async () => {
    ports.application.mockResolvedValue({ data: null, error: null })
    const response = await POST(request(payload))
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: { code: 'application_not_found', field: 'application_number' } })
    expect(ports.quote).not.toHaveBeenCalled()
  })
})
