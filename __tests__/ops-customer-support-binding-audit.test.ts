import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ binding: 'identifier_match', list: vi.fn() }))
vi.mock('@/lib/integrations/apiAuth', () => ({
  requireIntegrationApiAccess: async () => ({ ok: true, client: { id: 'synthetic-client', company_id: 'synthetic-company', scopes: ['customer_support.read'] } }),
  logIntegrationApiRequest: async () => undefined,
  currentIntegrationApiResponseContext: () => null,
}))
vi.mock('@/lib/customer-portal/customerResolver', () => ({
  portalIdentifiersFromRequest: () => ({ customerNumber: 'synthetic-customer-number' }),
  resolvePortalCustomer: async () => ({ ok: true, binding: state.binding, customer: { company_id: 'synthetic-company', customer_id: 'synthetic-customer', auth_user_id: null, customer_portal_user_id: null } }),
}))
vi.mock('@/lib/customer-portal/customerAssertion', () => ({ CUSTOMER_ASSERTION_HEADER: 'x-gridex-customer-assertion', gateCustomerAssertion: async () => ({ allowed: true, enforcement: 'none' }) }))
vi.mock('@/lib/customer-service/supportConversation', () => ({ listCustomerSupportCases: async () => { state.list(); return { items: [], page: { limit: 50, offset: 0, returned: 0, has_more: false, next_cursor: null } } } }))

describe('OPS audit: support requires a linked user on reads as documented', () => {
  it('rejects an identifier-only support GET before querying cases', async () => {
    state.list.mockClear()
    const { GET } = await import('@/app/api/v1/customer/support/cases/route')
    const response = await GET(new NextRequest('https://synthetic.example/api/v1/customer/support/cases', { headers: { 'x-gridex-customer-number': 'synthetic-customer-number' } }))
    expect(response.status).toBe(403)
    expect(state.list).not.toHaveBeenCalled()
  })
  it('preserves identifier-only reads for the established general portal compatibility mode', async () => {
    const { customerPortalBindingAllowsRequest } = await import('@/lib/customer-portal/externalApi')
    expect(customerPortalBindingAllowsRequest('GET', 'identifier_match')).toBe(true)
    expect(customerPortalBindingAllowsRequest('POST', 'identifier_match', { enforceBinding: true })).toBe(false)
  })
})
