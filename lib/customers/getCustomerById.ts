import { supabaseService } from '@/lib/supabase/service'
import type { CustomerDetailData } from '@/types/customers'

export async function getCustomerById(customerId: string): Promise<CustomerDetailData> {
  const { data: customer, error: customerError } = await supabaseService
    .from('customers')
    .select('*')
    .eq('id', customerId)
    .single()

  if (customerError) throw customerError

  const { data: contacts, error: contactsError } = await supabaseService
    .from('customer_contacts')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })

  if (contactsError) throw contactsError

  const { data: addresses, error: addressesError } = await supabaseService
    .from('customer_addresses')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })

  if (addressesError) throw addressesError

  const { data: sites, error: sitesError } = await supabaseService
    .from('sites')
    .select(`
      *,
      grid_owners(id, name, code),
      price_areas(id, code, name)
    `)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })

  if (sitesError) throw sitesError

  const { data: notes, error: notesError } = await supabaseService
    .from('customer_notes')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })

  if (notesError) throw notesError

  return {
    customer,
    contacts: contacts ?? [],
    addresses: addresses ?? [],
    sites: sites ?? [],
    notes: notes ?? [],
  }
}