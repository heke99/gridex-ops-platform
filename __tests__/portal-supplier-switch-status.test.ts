import { describe, expect, it } from 'vitest'
import { buildPortalCustomerStatus } from '@/lib/customer-portal/status'

const base = {
  contracts: [{ status: 'signed', price_plan_id: 'plan-1' }],
  sites: [{
    facility_id: 'facility-1',
    resolution_status: 'facility_verified',
    grid_owner_id: 'owner-1',
  }],
  meteringPoints: [{ metering_point_id: 'mp-1', grid_owner_id: 'owner-1' }],
}

describe('portal supplier switch status', () => {
  it('separates request creation from dispatch readiness', () => {
    const status = buildPortalCustomerStatus(base)
    expect(status.supplier_switch).toMatchObject({
      can_create_request: true,
      can_dispatch: false,
      next_action: 'create_request',
    })
    expect(status.can_start_switch).toBe(false)
  })

  it('keeps the deprecated alias equal to dispatch readiness', () => {
    const status = buildPortalCustomerStatus({
      ...base,
      powersOfAttorney: [{ status: 'signed', scope: 'supplier_switch' }],
      legalAcceptances: [
        { acceptance_type: 'terms' },
        { acceptance_type: 'privacy_policy' },
        { acceptance_type: 'withdrawal_info' },
      ],
    })
    expect(status.supplier_switch.can_create_request).toBe(true)
    expect(status.supplier_switch.can_dispatch).toBe(true)
    expect(status.can_start_switch).toBe(status.supplier_switch.can_dispatch)
  })
})
