// reality-defects: H-12
// H-12 variant: the operations sync view counted only draft/queued/submitted as open switches. A customer whose Z03 is
// sent (status 'prepared', kept until the Z04; GOR-06) was shown as "Redo för leverantörsbyte — Starta eller köa
// leverantörsbyte", inviting a second switch for the same facility.
import { describe, expect, it } from 'vitest'
import { buildCustomerSyncProfiles } from '@/lib/operations/customerSync'

const now = new Date('2026-10-24T20:00:00Z')
const at = '2026-10-24T19:00:00Z'
function input(status: string) {
  return {
    customers: [{ id: 'c1', status: 'active', created_at: at }],
    sites: [{ id: 's1', customer_id: 'c1', status: 'active', grid_owner_id: 'g1', price_area_code: 'SE3', created_at: at }],
    meteringPoints: [{ id: 'm1', site_id: 's1', status: 'active', created_at: at }],
    contracts: [{ id: 'k1', customer_id: 'c1', status: 'signed', created_at: at }],
    powersOfAttorney: [{ id: 'p1', customer_id: 'c1', status: 'signed', created_at: at }],
    switchRequests: [{ id: 'sw1', customer_id: 'c1', status, created_at: at }],
    gridOwnerDataRequests: [], meteringValues: [], outboundRequests: [], now,
  } as unknown as Parameters<typeof buildCustomerSyncProfiles>[0]
}

describe('H-12 the sync view treats a sent switch (prepared) as in progress', () => {
  it('does not offer a new switch while the Z03 is with the grid owner', () => {
    const profile = buildCustomerSyncProfiles(input('prepared')).profiles[0]
    expect(profile.stage).toBe('waiting_external_response')
    expect(profile.signal).toBe('in_progress')
  })
  it('keeps a queued switch as switch_in_progress', () => {
    expect(buildCustomerSyncProfiles(input('queued')).profiles[0].stage).toBe('switch_in_progress')
  })
})
