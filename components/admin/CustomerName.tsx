import { cache } from 'react'
import { supabaseService } from '@/lib/supabase/service'

type CustomerNameRow = {
  full_name: string | null
  first_name: string | null
  last_name: string | null
  company_name: string | null
  customer_number: string | null
}

// One lookup per customer per request; rows shown here are already tenant-scoped.
const loadCustomerName = cache(async (id: string): Promise<CustomerNameRow | null> => {
  const { data } = await supabaseService
    .from('customers')
    .select('full_name, first_name, last_name, company_name, customer_number')
    .eq('id', id)
    .maybeSingle()
  return (data as CustomerNameRow | null) ?? null
})

export function formatCustomerName(row: CustomerNameRow | null): string {
  if (!row) return 'Okänd kund'
  const name =
    row.company_name?.trim() ||
    row.full_name?.trim() ||
    [row.first_name, row.last_name].filter(Boolean).join(' ').trim()
  if (name && row.customer_number) return `${name} (${row.customer_number})`
  return name || row.customer_number || 'Namn saknas'
}

/** Customer name and number instead of a raw UUID. */
export default async function CustomerName({ id }: { id: string | null | undefined }) {
  if (!id) return <>—</>
  return <>{formatCustomerName(await loadCustomerName(id))}</>
}
