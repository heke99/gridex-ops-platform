import { ApiInputError } from '@/lib/api/strictRequest'
import { CustomerContactChangeError, normalizeContactEmail, normalizeContactPhone } from '@/lib/customer-service/contactChange'
import { maskIdentityNumber } from '@/lib/customer-service/identityChange'
import { getCustomerRecordForCompany, STAFF_CUSTOMER_CHILD_LIMIT, type StaffCustomerRecord, type StaffCustomerDetail } from '@/lib/customers/getCustomerForCompany'
import { publicReference, isPublicReference } from '@/lib/integrations/publicReferences'
import { tenantDb } from '@/lib/supabase/tenantDb'

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** The database resolves the opaque hash inside the company; a second scoped read proves ownership. */
export async function findStaffCustomer(companyId: string, reference: string): Promise<StaffCustomerRecord> {
  if (!companyId.trim()) throw new Error('customer_company_scope_required')
  if (!isPublicReference(reference) || !reference.startsWith('customer_')) {
    throw new ApiInputError('Kunden hittades inte.', 'customer_not_found', 404)
  }
  const db = tenantDb(companyId).unscoped() as unknown as {
    rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>
  }
  const result = await db.rpc('gridex_staff_customer_id_for_reference_v1', { p_company_id: companyId, p_reference: reference })
  if (result.error) throw result.error
  if (typeof result.data !== 'string') throw new ApiInputError('Kunden hittades inte.', 'customer_not_found', 404)
  const customer = await getCustomerRecordForCompany(companyId, result.data)
  if (publicReference('customer', companyId, customer.id) !== reference) {
    throw new ApiInputError('Kunden hittades inte.', 'customer_not_found', 404)
  }
  return customer
}

export function staffCustomerSummary(companyId: string, row: Record<string, unknown>) {
  return {
    customer_reference: publicReference('customer', companyId, row.id),
    customer_number: text(row.customer_number),
    customer_type: text(row.customer_type),
    status: text(row.status),
    display_name: text(row.full_name) ?? text(row.company_name) ?? ([text(row.first_name), text(row.last_name)].filter(Boolean).join(' ') || null),
    first_name: text(row.first_name),
    last_name: text(row.last_name),
    company_name: text(row.company_name),
    email: text(row.email),
    phone: text(row.phone),
    personal_number_masked: maskIdentityNumber(text(row.personal_number)),
    org_number_masked: maskIdentityNumber(text(row.org_number)),
    created_at: text(row.created_at),
  }
}

export function staffCustomerDetail(companyId: string, detail: StaffCustomerDetail) {
  const customer = detail.customer
  return {
    ...staffCustomerSummary(companyId, customer),
    invoice_email: text(customer.invoice_email),
    preferred_language: text(customer.preferred_language),
    apartment_number: text(customer.apartment_number),
    updated_at: text(customer.updated_at),
    contacts_page: detail.contactsPage ?? { limit: STAFF_CUSTOMER_CHILD_LIMIT, returned: detail.contacts.length, has_more: false },
    addresses_page: detail.addressesPage ?? { limit: STAFF_CUSTOMER_CHILD_LIMIT, returned: detail.addresses.length, has_more: false },
    sites_page: detail.sitesPage ?? { limit: STAFF_CUSTOMER_CHILD_LIMIT, returned: detail.sites.length, has_more: false },
    contacts: detail.contacts.map(row => ({
      contact_reference: publicReference('contact', companyId, row.id),
      type: text(row.type), name: text(row.name), email: text(row.email), phone: text(row.phone), title: text(row.title), is_primary: row.is_primary === true,
    })),
    addresses: detail.addresses.map(row => ({
      address_reference: publicReference('address', companyId, row.id),
      type: text(row.type), street_1: text(row.street_1), street_2: text(row.street_2), postal_code: text(row.postal_code), city: text(row.city), country: text(row.country), is_active: row.is_active === true,
    })),
    sites: detail.sites.map(row => ({
      facility_reference: publicReference('facility', companyId, row.id),
      site_name: text(row.site_name), facility_id: text(row.facility_id), site_type: text(row.site_type), status: text(row.status), price_area_code: text(row.price_area_code), street: text(row.street), postal_code: text(row.postal_code), city: text(row.city),
    })),
  }
}

export function rejectUnknownFields(body: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) throw new ApiInputError('Fältet kan inte ändras här.', 'field_not_allowed', 422, key)
  }
}

/** Strict, additive patch; identity numbers remain in the separate approval workflow. */
export function parseStaffContactPatch(body: Record<string, unknown>): {
  expectedUpdatedAt: string
  customerPatch: Record<string, string | null>
} {
  const allowed = ['email', 'phone', 'invoice_email', 'preferred_language', 'apartment_number'] as const
  rejectUnknownFields(body, ['expectedUpdatedAt', ...allowed])
  if (typeof body.expectedUpdatedAt !== 'string' || !body.expectedUpdatedAt.trim()) {
    throw new ApiInputError('expectedUpdatedAt krävs.', 'expected_updated_at_required', 422, 'expectedUpdatedAt')
  }
  const expectedUpdatedAt = body.expectedUpdatedAt.trim()
  const timestamp = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(expectedUpdatedAt)
  const invalidTimestamp = () => new ApiInputError('expectedUpdatedAt måste vara en giltig tidsstämpel.', 'invalid_expected_updated_at', 422, 'expectedUpdatedAt')
  if (!timestamp || !Number.isFinite(Date.parse(expectedUpdatedAt))) throw invalidTimestamp()
  const [year, month, day, hour, minute, second] = timestamp.slice(1, 7).map(Number)
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59 || Number(timestamp[7] ?? 0) > 23 || Number(timestamp[8] ?? 0) > 59) {
    throw invalidTimestamp()
  }
  const customerPatch: Record<string, string | null> = {}
  for (const key of allowed) {
    if (!Object.hasOwn(body, key)) continue
    const value = body[key]
    if (value !== null && typeof value !== 'string') throw new ApiInputError('Fältet måste vara text eller null.', 'invalid_field', 422, key)
    try {
      if (key === 'email' || key === 'invoice_email') customerPatch[key] = normalizeContactEmail(value) ?? null
      else if (key === 'phone') customerPatch[key] = normalizeContactPhone(value) ?? null
      else {
        const normalized = value?.trim() || null
        if (normalized && normalized.length > 20) throw new ApiInputError('Fältet är för långt.', 'invalid_field', 422, key)
        customerPatch[key] = normalized
      }
    } catch (error) {
      if (error instanceof CustomerContactChangeError) throw new ApiInputError(error.message, error.code, 422, key)
      throw error
    }
  }
  if (!Object.keys(customerPatch).length) throw new ApiInputError('Minst ett kontaktfält krävs.', 'contact_patch_empty', 422)
  return { expectedUpdatedAt, customerPatch }
}
