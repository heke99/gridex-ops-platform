import { afterEach, expect, it, vi } from 'vitest'
import { delegatedRequest, runConfiguredCustomerRead } from '../scripts/tenantservice/customer-api-reference.mjs'

afterEach(() => vi.unstubAllGlobals())
const input = () => ({ baseUrl: 'https://tenant.example.test/', method: 'GET', path: '/api/v1/customer/me',
  apiKey: 'synthetic-backend-key', customerNumber: 'SYN-1', signAssertion: vi.fn(async () => 'synthetic-signed-action') })

it.each(['../website/contracts', '%2e%2e/website/contracts', '%252e%252e/website/contracts', '%2f..%2fwebsite/contracts', '..\\website/contracts'])
  ('rejects raw or encoded customer-path traversal %s before signing or fetching', async traversal => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const options = { ...input(), path: `/api/v1/customer/${traversal}` }
    await expect(delegatedRequest(options)).rejects.toThrow('customer_reference_secure_backend_url_required')
    expect(options.signAssertion).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

it('signs and fetches the same normalized URL, preserving only the resource query outside the proof action', async () => {
  const fetch = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }))
  vi.stubGlobal('fetch', fetch)
  const options = { ...input(), path: '/api/v1/customer/legal-acceptances?limit=1&cursor=opaque%2Bvalue' }
  await delegatedRequest(options)
  expect(options.signAssertion).toHaveBeenCalledWith('GET /api/v1/customer/legal-acceptances')
  expect(fetch.mock.calls[0][0]).toBe('https://tenant.example.test/api/v1/customer/legal-acceptances?limit=1&cursor=opaque%2Bvalue')
  expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: 'error', method: 'GET' })
})

it.each(['https://user:password@tenant.example.test', 'http://tenant.example.test', 'https://tenant.example.test/?key=secret'])
  ('rejects unsafe backend origins %s before invoking an enrolled signer', async baseUrl => {
    vi.stubGlobal('fetch', vi.fn())
    const options = { ...input(), baseUrl }
    await expect(delegatedRequest(options)).rejects.toThrow('customer_reference_secure_backend_url_required')
    expect(options.signAssertion).not.toHaveBeenCalled()
  })

it('returns safe real-mode status metadata without forwarding private response contents', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { email: 'synthetic-private@example.invalid' },
    request_id: 'synthetic-request', contract_schema_version: 'synthetic-contract' }), { status: 200 })))
  expect(await runConfiguredCustomerRead(input())).toEqual({ status: 200, resultCount: 1, requestId: 'synthetic-request',
    contractVersion: 'synthetic-contract', errorCode: null })
})
