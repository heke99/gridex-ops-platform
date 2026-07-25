import { describe, expect, it } from 'vitest'
import { publicWebsiteCustomerApplicationData } from '@/lib/website/publicCustomerApplication'

describe('public website application DTO', () => {
  it('keeps opaque public resources and removes internal implementation IDs', () => {
    const data = publicWebsiteCustomerApplicationData({
      customer_id: 'customer-public-id',
      customer_number: 'DX-100025',
      application_id: 'application-public-id',
      contract_id: 'contract-public-id',
      customer_site_id: 'site-public-id',
      metering_point_id: 'metering-public-id',
      workflow_id: 'workflow-public-id',
      continuation_job_id: 'job-public-id',
      status: 'accepted',
      can_start_switch: true,
      blocking_reasons: [],
      portal_identity_id: 'internal-portal-id',
      price_plan_id: 'internal-plan-id',
      price_plan_version_id: 'internal-version-id',
      contract_price_snapshot_id: 'internal-snapshot-id',
      public_contract_offer_id: 'internal-publication-row-id',
      provider_connection_id: 'internal-provider-id',
      energy_resolution: {
        gridOwnerId: 'internal-grid-owner-id',
        raw: { provider_payload: true },
      },
    })

    expect(data).toMatchObject({
      customer_id: 'customer-public-id',
      customer_number: 'DX-100025',
      application_id: 'application-public-id',
      contract_id: 'contract-public-id',
      supplier_switch: {
        request_id: null,
        status: 'not_created',
        can_create_request: true,
        can_dispatch: false,
        next_action: 'create_supplier_switch_request',
      },
    })
    for (const internalField of [
      'portal_identity_id',
      'price_plan_id',
      'price_plan_version_id',
      'contract_price_snapshot_id',
      'public_contract_offer_id',
      'provider_connection_id',
      'energy_resolution',
      'can_start_switch',
    ]) {
      expect(data).not.toHaveProperty(internalField)
    }
  })
})
