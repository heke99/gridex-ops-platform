import { beforeEach, describe, expect, it, vi } from 'vitest'

const fromMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: fromMock,
  },
}))

import { getGridOwnerVerification } from '@/lib/grid-owners/verification'

function buildQuery(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  builder.select = chain
  builder.eq = chain
  builder.limit = () => Promise.resolve(result)
  builder.maybeSingle = () => Promise.resolve(result)
  return builder
}

describe('getGridOwnerVerification fan-out handling', () => {
  beforeEach(() => {
    fromMock.mockReset()
  })

  it('fails closed when the verified view returns multiple rows for one grid owner', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table !== 'gridex_verified_grid_owners_v') {
        return buildQuery({ data: null, error: null })
      }
      return buildQuery({
        data: [
          {
            grid_owner_id: 'go-1',
            name: 'Owner',
            verification_status: 'verified',
            can_start_supplier_switch: true,
            verified_for_customer_flow: true,
          },
          {
            grid_owner_id: 'go-1',
            name: 'Owner',
            verification_status: 'needs_route',
            can_start_supplier_switch: false,
            verified_for_customer_flow: false,
          },
        ],
        error: null,
      })
    })

    await expect(getGridOwnerVerification('go-1')).rejects.toThrow(/grid_owner_verification_ambiguous/)
  })

  it('maps a single verified-view row', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table !== 'gridex_verified_grid_owners_v') {
        return buildQuery({ data: null, error: null })
      }
      return buildQuery({
        data: [
          {
            grid_owner_id: 'go-1',
            name: 'Owner',
            verification_status: 'verified',
            certificate_status: 'finns',
            can_start_supplier_switch: true,
            verified_for_customer_flow: true,
            route_count: 1,
            prodat_route_count: 1,
            utilts_route_count: 0,
            duplicate_count: 1,
            verification_reasons: [],
            next_action: null,
            can_use_for_prodat: true,
            can_use_for_utilts: false,
          },
        ],
        error: null,
      })
    })

    const row = await getGridOwnerVerification('go-1')
    expect(row?.gridOwnerId).toBe('go-1')
    expect(row?.verificationStatus).toBe('verified')
    expect(row?.canStartSupplierSwitch).toBe(true)
  })
})
