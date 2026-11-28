import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readAdminCustomerDataChain, readPortalCustomerStatus } from '@/lib/customer-portal/supplierSwitchStatus'

const read = vi.hoisted(() => vi.fn())
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: read } }))

const scope = {
  companyId: '00000000-0000-4000-8000-000000000001',
  customerIds: ['00000000-0000-4000-8000-000000000002'],
}
const pending = {
  contracts: [{ id: 'contract-a', status: 'signed', price_plan_id: 'price-a' }],
  sites: [{ id: 'site-a', facility_id: 'facility-a', grid_owner_id: 'owner-a' }],
  meteringPoints: [{ metering_point_id: 'meter-a', site_id: 'site-a' }],
  powersOfAttorney: [{
    contract_id: 'contract-a', site_id: 'site-a', status: 'signed', scope: 'supplier_switch',
  }],
  legalAcceptances: ['terms', 'privacy_policy', 'withdrawal_info'].map(
    acceptance_type => ({ acceptance_type }),
  ),
}
const exactRead = [
  'gridex_read_supplier_switch_status_basis_v1',
  { p_company_id: scope.companyId, p_customer_ids: scope.customerIds },
]

describe('supplier switch readiness from verified evidence', () => {
  beforeEach(() => { read.mockReset() })

  it('keeps a historical signature visible without giving dispatch clearance', async () => {
    read.mockResolvedValue({ data: { ready: false, fullmakt: 'signed_unverified' }, error: null })

    const portal = await readPortalCustomerStatus(scope, pending)
    const staff = await readAdminCustomerDataChain(scope, pending)

    expect(portal).toMatchObject({
      code: 'needs_review',
      can_start_switch: false,
      supplier_switch: { can_dispatch: false },
    })
    expect(staff.status).toEqual(portal)
    expect(staff.rows).toContainEqual({
      label: 'Fullmakt',
      ok: false,
      detail: 'Signerad. Giltigheten för leverantörsbyte behöver kontrolleras.',
    })
    expect(read.mock.calls).toEqual([exactRead, exactRead])
  })

  it('reports verified dispatch readiness from the same scoped read in both projections', async () => {
    read.mockResolvedValue({ data: { ready: true, fullmakt: 'effective' }, error: null })

    const portal = await readPortalCustomerStatus(scope, pending)
    const staff = await readAdminCustomerDataChain(scope, pending)

    expect(portal).toMatchObject({
      code: 'pending_supplier_switch',
      can_start_switch: true,
      supplier_switch: { can_dispatch: true, next_action: 'dispatch_request' },
    })
    expect(staff.status).toEqual(portal)
    expect(staff.rows).toContainEqual({
      label: 'Fullmakt', ok: true, detail: 'Giltig för leverantörsbyte',
    })
    expect(read.mock.calls).toEqual([exactRead, exactRead])
  })

  it('holds a pending status if the evidence read is unavailable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    read.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'private fixture diagnostics' } })

    try {
      const status = await readPortalCustomerStatus(scope, pending)

      expect(status.code).toBe('needs_review')
      expect(status.supplier_switch.can_dispatch).toBe(false)
      expect(read.mock.calls).toEqual([exactRead])
      expect(warn.mock.calls).toEqual([
        ['[supplier-switch-status] readiness read unavailable', { reason: 'schema_unavailable' }],
      ])
    } finally {
      warn.mockRestore()
    }
  })

  it('skips the readiness read for an already active contract', async () => {
    const input = { ...pending, contracts: [{ ...pending.contracts[0], status: 'active' }] }

    expect(await readPortalCustomerStatus(scope, input)).toMatchObject({
      code: 'active', supplier_switch: { can_dispatch: false },
    })
    expect(read).not.toHaveBeenCalled()
  })
})
