import { beforeEach, describe, expect, it, vi } from 'vitest'
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
import { handleBusinessPartnerApi } from '@/lib/partner-api/business'

beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, 'error').mockImplementation(() => {}) })
async function price(body: string, extraHeaders: Record<string, string> = {}) {
  return (await handleBusinessPartnerApi(new NextRequest('https://example.invalid/api/partner/v1/price', {
    method: 'POST', headers: { 'content-type': 'application/json', ...extraHeaders }, body,
  }), 'POST', ['price']))!
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
    expect(response.status).toBe(413)
    expect((await response.json()).error.code).toBe('payload_too_large')
    expect(resolveEnergyContext).not.toHaveBeenCalled()
  })
  it('rejects oversized content-length before reading or resolving the request', async () => {
    const response = await price('{}', { 'content-length': '256001' })
    expect(response.status).toBe(413)
    expect((await response.json()).error.code).toBe('payload_too_large')
    expect(resolveEnergyContext).not.toHaveBeenCalled()
  })
})
