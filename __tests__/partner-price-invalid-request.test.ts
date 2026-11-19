import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/integrations/apiAuth', () => ({
  requireIntegrationApiAccess: vi.fn(async () => ({ ok: true, client: { id: 'client_synthetic', company_id: 'company_synthetic' } })),
  logIntegrationApiRequest: vi.fn(async () => {}),
}))
vi.mock('@/lib/energy/resolver', () => ({ resolveEnergyContext: vi.fn() }))
vi.mock('@/lib/pricing/offerQuote', async original => ({
  ...await original<object>(), calculateOfferQuote: vi.fn(),
}))
import { resolveEnergyContext } from '@/lib/energy/resolver'
import { calculateOfferQuote } from '@/lib/pricing/offerQuote'
import { GET, POST } from '@/app/api/partner/v1/[[...path]]/route'

const { validateResponse } = createRequire(import.meta.url)('../scripts/lib/openapi-schema-validator.cjs') as {
  validateResponse: (document: unknown, path: string, value: unknown, method: string, status: string) => string[]
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected external request')))
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function price(body: string, extraHeaders: Record<string, string> = {}) {
  return POST(new NextRequest('https://example.invalid/api/partner/v1/price', {
    method: 'POST', headers: { 'content-type': 'application/json', ...extraHeaders }, body,
  }), { params: Promise.resolve({ path: ['price'] }) })
}

async function expectDocumentedPriceError(response: Response, status: 413 | 500, code: string) {
  expect(response.status).toBe(status)
  const payload = await response.json()
  expect(payload).toMatchObject({
    error: { code, message: expect.any(String) },
    request_id: expect.any(String),
  })
  expect(response.headers.get('X-Request-ID')).toBe(payload.request_id)
  expect(response.headers.get('Cache-Control')).toBe('no-store')

  const spec = await GET(new NextRequest('https://example.invalid/api/partner/v1/openapi.json'), {
    params: Promise.resolve({ path: ['openapi.json'] }),
  })
  expect(spec.status).toBe(200)
  expect(spec.headers.get('Cache-Control')).toBe('public, max-age=300, s-maxage=300')
  expect(spec.headers.get('X-Gridex-API-Version')).toBe(response.headers.get('X-Gridex-API-Version'))
  const document = await spec.json()
  expect(validateResponse(document, '/price', payload, 'post', String(status))).toEqual([])
  expect(document.paths['/price'].post.responses[status].content['application/json'].schema).toEqual({
    $ref: '#/components/schemas/ErrorResponse',
  })
  return payload
}
describe('Partner price validates JSON at the HTTP boundary', () => {
  it.each([
    ['{', 'invalid_json'], ['', 'json_body_missing'], ['[]', 'invalid_json_object'],
    ['null', 'invalid_json_object'], ['"hello"', 'invalid_json_object'],
  ])('returns 400 for invalid JSON object %s before resolving location or persisting quotes', async (body, code) => {
    const response = await price(body)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code }, request_id: expect.any(String) })
    expect(resolveEnergyContext).not.toHaveBeenCalled()
    expect(calculateOfferQuote).not.toHaveBeenCalled()
  })
  it('bounds the actual body even if content-length is absent', async () => {
    const response = await price(JSON.stringify({ postal_code: '12345', address: 'x'.repeat(256000) }))
    await expectDocumentedPriceError(response, 413, 'payload_too_large')
    expect(resolveEnergyContext).not.toHaveBeenCalled()
  })
  it('rejects oversized content-length before reading or resolving the request', async () => {
    const response = await price('{}', { 'content-length': '256001' })
    await expectDocumentedPriceError(response, 413, 'payload_too_large')
    expect(resolveEnergyContext).not.toHaveBeenCalled()
  })

  it('documents the sanitized 500 for an unexpected runtime failure', async () => {
    const privateDetail = 'Synthetic internal resolver detail'
    vi.mocked(resolveEnergyContext).mockRejectedValueOnce(new Error(privateDetail))
    const response = await price(JSON.stringify({
      postal_code: '12345', annual_consumption_kwh: 3500, customer_type: 'PRIVATE',
    }))

    expect(resolveEnergyContext).toHaveBeenCalledOnce()
    expect(calculateOfferQuote).not.toHaveBeenCalled()
    const payload = await expectDocumentedPriceError(response, 500, 'partner_api_internal_error')
    expect(JSON.stringify(payload)).not.toContain(privateDetail)
  })
})
