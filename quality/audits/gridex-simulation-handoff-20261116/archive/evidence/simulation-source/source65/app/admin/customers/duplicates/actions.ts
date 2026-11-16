'use server'

import { revalidatePath } from 'next/cache'
import { requireAdminActionAccess, requireCompanyScopedActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'

type CustomerForMerge = {
  id: string
  company_id: string | null
  customer_number: string | null
  full_name: string | null
  company_name: string | null
  email: string | null
  status: string | null
}

function getString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim()
}

function getStrings(formData: FormData, key: string): string[] {
  return formData
    .getAll(key)
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
}

async function loadCustomer(customerId: string): Promise<CustomerForMerge> {
  const { data, error } = await supabaseService
    .from('customers')
    .select('id, company_id, customer_number, full_name, company_name, email, status')
    .eq('id', customerId)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('Kunden hittades inte.')
  return data as CustomerForMerge
}

export async function mergeCustomersAction(formData: FormData) {
  await requireAdminActionAccess({ allOf: ['customers.write'] })
  const primaryCustomerId = getString(formData, 'primaryCustomerId')
  const reason = getString(formData, 'reason') || null
  const rawSourceIds = getStrings(formData, 'sourceCustomerIds')
  const sourceCustomerIds = Array.from(new Set(rawSourceIds)).filter(
    (id) => id && id !== primaryCustomerId
  )

  if (!primaryCustomerId) throw new Error('Välj huvudkund innan merge körs.')
  if (sourceCustomerIds.length === 0) throw new Error('Välj minst en kund som ska slås ihop till huvudkunden.')
  if (!reason) throw new Error('Ange orsak. Merge påverkar avtal, anläggningar, fullmakter, driftuppgifter och fakturering.')

  const primary = await loadCustomer(primaryCustomerId)
  if (!primary.company_id) throw new Error('Huvudkunden saknar bolagskoppling och kan inte användas för säker merge.')

  const admin = await requireCompanyScopedActionAccess(primary.company_id, { allOf: ['customers.write'] })
  const actorUserId = admin.userId
  // All sources move, are marked merged and are audited in one tenant-bound transaction.
  const { error } = await supabaseService.rpc('gridex_merge_customers_v1', {
    p_company_id: primary.company_id,
    p_primary_customer_id: primaryCustomerId,
    p_source_customer_ids: sourceCustomerIds,
    p_actor_user_id: actorUserId,
    p_reason: reason,
  })
  if (error) {
    if (error.message === 'customer_merge_source_not_found_for_tenant') {
      throw new Error('Merge mellan olika bolag/tenants är blockerad.')
    }
    throw error
  }

  revalidatePath('/admin/customers')
  revalidatePath('/admin/customers/duplicates')
  revalidatePath(`/admin/customers/${primaryCustomerId}`)
  for (const sourceId of sourceCustomerIds) revalidatePath(`/admin/customers/${sourceId}`)
}
