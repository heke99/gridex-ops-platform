import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import CustomerSiteForm from '@/components/admin/masterdata/CustomerSiteForm'
import type { CustomerSiteRow } from '@/lib/masterdata/types'

vi.mock('@/app/admin/customers/[id]/actions', () => ({ saveCustomerSiteAction: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
const site: CustomerSiteRow = {
  id: '55555555-5555-4555-8555-555555555555', customer_id: '33333333-3333-4333-8333-333333333333',
  site_name: 'Synthetic site', facility_id: null, site_type: 'consumption', status: 'draft', grid_owner_id: null,
  price_area_code: 'SE3', move_in_date: null, annual_consumption_kwh: null, current_supplier_name: null,
  current_supplier_org_number: null, street: 'Testgatan 1', care_of: null, postal_code: '12345', city: 'Teststad', country: 'SE',
  moved_from_street: null, moved_from_postal_code: null, moved_from_city: null, moved_from_supplier_name: null,
  internal_notes: null, created_at: '2026-09-30T00:00:00Z', updated_at: '2026-09-30T00:00:00Z', created_by: null, updated_by: null, site_revision: 3,
}
const areas = ['SE1', 'SE2', 'SE3', 'SE4'].map((code, index) => ({ code: code as 'SE1' | 'SE2' | 'SE3' | 'SE4', name: code,
  sort_order: index, created_at: '2026-09-30T00:00:00Z' }))
function render(current: CustomerSiteRow, commandKey: string | undefined = 'site-render-current-key') {
  return renderToStaticMarkup(createElement(CustomerSiteForm, { customerId: site.customer_id, gridOwners: [], priceAreas: areas,
    site: current, commandKey }))
}
describe('site form preserves candidate and canonical routing distinction', () => {
  it('shows the persisted manual price-area hint while leaving canonical routing in the source row', () => {
    const current = { ...site, metadata: { claimed_price_area_code: 'SE4' } }
    expect(render(current)).toContain('<option value="SE4" selected="">')
    expect(current.price_area_code).toBe('SE3')
  })
  it('preserves an explicitly cleared hint and falls back for legacy rows with no hint', () => {
    expect(render({ ...site, metadata: { claimed_price_area_code: null } } as CustomerSiteRow)).toContain('<option value="" selected="">')
    expect(render(site)).toContain('<option value="SE3" selected="">')
  })
  it('renders the persisted revision and server key and disables every control when either is missing', () => {
    const confirmed = render(site)
    expect(confirmed).toContain('name="expected_site_revision" value="3"')
    expect(confirmed).toContain('name="idempotency_key" value="site-render-current-key"')
    expect(render({ ...site, site_revision: undefined })).toMatch(/^<fieldset disabled=""/)
    expect(render(site, '')).toMatch(/^<fieldset disabled=""/)
  })
})
