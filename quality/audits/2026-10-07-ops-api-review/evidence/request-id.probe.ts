import { NextRequest } from 'next/server'
import { expect, it, vi } from 'vitest'
vi.mock('@/lib/staff-api/context', () => ({ requireStaffApiContext: vi.fn() }))
vi.mock('@/lib/integrations/apiAuth', () => ({ currentIntegrationApiResponseContext: vi.fn(() => null), logIntegrationApiRequest: vi.fn() }))
import { requireStaffApiContext } from '@/lib/staff-api/context'
import { logIntegrationApiRequest } from '@/lib/integrations/apiAuth'
import { withStaffApi, staffApiJson } from '@/lib/staff-api/http'
it('staff response identifier differs from the identifier passed to request logging', async () => {
  const incoming = 'synthetic-audit-request-123'
  const request = new NextRequest('https://app.gridex.se/api/v1/staff/customers', {headers:{'x-request-id':incoming}})
  vi.mocked(requireStaffApiContext).mockResolvedValue({companyId:'11111111-1111-4111-8111-111111111111',actorUserId:'22222222-2222-4222-8222-222222222222',apiClientId:'33333333-3333-4333-8333-333333333333',permissions:['customers.read'],client:{} as never,startedAt:Date.now()})
  const response = await withStaffApi(request,{scopes:['staff_customers.read'],permission:'customers.read'}, async () => staffApiJson({data:[]}))
  const payload = await response.json()
  expect(response.status).toBe(200)
  expect(response.headers.get('x-request-id')).toBe(payload.request_id)
  expect(payload.request_id).not.toBe(incoming)
  expect(vi.mocked(logIntegrationApiRequest).mock.calls[0][0].request.headers.get('x-request-id')).toBe(incoming)
})
