import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'
import { parseTenantCustomerSyncPayload } from '@/lib/customer-portal/customerSyncContract'

const fixture = vi.hoisted(() => ({
  context: vi.fn(),
  write: vi.fn(),
}))
vi.mock('@/lib/customer-portal/externalApi', () => ({
  requireCustomerPortalApiContextForIdentifiers: fixture.context,
  handleCustomerPortalRouteError: ({ error }: { error: { status: number; code: string; field?: string } }) =>
    Response.json({ code: error.code, field: error.field }, { status: error.status }),
}))
vi.mock('@/lib/customer-portal/tenantSync', () => ({ syncTenantCustomerRecords: fixture.write }))

import { POST } from '@/app/api/v1/customer/sync/route'

describe('tenant machine contact boundary', () => {
  it('rejects phone before identity resolution, idempotency claim or any sync write', async () => {
    const response = await POST(new NextRequest('https://gridex.test/api/v1/customer/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'synthetic-sync-key' },
      body: JSON.stringify({ customer_number: 'C-1', profile: { phone: '+46123456789' } }),
    }))
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ field: 'profile.phone' })
    expect(fixture.context).not.toHaveBeenCalled()
    expect(fixture.write).not.toHaveBeenCalled()
  })

  it('continues to allow noncontact sync profile fields', () => {
    expect(parseTenantCustomerSyncPayload({
      customer_number: 'C-1', profile: { first_name: 'Synthetic', invoice_email: 'invoice@example.invalid' },
    }).profile).toMatchObject({ first_name: 'Synthetic', invoice_email: 'invoice@example.invalid' })
  })
})
