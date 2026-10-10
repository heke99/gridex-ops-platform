import { describe, expect, it } from 'vitest'
import { websiteApplicationPayloadToIntakeRow } from '@/lib/website/applicationCustomerIntakeRow'
import { canCloseInfoRequest, validateInfoRequestClosure } from '@/lib/onboarding/infoRequestClosure'
import { matchPortalRepliesToRequests, type InfoRequestPortalReply } from '@/lib/onboarding/infoRequestPortalReplies'
import { catalogPricesOverridden, validateContractPricing } from '@/lib/customer-contracts/pricingValidation'
import {
  portalCaseStatusLabel,
  portalInfoRequestStatusLabel,
  portalInvoiceLineTypeLabel,
  portalInvoiceTitle,
  portalSiteStatusLabel,
} from '@/lib/customer-portal/labels'
import { decidePostLoginPath } from '@/lib/auth/postLoginDestination'

describe('websiteApplicationPayloadToIntakeRow', () => {
  it('maps a private application and splits the full name', () => {
    const row = websiteApplicationPayloadToIntakeRow(
      {
        customer: { full_name: 'Anna Maria Svensson', email: 'anna@example.se', personal_number: '19900101-1234' },
        site: { street: 'Gatan 1', postal_code: '12345', city: 'Ort', facility_id: 'F1', price_area_code: 'se3' },
        metering_point: { metering_point_id: '735999' },
      },
      { grid_owner_id: 'go-1' },
    )
    expect(row).toMatchObject({
      customer_type: 'private',
      first_name: 'Anna',
      last_name: 'Maria Svensson',
      email: 'anna@example.se',
      personal_number: '19900101-1234',
      street: 'Gatan 1',
      facility_id: 'F1',
      meter_point_id: '735999',
      grid_owner_id: 'go-1',
      price_area_code: 'SE3',
      country: 'SE',
    })
    expect(row.company_name).toBeUndefined()
    expect(row.contract_offer_id).toBeUndefined()
  })

  it('treats an application with company name as business and drops personal number', () => {
    const row = websiteApplicationPayloadToIntakeRow({ customer: { company_name: 'AB', org_number: '556677-8899', personal_number: 'x' } })
    expect(row.customer_type).toBe('business')
    expect(row.company_name).toBe('AB')
    expect(row.org_number).toBe('556677-8899')
    expect(row.personal_number).toBeUndefined()
  })

  it('tolerates missing payloads', () => {
    expect(websiteApplicationPayloadToIntakeRow(null)).toEqual({ customer_type: 'private', country: 'SE' })
  })
})

describe('validateInfoRequestClosure', () => {
  it('allows cancel/complete with a reason from an open status', () => {
    expect(validateInfoRequestClosure({ currentStatus: 'draft', targetStatus: 'cancelled', reason: 'Kunden ångrade sig' })).toBeNull()
    expect(validateInfoRequestClosure({ currentStatus: 'z02_received', targetStatus: 'completed', reason: 'Klart' })).toBeNull()
  })

  it('rejects unknown target statuses, missing reasons, closed and in-flight requests', () => {
    expect(validateInfoRequestClosure({ currentStatus: 'draft', targetStatus: 'rejected', reason: 'abc' })).toMatch(/Ogiltig status/)
    expect(validateInfoRequestClosure({ currentStatus: 'draft', targetStatus: 'cancelled', reason: ' ' })).toMatch(/orsak/)
    expect(validateInfoRequestClosure({ currentStatus: 'completed', targetStatus: 'cancelled', reason: 'abc' })).toMatch(/redan stängt/)
    expect(validateInfoRequestClosure({ currentStatus: 'waiting_for_z02', targetStatus: 'cancelled', reason: 'abc' })).toMatch(/väntar på svar/)
    expect(canCloseInfoRequest('waiting_for_aperak')).toBe(false)
    expect(canCloseInfoRequest('blocked')).toBe(true)
  })
})

