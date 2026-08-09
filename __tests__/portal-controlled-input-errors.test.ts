import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiInputError } from '@/lib/api/strictRequest'

vi.mock('@/lib/integrations/apiAuth', () => ({
  logIntegrationApiRequest: vi.fn(async () => undefined),
  requireIntegrationApiAccess: vi.fn(),
  currentIntegrationApiResponseContext: vi.fn(() => null),
}))

import { handleCustomerPortalRouteError } from '@/lib/customer-portal/externalApi'
import { logIntegrationApiRequest } from '@/lib/integrations/apiAuth'

describe('portal controlled input errors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preserves ApiInputError status and code instead of forcing 500', async () => {
    const request = new NextRequest('https://example.test/api/v1/customer-portal/sync', {
      method: 'POST',
    })
    const response = handleCustomerPortalRouteError({
      request,
      client: null,
      startedAt: Date.now(),
      error: new ApiInputError('Request body är för stor.', 'payload_too_large', 413),
    })

    expect(response.status).toBe(413)
    const body = await response.json()
    expect(body.error.code).toBe('payload_too_large')
    expect(body.error.message).toContain('för stor')
    expect(logIntegrationApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 413,
        errorCode: 'payload_too_large',
      }),
    )
  })

  it('preserves invalid JSON as 400', async () => {
    const request = new NextRequest('https://example.test/api/v1/customer/sync', {
      method: 'POST',
    })
    const response = handleCustomerPortalRouteError({
      request,
      client: null,
      startedAt: Date.now(),
      error: new ApiInputError('JSON body är ogiltig.', 'invalid_json', 400),
    })

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error.code).toBe('invalid_json')
  })

  it('keeps unexpected failures as generic 500', async () => {
    const request = new NextRequest('https://example.test/api/v1/customer-portal/sync', {
      method: 'POST',
    })
    const response = handleCustomerPortalRouteError({
      request,
      client: null,
      startedAt: Date.now(),
      error: new Error('unexpected boom'),
    })

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error.code).toBe('customer_portal_internal_error')
  })
})
