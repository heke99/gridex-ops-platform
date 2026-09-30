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

  it.each(['first_name', 'invoice_email', 'language_code', 'timezone'])
    ('rejects protected %s before identity resolution or any sync writer', async (field) => {
      fixture.context.mockClear()
      fixture.write.mockClear()
      const response = await POST(new NextRequest('https://gridex.test/api/v1/customer/sync', {
        method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'synthetic-sync-key' },
        body: JSON.stringify({ customer_number: 'C-1', profile: { [field]: field === 'invoice_email' ? 'invoice@example.invalid' : 'Synthetic' } }),
      }))
      expect(response.status).toBe(422)
      expect(await response.json()).toMatchObject({ field: `profile.${field}` })
      expect(fixture.context).not.toHaveBeenCalled()
      expect(fixture.write).not.toHaveBeenCalled()
    })

  it('keeps the machine intake of supported non-profile records available', () => {
    expect(parseTenantCustomerSyncPayload({ customer_number: 'C-1', documents: [{ document_type: 'customer_document' }] }))
      .toMatchObject({ customer_number: 'C-1', documents: [{ document_type: 'customer_document' }] })
  })

  it('rejects protected site addresses before identity resolution or any sync writer', async () => {
    fixture.context.mockClear(); fixture.write.mockClear()
    const response = await POST(new NextRequest('https://gridex.test/api/v1/customer/sync', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'synthetic-sync-key' },
      body: JSON.stringify({ customer_number: 'C-1', facility_data: [{ facility_reference: 'SITE-1', address: { city: 'Synthetic' } }] }),
    }))
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'sync_facility_address_command_required', field: 'facility_data.0.address' })
    expect(fixture.context).not.toHaveBeenCalled(); expect(fixture.write).not.toHaveBeenCalled()
  })

  it('retains non-address facility intake with explicit owned references', () => {
    const payload = { customer_number: 'C-1', facility_data: [{ facility_reference: 'SITE-1', facility_id: 'FACILITY-1' }] }
    expect(parseTenantCustomerSyncPayload(payload)).toEqual(payload)
  })
})
