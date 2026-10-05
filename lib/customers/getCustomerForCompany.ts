import { ApiInputError } from '@/lib/api/strictRequest'
import { tenantSelect } from '@/lib/supabase/tenantQuery'
import { readCustomerRecordTombstones } from '@/lib/ediel/retention/customerRecordClasses'

/** Deliberately excludes metadata, creator IDs and all privileged operational fields. */
export const STAFF_CUSTOMER_SELECT = 'id,customer_type,status,customer_number,first_name,last_name,full_name,company_name,personal_number,org_number,email,phone,invoice_email,preferred_language,apartment_number,created_at,updated_at'
export type StaffCustomerRecord = Record<string, unknown> & { id: string }
export const STAFF_CUSTOMER_CHILD_LIMIT = 100
export type StaffCustomerCollectionPage = { limit: number; returned: number; has_more: boolean }
export type StaffCustomerDetail = {
  customer: StaffCustomerRecord
  contacts: Record<string, unknown>[]
  addresses: Record<string, unknown>[]
  sites: Record<string, unknown>[]
  contactsPage?: StaffCustomerCollectionPage
  addressesPage?: StaffCustomerCollectionPage
  sitesPage?: StaffCustomerCollectionPage
}

function requireCompany(companyId: string): void {
  if (!companyId.trim()) throw new Error('customer_company_scope_required')
}

export async function getCustomerRecordForCompany(companyId: string, customerId: string): Promise<StaffCustomerRecord> {
  requireCompany(companyId)
  const result = await tenantSelect(companyId, 'customers', STAFF_CUSTOMER_SELECT).eq('id', customerId).maybeSingle()
  if (result.error) throw result.error
  if (!result.data) throw new ApiInputError('Kunden hittades inte.', 'customer_not_found', 404)
  return result.data as StaffCustomerRecord
}

/** Every child query repeats both company and customer ownership. No unscoped OPS lookup is used. */
export async function getCustomerForCompany(companyId: string, customerId: string): Promise<StaffCustomerDetail> {
  const customer = await getCustomerRecordForCompany(companyId, customerId)
  const [contacts, addresses, sites, tombstones] = await Promise.all([
    tenantSelect(companyId, 'customer_contacts', 'id,type,name,email,phone,title,is_primary')
      .eq('customer_id', customerId).order('is_primary', { ascending: false }).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(STAFF_CUSTOMER_CHILD_LIMIT + 1),
    tenantSelect(companyId, 'customer_addresses', 'id,type,street_1,street_2,postal_code,city,country,is_active')
      .eq('customer_id', customerId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(STAFF_CUSTOMER_CHILD_LIMIT + 1),
    tenantSelect(companyId, 'customer_sites', 'id,site_name,facility_id,site_type,status,price_area_code,street,postal_code,city')
      .eq('customer_id', customerId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(STAFF_CUSTOMER_CHILD_LIMIT + 1),
    readCustomerRecordTombstones({ companyId, customerId }),
  ])
  for (const result of [contacts, addresses, sites]) if (result.error) throw result.error
  const deletedAddresses = new Set(tombstones.filter(row => row.retentionClass === 'customer_address_history').map(row => row.targetId))
  const initial = (data: unknown[]) => data.slice(0, STAFF_CUSTOMER_CHILD_LIMIT) as Record<string, unknown>[]
  const contactRows = initial(contacts.data ?? [])
  const addressRows = initial(addresses.data ?? []).filter(row => !deletedAddresses.has(String(row.id)))
  const siteRows = initial(sites.data ?? [])
  const page = (raw: unknown[], visible: unknown[]): StaffCustomerCollectionPage => ({
    limit: STAFF_CUSTOMER_CHILD_LIMIT, returned: visible.length, has_more: raw.length > STAFF_CUSTOMER_CHILD_LIMIT,
  })
  return {
    customer, contacts: contactRows, addresses: addressRows, sites: siteRows,
    contactsPage: page(contacts.data ?? [], contactRows),
    addressesPage: page(addresses.data ?? [], addressRows),
    sitesPage: page(sites.data ?? [], siteRows),
  }
}