describe('matchPortalRepliesToRequests', () => {
  const reply = (overrides: Partial<InfoRequestPortalReply>): InfoRequestPortalReply => ({
    id: 'r', customer_id: 'c1', completion_type: 'missing_information', status: 'submitted', submitted_payload: {}, linked_info_request_id: null, created_at: '2026-10-05T00:00:00Z', ...overrides,
  })

  it('prefers explicit links and otherwise attaches to the latest earlier request of the same customer', () => {
    const requests = [
      { id: 'a', customer_id: 'c1', created_at: '2026-10-01T00:00:00Z' },
      { id: 'b', customer_id: 'c1', created_at: '2026-10-04T00:00:00Z' },
      { id: 'c', customer_id: 'c2', created_at: '2026-10-01T00:00:00Z' },
    ]
    const result = matchPortalRepliesToRequests(requests, [
      reply({ id: 'linked', linked_info_request_id: 'a' }),
      reply({ id: 'late' }),
      reply({ id: 'before-all', created_at: '2026-09-01T00:00:00Z' }),
      reply({ id: 'other-customer', customer_id: 'c3' }),
      reply({ id: 'foreign-link', linked_info_request_id: 'zzz' }),
    ])
    expect(result.get('a')?.map((r) => r.id)).toEqual(['linked'])
    expect(result.get('b')?.map((r) => r.id)).toEqual(['late'])
    expect(result.get('c')).toBeUndefined()
  })
})

describe('validateContractPricing', () => {
  it('requires the matching price for custom pricing', () => {
    expect(validateContractPricing({ contractType: 'fixed', customPricing: true, catalogOverridden: false }).fixedPriceOrePerKwh).toBeTruthy()
    expect(validateContractPricing({ contractType: 'variable_hourly', customPricing: true, catalogOverridden: false }).spotMarkupOrePerKwh).toBeTruthy()
    expect(validateContractPricing({ contractType: 'fixed', customPricing: true, catalogOverridden: false, fixedPriceOrePerKwh: 0 })).toEqual({})
    expect(validateContractPricing({ contractType: 'fixed', customPricing: false, catalogOverridden: false })).toEqual({})
  })

  it('requires an override reason and ordered dates', () => {
    expect(validateContractPricing({ contractType: 'fixed', customPricing: false, catalogOverridden: true }).overrideReason).toBeTruthy()
    expect(validateContractPricing({ contractType: 'fixed', customPricing: false, catalogOverridden: true, overrideReason: 'Kampanj' })).toEqual({})
    expect(validateContractPricing({ contractType: null, customPricing: false, catalogOverridden: false, startsAt: '2026-05-01', endsAt: '2026-04-30' }).contractEndDate).toBeTruthy()
    expect(validateContractPricing({ contractType: null, customPricing: false, catalogOverridden: false, startsAt: '2026-05-01', endsAt: '2026-05-01' })).toEqual({})
  })

  it('detects catalog overrides only for changed submitted values', () => {
    const catalog = { fixed_price_ore_per_kwh: 89.5, monthly_fee_sek: 39 }
    expect(catalogPricesOverridden(catalog, { fixedPriceOrePerKwh: 89.5, monthlyFeeSek: 39 })).toBe(false)
    expect(catalogPricesOverridden(catalog, { fixedPriceOrePerKwh: null })).toBe(false)
    expect(catalogPricesOverridden(catalog, { fixedPriceOrePerKwh: 80 })).toBe(true)
    expect(catalogPricesOverridden(catalog, { spotMarkupOrePerKwh: 5 })).toBe(true)
    expect(catalogPricesOverridden(null, { fixedPriceOrePerKwh: 80 })).toBe(false)
  })
})

describe('customer portal labels', () => {
  it('maps codes to Swedish and never leaks unknown snake_case codes', () => {
    expect(portalCaseStatusLabel('awaiting_external_response')).toBe('Väntar på svar')
    expect(portalInfoRequestStatusLabel('waiting_for_z02')).toBe('Väntar på svar från nätägaren')
    expect(portalSiteStatusLabel('some_internal_code')).toBe('Under handläggning')
    expect(portalInvoiceLineTypeLabel('energy')).toBe('Elenergi')
    expect(portalInvoiceLineTypeLabel(null)).toBe('Övrigt')
  })

  it('builds invoice titles without falling back to ids', () => {
    expect(portalInvoiceTitle({ invoice_number: '1001' })).toBe('Faktura 1001')
    expect(portalInvoiceTitle({ invoice_number: null, issued_at: '2026-03-15T10:00:00Z' })).toBe('Faktura 2026-03-15')
    expect(portalInvoiceTitle({})).toBe('Faktura')
  })
})

describe('decidePostLoginPath', () => {
  it('sends customer-only users to the portal only for the default landing', () => {
    expect(decidePostLoginPath({ next: '/dashboard', hasStaffAccess: false })).toBe('/portal')
    expect(decidePostLoginPath({ next: '/dashboard', hasStaffAccess: true })).toBe('/dashboard')
    expect(decidePostLoginPath({ next: '/admin/customers', hasStaffAccess: false })).toBe('/admin/customers')
  })
})
