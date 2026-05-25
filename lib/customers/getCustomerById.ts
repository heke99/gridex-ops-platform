// lib/customers/getCustomerById.ts
import { supabaseService } from '@/lib/supabase/service'
import type { CustomerDetailData } from '@/types/customers'

export async function getCustomerById(
  customerId: string
): Promise<CustomerDetailData> {
  const { data: customer, error: customerError } = await supabaseService
    .from('customers')
    .select('*')
    .eq('id', customerId)
    .single()

  if (customerError) throw customerError

  const companyId = typeof customer.company_id === 'string' ? customer.company_id : null

  let contactsQuery = supabaseService
    .from('customer_contacts')
    .select('*')
    .eq('customer_id', customerId)

  if (companyId) {
    contactsQuery = contactsQuery.eq('company_id', companyId)
  }

  const { data: contacts, error: contactsError } = await contactsQuery
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: false })

  if (contactsError) throw contactsError

  let addressesQuery = supabaseService
    .from('customer_addresses')
    .select('*')
    .eq('customer_id', customerId)

  if (companyId) {
    addressesQuery = addressesQuery.eq('company_id', companyId)
  }

  const { data: addresses, error: addressesError } = await addressesQuery
    .order('created_at', { ascending: false })

  if (addressesError) throw addressesError

  let sitesQuery = supabaseService
    .from('customer_sites')
    .select(
      `
      *,
      grid_owners(id, name, owner_code),
      price_areas(code, name)
    `
    )
    .eq('customer_id', customerId)

  if (companyId) {
    sitesQuery = sitesQuery.eq('company_id', companyId)
  }

  const { data: sites, error: sitesError } = await sitesQuery
    .order('created_at', { ascending: false })

  if (sitesError) throw sitesError

  let notesQuery = supabaseService
    .from('customer_internal_notes')
    .select('*')
    .eq('customer_id', customerId)

  if (companyId) {
    notesQuery = notesQuery.eq('company_id', companyId)
  }

  const { data: notes, error: notesError } = await notesQuery
    .order('created_at', { ascending: false })
    .limit(50)

  if (notesError) throw notesError

  return {
    customer,
    contacts: contacts ?? [],
    addresses: addresses ?? [],
    sites: sites ?? [],
    notes: notes ?? [],
  }
}
